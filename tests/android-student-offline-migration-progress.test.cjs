const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const main = fs.readFileSync(path.join(root, 'MainActivity.kt'), 'utf8');
const service = fs.readFileSync(path.join(root, 'StudentOfflineMigrationService.kt'), 'utf8');
const journal = fs.readFileSync(path.join(root, 'StudentOfflineMigrationJournal.kt'), 'utf8');

test('Windows U disk migration exposes a persistent in-app progress card', () => {
  assert.match(main, /ProgressBar\(this, null, android\.R\.attr\.progressBarStyleHorizontal\)/);
  assert.match(main, /U盘迁移 ·/);
  assert.match(main, /文件 \$\{state\.completedFiles\}\/\$\{state\.totalFiles\}/);
  assert.match(main, /当前文件 \$\{formatBytes\(state\.currentFileBytes\)\}/);
  assert.match(main, /formatElapsed/);
  assert.match(main, /offlineMigrationPhaseLabel/);
});
test('progress survives navigation and missed broadcasts without depending on notifications', () => {
  assert.match(main, /StudentOfflineMigrationService\.ACTION_PROGRESS/);
  assert.match(main, /ContextCompat\.registerReceiver/);
  assert.match(main, /RECEIVER_NOT_EXPORTED/);
  assert.match(main, /latestProgress\(\)/);
  assert.match(main, /OFFLINE_MIGRATION_POLL_MS = 1_000L/);
  assert.match(main, /requestMigrationNotificationPermission\(\)/);
  assert.match(main, /通知权限被拒绝时，应用内进度仍会继续显示/);
});

test('large files publish byte progress while durable checkpoints stay throttled', () => {
  assert.match(service, /currentFileBytes = copied/);
  assert.match(service, /LIVE_UPDATE_INTERVAL_MS = 500L/);
  assert.match(service, /LIVE_PERSIST_INTERVAL_MS = 5_000L/);
  assert.match(service, /forcePersist = false/);
  assert.match(journal, /fun writeProgress/);
  assert.match(journal, /fun latestProgress/);
  assert.match(journal, /toProgressJson/);
  assert.match(journal, /completedKeys/);
});

test('each migration owns its preparation and failure state and duplicate UI starts are disabled', () => {
  assert.match(service, /migrationId = "pending-\$startedAt"/);
  assert.match(service, /activeState/);
  assert.doesNotMatch(service, /val previous = journal\.latest\(\)/);
  assert.match(service, /private val running = AtomicBoolean\(false\)/);
  assert.match(main, /StudentOfflineMigrationService\.isRunning\(\)/);
  assert.match(main, /继续上次 U 盘迁移/);
});
