const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sharedPath = path.join(root, 'android-shared/src/com/qxmatrix/projectmaterials/ProjectMaterialsDialog.java');
const shared = fs.readFileSync(sharedPath, 'utf8');
const student = fs.readFileSync(path.join(root,
  'android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java'), 'utf8');
const teacher = fs.readFileSync(path.join(root,
  'android-teacher-terminal/src/com/qxmatrix/eduteacher/MainActivity.java'), 'utf8');
const studentBuild = fs.readFileSync(path.join(root, 'android-tablet-terminal/build.ps1'), 'utf8');
const teacherBuild = fs.readFileSync(path.join(root, 'android-teacher-terminal/build.ps1'), 'utf8');

test('both Android terminals use one host-authorized four-view component', () => {
  for (const source of [student, teacher]) {
    assert.match(source, /ProjectMaterialsDialog\.open/);
    assert.match(source, /materialCapabilities/);
    assert.match(source, /supportsMaterialViews\(\)/);
    assert.match(source, /项目资料与知识/);
  }
  assert.match(studentBuild, /android-shared\\src\\com\\qxmatrix\\projectmaterials\\ProjectMaterialsDialog\.java/);
  assert.match(teacherBuild, /android-shared\\src\\com\\qxmatrix\\projectmaterials\\ProjectMaterialsDialog\.java/);
  for (const view of ['materials', 'pending', 'knowledge', 'contributions']) assert.match(shared, new RegExp(`"${view}"`));
});

test('Android role operations obey host capability flags and exact optimistic revisions', () => {
  assert.match(shared, /project\.can\("classificationSuggest"\)/);
  assert.match(shared, /project\.can\("classificationWrite"\)/);
  assert.match(shared, /project\.can\("adoptionWrite"\)/);
  assert.match(shared, /project\.can\("evidenceConfirm"\)/);
  assert.match(shared, /expectedVersion/);
  assert.match(shared, /expectedRecordRevision/);
  assert.match(shared, /expectedEvidenceRevision/);
  assert.match(shared, /classifications:batch/);
  assert.match(shared, /adoptions:batch/);
  assert.match(shared, /confirmation-preview/);
  assert.match(shared, /同一|idempotencyKey/);
});

test('Android specified-version download verifies identity length and SHA-256 before publishing', () => {
  assert.match(shared, /versions\/" \+ version \+ "\/download/);
  assert.match(shared, /X-Edu-Material-Id/);
  assert.match(shared, /X-Edu-Material-Version/);
  assert.match(shared, /X-Edu-Material-Sha256/);
  assert.match(shared, /Content-Length/);
  assert.match(shared, /MAX_DOWNLOAD_BYTES/);
  assert.match(shared, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(shared, /不会自动执行/);
});

test('Android offline caches are generation and principal scoped and never cache contributions', () => {
  assert.match(shared, /hostId \+ "\\n" \+ generation \+ "\\n" \+ principal/);
  assert.match(shared, /CACHE_MAX_AGE_MS/);
  assert.match(shared, /离线只读缓存/);
  assert.match(shared, /cacheEligible/);
  assert.match(shared, /return "materials"\.equals\(value\) \|\| "pending"\.equals\(value\) \|\| "knowledge"\.equals\(value\);/);
  assert.doesNotMatch(shared, /"contributions"\.equals\(value\).*cache/i);
});

test('Android terminals expose only host-authorized organization status and remote run or retry', () => {
  assert.match(shared, /project\.can\("organizationRead"\)/);
  assert.match(shared, /project\.can\("organizationRun"\)/);
  assert.match(shared, /project\.can\("organizationRetry"\)/);
  assert.match(shared, /\/materials\/organization"/);
  assert.match(shared, /\/materials\/organization:run/);
  assert.match(shared, /\/materials\/organization\/"/);
  assert.match(shared, /请求主机整理/);
  assert.match(shared, /本端不直接操作主机磁盘/);
  assert.match(shared, /离线缓存不能请求主机移动文件/);
  assert.doesNotMatch(shared, /configureProjectMaterialOrganization|capacityCleanup|undoProjectMaterialOrganization/);
});

test('Android terminals show host migration state and never migrate local storage', () => {
  for (const source of [student, teacher]) {
    assert.match(source, /materialMigrationState/);
    assert.match(source, /主机迁移中/);
    assert.match(source, /Windows主机正在迁移历史资料/);
    assert.match(source, /ProjectMaterialsDialog\.ProjectRef\(id, name, status, materialStorageMode,/);
  }
  assert.match(shared, /project\.migrationState/);
  assert.match(shared, /本端保持只读/);
  assert.match(shared, /本端不会执行磁盘迁移/);
  assert.doesNotMatch(shared, /move.*legacy|rename.*legacy|delete.*legacy/i);
});
