'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHttpServer } = require('./http.cjs');
const { createModelGatewayPilot } = require('./model-gateway-pilot.cjs');

test('HTTP gateway is disabled by default and opt-in validates proof, bearer and replay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-http-'));
  const adminToken = 'synthetic-gateway-http-admin-credential';
  let calls = 0;
  const gateway = createModelGatewayPilot({ databasePath: path.join(root, 'gateway.sqlite'), models: ['synthetic-model'],
    authorize: async input => input.proof?.synthetic === true ? { licenseId: 'license-a', deviceId: input.deviceId, studentId: input.studentId, expiresAt: Date.now() + 600000, dailyLimit: 4 } : null,
    isSessionActive: async () => true, providerRequest: async () => { calls++; return { text: 'synthetic-result', sources: [] }; } });
  const disabled = createHttpServer({ dataDir: path.join(root, 'disabled'), adminToken });
  const enabled = createHttpServer({ dataDir: path.join(root, 'enabled'), adminToken, modelGateway: gateway });
  try {
    for (const app of [disabled, enabled]) await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const post = async (app, route, body, token = '') => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const scope = { studentId: 'student-a', deviceId: 'device-a', proof: { synthetic: true } };
    assert.equal((await post(disabled, '/model-gateway/session', scope)).status, 404);
    assert.equal((await post(enabled, '/model-gateway/session', { ...scope, proof: { synthetic: false } })).status, 403);
    const session = (await post(enabled, '/model-gateway/session', scope)).body;
    const request = { ...scope, token: session.token, model: 'synthetic-model', idempotencyKey: 'request-a', messages: [{ role: 'user', content: 'synthetic' }], maxOutputTokens: 100, webResearch: false };
    assert.equal((await post(enabled, '/model-gateway/generate', request, 'wrong')).status, 401);
    assert.equal((await post(enabled, '/model-gateway/generate', request, session.token)).status, 200);
    assert.equal((await post(enabled, '/model-gateway/generate', request, session.token)).status, 200);
    assert.equal(calls, 1);
  } finally { await disabled.close(); await enabled.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
