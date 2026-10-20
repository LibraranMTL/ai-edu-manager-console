'use strict';
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { const error = Error(message); error.status = status; throw error; };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function safeContent(content) {
  if (typeof content === 'string') return true;
  if (!Array.isArray(content) || content.length < 1 || content.length > 6) return false;
  return content.every(part => {
    if (part?.type === 'text') return typeof part.text === 'string' && Object.keys(part).every(key => ['type','text'].includes(key));
    if (part?.type !== 'image_url' || Object.keys(part).some(key => !['type','image_url'].includes(key)) || !part.image_url || Object.keys(part.image_url).some(key => key !== 'url')) return false;
    return typeof part.image_url.url === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(part.image_url.url) && part.image_url.url.length <= 750000;
  });
}

/** Isolated pilot module, NOT automatically mounted on the production document server.
 * Deployment must supply real license + device-proof + student-binding authorization and
 * revocation checks. No permissive fallback and no provider credential is returned to clients. */
function createModelGatewayPilot({ databasePath, authorize, isSessionActive, providerRequest, models, now = Date.now, allowEphemeralTestStore = false, monthlyLimit = 200 }) {
  if (!databasePath || typeof authorize !== 'function' || typeof isSessionActive !== 'function' || typeof providerRequest !== 'function' || !Array.isArray(models) || !models.length) throw Error('Gateway requires persistent storage, authorization, revocation and provider adapters');
  if (databasePath === ':memory:' && !allowEphemeralTestStore) throw Error('Production gateway requires durable receipts');
  if (!Number.isSafeInteger(monthlyLimit) || monthlyLimit < 1 || monthlyLimit > 100000) throw Error('Invalid monthly request limit');
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS gateway_sessions(tokenHash TEXT PRIMARY KEY, licenseId TEXT NOT NULL, deviceId TEXT NOT NULL, studentId TEXT NOT NULL, issuedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, dailyLimit INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS gateway_requests(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT, createdAt INTEGER NOT NULL, completedAt INTEGER);
    CREATE TABLE IF NOT EXISTS gateway_budget(licenseId TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(licenseId,day));`);
  const allowedModels = new Set(models);
  const inFlight = new Map();
  async function issue(input) {
    if (!id(input?.deviceId) || !id(input?.studentId) || !input?.proof || JSON.stringify(input.proof).length > 16_000) fail(400, 'Invalid session proof');
    const scope = await authorize(input); // Must validate signed license AND device proof AND exact student binding.
    const issuedAt = now();
    db.prepare('DELETE FROM gateway_sessions WHERE expiresAt < ?').run(issuedAt);
    if (!scope || !id(scope.licenseId) || scope.deviceId !== input.deviceId || scope.studentId !== input.studentId || !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt <= issuedAt || !Number.isInteger(scope.dailyLimit) || scope.dailyLimit < 1 || scope.dailyLimit > 1000) fail(403, 'Scope not authorized');
    const expiresAt = Math.min(issuedAt + 300_000, scope.expiresAt);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO gateway_sessions VALUES (?,?,?,?,?,?,?)').run(hash(token), scope.licenseId, scope.deviceId, scope.studentId, issuedAt, expiresAt, scope.dailyLimit);
    return { schema: 'edu-manager.model-gateway-session.v1', token, deviceId: scope.deviceId, studentId: scope.studentId, issuedAt, expiresAt };
  }
  async function generate(input) {
    if (typeof input?.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(input.token)) fail(401, 'Short credential required');
    const session = db.prepare('SELECT * FROM gateway_sessions WHERE tokenHash=?').get(hash(input.token));
    if (!session || session.expiresAt <= now() || session.issuedAt > now() + 60_000) fail(401, 'Session expired');
    if (session.studentId !== input.studentId || session.deviceId !== input.deviceId || !await isSessionActive(session)) fail(403, 'Session scope revoked or mismatched');
    if (!allowedModels.has(input.model) || !id(input.idempotencyKey) || !Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 8000 || typeof input.webResearch !== 'boolean') fail(400, 'Invalid bounded model request');
    if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 30 || JSON.stringify(input.messages).length > 1_000_000 || input.messages.some(message => !['system','user','assistant'].includes(message.role) || !safeContent(message.content) || Object.keys(message).some(key => !['role','content'].includes(key)))) fail(400, 'Unsupported messages; tools and remote file operations are forbidden');
    const request = { model: input.model, messages: input.messages, maxOutputTokens: input.maxOutputTokens, webResearch: input.webResearch };
    const fingerprint = hash(JSON.stringify(request));
    const requestId = hash(`${session.licenseId}:${session.deviceId}:${session.studentId}:${input.idempotencyKey}`);
    const old = db.prepare('SELECT * FROM gateway_requests WHERE id=?').get(requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) fail(409, 'Idempotency content conflict');
      if (old.state === 'succeeded') return JSON.parse(old.result);
      fail(409, 'Result requires user verification; request is not repeated');
    }
    if ((inFlight.get(session.licenseId) || 0) >= 2) fail(429, 'License concurrency limit reached');
    db.exec('BEGIN IMMEDIATE');
    try {
      const day = new Date(now()).toISOString().slice(0, 10);
      const budget = db.prepare('SELECT used FROM gateway_budget WHERE licenseId=? AND day=?').get(session.licenseId, day);
      if ((budget?.used || 0) >= session.dailyLimit) fail(429, 'Daily request budget exhausted');
      const monthly = db.prepare('SELECT COALESCE(SUM(used),0) AS used FROM gateway_budget WHERE licenseId=? AND day LIKE ?').get(session.licenseId, day.slice(0, 7) + '%');
      if (monthly.used >= monthlyLimit) fail(429, 'Monthly request budget exhausted');
      db.prepare('INSERT INTO gateway_requests VALUES (?,?,?,NULL,?,NULL)').run(requestId, fingerprint, 'running', now());
      db.prepare('INSERT INTO gateway_budget VALUES (?,?,1) ON CONFLICT(licenseId,day) DO UPDATE SET used=used+1').run(session.licenseId, day);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    inFlight.set(session.licenseId, (inFlight.get(session.licenseId) || 0) + 1);
    try {
      const result = await providerRequest(request, { requestId, studentId: session.studentId, deviceId: session.deviceId });
      if (!result || typeof result.text !== 'string' || !result.text.trim() || JSON.stringify(result).length > 1_000_000 || !Array.isArray(result.sources)) throw Error('Invalid provider response');
      if (input.webResearch && !result.sources.length) throw Error('Research has no supplier sources');
      for (const source of result.sources) { const url = new URL(source.url); if (!['http:','https:'].includes(url.protocol) || url.username || url.password || typeof source.title !== 'string') throw Error('Invalid supplier source'); }
      // Allow-list output: provider API keys, raw transport payloads and internal fields cannot escape.
      const usage = Object.fromEntries(['inputTokens','outputTokens','totalTokens'].map(key => [key, Number.isSafeInteger(result.usage?.[key]) && result.usage[key] >= 0 ? result.usage[key] : null]));
      const output = { text: result.text, requestId, providerRequestId: typeof result.providerRequestId === 'string' ? result.providerRequestId.slice(0, 256) : '', usage, sources: result.sources.map(({ title, url }) => ({ title, url })) };
      db.prepare("UPDATE gateway_requests SET state='succeeded',result=?,completedAt=? WHERE id=? AND state='running'").run(JSON.stringify(output), now(), requestId);
      return output;
    } catch (error) {
      db.prepare("UPDATE gateway_requests SET state='unknown',completedAt=? WHERE id=? AND state='running'").run(now(), requestId);
      fail(502, 'Provider outcome unknown; verify before any new request');
    } finally {
      const count = (inFlight.get(session.licenseId) || 1) - 1;
      if (count === 0) inFlight.delete(session.licenseId); else inFlight.set(session.licenseId, count);
    }
  }
  return { issue, generate, close: () => db.close() };
}
module.exports = { createModelGatewayPilot };
