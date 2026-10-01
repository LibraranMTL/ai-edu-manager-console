'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createService } = require('./service.cjs');
const { startBackupScheduler } = require('./backup-scheduler.cjs');
const { verifyBackup } = require('./backup.cjs');

test('scheduled backup creates a verified new snapshot without changing the live data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-schedule-test-'));
  const dataDir = path.join(root, 'data');
  const backupRoot = path.join(root, 'backups');
  const service = createService({ dataDir, adminToken: 'test-admin-credential-1234567890', allowLegacyTestCredentials: true });
  const student = service.createStudent('test-admin-credential-1234567890', '合成学生');
  const scheduler = startBackupScheduler({ dataDir, backupRoot, immediate: false, onSuccess: () => {} });
  try {
    const before = fs.statSync(path.join(dataDir, 'cloud-reports.sqlite')).size;
    const result = await scheduler.runNow();
    assert.equal((await verifyBackup(result.backupDir)).objectCount, 0);
    assert.equal(fs.statSync(path.join(dataDir, 'cloud-reports.sqlite')).size, before);
    assert.equal(fs.readdirSync(backupRoot).length, 1);
    assert.deepEqual(service.listStudents('test-admin-credential-1234567890').map(item => item.id), [student.id]);
  } finally {
    await scheduler.stop();
    service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scheduler rejects overlapping backup and data roots and does not overlap runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-schedule-check-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  assert.throws(() => startBackupScheduler({ dataDir, backupRoot: path.join(dataDir, 'backups') }), /不能重叠/);
  let finish;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  let count = 0;
  const scheduler = startBackupScheduler({ dataDir, backupRoot: path.join(root, 'backups'), immediate: false, onSuccess: () => {},
    backup: () => { count++; markStarted(); return new Promise(resolve => { finish = resolve; }); } });
  try {
    const first = scheduler.runNow();
    const second = scheduler.runNow();
    assert.equal(first, second);
    await started;
    assert.equal(count, 1);
    finish({ ok: true });
    assert.deepEqual(await first, { ok: true });
    await scheduler.stop();
    assert.throws(() => scheduler.runNow(), /已停止/);
  } finally {
    await scheduler.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
