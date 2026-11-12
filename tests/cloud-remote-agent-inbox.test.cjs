'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { createHttpServer } = require('../cloud-report-service/http.cjs');
const { createCloudReportRuntime } = require('../electron/cloud-report-runtime.cjs');

const ADMIN = 'cloud-agent-inbox-test-admin-token-123456';

test('short-lived Codex/WorkBuddy sessions read only granted material and submit one idempotent inbox result', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-agent-inbox-'));
  const app = createHttpServer({ dataDir: path.join(root, 'service'), adminToken: ADMIN, allowLegacyTestCredentials: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const reports = path.join(root, 'reports'); fs.mkdirSync(reports);
  const source = createCloudReportRuntime({ dataDir: path.join(root, 'source'), protect: value => value, unprotect: value => value,
    resolveReportDir: id => id === 'student-local' ? reports : '', resolveStudentProfile: () => ({ name: '远程合成学生' }) });
  const receiver = createCloudReportRuntime({ dataDir: path.join(root, 'receiver'), protect: value => value, unprotect: value => value,
    resolveReportDir: () => '', ensureLocalStudentFromCloudProfile: async () => ({ localStudentId: 'receiver-student', status: 'created' }) });
  async function adminPost(route, body) {
    const response = await fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status < 300, true, `${route}: ${response.status}`);
    return response.json();
  }
  async function agentRequest(route, token, options = {}) {
    const response = await fetch(base + route, { method: options.method || 'GET', headers: { authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  }
  try {
    await source.load(); await receiver.load();
    const student = await adminPost('/v1/students', { displayName: '远程合成学生' });
    const enrollment = await adminPost('/v1/source-enrollments', { cloudStudentId: student.id });
    await source.enrollSource({ serverUrl: base, enrollmentCode: enrollment.enrollmentCode, localStudentId: 'student-local',
      materialCategories: ['learning_material'] });
    const pairing = await receiver.createPairing(base);
    await source.approvePairing(pairing.pairingCode, ['student-local'], { materialCategories: ['learning_material'] });
    const scopeFingerprint = 'a'.repeat(64);
    const material = await source.uploadCloudMaterial('student-local', { category: 'learning_material',
      materialId: 'learning:remote:001', idempotencyKey: 'learning:remote:001:v1', displayName: '项目资料.md',
      contentType: 'text/markdown', content: '# 项目资料\n\n只读范围测试。\n',
      projectId: 'project:remote:001', scopeFingerprint });
    const session = await receiver.issueRemoteAgentSession({ provider: 'codex', cloudStudentId: student.id,
      projectId: 'project:remote:001', scopeFingerprint, taskId: 'task:remote:001', executionId: 'execution:remote:001', taskType: 'project_digest.v2',
      idempotencyKey: 'execution:remote:001', materialCategories: ['learning_material'] });
    assert.equal(session.materialCategories.includes('learning_material'), true);
    assert.equal(session.materialCategories.includes('health_record'), false);
    const acknowledged = await agentRequest('/v2/agent/task/acknowledge', session.sessionToken, { method: 'POST', body: {} });
    assert.equal(acknowledged.json.status, 'running');
    assert.equal((await receiver.remoteAgentSessionStatus(session.sessionId)).status, 'running');

    const listed = await agentRequest('/v2/agent/materials?category=learning_material', session.sessionToken);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.json.materials[0].revisionId, material.revisionId);
    assert.equal(listed.json.scopeFingerprint, scopeFingerprint);
    const deniedCategory = await agentRequest('/v2/agent/materials?category=learning_card', session.sessionToken);
    assert.equal(deniedCategory.response.status, 403);
    const contentResponse = await fetch(`${base}/v2/agent/material-revisions/${material.revisionId}/content`,
      { headers: { authorization: `Bearer ${session.sessionToken}` } });
    assert.equal(contentResponse.status, 200);
    assert.equal(await contentResponse.text(), '# 项目资料\n\n只读范围测试。\n');

    const attachmentBytes = Buffer.from('# 远程成果附件\n');
    const attachmentSha = require('node:crypto').createHash('sha256').update(attachmentBytes).digest('hex');
    const resultPayload = { schema: 'edu-manager.remote-project-result.v2', taskId: 'task:remote:001', executionId: 'execution:remote:001',
      taskType: 'project_digest.v2', projectId: 'project:remote:001', scopeFingerprint, status: 'completed',
      title: '合成远程结果', content: '这是经过资料来源约束的合成远程结果。',
      sources: [{ materialId: 'learning:remote:001', revisionId: material.revisionId, contentSha256: material.contentSha256 }],
      attachments: [{ displayName: '成果附件.md', contentType: 'text/markdown', contentSha256: attachmentSha,
        contentBase64: attachmentBytes.toString('base64') }] };
    const submission = { idempotencyKey: 'result:remote:001:v1', projectId: 'project:remote:001', scopeFingerprint,
      payload: resultPayload };
    const submitted = await agentRequest('/v2/inbox/submissions', session.sessionToken, { method: 'POST', body: submission });
    assert.equal(submitted.response.status, 201);
    assert.equal((await receiver.remoteAgentSessionStatus(session.sessionId)).status, 'result_submitted');
    const duplicate = await agentRequest('/v2/inbox/submissions', session.sessionToken, { method: 'POST', body: submission });
    assert.equal(duplicate.json.duplicate, true);
    const conflict = await agentRequest('/v2/inbox/submissions', session.sessionToken,
      { method: 'POST', body: { ...submission, payload: { ...resultPayload, content: '不同结果' } } });
    assert.equal(conflict.response.status, 409);
    const outsideSource = await agentRequest('/v2/inbox/submissions', session.sessionToken,
      { method: 'POST', body: { ...submission, idempotencyKey: 'result:remote:outside:001', payload: {
        ...resultPayload, sources: [{ ...resultPayload.sources[0], revisionId: `material_rev_${'f'.repeat(48)}` }],
      } } });
    assert.equal(outsideSource.response.status, 409);
    const wrongTask = await agentRequest('/v2/inbox/submissions', session.sessionToken,
      { method: 'POST', body: { ...submission, idempotencyKey: 'result:remote:wrong-task', payload: {
        ...resultPayload, taskId: 'task:remote:other',
      } } });
    assert.equal(wrongTask.response.status, 400);
    const secondResult = await agentRequest('/v2/inbox/submissions', session.sessionToken,
      { method: 'POST', body: { ...submission, idempotencyKey: 'result:remote:second:001' } });
    assert.equal(secondResult.response.status, 409);

    const inbox = await receiver.listCloudInbox();
    assert.equal(inbox.submissions.length, 1);
    const leased = await receiver.leaseCloudInboxSubmission(submitted.json.submissionId);
    assert.equal(leased.payload.content, '这是经过资料来源约束的合成远程结果。');
    assert.equal(leased.attachments.length, 1);
    assert.equal(leased.payload.attachments[0].contentBase64, undefined, '云端账本不得重复保存附件正文');
    const downloadedAttachment = await receiver.downloadCloudInboxAttachment(submitted.json.submissionId,
      leased.attachments[0].attachmentId, leased.leaseId);
    assert.equal(downloadedAttachment.content.toString('utf8'), attachmentBytes.toString('utf8'));
    assert.equal(leased.taskId, 'task:remote:001');
    assert.equal(leased.executionId, 'execution:remote:001');
    await assert.rejects(receiver.leaseCloudInboxSubmission(submitted.json.submissionId), /正在由本机另一流程处理/);
    const settled = await receiver.settleCloudInboxSubmission(submitted.json.submissionId,
      { leaseId: leased.leaseId, status: 'committed' });
    assert.equal(settled.status, 'committed');
    assert.equal((await receiver.remoteAgentSessionStatus(session.sessionId)).status, 'committed');
    const settledAgain = await receiver.settleCloudInboxSubmission(submitted.json.submissionId,
      { leaseId: leased.leaseId, status: 'committed' });
    assert.equal(settledAgain.duplicate, true);

    await receiver.revokeRemoteAgentSession(session.sessionId);
    const afterRevoke = await agentRequest('/v2/agent/materials', session.sessionToken);
    assert.equal(afterRevoke.response.status, 401);
  } finally {
    source.close(); receiver.close(); await app.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inbox is target-host isolated and an unsafe late result can be quarantined instead of committed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-inbox-isolation-'));
  let clock = 1_800_000_000_000;
  const service = require('../cloud-report-service/service.cjs').createService({ dataDir: root, adminToken: ADMIN,
    allowLegacyTestCredentials: true, now: () => clock });
  try {
    const student = service.createStudent(ADMIN, '隔离学生');
    const crypto = require('node:crypto');
    const keys = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const target = service.createPairing('', keys().publicKey);
    const other = service.createPairing('', keys().publicKey);
    service.issueV2Grant(ADMIN, { deviceId: target.deviceId, cloudStudentId: student.id,
      scope: 'material.read', category: 'learning_material' });
    const source = service.registerSource(ADMIN);
    service.allowWrite(ADMIN, source.deviceId, student.id);
    service.issueV2Grant(ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id,
      scope: 'material.write', category: 'learning_material' });
    const prepared = service.prepareV2Material(source.deviceToken, student.id, { category: 'learning_material',
      materialId: 'learning:late:001', idempotencyKey: 'learning:late:001:v1', displayName: '迟到资料.md',
      contentType: 'text/markdown', projectId: 'project:late:001', scopeFingerprint: 'b'.repeat(64) });
    const materialBytes = Buffer.from('# 迟到资料\n');
    fs.writeFileSync(prepared.tempPath, materialBytes);
    const material = prepared.commit({ sha: require('node:crypto').createHash('sha256').update(materialBytes).digest('hex'),
      size: materialBytes.length, head: materialBytes.subarray(0, 16) });
    const session = service.issueRemoteAgentSession(target.deviceToken, { provider: 'workbuddy', cloudStudentId: student.id,
      projectId: 'project:late:001', scopeFingerprint: 'b'.repeat(64), taskId: 'task:late:001', executionId: 'execution:late:001', taskType: 'project_digest.v2',
      idempotencyKey: 'execution:late:001', materialCategories: ['learning_material'] });
    const submitted = service.submitInboxResult(session.sessionToken, { idempotencyKey: 'late:result:001',
      projectId: 'project:late:001', scopeFingerprint: 'b'.repeat(64), payload: {
        schema: 'edu-manager.remote-project-result.v2', taskId: 'task:late:001', executionId: 'execution:late:001', taskType: 'project_digest.v2',
        projectId: 'project:late:001', scopeFingerprint: 'b'.repeat(64), status: 'completed', title: '迟到结果',
        content: '迟到结果正文。', sources: [{ materialId: 'learning:late:001', revisionId: material.revisionId,
          contentSha256: material.contentSha256 }],
      } });
    assert.deepEqual(service.listInbox(other.deviceToken).submissions, []);
    assert.throws(() => service.leaseInboxSubmission(other.deviceToken, submitted.submissionId), /成果不存在/);
    const firstLease = service.leaseInboxSubmission(target.deviceToken, submitted.submissionId);
    clock += 2 * 60 * 1000 + 1;
    const recoveredLease = service.leaseInboxSubmission(target.deviceToken, submitted.submissionId);
    assert.notEqual(recoveredLease.leaseId, firstLease.leaseId);
    const isolated = service.settleInboxSubmission(target.deviceToken, submitted.submissionId,
      { leaseId: recoveredLease.leaseId, status: 'quarantined', reason: '项目成员已变化，结果未采纳' });
    assert.equal(isolated.status, 'quarantined');
    assert.throws(() => service.settleInboxSubmission(target.deviceToken, submitted.submissionId,
      { leaseId: recoveredLease.leaseId, status: 'committed' }), /已经完成其他处置/);
  } finally { service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('one project session freezes a sorted multi-student cloud scope and exposes only matching project material', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-agent-project-scope-'));
  const service = require('../cloud-report-service/service.cjs').createService({ dataDir: root, adminToken: ADMIN,
    allowLegacyTestCredentials: true });
  try {
    const first = service.createStudent(ADMIN, '项目学生甲');
    const second = service.createStudent(ADMIN, '项目学生乙');
    const source = service.registerSource(ADMIN);
    const viewerKey = require('node:crypto').generateKeyPairSync('ec', { namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }).publicKey;
    const viewer = service.createPairing('', viewerKey);
    for (const student of [first, second]) {
      service.allowWrite(ADMIN, source.deviceId, student.id);
      service.issueV2Grant(ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id,
        scope: 'material.write', category: 'learning_material' });
      service.issueV2Grant(ADMIN, { deviceId: viewer.deviceId, cloudStudentId: student.id,
        scope: 'material.read', category: 'learning_material' });
    }
    const fingerprint = 'c'.repeat(64);
    const prepared = service.prepareV2Material(source.deviceToken, second.id, { category: 'learning_material',
      materialId: 'project:shared:001', idempotencyKey: 'project:shared:001:v1', displayName: '共享资料.md',
      contentType: 'text/markdown', projectId: 'project:multi:001', scopeFingerprint: fingerprint });
    const bytes = Buffer.from('# 多学生项目共享资料\n');
    fs.writeFileSync(prepared.tempPath, bytes);
    const uploaded = prepared.commit({ sha: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length, head: bytes.subarray(0, 16) });
    const session = service.issueRemoteAgentSession(viewer.deviceToken, { provider: 'workbuddy',
      cloudStudentIds: [second.id, first.id, second.id], projectId: 'project:multi:001', scopeFingerprint: fingerprint,
      taskId: 'task:multi:001', executionId: 'execution:multi:001', taskType: 'project_digest.v2', idempotencyKey: 'execution:multi:001',
      materialCategories: ['learning_material'] });
    assert.deepEqual(session.cloudStudentIds, [first.id, second.id].sort());
    const listed = service.listRemoteAgentMaterials(session.sessionToken, { category: 'learning_material' });
    assert.deepEqual(listed.cloudStudentIds, [first.id, second.id].sort());
    assert.deepEqual(listed.materials.map(item => item.revisionId), [uploaded.revisionId]);
    assert.throws(() => service.issueRemoteAgentSession(viewer.deviceToken, { provider: 'codex',
      cloudStudentIds: [first.id, second.id], projectId: 'project:multi:001', scopeFingerprint: fingerprint,
      taskId: 'task:multi:002', executionId: 'execution:multi:002', taskType: 'project_digest.v2', idempotencyKey: 'execution:multi:001',
      materialCategories: ['learning_material'] }), /任务已存在/);
  } finally { service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('remote Agent task columns migrate before the idempotency index is created', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-agent-migration-'));
  const databasePath = path.join(root, 'cloud-reports.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE remote_agent_sessions (
      session_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      owner_device_id TEXT NOT NULL, provider TEXT NOT NULL,
      student_id TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
      scope_fingerprint TEXT NOT NULL DEFAULT '', categories_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
    );
  `);
  legacy.close();
  const service = require('../cloud-report-service/service.cjs').createService({ dataDir: root, adminToken: ADMIN,
    allowLegacyTestCredentials: true });
  try {
    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const columns = new Set(migrated.prepare('PRAGMA table_info(remote_agent_sessions)').all().map(column => column.name));
      assert.equal(columns.has('idempotency_key'), true);
      assert.equal(columns.has('execution_id'), true);
      assert.equal(columns.has('student_ids_json'), true);
      assert.equal(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='remote_agent_sessions_task'").get()[1], 1);
    } finally { migrated.close(); }
  } finally { service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
