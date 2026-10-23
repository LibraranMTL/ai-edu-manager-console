'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createHttpServer } = require('../cloud-report-service/http.cjs');
const { createCloudReportRuntime } = require('../electron/cloud-report-runtime.cjs');
const { sourceProof } = require('../electron/cloud-device-proof.cjs');

const ADMIN = 'cloud-test-admin-token-keep-private-123456';
const CONTENT = '---\ntype: learning_profile\nstatus: published\nupdated: 2026-09-25\n---\n\n# 整体画像\n\n## 学习优势\n\n- 已确认的数学建模练习持续推进。\n';

test('legacy upload bindings without v2 scope arrays never enter v2 profile synchronization', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-runtime-legacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'cloud-report-state.json'), JSON.stringify({
    version: 1,
    serverUrl: 'http://127.0.0.1:1',
    sourceToken: 'legacy-token',
    sourcePrivateKey: 'legacy-key',
    sourceDeviceId: 'legacy-device',
    bindings: {
      legacy: { cloudStudentId: 'cloud-legacy', sourceDeviceId: 'legacy-device', enabled: true, hashes: {}, lastError: '' },
    },
  }));
  let profileReads = 0;
  const runtime = createCloudReportRuntime({ dataDir: root, protect: value => value, unprotect: value => value,
    resolveReportDir: () => root, resolveStudentProfile: () => { profileReads++; return { displayName: '旧版学生' }; } });
  t.after(() => runtime.close());
  await runtime.load();
  assert.equal(await runtime.syncStudentProfile('legacy'), null);
  assert.equal(profileReads, 0);
  assert.equal(runtime.status('legacy').uploadScopePersistence, 'local_requires_upgrade');
  assert.deepEqual(runtime.status('legacy').profileFields, [...require('../electron/cloud-report-runtime.cjs').DEFAULT_PROFILE_FIELDS]);
});

test('one Windows host enrolls once, syncs, pairs, excludes own reports, and can turn upload off', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-runtime-'));
  const serviceDir = path.join(root, 'service');
  const reportDir = path.join(root, 'reports');
  fs.mkdirSync(reportDir);
  fs.writeFileSync(path.join(reportDir, '整体画像.md'), CONTENT);
  const app = createHttpServer({ dataDir: serviceDir, adminToken: ADMIN, allowLegacyTestCredentials: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function call(route, token, body) {
    const response = await fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, `${route}: HTTP ${response.status}`);
    return response.json();
  }
  const runtime = createCloudReportRuntime({ dataDir: path.join(root, 'win'), protect: value => value,
    unprotect: value => value, resolveReportDir: id => id === 'local-one' ? reportDir : '' });
  const receiver = createCloudReportRuntime({ dataDir: path.join(root, 'receiver'), protect: value => value,
    unprotect: value => value, resolveReportDir: () => '' });
  try {
    await runtime.load(); await receiver.load();
    const student = await call('/v1/students', ADMIN, { displayName: '样例学生' });
    const enrollment = await call('/v1/source-enrollments', ADMIN, { cloudStudentId: student.id });
    await runtime.enrollSource({ serverUrl: base, enrollmentCode: enrollment.enrollmentCode, localStudentId: 'local-one' });
    await runtime.syncStudent('local-one');
    const manual = await runtime.syncNow('local-one');
    assert.equal(manual.enabled, true); assert.equal(manual.lastReady, 1);
    assert.equal(manual.lastUnchanged, 1); assert.equal(manual.lastUploaded, 0);
    await assert.rejects(runtime.syncNow('other-student'), /上传授权/);
    const pairing = await runtime.createPairing(base);
    await runtime.approvePairing(pairing.pairingCode, ['local-one']);
    const sameHostPairing = await runtime.createPairing(base);
    assert.equal(sameHostPairing.deviceId, pairing.deviceId);
    assert.equal((await runtime.listCloudStudents()).length, 1);
    assert.equal((await runtime.listCloudReports(student.id)).reports.length, 0);
    const android = await call('/v1/devices/source', ADMIN, {});
    await call('/v1/grants/write', ADMIN, { deviceId: android.deviceId, cloudStudentId: student.id });
    const hash = crypto.createHash('sha256').update(CONTENT).digest('hex');
    await call('/v1/reports', android.deviceToken, { cloudStudentId: student.id, originPlatform: 'android',
      reportType: 'learning_profile', sourceStatus: 'published', publishedAt: '2026-09-25',
      content: CONTENT, sourceSha256: hash, contentSha256: hash, filename: '整体画像.md' });
    const listed = await runtime.listCloudReports(student.id);
    assert.equal(listed.reports.length, 1);
    assert.equal(listed.reports[0].originPlatform, 'android');
    const saved = await runtime.downloadCloudReport(student.id, listed.reports[0].revisionId);
    assert.equal(saved.content, CONTENT);
    const remotePairing = await receiver.createPairing(base);
    await runtime.approvePairing(remotePairing.pairingCode, ['local-one']);
    assert.equal((await receiver.listCloudStudents())[0].id, student.id);
    assert.equal((await receiver.listCloudReports(student.id)).reports.length, 2);
    const manualDocument = await fetch(`${base}/v1/students/${student.id}/documents`, {
      method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'text/markdown',
        'x-document-name': encodeURIComponent('试点笔记.md') }, body: Buffer.from('# 合成试点笔记\n'),
    });
    assert.equal(manualDocument.status, 201);
    const documentId = (await manualDocument.json()).documentId;
    assert.equal((await receiver.listCloudDocuments(student.id))[0].documentId, documentId);
    const downloadedDocument = await receiver.downloadCloudDocument(student.id, documentId);
    assert.equal(downloadedDocument.content, '# 合成试点笔记\n');
    assert.equal(fs.readFileSync(downloadedDocument.path, 'utf8'), downloadedDocument.content);
    const sharedContent = '# 合成选题建议\n\n只含合成摘要，不含原始档案。';
    const shared = { name: '选题建议-v1.md', content: sharedContent, sha256: crypto.createHash('sha256').update(sharedContent).digest('hex') };
    const upload = await runtime.uploadSharedDocument('local-one', shared);
    assert.equal(upload.ok, true);
    assert.equal(upload.cloudStudentId, student.id);
    const duplicates = await Promise.all([runtime.uploadSharedDocument('local-one', shared), runtime.uploadSharedDocument('local-one', shared)]);
    assert.equal(duplicates[0].duplicate, true);
    assert.equal(duplicates[1].documentId, upload.documentId);
    assert.equal((await receiver.listCloudDocuments(student.id)).filter(x => x.displayName === shared.name).length, 1);
    assert.equal((await receiver.downloadCloudDocument(student.id, upload.documentId)).content, sharedContent);
    await assert.rejects(runtime.uploadSharedDocument('other-student', shared), /当前学生/);
    await assert.rejects(runtime.uploadSharedDocument('local-one', { ...shared, sha256: '0'.repeat(64) }), /校验/);
    assert.equal((await receiver.removeCloudStudent(student.id)).removed, true);
    assert.equal((await receiver.listCloudStudents()).length, 0);
    await assert.rejects(receiver.listCloudDocuments(student.id), /没有此学生的许可/);
    await assert.rejects(receiver.downloadCloudDocument(student.id, documentId), /HTTP 403/);
    assert.equal((await receiver.listCachedStudents()).find(item => item.cloudStudentId === student.id)?.displayName, '样例学生');
    const otherCache = path.join(root, 'receiver', 'cloud-report-cache', `cs_${'f'.repeat(32)}`);
    fs.mkdirSync(otherCache, { recursive: true });
    fs.writeFileSync(path.join(otherCache, 'keep.txt'), 'other student cache');
    assert.equal((await receiver.clearCloudCache(student.id)).cleared, true);
    assert.equal(fs.existsSync(downloadedDocument.path), false);
    assert.equal(fs.readFileSync(path.join(otherCache, 'keep.txt'), 'utf8'), 'other student cache');
    assert.equal(fs.readFileSync(path.join(reportDir, '整体画像.md'), 'utf8'), CONTENT);
    await assert.rejects(receiver.clearCloudCache('../other'), /云端学生标识无效/);
    assert.equal(fs.readFileSync(path.join(reportDir, '整体画像.md'), 'utf8'), CONTENT);
    await runtime.setUpload('local-one', false);
    await assert.rejects(runtime.syncNow('local-one'), /上传授权/);
    assert.equal(runtime.status('local-one').enabled, false);
    await assert.rejects(runtime.uploadSharedDocument('local-one', shared), /来源许可/);
    const savedState = JSON.parse(fs.readFileSync(path.join(root, 'win', 'cloud-report-state.json'), 'utf8'));
    const body = JSON.stringify({ cloudStudentId: student.id });
    const stopped = await fetch(`${base}/v1/reports`, { method: 'POST', headers: { authorization: `Bearer ${savedState.sourceToken}`, 'content-type': 'application/json',
      ...sourceProof(savedState.sourceDeviceId, savedState.sourcePrivateKey, 'POST', '/v1/reports', body) }, body });
    assert.equal(stopped.status, 403);
  } finally {
    runtime.close(); receiver.close(); await app.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});
