const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createMigrationPackage, restoreMigrationPackage, isPortableMetadataJson, walkFiles } = require('../electron/host-migration.cjs');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectEvidenceService, sourceBindingRef } = require('../electron/project-material-evidence.cjs');
const { writeArchiveVersion, discoverArchiveVersions } = require('../electron/education-archive-version.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-migration-materials-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-migration-materials-'));
    // Electron's Node does not remove read-only fixed snapshots on Windows.
    // Restore write permission only in this validated synthetic fixture.
    for (const file of walkFiles(root)) fs.chmodSync(file.absolutePath, 0o600);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const managedRoot = path.join(root, 'managed');
  const externalRoot = path.join(root, 'external');
  const destinationParent = path.join(root, 'packages');
  const userDataRoot = path.join(root, 'old-state');
  for (const dir of [managedRoot, externalRoot, destinationParent, userDataRoot]) fs.mkdirSync(dir);
  const options = { managedRoot, userDataRoot, destinationParent,
    sources: [{ kind: 'managed', id: 'managed', rootPath: managedRoot },
      { kind: 'external', id: 'external', rootPath: externalRoot }], virtualFiles: [] };
  async function restore(created, suffix = 'new') {
    const targetRoot = path.join(root, suffix);
    const userDataDir = path.join(root, `${suffix}-state`);
    const result = await restoreMigrationPackage({ packageRoot: created.packagePath, targetRoot, userDataDir });
    return { result, targetRoot, userDataDir, externalRoot: path.join(targetRoot, '.edu-manager', 'migrated-external', 'external') };
  }
  return { root, managedRoot, externalRoot, userDataRoot, options, restore };
}

test('external JSON originals are byte-identical, including invalid JSON, across two migrations', async (t) => {
  const f = fixture(t);
  const documents = {
    'source.json': Buffer.from(` { "path": ${JSON.stringify(f.externalRoot)}, "note": "  keep whitespace  " }\r\n`),
    'not-parsed.json': Buffer.from('this is an original attachment, not an application index\r\n'),
    'growth-index.json': Buffer.from(JSON.stringify({ sourcePath: f.externalRoot })),
    '成长证据审核.json': Buffer.from('an original document may have a reserved-looking filename'),
  };
  for (const [name, bytes] of Object.entries(documents)) fs.writeFileSync(path.join(f.externalRoot, name), bytes);
  const first = await f.restore(await createMigrationPackage(f.options));
  assert.equal(first.result.remappedMetadataFiles, 0);
  for (const [name, bytes] of Object.entries(documents)) assert.deepEqual(fs.readFileSync(path.join(first.externalRoot, name)), bytes);
  const second = await f.restore(await createMigrationPackage({ ...f.options, managedRoot: first.targetRoot,
    sources: [{ kind: 'managed', id: 'managed', rootPath: first.targetRoot }] }), 'second');
  for (const [name, bytes] of Object.entries(documents)) assert.deepEqual(fs.readFileSync(path.join(second.externalRoot, name)), bytes);
});

for (const layout of ['managed', 'external-project', 'external-manager']) {
  test(`fixed material versions and evidence bindings survive a real ${layout} package restore`, async (t) => {
    const f = fixture(t);
    const projectRoot = layout === 'managed' ? path.join(f.managedRoot, 'project') : f.externalRoot;
    const workspacePath = path.join(projectRoot, 'workspace');
    const managerPath = layout === 'external-manager' ? path.join(f.root, 'separate', '.edu-manager') : path.join(projectRoot, '.edu-manager');
    const knowledgeRootPath = path.join(projectRoot, 'knowledge');
    for (const dir of [workspacePath, managerPath, knowledgeRootPath]) fs.mkdirSync(dir, { recursive: true });
    if (layout === 'external-manager') f.options.sources.push({ kind: 'external', id: 'manager', rootPath: managerPath });
    const sourcePath = path.join(workspacePath, 'source.json');
    const bytes = Buffer.from(`{ "path": ${JSON.stringify(sourcePath)}, "observation": "  unchanged  " }\r\n`);
    fs.writeFileSync(sourcePath, bytes);
    const project = { id: 'project-1', name: 'test', studentIds: ['student-1'], materialStorageMode: 'workspace-v1',
      projectRootPath: projectRoot, workspacePath, managerPath, knowledgeRootPath, rawPath: path.join(projectRoot, 'legacy') };
    const store = createProjectMaterialStore({ projectId: project.id, managerPath,
      roots: { workspace: { kind: 'workspace', path: workspacePath } } });
    const { result: [record] } = await store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: 'source.json' } }], { intent: 'active' });
    const evidence = { studentId: 'student-1', ability: 'research', observation: sourcePath, confidence: 'high', sourcePaths: [sourcePath] };
    const service = createProjectEvidenceService(project, { authorize: async () => true });
    const binding = await service.prepare('student-1', evidence, null);
    project.studentEvidence = [{ ...evidence, status: 'verified', sourceBinding: sourceBindingRef(binding) }];
    fs.writeFileSync(sourcePath, '{ "version": 2 }\r\n');
    await store.registerFiles([{ materialId: record.materialId, location: record.location, expectedVersion: 1 }]);
    const originalRegistry = fs.readFileSync(store.indexPath);
    f.options.virtualFiles.push({ kind: 'state', relativePath: 'projects.json', content: JSON.stringify({ version: 1, projects: [project] }) });
    const restored = await f.restore(await createMigrationPackage(f.options));
    const restoredProject = JSON.parse(fs.readFileSync(path.join(restored.userDataDir, 'projects.json'), 'utf8')).projects[0];
    assert.notEqual(restoredProject.workspacePath, project.workspacePath);
    assert.deepEqual(fs.readFileSync(path.join(restoredProject.managerPath, 'project-materials', 'registry.json')), originalRegistry);
    const restoredStore = createProjectMaterialStore({ projectId: project.id, managerPath: restoredProject.managerPath,
      roots: { workspace: { kind: 'workspace', path: restoredProject.workspacePath } } });
    const v1 = await restoredStore.resolve(record.materialId, 1);
    const current = await restoredStore.resolve(record.materialId);
    assert.deepEqual(fs.readFileSync(v1.path), bytes);
    assert.equal(current.version, 2);
    assert.equal(fs.readFileSync(current.path, 'utf8'), '{ "version": 2 }\r\n');
    const restoredBinding = await createProjectEvidenceService(restoredProject, { authorize: async () => true })
      .readBinding('student-1', restoredProject.studentEvidence[0], binding.bindingId);
    assert.deepEqual(restoredBinding, binding);
    assert.ok(restored.result.preservedDataFiles >= 3);
    assert.deepEqual(restored.result.materialValidation, { registries: 1, fixedVersions: 1 });
  });
}

test('historical archive JSON and recovery preimages retain bytes while current path metadata remaps', async (t) => {
  const f = fixture(t);
  const manager = path.join(f.managedRoot, 'student', '.edu-manager');
  const archiveRoot = path.join(manager, 'education-archive-versions');
  const originalPath = path.join(f.managedRoot, 'original.txt');
  const archive = writeArchiveVersion({ rootDir: archiveRoot, student: { id: 'student-1', name: 'Synthetic' },
    growthIndex: { studentId: 'student-1', sourceFingerprint: 'growth-one', sourcePath: originalPath }, reports: [] });
  const archiveBytes = fs.readFileSync(path.join(archive.versionDir, 'education-archive.json'));
  const pathmap = path.join(manager, 'pathmap.json');
  fs.writeFileSync(pathmap, JSON.stringify({ root: f.managedRoot }));
  const growthPath = path.join(f.managedRoot, 'student', '成长模型', 'growth-index.json');
  fs.mkdirSync(path.dirname(growthPath), { recursive: true });
  fs.writeFileSync(growthPath, JSON.stringify({ sourcePath: originalPath, observation: originalPath, note: '  unchanged  ' }));
  const recoveryRoot = path.join(f.userDataRoot, 'growth-recovery');
  fs.mkdirSync(recoveryRoot);
  const recoveryBytes = Buffer.from(` { "sourcePath": ${JSON.stringify(originalPath)} }\r\n`);
  fs.writeFileSync(path.join(recoveryRoot, 'preimage.json'), recoveryBytes);
  f.options.sources.push({ kind: 'state', id: 'growth-recovery', destinationPrefix: 'growth-recovery', rootPath: recoveryRoot });
  const restored = await f.restore(await createMigrationPackage(f.options));
  const newArchiveRoot = path.join(restored.targetRoot, 'student', '.edu-manager', 'education-archive-versions');
  const newVersion = path.join(newArchiveRoot, archive.versionId);
  const restoredArchiveBytes = fs.readFileSync(path.join(newVersion, 'education-archive.json'));
  assert.deepEqual(restoredArchiveBytes, archiveBytes);
  const manifest = JSON.parse(fs.readFileSync(path.join(newVersion, 'manifest.json'), 'utf8'));
  assert.equal(crypto.createHash('sha1').update(restoredArchiveBytes).digest('hex'), manifest.files.find((item) => item.name === 'education-archive.json').sha1);
  const latest = JSON.parse(fs.readFileSync(path.join(newArchiveRoot, 'latest.json'), 'utf8'));
  assert.equal(latest.versionDir, newVersion);
  assert.equal(discoverArchiveVersions(newArchiveRoot, 'student-1').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(restored.targetRoot, 'student', '.edu-manager', 'pathmap.json'), 'utf8')).root, restored.targetRoot);
  const growth = JSON.parse(fs.readFileSync(path.join(restored.targetRoot, 'student', '成长模型', 'growth-index.json'), 'utf8'));
  assert.equal(growth.sourcePath, path.join(restored.targetRoot, 'original.txt'));
  assert.equal(growth.observation, originalPath);
  assert.equal(growth.note, '  unchanged  ');
  assert.deepEqual(fs.readFileSync(path.join(restored.userDataDir, 'growth-recovery', 'preimage.json')), recoveryBytes);
});

test('metadata classification excludes immutable records and migrated-original wrappers', () => {
  for (const file of ['.edu-manager/project-materials/registry.json', '.edu-manager/project-materials/batches/b/manifest.json',
    '.edu-manager/project-materials/archive-transactions/t/journal.json', '.edu-manager/education-archive-versions/v/education-archive.json',
    '.edu-manager/migrated-external/p/original.json']) assert.equal(isPortableMetadataJson(file), false, file);
  for (const file of ['.edu-manager/pathmap.json', '.edu-manager/education-archive-versions/latest.json',
    '.edu-manager/migrated-external/p/project/.edu-manager/pathmap.json']) assert.equal(isPortableMetadataJson(file), true, file);
});

for (const fault of ['missing-snapshot', 'wrong-snapshot-bytes', 'missing-evidence-version']) {
  test(`restore refuses ${fault} despite a valid package manifest, without activating data`, async (t) => {
    const f = fixture(t);
    const managerPath = path.join(f.managedRoot, '.edu-manager');
    fs.writeFileSync(path.join(f.managedRoot, 'source.txt'), 'fixed synthetic source');
    const store = createProjectMaterialStore({ projectId: 'p1', managerPath,
      roots: { workspace: { kind: 'workspace', path: f.managedRoot } } });
    const { result: [record] } = await store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: 'source.txt' } }]);
    const fixed = await store.snapshot(record.materialId, 1);
    const snapshotFile = path.join(store.directory, fixed.snapshot);
    // Only synthetic data inside this fixture is altered to construct an
    // internally inconsistent but cryptographically valid migration package.
    fs.chmodSync(snapshotFile, 0o600);
    if (fault === 'missing-snapshot') fs.unlinkSync(snapshotFile);
    if (fault === 'wrong-snapshot-bytes') fs.writeFileSync(snapshotFile, 'corrupt bytes');
    if (fault === 'missing-evidence-version') await store.mutate((index) => {
      index.evidenceBindings = [{ projectId: 'p1', materials: [{ materialId: record.materialId, version: 2, sha256: record.sha256 }], knowledge: [] }];
    });
    const created = await createMigrationPackage(f.options);
    const targetRoot = path.join(f.root, 'new');
    const userDataDir = path.join(f.root, 'new-state');
    fs.mkdirSync(userDataDir);
    const settingsFile = path.join(userDataDir, 'settings.json');
    fs.writeFileSync(settingsFile, '{"apiToken":"synthetic-current-value"}');
    let failure;
    await assert.rejects(restoreMigrationPackage({ packageRoot: created.packagePath, targetRoot, userDataDir }), (error) => {
      failure = error;
      return /固定来源缺失或校验不符|固定原文版本缺失/.test(error.message);
    });
    assert.equal(fs.existsSync(targetRoot), false);
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{"apiToken":"synthetic-current-value"}');
    assert.ok(fs.statSync(failure.recoveryPath).isDirectory());
  });
}

for (const [folder, schema, state, allowed] of [
  ['archive-transactions', 'edu-manager.project-archive-transaction.v1', 'prepared', false],
  ['archive-transactions', 'edu-manager.project-archive-transaction.v1', 'committed', true],
  ['archive-transactions', 'edu-manager.project-archive-transaction.v1', 'abandoned', true],
  ['commits', 'edu-manager.project-knowledge-commit.v1', 'recovery_required', false],
  ['commits', 'edu-manager.project-knowledge-commit.v1', 'committed', true],
]) {
  test(`restore ${allowed ? 'preserves' : 'blocks'} ${folder} ${state} without rewriting journal paths`, async (t) => {
    const f = fixture(t);
    const relative = path.join('.edu-manager', 'project-materials', folder, 'synthetic-journal', 'journal.json');
    const file = path.join(f.managedRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = Buffer.from(JSON.stringify({ schema, projectId: 'p1', state, entries: [{ path: path.join(f.managedRoot, 'target.txt') }] }, null, 2));
    fs.writeFileSync(file, bytes);
    const created = await createMigrationPackage(f.options);
    if (allowed) {
      const restored = await f.restore(created);
      assert.deepEqual(fs.readFileSync(path.join(restored.targetRoot, relative)), bytes);
    } else {
      await assert.rejects(f.restore(created), /未结算或未知的项目提交事务/);
      assert.equal(fs.existsSync(path.join(f.root, 'new')), false);
      assert.deepEqual(fs.readFileSync(file), bytes);
    }
  });
}
