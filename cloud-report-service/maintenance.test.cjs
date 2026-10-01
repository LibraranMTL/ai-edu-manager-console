'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createService } = require('./service.cjs');
const { createBackup } = require('./backup.cjs');
const { exportAudit, verifyAudit, applyRetention, diskStatus } = require('./maintenance.cjs');
const { startBackupScheduler } = require('./backup-scheduler.cjs');

test('independent audit detects tampering and retention is dry-run by default, preserving newest snapshot and unrelated files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-maintenance-'));
  const dataDir = path.join(root, 'data'); const backupRoot = path.join(root, 'backups');
  const admin = 'maintenance-test-admin-credential-123456';
  const service = createService({ dataDir, adminToken: admin });
  const token = service.loginAdmin(admin).sessionToken;
  try {
    service.createStudent(token, '合成测试');
    const archive = path.join(root, 'independent', 'audit.json'); const key = crypto.randomBytes(32).toString('hex');
    await exportAudit(dataDir, archive, key);
    assert.equal((await verifyAudit(archive, key, dataDir)).verified, true);
    await assert.rejects(verifyAudit(archive, 'x'.repeat(32)), /签名/);
    service.db.prepare("UPDATE audit_events SET action='changed' WHERE id=1").run();
    await assert.rejects(verifyAudit(archive, key, dataDir), /不一致/);
    for (let i = 0; i < 3; i++) await createBackup(dataDir, path.join(backupRoot, `snapshot-20260926T00000${i}Z-${crypto.randomUUID()}`));
    fs.writeFileSync(path.join(backupRoot, 'keep-user-file.txt'), 'unrelated');
    const options = { keep: 1, days: 30, now: Date.now() + 40 * 86400000 };
    const preview = await applyRetention(backupRoot, options);
    assert.equal(preview.dryRun, true); assert.equal(preview.candidates.length, 2); assert.equal(fs.readdirSync(backupRoot).length, 4);
    const applied = await applyRetention(backupRoot, { ...options, confirm: true });
    assert.equal(applied.deleted.length, 2); assert.equal(fs.readdirSync(backupRoot).length, 2);
    assert.equal(fs.readFileSync(path.join(backupRoot, 'keep-user-file.txt'), 'utf8'), 'unrelated');
    assert.ok((await diskStatus(dataDir)).freeBytes > 0);
    const scheduler = startBackupScheduler({ dataDir, backupRoot, immediate: false, minimumFreeBytes: Number.MAX_SAFE_INTEGER, onSuccess: () => {} });
    try { await assert.rejects(scheduler.runNow(), /空间不足/); assert.match(scheduler.status().lastError, /空间不足/); }
    finally { await scheduler.stop(); }
  } finally { service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
