'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createHttpServer } = require('./http.cjs');
const { createService } = require('./service.cjs');

const ADMIN = 'cloud-test-admin-token-keep-private-123456';
const CONTENT = '---\ntype: learning_profile\nstatus: active\nupdated: 2026-09-25\n---\n\n# 整体画像\n\n有据可查。\n';

test('admin browser sessions expire, logout revokes them, and login attempts are limited', async () => fixture(async ({ call, advance }) => {
  const invalid = await call('POST', '/v1/admin/sessions', '', { credential: 'wrong' });
  assert.equal(invalid.status, 401);
  assert.equal((await call('GET', '/v1/students', invalid.body.sessionToken)).status, 401);
  const created = await call('POST', '/v1/admin/sessions', '', { credential: ADMIN });
  assert.equal(created.status, 201);
  const session = created.body.sessionToken;
  assert.notEqual(session, ADMIN);
  assert.equal((await call('GET', '/v1/students', session)).status, 200);
  assert.equal((await call('DELETE', '/v1/admin/sessions/current', session)).status, 200);
  assert.equal((await call('GET', '/v1/students', session)).status, 401);
  assert.equal((await call('DELETE', '/v1/admin/sessions/current', ADMIN)).status, 401);
  const next = (await call('POST', '/v1/admin/sessions', '', { credential: ADMIN })).body.sessionToken;
  advance(8 * 60 * 60 * 1000 + 1);
  assert.equal((await call('GET', '/v1/students', next)).status, 401);
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', '/v1/admin/sessions', '', { credential: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/v1/admin/sessions', '', { credential: ADMIN })).status, 429);
}));

test('per-student capacity counts report revisions and trashed documents but allows duplicate receipt', async () => fixture(async ({ call, base }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '容量测试' })).body;
  const other = (await call('POST', '/v1/students', ADMIN, { displayName: '其他学生' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN)).body;
  await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
  const report = { cloudStudentId: student.id, originPlatform: 'android', reportType: 'learning_profile',
    sourceStatus: 'active', content: CONTENT, contentSha256: crypto.createHash('sha256').update(CONTENT).digest('hex'),
    publishedAt: '2026-09-25' };
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 201);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).body.duplicate, true);
  assert.equal((await call('GET', `/v1/students/${student.id}/storage`, source.deviceToken)).status, 401);
  const uploadDoc = (name, content) => fetch(`${base}/v1/students/${student.id}/documents`, {
    method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'text/markdown',
      'x-document-name': encodeURIComponent(name) }, body: content,
  });
  const created = await uploadDoc('一.md', 'abc');
  assert.equal(created.status, 201);
  const documentId = (await created.json()).documentId;
  assert.equal((await call('PATCH', `/v1/documents/${documentId}`, ADMIN, { deleted: true })).status, 200);
  const usage = await call('GET', `/v1/students/${student.id}/storage`, ADMIN);
  assert.deepEqual(usage.body, { cloudStudentId: student.id, usedBytes: Buffer.byteLength(CONTENT) + 3,
    maxBytes: Buffer.byteLength(CONTENT) + 4 });
  assert.equal((await uploadDoc('二.md', 'xy')).status, 413);
  const second = CONTENT.replace('有据可查。', '持续观察。');
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, { ...report, content: second,
    contentSha256: crypto.createHash('sha256').update(second).digest('hex') })).status, 413);
  assert.equal((await call('GET', `/v1/students/${other.id}/storage`, ADMIN)).body.usedBytes, 0);
}, { maxStudentBytes: Buffer.byteLength(CONTENT) + 4 }));

test('streamed summary replay reuses receipt and cannot resurrect a withdrawn document', async () => fixture(async ({ call, base }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '摘要幂等测试' })).body;
  const upload = async () => {
    const response = await fetch(`${base}/v1/students/${student.id}/documents`, { method: 'POST',
      headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'text/markdown', 'x-document-name': 'planning-summary.md' }, body: '# 候选摘要\n待核验' });
    assert.equal(response.status, 201); return response.json();
  };
  const first = await upload(); const second = await upload();
  assert.equal(second.documentId, first.documentId); assert.equal(second.duplicate, true);
  assert.equal((await call('GET', `/v1/students/${student.id}/documents`, ADMIN)).body.documents.length, 1);
  await call('PATCH', `/v1/documents/${first.documentId}`, ADMIN, { deleted: true });
  const replay = await upload(); assert.equal(replay.documentId, first.documentId); assert.equal(replay.withdrawn, true);
  assert.equal((await call('GET', `/v1/students/${student.id}/documents`, ADMIN)).body.documents.length, 0);
  assert.equal((await call('GET', `/v1/students/${student.id}/documents?trash=1`, ADMIN)).body.documents.length, 1);
}));

async function fixture(fn, serviceOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-report-test-'));
  let clock = Date.parse('2026-09-25T00:00:00Z');
  const viewerKeys = new Map();
  const app = createHttpServer({ dataDir: dir, adminToken: ADMIN, now: () => clock, allowLegacyTestCredentials: true, ...serviceOptions });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function call(method, route, token, body) {
    let pair;
    if (method === 'POST' && route === '/v1/pairings' && !token) {
      pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
      body = { publicKey: pair.publicKey };
    }
    const response = await fetch(base + route, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(viewerKeys.has(token) ? proofHeaders(method, route, token) : {}),
        ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const contentType = response.headers.get('content-type') || '';
    const result = { status: response.status, body: contentType.includes('application/json') ? await response.json() : await response.text() };
    if (pair && result.status === 201) viewerKeys.set(result.body.deviceToken, { deviceId: result.body.deviceId, privateKey: pair.privateKey });
    return result;
  }
  function proofHeaders(method, route, token) {
    const key = viewerKeys.get(token);
    const timestamp = String(clock);
    const nonce = crypto.randomBytes(18).toString('base64url');
    return { 'x-cloud-device-id': key.deviceId, 'x-cloud-timestamp': timestamp, 'x-cloud-nonce': nonce,
      'x-cloud-signature': crypto.sign('sha256', Buffer.from(`${method}\n${route}\n${timestamp}\n${nonce}`),
        key.privateKey).toString('base64url') };
  }
  try { await fn({ call, base, proofHeaders, advance: ms => { clock += ms; } }); }
  finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('cloud student archive is recoverable but never restores revoked device grants', async () => fixture(async ({ call }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '可恢复停用学生' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN, {})).body;
  await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
  const viewer = (await call('POST', '/v1/pairings')).body;
  await call('POST', '/v1/pairings/approve', source.deviceToken,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [student.id] });
  assert.equal((await call('GET', '/v1/students', viewer.deviceToken)).body.students.length, 1);
  const preview = await call('GET', `/v1/students/${student.id}/removal-preview`, ADMIN);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.activeGrants, 2);
  assert.equal((await call('DELETE', `/v1/students/${student.id}`, ADMIN)).status, 200);
  assert.equal((await call('GET', '/v1/students', ADMIN)).body.students.length, 0);
  const archived = await call('GET', '/v1/students?includeArchived=1', ADMIN);
  assert.ok(archived.body.students[0].archivedAt);
  assert.equal((await call('GET', '/v1/students', viewer.deviceToken)).body.students.length, 0);
  assert.equal((await call('POST', `/v1/students/${student.id}/restore`, ADMIN)).body.grantsRestored, false);
  assert.equal((await call('GET', '/v1/students', ADMIN)).body.students.length, 1);
  assert.equal((await call('GET', '/v1/students', viewer.deviceToken)).body.students.length, 0);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, {
    cloudStudentId: student.id, originPlatform: 'android', reportType: 'learning_profile', sourceStatus: 'active',
    content: CONTENT, contentSha256: crypto.createHash('sha256').update(CONTENT).digest('hex'), publishedAt: '2026-09-25',
  })).status, 403);
}));

test('viewer can remove only its own student authorization without deleting cloud data', async () => fixture(async ({ call }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '本机解除授权学生' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN, {})).body;
  await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
  const viewer = (await call('POST', '/v1/pairings')).body;
  await call('POST', '/v1/pairings/approve', source.deviceToken,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [student.id] });
  const removed = await call('DELETE', `/v1/viewer/students/${student.id}`, viewer.deviceToken);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.removed, true);
  assert.equal((await call('GET', '/v1/students', viewer.deviceToken)).body.students.length, 0);
  assert.equal((await call('GET', '/v1/students', source.deviceToken)).body.students.length, 1);
  assert.equal((await call('GET', '/v1/students', ADMIN)).body.students.length, 1);
}));

test('one-time pairing, student isolation, repeated read, and revocation', async () => fixture(async ({ call }) => {
  const studentA = (await call('POST', '/v1/students', ADMIN, { displayName: '学生 A' })).body;
  const studentB = (await call('POST', '/v1/students', ADMIN, { displayName: '学生 B' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN)).body;
  assert.equal((await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: studentA.id })).status, 200);
  const viewer = (await call('POST', '/v1/pairings')).body;
  assert.equal((await call('GET', `/v1/students/${studentA.id}/reports`, viewer.deviceToken)).status, 403);
  assert.equal((await call('POST', '/v1/pairings/approve', source.deviceToken,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [studentB.id] })).status, 403);
  assert.equal((await call('POST', '/v1/pairings/approve', source.deviceToken,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [studentA.id] })).status, 200);
  assert.equal((await call('POST', '/v1/pairings/approve', source.deviceToken,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [studentA.id] })).status, 404);
  const contentSha256 = crypto.createHash('sha256').update(CONTENT).digest('hex');
  const report = { cloudStudentId: studentA.id, originPlatform: 'android', reportType: 'learning_profile', sourceStatus: 'active',
    content: CONTENT, contentSha256, publishedAt: '2026-09-25', filename: '整体画像.md' };
  const upload = await call('POST', '/v1/reports', source.deviceToken, report);
  assert.equal(upload.status, 201);
  assert.equal(upload.body.duplicate, false);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).body.duplicate, true);
  assert.equal((await call('POST', '/v1/reports', viewer.deviceToken, report)).status, 401);
  assert.equal((await call('GET', `/v1/students/${studentB.id}/reports`, viewer.deviceToken)).status, 403);
  assert.equal((await call('POST', '/v1/grants/revoke', ADMIN,
    { cloudStudentId: studentA.id, scope: 'cloud_document.read' })).status, 400);
  const listed = await call('GET', `/v1/students/${studentA.id}/reports`, viewer.deviceToken);
  assert.equal(listed.body.reports.length, 1);
  for (let i = 0; i < 2; i++) {
    const downloaded = await call('GET', `/v1/reports/${upload.body.revisionId}/content`, viewer.deviceToken);
    assert.equal(downloaded.body, CONTENT);
  }
  assert.equal((await call('POST', '/v1/grants/revoke', source.deviceToken,
    { deviceId: viewer.deviceId, cloudStudentId: studentA.id, scope: 'cloud_document.read' })).body.revoked, true);
  assert.equal((await call('GET', `/v1/reports/${upload.body.revisionId}/content`, viewer.deviceToken)).status, 403);
}));

test('expired pairing, invalid report status/hash, and no report upload after write revocation', async () => fixture(async ({ call, advance }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '学生' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN)).body;
  await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
  const viewer = (await call('POST', '/v1/pairings')).body;
  advance(5 * 60 * 1000 + 1);
  assert.equal((await call('POST', '/v1/pairings/approve', source.deviceToken,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [student.id] })).status, 404);
  const basic = { cloudStudentId: student.id, originPlatform: 'android', reportType: 'learning_profile', sourceStatus: 'active',
    content: CONTENT, contentSha256: crypto.createHash('sha256').update(CONTENT).digest('hex'), publishedAt: '2026-09-25' };
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, { ...basic, contentSha256: '0'.repeat(64) })).status, 400);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, { ...basic, publishedAt: undefined })).status, 400);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, { ...basic, sourceStatus: 'draft' })).status, 400);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, { ...basic, publishedAt: '2026-09-24' })).status, 400);
  const placeholder = CONTENT.replace('有据可查。', '待生成。');
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, {
    ...basic, content: placeholder, contentSha256: crypto.createHash('sha256').update(placeholder).digest('hex') })).status, 400);
  assert.equal((await call('POST', '/v1/grants/revoke', ADMIN,
    { deviceId: source.deviceId, cloudStudentId: student.id, scope: 'report.write' })).status, 200);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, basic)).status, 403);
}));

test('source upload switch is reversible, but source cannot undo administrator revocation', async () => fixture(async ({ call }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '上传开关测试' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN)).body;
  await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
  const report = { cloudStudentId: student.id, originPlatform: 'android', reportType: 'learning_profile', sourceStatus: 'active',
    content: CONTENT, contentSha256: crypto.createHash('sha256').update(CONTENT).digest('hex'), publishedAt: '2026-09-25' };
  const switchRoute = '/v1/grants/write-state';
  assert.equal((await call('POST', switchRoute, source.deviceToken, { cloudStudentId: student.id, enabled: false })).status, 200);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 403);
  assert.equal((await call('GET', '/v1/students', source.deviceToken)).body.students.length, 1);
  assert.equal((await call('POST', switchRoute, source.deviceToken, { cloudStudentId: student.id, enabled: true })).status, 200);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 201);
  assert.equal((await call('POST', '/v1/grants/revoke', ADMIN,
    { deviceId: source.deviceId, cloudStudentId: student.id, scope: 'report.write' })).body.revoked, true);
  assert.equal((await call('POST', switchRoute, source.deviceToken, { cloudStudentId: student.id, enabled: true })).status, 403);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 403);
  assert.equal((await call('POST', '/v1/grants/write', ADMIN,
    { deviceId: source.deviceId, cloudStudentId: student.id })).status, 200);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 201);
}));

test('admin audit records permission and content actions without exposing credentials or content', async () => fixture(async ({ call }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '审计测试' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN)).body;
  await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
  const report = { cloudStudentId: student.id, originPlatform: 'android', reportType: 'learning_profile', sourceStatus: 'active',
    content: CONTENT, contentSha256: crypto.createHash('sha256').update(CONTENT).digest('hex'), publishedAt: '2026-09-25' };
  const uploaded = (await call('POST', '/v1/reports', source.deviceToken, report)).body;
  await call('POST', '/v1/reports', source.deviceToken, report);
  await call('GET', `/v1/reports/${uploaded.revisionId}/content`, ADMIN);
  assert.equal((await call('GET', '/v1/audit-events', source.deviceToken)).status, 401);
  assert.equal((await call('GET', '/v1/audit-events?cursor=bad', ADMIN)).status, 400);
  const response = await call('GET', `/v1/audit-events?studentId=${student.id}`, ADMIN);
  assert.equal(response.status, 200);
  const actions = response.body.events.map(event => event.action);
  assert.equal(actions.filter(action => action === 'report.upload').length, 1);
  assert.ok(actions.includes('report.download'));
  assert.ok(actions.includes('grant.issue.report.write'));
  assert.ok(actions.includes('student.create'));
  assert.ok(response.body.events.every(event => event.studentId === student.id));
  const serialized = JSON.stringify(response.body);
  assert.ok(!serialized.includes(ADMIN));
  assert.ok(!serialized.includes(source.deviceToken));
  assert.ok(!serialized.includes(CONTENT));
}));

test('legacy revoked grants stay revoked after upload-switch schema migration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-report-legacy-test-'));
  try {
    const oldDb = new DatabaseSync(path.join(dir, 'cloud-reports.sqlite'));
    oldDb.exec(`CREATE TABLE grants (
      device_id TEXT NOT NULL, student_id TEXT NOT NULL, scope TEXT NOT NULL,
      revoked_at INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER,
      PRIMARY KEY(device_id, student_id, scope)
    )`);
    oldDb.prepare('INSERT INTO grants(device_id,student_id,scope,revoked_at,created_at) VALUES(?,?,?,?,?)')
      .run('src_legacy', 'cs_legacy', 'report.write', Date.now(), Date.now());
    oldDb.close();
    const service = createService({ dataDir: dir, adminToken: ADMIN, allowLegacyTestCredentials: true });
    try {
      const row = service.db.prepare('SELECT revoked_at,enabled FROM grants WHERE device_id=?').get('src_legacy');
      assert.ok(row.revoked_at);
      assert.equal(row.enabled, 1);
      assert.equal(service.listAudit(ADMIN).events.length, 0);
    } finally { service.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('audit pagination is bounded and stable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-report-audit-test-'));
  const service = createService({ dataDir: dir, adminToken: ADMIN, allowLegacyTestCredentials: true });
  try {
    for (let index = 0; index < 105; index++) service.createStudent(ADMIN, `合成学生 ${index}`);
    const first = service.listAudit(ADMIN);
    assert.equal(first.events.length, 100);
    assert.ok(first.nextCursor);
    const second = service.listAudit(ADMIN, first.nextCursor);
    assert.equal(second.events.length, 5);
    assert.equal(second.nextCursor, '');
    assert.ok(first.events.at(-1).id > second.events[0].id);
    assert.throws(() => service.listAudit('wrong-token'), /管理员凭据无效/);
  } finally { service.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('viewer license expires without expiring the source write grant', async () => fixture(async ({ call, advance }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '期限测试' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN)).body;
  await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
  const viewer = (await call('POST', '/v1/pairings')).body;
  const approved = await call('POST', '/v1/pairings/approve', source.deviceToken,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [student.id] });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.expiresAt, Date.parse('2026-09-25T00:00:00Z') + 365 * 24 * 60 * 60 * 1000);
  assert.equal((await call('GET', '/v1/students', viewer.deviceToken)).body.students.length, 1);
  advance(365 * 24 * 60 * 60 * 1000);
  assert.equal((await call('GET', '/v1/students', viewer.deviceToken)).body.students.length, 0);
  assert.equal((await call('GET', `/v1/students/${student.id}/reports`, viewer.deviceToken)).status, 403);
  assert.equal((await call('GET', '/v1/students', source.deviceToken)).body.students.length, 1);
}));

test('viewer token alone, forged device signature and replay cannot read', async () => fixture(async ({ call, base, proofHeaders }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '持有证明测试' })).body;
  const viewer = (await call('POST', '/v1/pairings')).body;
  await call('POST', '/v1/pairings/approve', ADMIN, { pairingCode: viewer.pairingCode, cloudStudentIds: [student.id] });
  const route = `/v1/students/${student.id}/reports`;
  const bare = await fetch(base + route, { headers: { authorization: `Bearer ${viewer.deviceToken}` } });
  assert.equal(bare.status, 401);
  const validHeaders = { authorization: `Bearer ${viewer.deviceToken}`, ...proofHeaders('GET', route, viewer.deviceToken) };
  assert.equal((await fetch(base + route, { headers: { ...validHeaders, 'x-cloud-signature': 'A'.repeat(88) } })).status, 401);
  assert.equal((await fetch(base + route, { headers: validHeaders })).status, 200);
  assert.equal((await fetch(base + route, { headers: validHeaders })).status, 401);
}));

test('pairing approval throttles code guesses', async () => fixture(async ({ call }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '猜码测试' })).body;
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('POST', '/v1/pairings/approve', ADMIN,
      { pairingCode: String(i).padStart(8, '0'), cloudStudentIds: [student.id] })).status, 404);
  }
  assert.equal((await call('POST', '/v1/pairings/approve', ADMIN,
    { pairingCode: '00000010', cloudStudentIds: [student.id] })).status, 429);
}));

test('manual document upload, viewer download, trash and restore', async () => fixture(async ({ call, base, proofHeaders }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '学生' })).body;
  const source = (await call('POST', '/v1/devices/source', ADMIN)).body;
  await call('POST', '/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
  const viewer = (await call('POST', '/v1/pairings')).body;
  await call('POST', '/v1/pairings/approve', source.deviceToken,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [student.id] });
  const upload = await fetch(`${base}/v1/students/${student.id}/documents`, {
    method: 'POST', headers: { authorization: `Bearer ${source.deviceToken}`,
      'content-type': 'text/markdown', 'x-document-name': encodeURIComponent('学习笔记.md') },
    body: Buffer.from('# 学习笔记\n'),
  });
  assert.equal(upload.status, 201);
  const { documentId } = await upload.json();
  assert.equal((await call('GET', `/v1/students/${student.id}/documents`, viewer.deviceToken)).body.documents.length, 1);
  assert.equal((await call('GET', `/v1/documents/${documentId}/content`, viewer.deviceToken)).body, '# 学习笔记\n');
  const scopedDownload = await fetch(`${base}/v1/documents/${documentId}/content`, {
    headers: { authorization: `Bearer ${viewer.deviceToken}`,
      ...proofHeaders('GET', `/v1/documents/${documentId}/content`, viewer.deviceToken) },
  });
  assert.equal(scopedDownload.headers.get('x-cloud-student-id'), student.id);
  assert.equal((await call('PATCH', `/v1/documents/${documentId}`, viewer.deviceToken, { deleted: true })).status, 401);
  assert.equal((await call('PATCH', `/v1/documents/${documentId}`, source.deviceToken,
    { displayName: '新笔记.md', deleted: true })).status, 200);
  assert.equal((await call('GET', `/v1/documents/${documentId}/content`, viewer.deviceToken)).status, 404);
  assert.equal((await call('GET', `/v1/students/${student.id}/documents?trash=1`, source.deviceToken)).body.documents.length, 1);
  assert.equal((await call('PATCH', `/v1/documents/${documentId}`, source.deviceToken, { deleted: false })).status, 200);
  assert.equal((await call('GET', `/v1/students/${student.id}/documents`, viewer.deviceToken)).body.documents.length, 1);
}));

test('local admin approves one selected student and can inspect and revoke the viewer license', async () => fixture(async ({ call }) => {
  const studentA = (await call('POST', '/v1/students', ADMIN, { displayName: '学生 A' })).body;
  const studentB = (await call('POST', '/v1/students', ADMIN, { displayName: '学生 B' })).body;
  const viewer = (await call('POST', '/v1/pairings')).body;
  assert.equal((await call('POST', '/v1/pairings/approve', ADMIN,
    { pairingCode: viewer.pairingCode, cloudStudentIds: [studentA.id] })).status, 200);
  assert.equal((await call('GET', `/v1/students/${studentA.id}/grants`, viewer.deviceToken)).status, 401);
  const grants = (await call('GET', `/v1/students/${studentA.id}/grants`, ADMIN)).body.grants;
  assert.equal(grants.length, 1);
  assert.equal(grants[0].deviceId, viewer.deviceId);
  assert.equal(grants[0].scope, 'cloud_document.read');
  assert.equal((await call('GET', `/v1/students/${studentB.id}/reports`, viewer.deviceToken)).status, 403);
  assert.equal((await call('POST', '/v1/grants/revoke', ADMIN,
    { deviceId: viewer.deviceId, cloudStudentId: studentA.id, scope: 'cloud_document.read' })).body.revoked, true);
  assert.equal((await call('GET', `/v1/students/${studentA.id}/reports`, viewer.deviceToken)).status, 403);
}));

test('single source enrollment code binds a real student and cannot be reused', async () => fixture(async ({ call }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '学生' })).body;
  const issued = await call('POST', '/v1/source-enrollments', ADMIN, { cloudStudentId: student.id });
  assert.equal(issued.status, 201);
  const redeemed = await call('POST', '/v1/source-enrollments/redeem', '', { enrollmentCode: issued.body.enrollmentCode });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.cloudStudentId, student.id);
  assert.equal((await call('GET', '/v1/students', redeemed.body.deviceToken)).body.students[0].id, student.id);
  assert.equal((await call('POST', '/v1/source-enrollments/redeem', '', { enrollmentCode: issued.body.enrollmentCode })).status, 404);
}));

test('source upload authorization limits fields, purpose and expiry across legacy and v2 writes', async () => fixture(async ({ call, advance }) => {
  const student = (await call('POST', '/v1/students', ADMIN, { displayName: '授权范围学生' })).body;
  const issued = await call('POST', '/v1/source-enrollments', ADMIN, { cloudStudentId: student.id });
  const source = (await call('POST', '/v1/source-enrollments/redeem', '', {
    enrollmentCode: issued.body.enrollmentCode, contractVersion: 2,
    profileFields: ['displayName'], materialCategories: ['learning_report'],
  })).body;
  const report = { cloudStudentId: student.id, originPlatform: 'android', reportType: 'learning_profile', sourceStatus: 'active',
    content: CONTENT, contentSha256: crypto.createHash('sha256').update(CONTENT).digest('hex'), publishedAt: '2026-09-25' };
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 403);
  const expiresAt = Date.parse('2026-09-25T00:00:00Z') + 7 * 24 * 60 * 60 * 1000;
  const scoped = await call('POST', '/v2/source-upload-scope', source.deviceToken, {
    cloudStudentId: student.id, profileFields: ['displayName', 'grade'],
    materialCategories: ['learning_report', 'topic_suggestion'],
    authorizationPurpose: 'expert_interpretation', authorizationExpiresAt: expiresAt,
  });
  assert.equal(scoped.status, 200);
  assert.deepEqual(scoped.body.profileFields, ['displayName', 'grade']);
  assert.equal(scoped.body.authorizationPurpose, 'expert_interpretation');
  assert.equal(scoped.body.authorizationExpiresAt, expiresAt);
  const grants = (await call('GET', `/v2/students/${student.id}/grants`, ADMIN)).body.grants;
  assert.ok(grants.filter(grant => grant.scope.endsWith('.write')).every(grant =>
    grant.purpose === 'expert_interpretation' && grant.expiresAt === expiresAt));
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 201);
  advance(7 * 24 * 60 * 60 * 1000 + 1);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 403);
  const renewed = await call('POST', '/v2/source-upload-scope', source.deviceToken, {
    cloudStudentId: student.id, profileFields: ['displayName'], materialCategories: ['learning_report'],
    authorizationPurpose: 'document_sync', authorizationExpiresAt: expiresAt + 30 * 24 * 60 * 60 * 1000,
  });
  assert.equal(renewed.status, 200);
  assert.equal((await call('POST', '/v1/reports', source.deviceToken, report)).status, 201);
}));
