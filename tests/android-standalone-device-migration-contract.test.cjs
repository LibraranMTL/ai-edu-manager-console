const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const java = path.join(root, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(java, name), 'utf8');

test('whole-device migration uses a distinct directory protocol without changing deployed student v2', () => {
  const models = read('StandaloneDeviceMigrationModels.kt');
  const student = read('StudentOfflineMigrationService.kt');
  assert.match(models, /edu-manager\.standalone-portable-folder\.v1/);
  assert.match(models, /edu-manager\.standalone-portable-manifest\.v1/);
  assert.match(models, /standalone-device/);
  assert.match(student, /edu-manager\.student-portable-folder\.v2/);
});

test('large whole-device migration is foreground resumable and hash verified', () => {
  const service = read('StandaloneDeviceMigrationService.kt');
  const manifest = fs.readFileSync(path.join(root, 'android-standalone-manager', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /StandaloneDeviceMigrationService/);
  assert.match(manifest, /foregroundServiceType="dataSync"/);
  assert.match(service, /START_REDELIVER_INTENT/);
  assert.match(service, /JOURNAL_INTERVAL = 10/);
  assert.match(service, /SHA-256/);
  assert.match(service, /completedKeys/);
  assert.match(service, /PARTIAL_WAKE_LOCK/);
});

test('new-tablet import is empty-target, seat-limited, ID preserving and transactional', () => {
  const service = read('StandaloneDeviceMigrationService.kt');
  assert.match(service, /StudentIndexRepository\(this\)\.list\(\)\.isEmpty\(\)/);
  assert.match(service, /ProjectRepository\(this\)\.list\(\)\.isEmpty\(\)/);
  assert.match(service, /descriptor\.optInt\("studentCount"\) <= license\.maxActiveStudents/);
  assert.match(service, /stagedStudentCount <= license\.maxActiveStudents/);
  assert.match(service, /stagedStudentCount == descriptor\.getInt\("studentCount"\)/);
  assert.match(service, /preserve-business-ids-remap-device-uris/);
  assert.match(service, /snapshotState\(\)/);
  assert.match(service, /rollbackState/);
  assert.match(service, /setDefaultRoot\(targetUri\)/);
});

test('device credentials and volatile grants are excluded but public Agent routing is restored', () => {
  const service = read('StandaloneDeviceMigrationService.kt');
  const agent = read('AgentAdapter.kt');
  for (const value of ['license-token', 'device-id', 'agent-api-key', 'android-keystore-key', 'saf-grants', 'media-projection-grant', 'collaboration-device-bindings']) {
    assert.match(service, new RegExp(value));
  }
  assert.match(agent, /data class AgentPublicConfiguration/);
  assert.match(agent, /remove\("credential"\)/);
  assert.match(agent, /需要重新填写 API Key/);
});

test('settings exposes device migration without removing encrypted archival backup', () => {
  const main = read('MainActivity.kt');
  for (const label of ['导出整机资料', '在新设备接管', '继续上次迁移', '查看迁移报告', '加密备份', '备份恢复']) {
    assert.match(main, new RegExp(label));
  }
});

test('legacy backup records the runtime package version instead of stale 1.0.0', () => {
  const backup = read('BackupRestoreService.kt');
  assert.doesNotMatch(backup, /APP_VERSION = "1\.0\.0"/);
  assert.match(backup, /appVersion\(\)/);
});

test('Android student keeps small-library upgrade and diverts large libraries to U disk', () => {
  const main = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'AndroidManifest.xml'), 'utf8');
  assert.match(main, /从 Windows 主机升级到单机版（少量资料）/);
  assert.match(main, /rawFileCount >= 1000/);
  assert.match(main, /rawTotalBytes >= 3L \* 1024L \* 1024L \* 1024L/);
  assert.match(manifest, /versionCode="94"/);
  assert.match(manifest, /versionName="0\.6\.24"/);
});
