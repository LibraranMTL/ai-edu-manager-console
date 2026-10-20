'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SkillLibraryStore } = require('../electron/skill-library-store.cjs');
const { createSkillLibraryService } = require('../electron/skill-library-service.cjs');
const installer = require('../electron/skill-install-adapters.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-migration-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDataDir = path.join(root, 'user'), destination = path.join(root, 'custom-skills');
  fs.mkdirSync(destination);
  return { root, userDataDir, destination, store: new SkillLibraryStore({ userDataDir }) };
}

test('migration keeps an existing selected directory even when Windows holds it open', async t => {
  const { destination, store } = fixture(t);
  const rmdir = fs.rmdirSync;
  const mock = t.mock.method(fs, 'rmdirSync', function(target, ...args) {
    if (path.resolve(target) === destination) throw Object.assign(Error('selected folder is held open'), { code: 'EBUSY' });
    return rmdir.call(fs, target, ...args);
  });
  try {
    const result = await store.migrateRoot(destination);
    assert.equal(result.activeRoot, destination);
    assert.equal(store.settings().archiveRoot, destination);
  } finally { mock.mock.restore(); }
});

test('migration to a folder directly below an existing drive-like root never mkdirs that root', async t => {
  const { destination, store } = fixture(t);
  const parent = path.dirname(destination), mkdir = fs.mkdirSync;
  const mock = t.mock.method(fs, 'mkdirSync', function(target, ...args) {
    if (path.resolve(target) === parent) throw Object.assign(Error(`must not mkdir existing root ${parent}`), { code: 'EPERM' });
    return mkdir.call(fs, target, ...args);
  });
  try {
    const result = await store.migrateRoot(destination);
    assert.equal(result.activeRoot, destination);
    assert.equal(store.settings().archiveRoot, destination);
  } finally { mock.mock.restore(); }
});

test('service directory selection migrates, refreshes, persists restart and routes new writes to chosen location', async t => {
  const { root, userDataDir, destination } = fixture(t);
  const service = createSkillLibraryService({ userDataDir, homeDir: root, dialog: { showOpenDialogSync() { return [destination]; } } });
  const original = service.store.root;
  const selection = await service.action('chooseArchiveRoot');
  const migrated = await service.action('migrateArchiveRoot', { selectionId: selection.selectionId });
  assert.equal(migrated.activeRoot, destination);
  assert.equal((await service.action('snapshot')).library.rootPath, destination);
  const reopened = createSkillLibraryService({ userDataDir, homeDir: root });
  assert.equal(reopened.store.root, destination);
  reopened.store.writeReceipt('scans', { receiptId: 'after-migration', createdAt: new Date().toISOString() });
  assert.ok(fs.existsSync(path.join(destination, 'receipts/scans/after-migration.json')));
  assert.equal(fs.existsSync(path.join(original, 'receipts/scans/after-migration.json')), false);
  assert.ok(fs.existsSync(path.join(original, 'catalog.json')));
});

test('migration rejects relative, overlapping, nonempty and junction targets without changing the active root', async t => {
  const { root, destination, store } = fixture(t), original = store.root;
  await assert.rejects(store.migrateRoot('relative-path'), /绝对路径/);
  await assert.rejects(store.migrateRoot(path.join(original, 'child')), /子目录/);
  await assert.rejects(store.migrateRoot(path.dirname(original)), /上级目录/);
  if (process.platform === 'win32') {
    const unavailable = ['Z', 'Y', 'X', 'W'].map(letter => `${letter}:\\`).find(drive => !fs.existsSync(drive));
    if (unavailable) await assert.rejects(store.migrateRoot(path.join(unavailable, 'skills')), /不可用/);
  }
  fs.writeFileSync(path.join(destination, 'user.txt'), 'keep');
  await assert.rejects(store.migrateRoot(destination), /不是空目录/);
  assert.equal(fs.readFileSync(path.join(destination, 'user.txt'), 'utf8'), 'keep');
  const alias = path.join(root, 'alias'); fs.symlinkSync(original, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.migrateRoot(path.join(alias, 'child')), /子目录/);
  assert.equal(store.root, original);
  assert.equal(fs.existsSync(path.join(original, 'child')), false);
});

for (const failure of ['settings', 'pointer']) {
  test(`migration ${failure} failure retains original root and never reports success`, async t => {
    const { userDataDir, destination, store } = fixture(t), original = store.root;
    const pointer = fs.readFileSync(store.pointerFile), settings = fs.readFileSync(path.join(original, 'settings.json'));
    const rename = fs.renameSync;
    const mock = t.mock.method(fs, 'renameSync', function(from, to) {
      if ((failure === 'pointer' && to === store.pointerFile) || (failure === 'settings' && to.includes('.edu-skill-migration-') && path.basename(to) === 'settings.json')) {
        throw Object.assign(Error('injected disk failure'), { code: 'EACCES' });
      }
      return rename.call(fs, from, to);
    });
    try { await assert.rejects(store.migrateRoot(destination), /当前仍使用原存档位置/); }
    finally { mock.mock.restore(); }
    assert.equal(store.root, original); assert.deepEqual(fs.readFileSync(store.pointerFile), pointer);
    assert.deepEqual(fs.readFileSync(path.join(original, 'settings.json')), settings);
    assert.equal(new SkillLibraryStore({ userDataDir }).root, original);
  });
}

test('async directory chooser uses the correct Electron overload, handles cancellation and invalidates old plans after migration', async t => {
  const { root, userDataDir, destination } = fixture(t);
  let cancel = true;
  const service = createSkillLibraryService({ userDataDir, homeDir: root, dialog: { async showOpenDialog(...args) {
    assert.equal(args.length, 1); assert.ok(args[0].properties.includes('openDirectory'));
    return { canceled: cancel, filePaths: cancel ? [] : [destination] };
  } } });
  assert.deepEqual(await service.action('chooseArchiveRoot'), { cancelled: true });
  cancel = false;
  const choice = await service.action('chooseArchiveRoot');
  service.installPlans.set('old', {}); service.rollbackPlans.set('old', {});
  await service.action('migrateArchiveRoot', { selectionId: choice.selectionId });
  assert.equal(service.installPlans.size, 0); assert.equal(service.rollbackPlans.size, 0);
  await assert.rejects(service.action('migrateArchiveRoot', { targetPath: root }), /selectionId/);
});

test('installed Skill can still roll back using migrated backups after a restart', async t => {
  const { root, userDataDir, destination, store } = fixture(t);
  const source = path.join(root, 'source'), homeDir = path.join(root, 'home'); fs.mkdirSync(source);
  let previous;
  for (const version of ['1.0.0', '2.0.0']) {
    fs.writeFileSync(path.join(source, 'SKILL.md'), `---\nname: migration-skill\npublisher: test\nversion: ${version}\ndescription: migration fixture\n---\n${version}\n`);
    const archived = await store.archiveDirectory(source, { sourceType: 'local_directory', sourceUri: 'fixture' });
    const plan = installer.previewInstall({ artifact: archived.artifact, version: archived.version, existingInstallation: previous, libraryRoot: store.root, providerId: 'codex', options: { homeDir } });
    previous = installer.executeInstall(plan, { libraryRoot: store.root, backupRoot: path.join(store.root, 'backups'), currentPlanHash: plan.planHash, options: { homeDir } });
    await store.saveInstallation(previous);
  }
  const oldBackup = previous.backupPath;
  await store.migrateRoot(destination);
  const reopened = new SkillLibraryStore({ userDataDir });
  const record = reopened.catalog().installations.find(item => item.installationId === previous.installationId);
  assert.notEqual(record.backupPath, oldBackup); assert.ok(record.backupPath.startsWith(destination + path.sep));
  assert.ok(fs.existsSync(oldBackup));
  const rolledBack = installer.rollbackInstallation(record, { backupRoot: path.join(destination, 'backups'), options: { homeDir } });
  assert.equal(rolledBack.state, 'rolled_back');
  assert.match(fs.readFileSync(path.join(record.targetPath, 'SKILL.md'), 'utf8'), /1\.0\.0/);
});
