'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createHttpServer } = require('../cloud-report-service/http.cjs');
const { createCloudReportRuntime } = require('../electron/cloud-report-runtime.cjs');

const ADMIN = 'auto-enroll-test-admin-token-private-123456';
const CAPABILITIES = ['course_learning', 'course_policy_manage', 'tenant_course_manage'];
const REPORT = '---\ntype: learning_profile\nstatus: published\nupdated: 2026-10-24\n---\n\n# 整体画像\n\n- SOURCE-01 自动上传验证。\n';

function licenseFixture(deviceId = 'host-auto-enroll-test') {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const payload = { schema: 'edu-manager.license.v3', licenseId: 'license-auto-enroll-001', productId: 'WINDOWS_HOST',
    edition: 'PRO', capabilities: CAPABILITIES, devicePolicy: 'required_binding', deviceId,
    maxActiveStudents: 3, maxDevices: 1, keyId: 'test-auto-enroll-key',
    issuedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2027-10-01T00:00:00.000Z' };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`AIE3.${encoded}`), keys.privateKey).toString('base64url');
  return { token: `AIE3.${encoded}.${signature}`, deviceId,
    trustedLicenseIssuers: { issuers: [{ keyId: payload.keyId, maxEdition: 'PLATFORM', publicKey: keys.publicKey }] } };
}

test('SOURCE-01 first source enrollment creates and stably reuses a cloud student without administrator action or code', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-source-auto-enroll-'));
  const license = licenseFixture();
  const app = createHttpServer({ dataDir: path.join(root, 'service'), adminToken: ADMIN,
    allowLegacyTestCredentials: true, trustedLicenseIssuers: license.trustedLicenseIssuers });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const profiles = { localA: { displayName: '来源端学生甲', phone: '13800000000' }, localB: { displayName: '来源端学生乙' } };
  for (const id of Object.keys(profiles)) fs.mkdirSync(path.join(root, id));
  fs.writeFileSync(path.join(root, 'localA', '整体画像.md'), REPORT);
  const runtime = createCloudReportRuntime({ dataDir: path.join(root, 'runtime'), protect: value => value, unprotect: value => value,
    resolveReportDir: id => profiles[id] ? path.join(root, id) : '', resolveStudentProfile: id => profiles[id] || null,
    resolveProductEntitlement: () => ({ active: true, licenseToken: license.token, deviceId: license.deviceId }) });
  try {
    await runtime.load();
    const authorization = { authorizationPurpose: 'document_sync', authorizationExpiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000 };
    const first = await runtime.enrollSource({ serverUrl: base, localStudentId: 'localA',
      profileFields: ['displayName', 'phone'], materialCategories: ['learning_report', 'learning_material'], ...authorization });
    const repeated = await runtime.enrollSource({ serverUrl: base, localStudentId: 'localA',
      profileFields: ['displayName', 'phone'], materialCategories: ['learning_report', 'learning_material'], ...authorization });
    assert.equal(repeated.cloudStudentId, first.cloudStudentId, 'same local student must reuse its cloud identity');
    for (let attempt = 0; attempt < 50 && app.service.db.prepare('SELECT COUNT(*) AS count FROM reports').get().count < 1; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(app.service.db.prepare('SELECT COUNT(*) AS count FROM reports').get().count, 1,
      'first authorization must schedule already published reports without administrator action');
    await runtime.setUploadScope('localA', { profileFields: ['displayName', 'phone'], materialCategories: ['learning_material'], ...authorization });
    fs.writeFileSync(path.join(root, 'localA', '整体画像.md'), REPORT.replace('自动上传验证', '取消报告类别后的变更'));
    await runtime.syncNow('localA');
    assert.equal(app.service.db.prepare('SELECT COUNT(*) AS count FROM reports').get().count, 1,
      'removing the report category must stop new report submissions without generating retry failures');
    const second = await runtime.enrollSource({ serverUrl: base, localStudentId: 'localB', ...authorization });
    assert.notEqual(second.cloudStudentId, first.cloudStudentId, 'different local students must not be name-matched or merged');
    assert.equal(app.service.db.prepare('SELECT COUNT(*) AS count FROM students').get().count, 2);
    assert.equal(app.service.db.prepare('SELECT COUNT(*) AS count FROM source_auto_bindings').get().count, 2);
    assert.equal(app.service.db.prepare("SELECT COUNT(*) AS count FROM devices WHERE kind='source' AND id<>'admin_local'").get().count, 1);
    const allGrants = app.service.listV2Grants(ADMIN, first.cloudStudentId);
    const grants = allGrants.filter(item => !item.revokedAt);
    assert.deepEqual(grants.find(item => item.scope === 'student_profile.write').fields, ['displayName', 'phone']);
    assert.deepEqual(grants.filter(item => item.scope === 'material.write').map(item => item.category).sort(), ['learning_material']);
    assert.equal(allGrants.some(item => item.scope === 'material.write' && item.category === 'learning_report' && item.revokedAt), true);
    assert.equal(grants.some(item => item.scope.startsWith('health_record.')), false);
  } finally {
    runtime.close(); await app.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('automatic source enrollment rejects an untrusted or wrong-device license', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-source-auto-reject-'));
  const license = licenseFixture('host-correct');
  const app = createHttpServer({ dataDir: path.join(root, 'service'), adminToken: ADMIN,
    allowLegacyTestCredentials: true, trustedLicenseIssuers: license.trustedLicenseIssuers });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/v2/source-auto-enroll`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ licenseToken: license.token, deviceId: 'host-wrong',
        bindingKey: crypto.randomBytes(32).toString('base64url'), displayName: '拒绝样例', publicKey: keys.publicKey,
        profileFields: ['displayName'], materialCategories: ['learning_report'] }) });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /设备不匹配/);
    assert.equal(app.service.db.prepare('SELECT COUNT(*) AS count FROM students').get().count, 0);
  } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
