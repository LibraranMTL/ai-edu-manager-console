const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8');
const main = read('electron', 'main.cjs');
const preload = read('electron', 'preload.cjs');
const renderer = read('src', 'main.tsx');
const android = (...parts) => read('android-standalone-manager', 'app', 'src', 'main', ...parts);
const service = android('java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'StudentOfflineMigrationService.kt');
const journal = android('java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'StudentOfflineMigrationJournal.kt');
const catalog = android('java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'CourseCatalogService.kt');
const activity = android('java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'MainActivity.kt');
const safWorkspace = android('java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'SafWorkspaceStore.kt');
const manifest = android('AndroidManifest.xml');

test('Windows exposes exact-student Android directory export through async IPC', () => {
  assert.match(main, /studentOfflineMigrationInput\(studentId\)/);
  assert.match(main, /coursesForStudent\(student\)/);
  assert.match(main, /bridge:getStudentOfflineMigrationPlan/);
  assert.match(main, /bridge:createStudentOfflineMigration/);
  assert.match(preload, /onStudentOfflineMigrationProgress/);
  assert.match(renderer, /导出到 Android 单机版（U盘）/);
  assert.match(renderer, /平台.*机构/);
});

test('student terminal inventory no longer performs recursive scans in the login response', () => {
  const record = main.slice(main.indexOf('function terminalStudentRecord'), main.indexOf('function teacherTerminalStudentRecord'));
  assert.doesNotMatch(record, /countFiles\(|countMarkdownFiles\(/);
  assert.match(main, /collectTerminalDirectoryStats/);
  assert.match(main, /visited % 100 === 0/);
  const payload = main.slice(main.indexOf('function studentSessionStatePayload'), main.indexOf('function loginIdFromRequestValue'));
  assert.equal((payload.match(/terminalStudentRecord\(student\)/g) || []).length, 1);
});

test('Android large migration is foreground, resumable, hash verified and license gated', () => {
  assert.match(manifest, /FOREGROUND_SERVICE_DATA_SYNC/);
  assert.match(manifest, /StudentOfflineMigrationService/);
  assert.match(manifest, /foregroundServiceType="dataSync"/);
  assert.match(service, /LicenseManager\(this\)\.requireActive\(\)/);
  assert.match(service, /START_REDELIVER_INTENT/);
  assert.match(service, /PARTIAL_WAKE_LOCK/);
  assert.match(service, /writeStreamSafely/);
  assert.match(service, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(service, /completedKeys/);
  assert.match(journal, /Atomic|PrivateStateStore/);
  assert.match(activity, /从 U 盘迁移并接管/);
  assert.match(activity, /继续上次 U 盘迁移/);
});

test('Android SAF safe writes use short helper names for long source filenames', () => {
  assert.match(safWorkspace, /val temporaryName = "edu-write-\$token"/);
  assert.match(safWorkspace, /val backupName = "edu-backup-\$token"/);
  assert.doesNotMatch(safWorkspace, /\.\$fileName\.write-/);
  assert.match(safWorkspace, /目标目录无法创建迁移临时文件：\$relativePath/);
});

test('offline course snapshot retains platform and tenant courses for one exact student', () => {
  assert.match(catalog, /OFFLINE_SNAPSHOT_SCHEMA/);
  assert.match(catalog, /snapshot\.getString\("studentId"\) == studentId/);
  assert.match(catalog, /tenant_custom/);
  assert.match(catalog, /effectiveCourses\(studentId: String\?/);
  assert.match(catalog, /offlineSnapshot\(studentId\)/);
  assert.match(activity, /effectiveCourses\(student\.id\)/);
});
