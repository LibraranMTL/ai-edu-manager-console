const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const app = path.resolve(__dirname, '../android-standalone-manager/app');
const read = (name) => fs.readFileSync(path.join(app, 'src/main/java/com/qxmatrix/edumanager/standalone', name), 'utf8');
test('task ledger migration is additive and old JSON is never overwritten or discarded', () => {
  const db = read('BusinessDatabase.kt'); const store = read('TaskLedgerStore.kt');
  assert.match(db, /version = 3/); assert.match(db, /addMigrations\(MIGRATION_1_2, MIGRATION_2_3\)/);
  assert.doesNotMatch(db, /fallbackToDestructiveMigration|allowMainThreadQueries|DROP TABLE/);
  assert.match(store, /legacy-room-v2/); assert.match(store, /readIfPresent\(TASKS\)/);
  assert.match(store, /LegacyTaskCodec.decode/); assert.doesNotMatch(store, /catch[^]*emptyList/);
});
test('task states and mutations preserve protocol while scoped lists use indexed DB reads', () => {
  const db = read('BusinessDatabase.kt'); const repository = read('TaskRepository.kt');
  assert.match(db, /studentId = :studentId OR \(studentId = '' AND projectId IN/);
  assert.match(db, /SELECT EXISTS/); assert.match(db, /revision = :expected/);
  assert.match(repository, /validateExternalResult/); assert.match(repository, /store.transaction/);
  assert.match(read('TaskCenterPolicy.kt'), /process_interrupted/);
  assert.match(read('TaskLedgerStore.kt'), /autoRetry", false/);
});
test('task center is local, lifecycle guarded and only cancels unstarted tasks', () => {
  const ui = read('TaskCenterActivity.kt');
  assert.match(ui, /request != generation/); assert.match(ui, /KEY_CURRENT_STUDENT_ID/);
  assert.match(ui, /listForStudent\(studentId/); assert.match(ui, /cancelQueued/);
  assert.match(ui, /shutdownNow/); assert.match(ui, /CloudReportSync/);
  assert.match(read('MainActivity.kt'), /TaskCenterActivity::class.java/);
});
test('backup and device transfer export logical Room snapshots and protect recovery credentials', () => {
  for (const file of ['BackupRestoreService.kt', 'StandaloneDeviceMigrationService.kt']) {
    assert.match(read(file), /BusinessDatabaseBackup/); assert.match(read(file), /restoreStaged/);
    assert.match(read(file), /BusinessRestoreRecovery.PREFIX/);
  }
  assert.match(read('BusinessRestoreRecovery.kt'), /restore-operation/);
  assert.match(read('BusinessRestoreRecovery.kt'), /phase", "rolled_back/);
  assert.match(read('MainActivity.kt'), /pendingRestore/);
});
