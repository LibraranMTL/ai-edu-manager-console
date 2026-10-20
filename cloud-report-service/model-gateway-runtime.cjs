'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createModelGatewayPilot } = require('./model-gateway-pilot.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const deny = () => { const error = Error('License, device proof or exact student grant rejected'); error.status = 403; throw error; };

/** Registry is administered outside the request path. No auto-enrollment or local-active fallback. */
function createRegistryAuthorization({ registryPath, trustedIssuersPath, nonceDatabasePath, now = Date.now }) {
  if (!registryPath || !trustedIssuersPath || !nonceDatabasePath || nonceDatabasePath === ':memory:') throw Error('Persistent registry, issuer trust and replay store required');
  const db = new DatabaseSync(nonceDatabasePath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS proof_nonces(deviceId TEXT NOT NULL,nonce TEXT NOT NULL,expiresAt INTEGER NOT NULL,PRIMARY KEY(deviceId,nonce));');
  function grants() {
    const root = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (root.schema !== 'edu-manager.model-gateway-grants.v1' || !Array.isArray(root.grants) || root.grants.length > 10000) deny();
    return root.grants;
  }
  function active(session) {
    return grants().some(grant => grant.enabled === true && grant.licenseId === session.licenseId && grant.deviceId === session.deviceId &&
      grant.studentId === session.studentId && (session.dailyLimit === undefined || grant.dailyLimit === session.dailyLimit) && Number.isSafeInteger(grant.expiresAt) && grant.expiresAt > now());
  }
  async function authorize(input) {
    const proof = input.proof;
    if (typeof proof.licenseToken !== 'string' || !Number.isSafeInteger(proof.issuedAt) || Math.abs(now() - proof.issuedAt) > 60000 ||
        typeof proof.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(proof.nonce) || typeof proof.signature !== 'string') deny();
    const parts = proof.licenseToken.split('.'); if (parts.length !== 3 || parts[0] !== 'AIE3') deny();
    let license; try { license = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { deny(); }
    const trust = JSON.parse(fs.readFileSync(trustedIssuersPath, 'utf8'));
    if (trust.schema !== 'edu-manager.license-trusted-issuers.v1' || !Array.isArray(trust.issuers)) deny();
    const issuer = trust.issuers.find(value => value.keyId === license.keyId);
    if (!issuer || !crypto.verify('RSA-SHA256', Buffer.from(`AIE3.${parts[1]}`), issuer.publicKey, Buffer.from(parts[2], 'base64url'))) deny();
    if (license.schema !== 'edu-manager.license.v3' || license.productId !== 'ANDROID_STANDALONE' ||
        license.deviceId !== input.deviceId || !Number.isSafeInteger(license.maxActiveStudents) || license.maxActiveStudents < 1 ||
        !Number.isFinite(Date.parse(license.issuedAt)) || Date.parse(license.issuedAt) > now() + 60000 ||
        (license.expiresAt && (!Number.isFinite(Date.parse(license.expiresAt)) || Date.parse(license.expiresAt) <= now()))) deny();
    const registry = grants(); const grant = registry.find(value => value.licenseId === license.licenseId && value.deviceId === input.deviceId && value.studentId === input.studentId);
    if (!grant || !active(grant) || !Number.isInteger(grant.dailyLimit) || grant.dailyLimit < 1 || grant.dailyLimit > 1000 ||
        registry.filter(value => value.enabled && value.licenseId === license.licenseId && value.expiresAt > now()).length > license.maxActiveStudents) deny();
    const message = `${input.deviceId}\n${input.studentId}\n${proof.issuedAt}\n${proof.nonce}\n${sha(proof.licenseToken)}`;
    let verified = false;
    try { verified = crypto.verify('sha256', Buffer.from(message), { key: Buffer.from(grant.publicKeyDer, 'base64'), format: 'der', type: 'spki' }, Buffer.from(proof.signature, 'base64')); } catch { deny(); }
    if (!verified) deny();
    db.prepare('DELETE FROM proof_nonces WHERE expiresAt < ?').run(now());
    try { db.prepare('INSERT INTO proof_nonces VALUES (?,?,?)').run(input.deviceId, proof.nonce, now() + 120000); } catch { deny(); }
    return { licenseId: grant.licenseId, deviceId: input.deviceId, studentId: input.studentId,
      expiresAt: Math.min(grant.expiresAt, license.expiresAt ? Date.parse(license.expiresAt) : grant.expiresAt), dailyLimit: grant.dailyLimit };
  }
  return { authorize, isSessionActive: active, close: () => db.close() };
}

function createProviderRequest({ endpoint, apiKey, fetchImpl = fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || typeof apiKey !== 'string' || !apiKey.trim()) throw Error('HTTPS provider endpoint and server-only credential required');
  return async request => {
    const body = { model: request.model, messages: request.messages, max_tokens: request.maxOutputTokens, temperature: 0.2, enable_thinking: false };
    if (request.webResearch) { body.enable_search = true; body.search_options = { search_strategy: 'standard', enable_source: true }; }
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
    if (!response.ok) throw Error('Provider request rejected');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 1000000) throw Error('Provider response exceeds limit'); chunks.push(Buffer.from(value)); } } finally { await reader.cancel().catch(() => {}); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const sources = value.search_info?.search_results || value.choices?.[0]?.message?.search_info?.search_results || [];
    return { text: value.choices?.[0]?.message?.content, providerRequestId: response.headers.get('x-request-id') || value.id || '', usage: { inputTokens: value.usage?.prompt_tokens, outputTokens: value.usage?.completion_tokens, totalTokens: value.usage?.total_tokens },
      sources: sources.map(source => ({ title: source.title || source.url, url: source.url })) };
  };
}

function fromEnvironment(env, dataDir) {
  if (env.EDU_MODEL_GATEWAY_ENABLED !== '1') return undefined;
  fs.mkdirSync(dataDir, { recursive: true });
  const auth = createRegistryAuthorization({ registryPath: env.EDU_MODEL_GATEWAY_REGISTRY, trustedIssuersPath: env.EDU_MODEL_GATEWAY_ISSUERS,
    nonceDatabasePath: path.join(dataDir, 'gateway-nonces.sqlite') });
  try {
    const gateway = createModelGatewayPilot({ databasePath: path.join(dataDir, 'gateway-receipts.sqlite'),
      authorize: auth.authorize, isSessionActive: auth.isSessionActive, providerRequest: createProviderRequest({ endpoint: env.EDU_MODEL_PROVIDER_ENDPOINT, apiKey: env.EDU_MODEL_PROVIDER_KEY }),
      monthlyLimit: env.EDU_MODEL_GATEWAY_MONTHLY_LIMIT === undefined ? 200 : Number(env.EDU_MODEL_GATEWAY_MONTHLY_LIMIT),
      models: String(env.EDU_MODEL_GATEWAY_MODELS || '').split(',').map(value => value.trim()).filter(Boolean) });
    return { issue: gateway.issue, generate: gateway.generate, close() { gateway.close(); auth.close(); } };
  } catch (error) { auth.close(); throw error; }
}
module.exports = { createRegistryAuthorization, createProviderRequest, fromEnvironment };
