'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHttpServer } = require('./http.cjs');
const { sourceProof } = require('../electron/cloud-device-proof.cjs');
const { createCloudReportRuntime } = require('../electron/cloud-report-runtime.cjs');
const ADMIN = 'synthetic-admin-credential-0123456789';
const CONTENT = '---\ntype: learning_profile\nstatus: active\nupdated: 2026-09-26\n---\n\n# 整体画像\n\n- 合成练习表明持续学习进展。\n';

async function fixture(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-cloud-'));
  const app = createHttpServer({ dataDir: path.join(root, 'data'), adminToken: ADMIN });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, route, token = '', body, headers = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const session = (await call('POST', '/v1/admin/sessions', '', { credential: ADMIN })).body.sessionToken;
  try { await work({ root, app, base, call, session }); }
  finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test('source integrity endpoint requires a fresh device proof over the exact body', () => fixture(async ({ call, session }) => {
  const student = (await call('POST', '/v1/students', session, { displayName: '合成来源' })).body;
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { format: 'pem', type: 'spki' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
  const code = (await call('POST', '/v1/source-enrollments', session, { cloudStudentId: student.id })).body.enrollmentCode;
  const source = (await call('POST', '/v1/source-enrollments/redeem', '', { enrollmentCode: code, publicKey: keys.publicKey })).body;
  const route = `/v2/students/${student.id}/source-integrity`;
  const body = { category: 'learning_report', objectId: '*', action: 'hold' };
  assert.equal((await call('POST', route, source.deviceToken, body)).status, 401);
  const proof = sourceProof(source.deviceId, keys.privateKey, 'POST', route, JSON.stringify(body));
  const changed = { ...body, action: 'clear', contentSha256: '0'.repeat(64) };
  assert.equal((await call('POST', route, source.deviceToken, changed, proof)).status, 401);
  const fresh = sourceProof(source.deviceId, keys.privateKey, 'POST', route, JSON.stringify(body));
  assert.equal((await call('POST', route, source.deviceToken, body, fresh)).status, 200);
  assert.equal((await call('POST', route, source.deviceToken, body, fresh)).status, 401);
}));

test('strict source signatures bind body, reject replay, rotate/revoke credentials, and retain withdrawal tombstones', () => fixture(async ({ app, call, session }) => {
  assert.equal((await call('GET', '/v1/students', ADMIN)).status, 401);
  const student = (await call('POST', '/v1/students', session, { displayName: '测试学生' })).body;
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { format: 'pem', type: 'spki' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
  const code = (await call('POST', '/v1/source-enrollments', session, { cloudStudentId: student.id })).body.enrollmentCode;
  const source = (await call('POST', '/v1/source-enrollments/redeem', '', { enrollmentCode: code, publicKey: keys.publicKey })).body;
  const report = { cloudStudentId: student.id, originPlatform: 'android', reportType: 'learning_profile', sourceStatus: 'active',
    publishedAt: '2026-09-26', content: CONTENT, contentSha256: crypto.createHash('sha256').update(CONTENT).digest('hex') };
  const proof = (route, body) => sourceProof(source.deviceId, keys.privateKey, 'POST', route, JSON.stringify(body));
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 401);
  const signed = proof('/v1/reports', report);
  const uploaded = await call('POST', '/v1/reports', source.deviceToken, report, signed);
  assert.equal(uploaded.status, 201);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report, signed)).status, 401);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, { ...report, originPlatform: 'windows' }, proof('/v1/reports', report))).status, 401);
  assert.equal((await call('DELETE', `/v1/reports/${uploaded.body.revisionId}`, session)).status, 200);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report, proof('/v1/reports', report))).status, 410);
  assert.equal((await call('GET', `/v1/students/${student.id}/reports`, session)).body.reports.length, 0);
  assert.equal(app.service.db.prepare('SELECT COUNT(*) AS n FROM report_tombstones').get().n, 1);
  const nextToken = crypto.randomBytes(32).toString('base64url');
  const rotation = { nextToken };
  assert.equal((await call('POST', '/v1/devices/credential', source.deviceToken, rotation, proof('/v1/devices/credential', rotation))).status, 200);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report, proof('/v1/reports', report))).status, 401);
  assert.equal((await call('POST', '/v1/reports', nextToken, report, proof('/v1/reports', report))).status, 410);
  await call('POST', '/v1/devices/revoke', session, { deviceId: source.deviceId });
  assert.equal((await call('POST', '/v1/reports', nextToken, report, proof('/v1/reports', report))).status, 401);
}));

test('admin credential rotation revokes all sessions and never restores the bootstrap secret', () => fixture(async ({ call, session, app }) => {
  const replacement = 'replacement-private-credential-0123456789';
  assert.equal((await call('POST', '/v1/admin/credential', session, { oldCredential: ADMIN, newCredential: replacement })).status, 200);
  assert.equal((await call('GET', '/v1/students', session)).status, 401);
  assert.equal((await call('POST', '/v1/admin/sessions', '', { credential: ADMIN })).status, 401);
  assert.equal((await call('POST', '/v1/admin/sessions', '', { credential: replacement })).status, 201);
  const identity = app.service.db.prepare('SELECT * FROM admin_identity').get();
  assert.ok(!JSON.stringify(identity).includes(replacement));
}));

test('streamed documents validate bytes, pagination has no gaps, and expired admin sessions cannot finish uploads', () => fixture(async ({ call, session, app, base }) => {
  const student = (await call('POST', '/v1/students', session, { displayName: '文档分页' })).body;
  for (let i = 0; i < 102; i++) app.service.uploadDocument(session, student.id, `${i}.md`, 'text/markdown', Buffer.from(`doc ${i}`));
  const first = (await call('GET', `/v1/students/${student.id}/documents`, session)).body;
  assert.equal(first.documents.length, 100); assert.ok(first.nextCursor);
  const second = (await call('GET', `/v1/students/${student.id}/documents?cursor=${first.nextCursor}`, session)).body;
  assert.equal(second.documents.length, 2); assert.equal(second.nextCursor, '');
  assert.equal(new Set([...first.documents, ...second.documents].map(d => d.documentId)).size, 102);
  const data = Buffer.from('%PDF-1.4\nsynthetic upload');
  const uploaded = await fetch(`${base}/v1/students/${student.id}/documents`, { method: 'POST', headers: {
    authorization: `Bearer ${session}`, 'content-type': 'application/pdf', 'x-document-name': 'test.pdf' }, body: data });
  assert.equal(uploaded.status, 201);
  const metadata = await uploaded.json();
  assert.equal(metadata.contentSha256, crypto.createHash('sha256').update(data).digest('hex'));
  const pending = app.service.prepareDocument(session, student.id, 'pending.md', 'text/markdown');
  app.service.logoutAdmin(session);
  assert.throws(() => pending.commit({ sha: '0'.repeat(64), size: 1, head: Buffer.from('x') }), /失效/);
}));

test('two signed Windows runtimes recover after restart/offline, do not resend unchanged bytes, and download foreign reports only', () => fixture(async ({ root, app, base, call, session }) => {
  const student = (await call('POST', '/v1/students', session, { displayName: '双主机合成学生' })).body;
  const reportDir = path.join(root, 'reports'); fs.mkdirSync(reportDir); fs.writeFileSync(path.join(reportDir, '整体画像.md'), CONTENT);
  const make = name => createCloudReportRuntime({ dataDir: path.join(root, name), protect: s => s, unprotect: s => s, resolveReportDir: () => reportDir });
  let source = make('source'); const viewer = make('viewer');
  try {
    await source.load(); await viewer.load();
    const code = (await call('POST', '/v1/source-enrollments', session, { cloudStudentId: student.id })).body.enrollmentCode;
    await source.enrollSource({ serverUrl: base, enrollmentCode: code, localStudentId: 'local-student' });
    await source.syncStudent('local-student');
    const audits = () => app.service.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='report.upload'").get().n;
    assert.equal(audits(), 1);
    await source.syncStudent('local-student'); assert.equal(audits(), 1);
    const pairing = await viewer.createPairing(base); await source.approvePairing(pairing.pairingCode, ['local-student']);
    assert.equal((await viewer.listCloudReports(student.id)).reports.length, 1);
    await source.setUpload('local-student', false); source.close(); source = make('source'); await source.load();
    assert.equal(source.status('local-student').enabled, false);
    fs.writeFileSync(path.join(reportDir, '整体画像.md'), CONTENT.replace('持续学习进展', '新的合成学习进展'));
    await source.setUpload('local-student', true); await source.syncStudent('local-student'); assert.equal(audits(), 2);
    const port = app.server.address().port; await new Promise(resolve => app.server.close(resolve));
    fs.writeFileSync(path.join(reportDir, '整体画像.md'), CONTENT.replace('持续学习进展', '断网后的第三次合成学习进展'));
    await source.syncStudent('local-student'); assert.ok(source.status('local-student').lastError);
    await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
    await source.syncStudent('local-student'); assert.equal(source.status('local-student').lastError, '');
  } finally { source.close(); viewer.close(); }
}));
