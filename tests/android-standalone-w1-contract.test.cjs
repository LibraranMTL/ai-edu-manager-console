const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'android-standalone-manager', 'app');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

test('W1 uses user-selected persistable SAF access without broad storage permission', () => {
  const manifest = read(app, 'src', 'main', 'AndroidManifest.xml');
  const grant = read(app, 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'SafRootGrant.kt');
  assert.match(grant, /ACTION_OPEN_DOCUMENT_TREE/);
  assert.match(grant, /FLAG_GRANT_PERSISTABLE_URI_PERMISSION/);
  assert.match(grant, /takePersistableUriPermission/);
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/);
});

test('W1 blocks absolute and traversal paths before document resolution', () => {
  const policy = read(app, 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'WorkspacePath.kt');
  assert.match(policy, /relativePath\.startsWith\('\/'\)/);
  assert.match(policy, /it == "\.\."/);
  assert.match(policy, /WINDOWS_DRIVE/);
});

test('W1 keeps a previous SAF target until a temporary write is complete', () => {
  const store = read(app, 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'SafWorkspaceStore.kt');
  assert.match(store, /temporaryName/);
  assert.match(store, /backupName/);
  assert.match(store, /existing\.renameTo\(backupName\)/);
  assert.match(store, /temporary\.renameTo\(fileName\)/);
  assert.match(store, /existing\?\.renameTo\(fileName\)/);
});

test('W1 stores private indexes with Android AtomicFile', () => {
  const store = read(app, 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'PrivateStateStore.kt');
  assert.match(store, /AtomicFile/);
  assert.match(store, /finishWrite/);
  assert.match(store, /failWrite/);
});
