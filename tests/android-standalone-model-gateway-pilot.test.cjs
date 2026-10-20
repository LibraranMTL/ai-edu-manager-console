const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createModelGatewayPilot } = require('../cloud-report-service/model-gateway-pilot.cjs');
const options = (databasePath, extra = {}) => ({ databasePath, allowEphemeralTestStore: databasePath === ':memory:', authorize: async input => ({ licenseId: 'license-a', deviceId: input.deviceId, studentId: input.studentId, expiresAt: 2_000_000, dailyLimit: 2 }), isSessionActive: async () => true, providerRequest: async () => ({ text: 'candidate', sources: [], secret: 'never-return' }), models: ['fixture-model'], now: () => 1_000_000, ...extra });
const request = session => ({ ...session, model: 'fixture-model', messages: [{ role: 'user', content: 'deidentified fixture' }], webResearch: false, maxOutputTokens: 100, idempotencyKey: 'input-a' });
test('gateway has no permissive authorization defaults', () => assert.throws(() => createModelGatewayPilot({ databasePath: ':memory:' })));
test('gateway credential is short, scoped and expires', async () => {
  let now = 1_000_000; const gateway = createModelGatewayPilot(options(':memory:', { now: () => now }));
  try {
    const session = await gateway.issue({ deviceId: 'device-a', studentId: 'student-a', proof: { fixture: true } });
    assert.equal(session.expiresAt - session.issuedAt, 300_000);
    await assert.rejects(gateway.generate({ ...request(session), studentId: 'student-b' }), error => error.status === 403);
    now = session.expiresAt;
    await assert.rejects(gateway.generate(request(session)), error => error.status === 401);
  } finally { gateway.close(); }
});
test('gateway reuses receipts and does not leak provider secrets', async () => {
  let calls = 0; const gateway = createModelGatewayPilot(options(':memory:', { providerRequest: async () => { calls++; return { text: 'candidate', sources: [], secret: 'provider-key' }; } }));
  try {
    const session = await gateway.issue({ deviceId: 'device-a', studentId: 'student-a', proof: { fixture: true } });
    assert.equal((await gateway.generate(request(session))).text, 'candidate');
    assert.equal((await gateway.generate(request(session))).secret, undefined); assert.equal(calls, 1);
    await assert.rejects(gateway.generate({ ...request(session), messages: [{ role: 'user', content: 'changed' }] }), error => error.status === 409);
    await assert.rejects(gateway.generate({ ...request(session), messages: [{ role: 'tool', content: 'write' }] }), error => error.status === 400);
  } finally { gateway.close(); }
});
test('unknown request is not repeated even after server restart and new credential', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-gateway-test-')); const databasePath = path.join(directory, 'gateway.db');
  let calls = 0; let gateway = createModelGatewayPilot(options(databasePath, { providerRequest: async () => { calls++; throw Error('fixture timeout'); } }));
  try {
    let session = await gateway.issue({ deviceId: 'device-a', studentId: 'student-a', proof: { fixture: true } });
    await assert.rejects(gateway.generate(request(session)), error => error.status === 502);
    gateway.close(); gateway = createModelGatewayPilot(options(databasePath));
    session = await gateway.issue({ deviceId: 'device-a', studentId: 'student-a', proof: { fixture: true } });
    await assert.rejects(gateway.generate(request(session)), error => error.status === 409); assert.equal(calls, 1);
  } finally { gateway.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('gateway quotas survive renewal and missing research cannot become a valid result', async () => {
  const gateway = createModelGatewayPilot(options(':memory:'));
  try {
    const session = await gateway.issue({ deviceId: 'device-a', studentId: 'student-a', proof: { fixture: true } });
    await gateway.generate(request(session));
    await assert.rejects(gateway.generate({ ...request(session), idempotencyKey: 'input-b', webResearch: true }), error => error.status === 502);
    const renewed = await gateway.issue({ deviceId: 'device-a', studentId: 'student-a', proof: { fixture: true } });
    await assert.rejects(gateway.generate({ ...request(renewed), idempotencyKey: 'input-c' }), error => error.status === 429);
  } finally { gateway.close(); }
});
