const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const begin = main.slice(start - 6, start) === 'async ' ? start - 6 : start;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(begin, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

test('state SQLite v2 backup excludes raw project bytes and identifies its scope', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-state-backup-scope-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-state-backup-scope-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const raw = path.join(root, 'workspace', 'original.txt');
  fs.mkdirSync(path.dirname(raw));
  fs.writeFileSync(raw, 'synthetic project original');
  const scope = { fs, path, APP_VERSION: 'test', process,
    readStudentsIndex: () => [], createEducationArchiveVersion: () => {},
    readSettings: () => ({}), defaultStudentBaseDir: () => root,
    readDevices: () => [], readUploadRecords: () => [], readAssetIndex: () => [],
    readProjects: () => [{ id: 'project-1', workspacePath: path.dirname(raw) }],
    readHostTimeline: () => [], collectEducationArchiveBackups: () => [],
    downloadsDir: () => root, timestampForFilename: () => 'synthetic',
    assetStore: () => ({ backupTo: async target => { const db = new DatabaseSync(target); db.close(); } }),
    DatabaseSync, appendHostTimeline: () => {} };
  bind(scope, 'backupHostData');
  const receipt = JSON.parse(await scope.backupHostData(''));
  assert.equal(receipt.ok, true, receipt.message);
  assert.equal(receipt.backupScope, 'state_only');
  assert.match(receipt.message, /不包含工作空间原文/);
  const container = new DatabaseSync(receipt.path, { readOnly: true });
  const state = Object.fromEntries(container.prepare('SELECT key,json FROM host_backup_state').all().map(row => [row.key, JSON.parse(row.json)]));
  container.close();
  assert.equal(state.storage.backupScope, 'state_only');
  assert.equal(state.projects[0].workspacePath, path.dirname(raw));
  assert.equal(JSON.stringify(state).includes('synthetic project original'), false);
  assert.match(renderer, /创建状态备份/);
  assert.match(renderer, /恢复状态备份/);
  assert.match(renderer, /需要恢复完整资料时，请创建并校验下方的换机迁移包/);
});

test('state-only restore refuses workspace-v1 project records before any host mutation', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-state-backup-scope-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-state-backup-scope-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const backup = path.join(root, 'state.json');
  fs.writeFileSync(backup, JSON.stringify({ kind: 'ai-edu-manager-host-backup',
    projects: [{ id: 'project-1', materialStorageMode: 'workspace-v1' }] }));
  let mutated = false;
  const scope = { fs, path, mainWindow: {}, dialog: { showOpenDialogSync: () => [backup] },
    readStudentsIndex: () => { mutated = true; throw new Error('read after rejection'); },
    writeSettings: () => { mutated = true; }, writeProjects: () => { mutated = true; } };
  bind(scope, 'readHostBackupContainer');
  bind(scope, 'restoreHostData');
  const result = JSON.parse(scope.restoreHostData());
  assert.equal(result.code, 'full_project_restore_required');
  assert.equal(mutated, false);
  assert.match(result.message, /完整换机迁移包/);
});
