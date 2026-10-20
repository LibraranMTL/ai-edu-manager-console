'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createHttpServer } = require('../cloud-report-service/http.cjs');
const { createCloudReportRuntime, DEFAULT_MATERIAL_CATEGORIES, DEFAULT_PROFILE_FIELDS } = require('../electron/cloud-report-runtime.cjs');

const ADMIN = 'cloud-v2-test-admin-token-private-123456';

test('v2 profile authorization syncs default contact fields and creates one stable local binding without health access', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-v2-sync-'));
  const app = createHttpServer({ dataDir: path.join(root, 'service'), adminToken: ADMIN, allowLegacyTestCredentials: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const reportDir = path.join(root, 'reports'); fs.mkdirSync(reportDir);
  const localProfile = { name: '合成学生甲', grade: '八年级', school: '合成学校', goal: '准备项目展示',
    currentRegion: '上海', phone: '13800000000', email: 'student@example.test', birthDate: '2012-03-04',
    address: '合成路 1 号', guardian: { name: '合成监护人', phone: '13900000000' } };
  const source = createCloudReportRuntime({ dataDir: path.join(root, 'source'), protect: value => value, unprotect: value => value,
    resolveReportDir: id => id === 'local-source' ? reportDir : '', resolveStudentProfile: id => id === 'local-source' ? localProfile : null });
  let createCalls = 0;
  const receiver = createCloudReportRuntime({ dataDir: path.join(root, 'receiver'), protect: value => value, unprotect: value => value,
    resolveReportDir: () => '', ensureLocalStudentFromCloudProfile: async profile => {
      createCalls += 1;
      assert.equal(profile.profile.phone, localProfile.phone);
      assert.equal(profile.profile.email, undefined);
      assert.equal(profile.profile.address, undefined);
      assert.equal(profile.profile.guardian, undefined);
      return { localStudentId: 'local-created-once', status: createCalls === 1 ? 'created' : 'updated' };
    } });
  async function post(route, body) {
    const response = await fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status < 300, true, `${route}: ${response.status}`);
    return response.json();
  }
  try {
    await source.load(); await receiver.load();
    const student = await post('/v1/students', { displayName: localProfile.name });
    const enrollment = await post('/v1/source-enrollments', { cloudStudentId: student.id });
    const enrolled = await source.enrollSource({ serverUrl: base, enrollmentCode: enrollment.enrollmentCode, localStudentId: 'local-source' });
    assert.equal(enrolled.cloudStudentId, student.id);
    const sourceGrants = app.service.listV2Grants(ADMIN, student.id);
    assert.deepEqual(sourceGrants.find(item => item.scope === 'student_profile.write').fields, DEFAULT_PROFILE_FIELDS);
    assert.deepEqual(sourceGrants.filter(item => item.scope === 'material.write').map(item => item.category).sort(), [...DEFAULT_MATERIAL_CATEGORIES].sort());
    assert.equal(sourceGrants.some(item => item.scope.startsWith('health_record.')), false);
    const narrowed = await source.setUploadScope('local-source', {
      profileFields: ['displayName', 'phone'], materialCategories: ['topic_suggestion'],
    });
    assert.deepEqual(narrowed.profileFields, ['displayName', 'phone']);
    assert.deepEqual(narrowed.materialCategories, ['topic_suggestion']);
    const activeSourceGrants = app.service.listV2Grants(ADMIN, student.id).filter(item => item.deviceId === app.service.db
      .prepare("SELECT id FROM devices WHERE kind='source' AND id<>'admin_local'").get().id && !item.revokedAt);
    assert.deepEqual(activeSourceGrants.find(item => item.scope === 'student_profile.write').fields, ['displayName', 'phone']);
    assert.deepEqual(activeSourceGrants.filter(item => item.scope === 'material.write').map(item => item.category), ['topic_suggestion']);
    assert.equal(activeSourceGrants.some(item => item.scope.startsWith('health_record.')), false);

    const pairing = await receiver.createPairing(base);
    await source.approvePairing(pairing.pairingCode, ['local-source']);
    const first = await receiver.listCloudStudents();
    assert.equal(first[0].localBinding.localStudentId, 'local-created-once');
    assert.equal(createCalls, 1);
    await receiver.listCloudStudents();
    assert.equal(createCalls, 1, 'unchanged profile revision must reuse the binding');
    const readGrants = app.service.listV2Grants(ADMIN, student.id).filter(item => item.deviceId === pairing.deviceId);
    assert.equal(readGrants.some(item => item.scope === 'student_profile.read'), true);
    assert.deepEqual(readGrants.find(item => item.scope === 'student_profile.read' && !item.revokedAt).fields, ['displayName', 'phone']);
    assert.deepEqual(readGrants.filter(item => item.scope === 'material.read' && !item.revokedAt).map(item => item.category), ['topic_suggestion']);
    assert.equal(readGrants.some(item => item.scope.startsWith('health_record.')), false);
    const material = { category: 'topic_suggestion', materialId: 'topic:synthetic:001', idempotencyKey: 'topic:synthetic:001:v1',
      displayName: '合成选题建议.md', contentType: 'text/markdown', content: '# 合成选题建议\n\n仅用于协议测试。\n' };
    const uploaded = await source.uploadCloudMaterial('local-source', material);
    assert.match(uploaded.revisionId, /^material_rev_[a-f0-9]{48}$/);
    const duplicate = await source.uploadCloudMaterial('local-source', material);
    assert.equal(duplicate.duplicate, true);
    const listed = await receiver.listCloudMaterials(student.id, { category: 'topic_suggestion' });
    assert.equal(listed.materials.length, 1);
    const downloaded = await receiver.downloadCloudMaterial(student.id, uploaded.revisionId);
    assert.equal(downloaded.content, material.content);
    assert.equal(fs.readFileSync(downloaded.path, 'utf8'), material.content);
    assert.equal(app.service.db.prepare('SELECT COUNT(*) AS count FROM device_student_bindings WHERE device_id=? AND student_id=?')
      .get(pairing.deviceId, student.id).count, 1);
    assert.equal(app.service.db.prepare('SELECT COUNT(*) AS count FROM transfer_receipts WHERE device_id=? AND student_id=?')
      .get(pairing.deviceId, student.id).count, 1);
  } finally {
    source.close(); receiver.close(); await app.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('upload scope selection persists locally across restart without upgrading a legacy grant', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-upload-scope-local-'));
  const app = createHttpServer({ dataDir: path.join(root, 'service'), adminToken: ADMIN, allowLegacyTestCredentials: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const reportDir = path.join(root, 'reports'); fs.mkdirSync(reportDir);
  const runtimeDir = path.join(root, 'source');
  const options = { dataDir: runtimeDir, protect: value => value, unprotect: value => value,
    resolveReportDir: id => id === 'legacy-local' ? reportDir : '' };
  const source = createCloudReportRuntime(options);
  let restored;
  async function post(route, body) {
    const response = await fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status < 300, true, `${route}: ${response.status}`);
    return response.json();
  }
  try {
    await source.load();
    const student = await post('/v1/students', { displayName: '旧许可合成学生' });
    const enrollment = await post('/v1/source-enrollments', { cloudStudentId: student.id });
    await source.enrollSource({ serverUrl: base, enrollmentCode: enrollment.enrollmentCode, localStudentId: 'legacy-local' });
    assert.equal(app.service.listV2Grants(ADMIN, student.id).length, 0);
    const saved = await source.setUploadScope('legacy-local', {
      profileFields: ['displayName', 'phone'], materialCategories: ['learning_material'],
    });
    assert.equal(saved.uploadScopePersistence, 'local_requires_upgrade');
    assert.deepEqual(saved.savedUploadScope, { profileFields: ['displayName', 'phone'], materialCategories: ['learning_material'] });
    assert.equal(app.service.listV2Grants(ADMIN, student.id).length, 0, 'saving a local choice must not upgrade the server grant');
    source.close();
    restored = createCloudReportRuntime(options); await restored.load();
    assert.deepEqual(restored.status('legacy-local').savedUploadScope, saved.savedUploadScope);
  } finally {
    source.close(); restored?.close(); await app.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('health grants require explicit object scope and are not inferred from profile or document access', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-v2-health-'));
  const service = require('../cloud-report-service/service.cjs').createService({ dataDir: root, adminToken: ADMIN, allowLegacyTestCredentials: true });
  try {
    const student = service.createStudent(ADMIN, '合成学生乙');
    const viewer = service.createPairing('', require('node:crypto').generateKeyPairSync('ec', { namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }).publicKey);
    assert.throws(() => service.issueV2Grant(ADMIN, { deviceId: viewer.deviceId, cloudStudentId: student.id,
      scope: 'health_record.read', objectScope: [] }), /必须明确指定资料范围/);
    const issued = service.issueV2Grant(ADMIN, { deviceId: viewer.deviceId, cloudStudentId: student.id,
      scope: 'health_record.read', objectScope: ['health_record_001'] });
    assert.deepEqual(issued.objectScope, ['health_record_001']);
  } finally { service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('legacy report write permission cannot self-upgrade into v2 profile or material scope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-v2-legacy-scope-'));
  const service = require('../cloud-report-service/service.cjs').createService({ dataDir: root, adminToken: ADMIN, allowLegacyTestCredentials: true });
  try {
    const student = service.createStudent(ADMIN, '合成旧版学生');
    const source = service.registerSource(ADMIN, require('node:crypto').generateKeyPairSync('ec', { namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }).publicKey);
    service.allowWrite(ADMIN, source.deviceId, student.id);
    assert.throws(() => service.setOwnUploadScope(source.deviceToken, { cloudStudentId: student.id,
      profileFields: DEFAULT_PROFILE_FIELDS, materialCategories: DEFAULT_MATERIAL_CATEGORIES }), /旧版上传许可不能直接扩大/);
    assert.equal(service.listV2Grants(ADMIN, student.id).length, 0);
  } finally { service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
