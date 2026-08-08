const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const sourceRoot = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
const statuses = read('MaterialStatus.kt');
const repositories = read('FileAssetRepository.kt');
const service = read('FileAssetService.kt');
const windowsMain = fs.readFileSync(path.join(repo, 'electron', 'main.cjs'), 'utf8');

test('W4 preserves the complete Windows material state vocabulary', () => {
  for (const status of ['pending_digest', 'submitted', 'digesting', 'processed', 'ignored', 'invalid', 'failed', 'removed']) {
    assert.match(statuses, new RegExp(status));
  }
  assert.match(statuses, /canTransitionTo/);
});

test('W4 keeps per-student materials v1 and global asset-index v1 ledgers', () => {
  assert.match(windowsMain, /materials\.json/);
  assert.match(repositories, /\.edu-manager\/materials\.json/);
  assert.match(windowsMain, /asset-index\.json/);
  assert.match(repositories, /asset-index\.json/);
  assert.match(repositories, /put\("version", 1\)/);
  assert.match(repositories, /students\.requireExact|studentId/);
});

test('W4 asset fields and reference fields match the Windows asset center contract', () => {
  for (const field of ['assetId', 'filename', 'sha1', 'size', 'type', 'path', 'ownerStudentId', 'ownerStudentName', 'linkedStudents', 'linkedProjects', 'references', 'sourcePath', 'sourceName', 'sourceType', 'captureSessionId', 'captureItemId', 'courseId', 'courseProvider', 'courseUrl', 'uploadedAt', 'updatedAt', 'status']) {
    assert.match(service, new RegExp(`put\\("${field}"`));
  }
  for (const field of ['spaceType', 'spaceId', 'spaceName', 'workspaceId', 'logicalPath', 'role', 'path', 'source', 'linkedAt']) {
    assert.match(service, new RegExp(`put\\("${field}"`));
  }
});

test('W4 imports through Android document picker, copies into raw library and indexes by SHA-1', () => {
  const activity = read('MainActivity.kt');
  assert.match(activity, /ACTION_OPEN_DOCUMENT/);
  assert.match(activity, /EXTRA_ALLOW_MULTIPLE/);
  assert.match(service, /writeBytesSafely\(logicalPath/);
  assert.match(service, /digest\("SHA-1"/);
  assert.match(service, /upsertBySha1/);
  assert.match(service, /@RAW_DIR/);
});
