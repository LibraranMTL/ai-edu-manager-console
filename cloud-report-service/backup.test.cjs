'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createService } = require('./service.cjs');
const { createBackup, verifyBackup, restoreBackup } = require('./backup.cjs');

const ADMIN = 'local-backup-test-admin-credential-123456';
const CONTENT = '---\ntype: learning_profile\nstatus: active\nupdated: 2026-09-25\n---\n\n# 整体画像\n\n- 合成练习证据显示一次明确的建模进展。\n';

test('consistent report/document backup verifies and restores without overwriting an existing target', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-backup-test-'));
  const liveDir = path.join(root, 'live');
  const backupDir = path.join(root, 'backup');
  const restoredDir = path.join(root, 'restored');
  const service = createService({ dataDir: liveDir, adminToken: ADMIN, allowLegacyTestCredentials: true });
  try {
    const student = service.createStudent(ADMIN, '合成学生');
    const source = service.registerSource(ADMIN);
    service.allowWrite(ADMIN, source.deviceId, student.id);
    const sha = crypto.createHash('sha256').update(CONTENT).digest('hex');
    const report = service.uploadReport(source.deviceToken, { cloudStudentId: student.id,
      originPlatform: 'android', reportType: 'learning_profile', sourceStatus: 'active',
      publishedAt: '2026-09-25', content: CONTENT, sourceSha256: sha,
      contentSha256: sha, filename: '整体画像.md' });
    const document = service.uploadDocument(ADMIN, student.id, '笔记.md', 'text/markdown', Buffer.from('# 合成笔记\n'));
    const oldSession = service.loginAdmin(ADMIN).sessionToken;
    const created = await createBackup(liveDir, backupDir);
    assert.equal(created.objectCount, 2);
    assert.equal((await verifyBackup(backupDir)).objectCount, 2);
    await assert.rejects(createBackup(liveDir, backupDir), /禁止覆盖/);
    assert.equal((await restoreBackup(backupDir, restoredDir)).objectCount, 2);
    await assert.rejects(restoreBackup(backupDir, restoredDir), /禁止覆盖/);
    const restored = createService({ dataDir: restoredDir, adminToken: ADMIN, allowLegacyTestCredentials: true });
    try {
      assert.throws(() => restored.listStudents(oldSession), /失效|许可|凭据/);
      assert.throws(() => restored.setOwnWrite(source.deviceToken, student.id, true), /失效|许可|凭据/);
      assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM grants WHERE revoked_at IS NULL').get().n, 0);
      const auditActions = restored.listAudit(ADMIN, '', student.id).events.map(event => event.action);
      assert.ok(auditActions.includes('report.upload'));
      assert.ok(auditActions.includes('document.upload'));
      assert.equal(restored.getReport(ADMIN, report.revisionId).content.toString('utf8'), CONTENT);
      assert.equal(restored.getDocument(ADMIN, document.documentId).content.toString('utf8'), '# 合成笔记\n');
      assert.equal(restored.listStudents(ADMIN).length, 1);
    } finally { restored.close(); }
    const object = fs.readdirSync(path.join(backupDir, 'objects'))[0];
    fs.writeFileSync(path.join(backupDir, 'objects', object), 'tampered');
    await assert.rejects(verifyBackup(backupDir), /备份对象校验失败/);
    await assert.rejects(restoreBackup(backupDir, path.join(root, 'must-not-exist')), /备份对象校验失败/);
    assert.equal(fs.existsSync(path.join(root, 'must-not-exist')), false);
  } finally {
    service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
