'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { createRegistryAuthorization, createProviderRequest, fromEnvironment } = require('./model-gateway-runtime.cjs');
const { createModelGatewayPilot } = require('./model-gateway-pilot.cjs');
test('monthly rejection does not leak concurrency and replay does not reserve twice', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-monthly-')); let clock = Date.UTC(2026, 9, 2); let calls = 0;
  const gateway = createModelGatewayPilot({ databasePath: path.join(root, 'receipts.sqlite'), models: ['model'], monthlyLimit: 1, now: () => clock,
    authorize: async input => ({ licenseId: 'license', deviceId: input.deviceId, studentId: input.studentId, expiresAt: clock + 600000, dailyLimit: 6 }),
    isSessionActive: async () => true, providerRequest: async () => { calls++; return { text: 'candidate', sources: [] }; } });
  const request = (session, key) => ({ ...session, model: 'model', idempotencyKey: key, maxOutputTokens: 100, webResearch: false, messages: [{ role: 'user', content: 'synthetic' }] });
  try {
    let session = await gateway.issue({ deviceId: 'device', studentId: 'student', proof: { fixture: true } });
    await gateway.generate(request(session, 'first')); await gateway.generate(request(session, 'first')); assert.equal(calls, 1);
    for (let index = 0; index < 3; index++) await assert.rejects(gateway.generate(request(session, `rejected-${index}`)), error => error.status === 429);
    clock = Date.UTC(2026, 10, 2); session = await gateway.issue({ deviceId: 'device', studentId: 'student', proof: { fixture: true } });
    await gateway.generate(request(session, 'next-month')); assert.equal(calls, 2);
  } finally { gateway.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('gateway bounds in-flight calls and accepts inline images but never remote image URLs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-concurrency-')); const releases = []; let calls = 0;
  const gateway = createModelGatewayPilot({ databasePath: path.join(root, 'receipts.sqlite'), models: ['model'],
    authorize: async input => ({ licenseId: 'license', deviceId: input.deviceId, studentId: input.studentId, expiresAt: Date.now() + 600000, dailyLimit: 6 }),
    isSessionActive: async () => true, providerRequest: () => { calls++; return new Promise(resolve => releases.push(() => resolve({ text: 'candidate', sources: [] }))); } });
  try {
    const session = await gateway.issue({ deviceId: 'device', studentId: 'student', proof: { fixture: true } });
    const request = key => ({ ...session, model: 'model', idempotencyKey: key, maxOutputTokens: 100, webResearch: false,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] }] });
    const first = gateway.generate(request('first')); const second = gateway.generate(request('second'));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2);
    await assert.rejects(gateway.generate(request('third')), error => error.status === 429);
    await assert.rejects(gateway.generate({ ...request('remote'), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.org/image.png' } }] }] }), error => error.status === 400);
    releases[0](); await first;
    const third = gateway.generate(request('third')); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 3);
    releases[1](); releases[2](); await Promise.all([second, third]);
  } finally { gateway.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('real signature authorization rejects forged license, device replay, cross-student and revoked binding', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-runtime-'));
  const issuer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); const device = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const now = Date.now(); const registryPath = path.join(root, 'registry.json'); const trustedIssuersPath = path.join(root, 'issuers.json');
  const grant = { enabled: true, licenseId: 'license', deviceId: 'device', studentId: 'student', expiresAt: now + 600000, dailyLimit: 6,
    publicKeyDer: device.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const save = () => fs.writeFileSync(registryPath, JSON.stringify({ schema: 'edu-manager.model-gateway-grants.v1', grants: [grant] })); save();
  fs.writeFileSync(trustedIssuersPath, JSON.stringify({ schema: 'edu-manager.license-trusted-issuers.v1', issuers: [{ keyId: 'issuer', publicKey: issuer.publicKey.export({ type: 'spki', format: 'pem' }) }] }));
  const payload = Buffer.from(JSON.stringify({ schema: 'edu-manager.license.v3', productId: 'ANDROID_STANDALONE', keyId: 'issuer', licenseId: 'license',
    deviceId: 'device', maxActiveStudents: 1, issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 600000).toISOString() })).toString('base64url');
  const token = `AIE3.${payload}.${crypto.sign('RSA-SHA256', Buffer.from(`AIE3.${payload}`), issuer.privateKey).toString('base64url')}`;
  function input(studentId = 'student', licenseToken = token) {
    const nonce = crypto.randomUUID(); const message = `device\n${studentId}\n${now}\n${nonce}\n${crypto.createHash('sha256').update(licenseToken).digest('hex')}`;
    return { deviceId: 'device', studentId, proof: { licenseToken, issuedAt: now, nonce, signature: crypto.sign('sha256', Buffer.from(message), device.privateKey).toString('base64') } };
  }
  const auth = createRegistryAuthorization({ registryPath, trustedIssuersPath, nonceDatabasePath: path.join(root, 'nonces.sqlite'), now: () => now });
  try {
    const request = input(); const session = await auth.authorize(request); assert.equal(session.licenseId, 'license');
    await assert.rejects(auth.authorize(request), error => error.status === 403);
    await assert.rejects(auth.authorize(input('other')), error => error.status === 403);
    await assert.rejects(auth.authorize(input('student', token.slice(0, -10) + 'wrong')), error => error.status === 403);
    grant.enabled = false; save(); assert.equal(auth.isSessionActive(session), false);
    await assert.rejects(auth.authorize(input()), error => error.status === 403);
  } finally { auth.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('provider allow-listed output uses real search metadata and gateway is default-off', async () => {
  assert.equal(fromEnvironment({}, 'unused'), undefined);
  let sent;
  const provider = createProviderRequest({ endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', apiKey: 'synthetic-server-key',
    fetchImpl: async (_, options) => { sent = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'result' } }], usage: { prompt_tokens: 10 }, search_info: { search_results: [{ title: 'official', url: 'https://example.org/' }] } })); } });
  const result = await provider({ model: 'model', messages: [{ role: 'user', content: 'public query' }], maxOutputTokens: 100, webResearch: true });
  assert.equal(sent.enable_search, true); assert.equal(result.sources[0].title, 'official'); assert.equal(result.usage.inputTokens, 10);
  assert.equal(result.secret, undefined);
  assert.throws(() => createProviderRequest({ endpoint: 'http://example.org', apiKey: 'synthetic' }));
});
