'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createHttpServer } = require('../cloud-report-service/http.cjs');
const { snapshotPublishedReports, uploadPublishedReports } = require('../electron/cloud-report-sync.cjs');

const ADMIN = 'cloud-test-admin-token-keep-private-123456';
const STUDENT = 'local-student-001';

function report(type, status = 'published', studentId = '') {
  return `---\ntype: ${type}\nstatus: ${status}\nupdated: 2026-09-25\n${studentId ? `student_id: ${studentId}\n` : ''}---\n\n# 整体画像\n\n## 学习优势\n\n- 已确认的数学建模练习持续推进。\n`;
}

test('Windows snapshot accepts trusted legacy ownership, skips draft and wrong student', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-win-snapshot-'));
  try {
    fs.writeFileSync(path.join(root, '整体画像.md'), report('learning_profile'));
    fs.writeFileSync(path.join(root, '历史变化.md'), report('learning_change', 'draft'));
    fs.writeFileSync(path.join(root, '每日行动建议.md'), report('weekly_action', 'published', 'other-student'));
    const result = await snapshotPublishedReports({ reportDir: root, localStudentId: STUDENT, cloudStudentId: 'cs_teststudent' });
    assert.equal(result.ready.length, 1);
    assert.equal(result.ready[0].reportType, 'learning_profile');
    assert.equal(result.skipped.length, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Windows uploader sends only formal reports and server deduplicates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-win-upload-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-win-service-'));
  const app = createHttpServer({ dataDir, adminToken: ADMIN, allowLegacyTestCredentials: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    fs.writeFileSync(path.join(root, '整体画像.md'), report('learning_profile'));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    async function post(route, token, body) {
      const response = await fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.ok(response.ok);
      return response.json();
    }
    const student = await post('/v1/students', ADMIN, { displayName: '测试学生' });
    const source = await post('/v1/devices/source', ADMIN, {});
    await post('/v1/grants/write', ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id });
    const options = { serverUrl: base, deviceToken: source.deviceToken, reportDir: root, localStudentId: STUDENT, cloudStudentId: student.id };
    const first = await uploadPublishedReports(options);
    const second = await uploadPublishedReports(options);
    assert.equal(first.uploaded.length, 1);
    assert.equal(first.uploaded[0].duplicate, false);
    assert.equal(second.uploaded[0].duplicate, true);
    assert.equal(fs.readFileSync(path.join(root, '整体画像.md'), 'utf8'), report('learning_profile'));
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
