const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createMigrationPackage, restoreMigrationPackage } = require('../electron/host-migration.cjs');
const {
  prepareMigrationStateInstall, installMigrationStateFiles, commitMigrationStateInstall,
  recoverInterruptedMigrationStateInstalls,
} = require('../electron/host-migration-state-install.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-migration-state-install-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-migration-state-install-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const userDataDir = path.join(root, 'userdata');
  const stateStage = path.join(root, 'state-stage');
  const targetRoot = path.join(root, 'student-data');
  const rollbackRoot = path.join(userDataDir, 'migration-rollbacks', 'synthetic-1');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(stateStage, { recursive: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(path.join(targetRoot, 'original.md'), 'synthetic original');
  fs.writeFileSync(path.join(userDataDir, 'a-state.json'), 'old state');
  fs.writeFileSync(path.join(stateStage, 'a-state.json'), 'new state');
  fs.writeFileSync(path.join(stateStage, 'z-state.json'), 'new second state');
  return { root, userDataDir, stateStage, managedStage: targetRoot, targetRoot, rollbackRoot };
}

test('worker process exit between state files is recovered on the next startup without losing originals', (t) => {
  const fx = fixture(t);
  const journal = prepareMigrationStateInstall({ ...fx, migrationId: 'synthetic-1' });
  const script = `const { installMigrationStateFiles } = require(process.argv[1]); installMigrationStateFiles(process.argv[2], process.argv[3], () => process.exit(82));`;
  const child = spawnSync(process.execPath, ['-e', script, path.join(__dirname, '../electron/host-migration-state-install.cjs'), journal, fx.stateStage], { encoding: 'utf8' });
  assert.equal(child.status, 82, child.stderr);
  assert.equal(fs.readFileSync(path.join(fx.userDataDir, 'a-state.json'), 'utf8'), 'new state');
  assert.equal(fs.existsSync(path.join(fx.userDataDir, 'z-state.json')), false);
  const recovered = recoverInterruptedMigrationStateInstalls(fx.userDataDir);
  assert.equal(recovered.ready, true);
  assert.equal(recovered.recovered.length, 1);
  assert.equal(fs.readFileSync(path.join(fx.userDataDir, 'a-state.json'), 'utf8'), 'old state');
  assert.equal(fs.existsSync(path.join(fx.userDataDir, 'z-state.json')), false);
  assert.equal(fs.existsSync(fx.targetRoot), false);
  assert.equal(fs.readFileSync(path.join(recovered.recovered[0].recoveryPath, 'original.md'), 'utf8'), 'synthetic original');
  assert.deepEqual(recoverInterruptedMigrationStateInstalls(fx.userDataDir).recovered, []);
});

test('recovery refuses external edits and missing backups before changing any state', (t) => {
  const fx = fixture(t);
  const journal = prepareMigrationStateInstall({ ...fx, migrationId: 'synthetic-1' });
  assert.throws(() => installMigrationStateFiles(journal, fx.stateStage, () => { throw new Error('synthetic interruption'); }), /synthetic interruption/);
  fs.writeFileSync(path.join(fx.userDataDir, 'a-state.json'), 'external edit');
  const conflict = recoverInterruptedMigrationStateInstalls(fx.userDataDir);
  assert.equal(conflict.ready, false);
  assert.match(conflict.issues[0].message, /其他操作修改/);
  assert.equal(fs.readFileSync(path.join(fx.userDataDir, 'a-state.json'), 'utf8'), 'external edit');
  assert.equal(fs.existsSync(fx.targetRoot), true);
  fs.writeFileSync(path.join(fx.userDataDir, 'a-state.json'), 'new state');
  const backup = path.join(fx.rollbackRoot, 'originals', 'a-state.json');
  fs.writeFileSync(backup, 'damaged backup');
  const missing = recoverInterruptedMigrationStateInstalls(fx.userDataDir);
  assert.equal(missing.ready, false);
  assert.match(missing.issues[0].message, /备份缺失或损坏/);
  assert.equal(fs.readFileSync(path.join(fx.userDataDir, 'a-state.json'), 'utf8'), 'new state');
});

test('committed state remains installed and does not trigger startup rollback', (t) => {
  const fx = fixture(t);
  const journal = prepareMigrationStateInstall({ ...fx, migrationId: 'synthetic-1' });
  assert.equal(installMigrationStateFiles(journal, fx.stateStage), 2);
  commitMigrationStateInstall(journal);
  const startup = recoverInterruptedMigrationStateInstalls(fx.userDataDir);
  assert.equal(startup.ready, true);
  assert.deepEqual(startup.recovered, []);
  assert.equal(fs.readFileSync(path.join(fx.userDataDir, 'a-state.json'), 'utf8'), 'new state');
  assert.equal(fs.readFileSync(path.join(fx.userDataDir, 'z-state.json'), 'utf8'), 'new second state');
  assert.equal(fs.existsSync(fx.targetRoot), true);
});

test('a prepared restore leaves an empty unactivated target in place', (t) => {
  const fx = fixture(t);
  fs.rmSync(path.join(fx.targetRoot, 'original.md'));
  const managedStage = path.join(fx.root, 'managed-stage');
  fs.mkdirSync(managedStage);
  prepareMigrationStateInstall({ ...fx, managedStage, migrationId: 'synthetic-1' });
  const recovered = recoverInterruptedMigrationStateInstalls(fx.userDataDir);
  assert.equal(recovered.ready, true);
  assert.equal(fs.existsSync(fx.targetRoot), true);
  assert.deepEqual(fs.readdirSync(fx.targetRoot), []);
  assert.equal(fs.existsSync(`${fx.targetRoot}.migration-unactivated-synthetic-1`), false);
  assert.equal(fs.readFileSync(path.join(fx.userDataDir, 'a-state.json'), 'utf8'), 'old state');
});

test('an unmarked file added after preparation blocks automatic movement of the target', (t) => {
  const fx = fixture(t);
  const managedStage = path.join(fx.root, 'managed-stage');
  fs.mkdirSync(managedStage);
  prepareMigrationStateInstall({ ...fx, managedStage, migrationId: 'synthetic-1' });
  const result = recoverInterruptedMigrationStateInstalls(fx.userDataDir);
  assert.equal(result.ready, false);
  assert.match(result.issues[0].message, /未标记的文件/);
  assert.equal(fs.readFileSync(path.join(fx.targetRoot, 'original.md'), 'utf8'), 'synthetic original');
  assert.equal(fs.readFileSync(path.join(fx.userDataDir, 'a-state.json'), 'utf8'), 'old state');
});

test('real package restore rolls back all state after an installation progress failure', async (t) => {
  const fx = fixture(t);
  const oldRoot = path.join(fx.root, 'old-documents');
  const packageDir = path.join(fx.root, 'packages');
  fs.mkdirSync(oldRoot);
  fs.mkdirSync(packageDir);
  fs.writeFileSync(path.join(oldRoot, 'document.md'), 'original document');
  fs.writeFileSync(path.join(fx.userDataDir, 'settings.json'), JSON.stringify({ apiToken: 'keep-local' }));
  const created = await createMigrationPackage({ destinationParent: packageDir, managedRoot: oldRoot,
    userDataRoot: path.join(fx.root, 'old-userdata'), appVersion: '0.18.4',
    sources: [{ kind: 'managed', id: 'managed-root', rootPath: oldRoot }],
    virtualFiles: [
      { kind: 'state', id: 'state', relativePath: 'settings.json', content: JSON.stringify({ studentBaseDir: oldRoot }) },
      { kind: 'state', id: 'state', relativePath: 'students.json', content: JSON.stringify([{ id: 'synthetic-student' }]) },
    ] });
  await assert.rejects(() => restoreMigrationPackage({ packageRoot: created.packagePath,
    targetRoot: path.join(fx.root, 'restored-documents'), userDataDir: fx.userDataDir,
    onProgress: (progress) => { if (progress.phase === 'installing-state') throw new Error('synthetic install failure'); } }), /synthetic install failure/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fx.userDataDir, 'settings.json'), 'utf8')), { apiToken: 'keep-local' });
  assert.equal(fs.existsSync(path.join(fx.userDataDir, 'students.json')), false);
  assert.equal(fs.existsSync(path.join(fx.root, 'restored-documents')), false);
  const startup = recoverInterruptedMigrationStateInstalls(fx.userDataDir);
  assert.equal(startup.ready, true);
  assert.deepEqual(startup.recovered, []);
});
