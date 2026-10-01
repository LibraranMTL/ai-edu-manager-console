const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { projectMigrationRequirements, mergeExternalMigrationCandidates, sameOrInside } = require('../electron/migration-source-plan.cjs');
const { createMigrationPackage, inspectMigrationSources, restoreMigrationPackage, walkFiles } = require('../electron/host-migration.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-migration-coverage-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-migration-coverage-'));
    for (const file of walkFiles(root)) fs.chmodSync(file.absolutePath, 0o600);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const managedRoot = path.join(root, 'managed');
  const externalRoot = path.join(root, 'external');
  const destinationParent = path.join(root, 'packages');
  for (const dir of [managedRoot, externalRoot, destinationParent]) fs.mkdirSync(dir);
  const project = { id: 'p1', name: 'Synthetic', materialStorageMode: 'workspace-v1', projectRootPath: externalRoot,
    workspacePath: path.join(externalRoot, 'workspace'), managerPath: path.join(externalRoot, '.edu-manager'),
    knowledgeRootPath: path.join(externalRoot, 'knowledge'), rawPath: path.join(externalRoot, 'unused-legacy') };
  for (const dir of [project.workspacePath, project.managerPath, project.knowledgeRootPath]) fs.mkdirSync(dir);
  const options = { destinationParent, managedRoot, userDataRoot: path.join(root, 'old-state'),
    sources: [{ kind: 'managed', id: 'managed', rootPath: managedRoot }, { kind: 'external', id: 'project', rootPath: externalRoot, required: true }],
    requiredDirectories: projectMigrationRequirements([project]),
    virtualFiles: [{ kind: 'state', relativePath: 'projects.json', content: JSON.stringify({ version: 1, projects: [project] }) }] };
  return { root, managedRoot, project, options };
}

function hostPlan(f, { projects = [f.project], removed = [] } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const context = vm.createContext({ fs, path, projectMigrationRequirements, mergeExternalMigrationCandidates,
    readProjects: () => projects, normalizeProjectMetadata: (value) => value,
    findRemovedProjectSnapshots: () => removed,
    normalizeProject: () => { throw new Error('must not scan/hash projects while planning'); },
    readProjectMaterialIndexSync: () => ({ materials: [] }), isWorkspaceMaterialProject: (p) => p.materialStorageMode === 'workspace-v1',
    defaultStudentBaseDir: () => f.managedRoot, readStudentsIndex: () => [], toHostStudent: (value) => value,
    isSameOrInsidePath: sameOrInside, migrationStateDirectorySources: () => [] });
  for (const name of ['migrationExternalSources', 'hostMigrationSources']) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  return context.hostMigrationSources([]);
}

async function inspectInWorker(options) {
  const worker = new Worker(path.join(__dirname, '../electron/host-migration-worker.cjs'));
  try {
    return await new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', (message) => {
        if (message.type === 'result') resolve(message.result);
        if (message.type === 'error') reject(new Error(message.error.message));
      });
      worker.once('exit', (code) => reject(new Error(`worker exited without a result: ${code}`)));
      worker.postMessage({ requestId: 'coverage-test', action: 'inspect-sources', options });
    });
  } finally { await worker.terminate(); }
}

test('actual host planning mandates new-mode external roots even with no selected IDs, and the real worker detects missing children', async (t) => {
  const f = fixture(t);
  const state = hostPlan(f);
  assert.equal(state.external.length, 1);
  assert.equal(state.external[0].required, true);
  assert.ok(state.sources.some((item) => item.rootPath === f.project.projectRootPath));
  assert.equal(state.requiredDirectories.length, 4);
  assert.equal((await inspectInWorker(state)).fileCount, 0);
  // This empty synthetic directory is intentionally removed, not user data.
  fs.rmdirSync(f.project.workspacePath);
  const missing = hostPlan(f);
  assert.equal(missing.requiredDirectories.length, 4);
  await assert.rejects(inspectInWorker(missing), /必需目录不可访问/);
});

test('export rejects a missing required child before writing any package', async (t) => {
  const f = fixture(t);
  fs.rmdirSync(f.project.knowledgeRootPath);
  assert.throws(() => inspectMigrationSources(f.options.sources, f.options), /必需目录不可访问/);
  await assert.rejects(createMigrationPackage(f.options), /必需目录不可访问/);
  assert.deepEqual(fs.readdirSync(f.options.destinationParent), []);
});

test('host planning also validates required paths inside the managed root while keeping legacy selection semantics', async (t) => {
  const f = fixture(t);
  f.project.projectRootPath = path.join(f.managedRoot, 'project');
  for (const [field, name] of [['workspacePath', 'workspace'], ['managerPath', '.edu-manager'], ['knowledgeRootPath', 'knowledge']]) {
    f.project[field] = path.join(f.project.projectRootPath, name);
    fs.mkdirSync(f.project[field], { recursive: true });
  }
  f.project.rawPath = path.join(f.project.projectRootPath, 'unused-legacy');
  const state = hostPlan(f);
  assert.equal(state.external.length, 0);
  assert.equal((await inspectInWorker(state)).fileCount, 0);
  fs.rmdirSync(f.project.managerPath);
  await assert.rejects(inspectInWorker(hostPlan(f)), /必需目录不可访问/);
  f.project.materialStorageMode = 'legacy';
  assert.equal(hostPlan(f).requiredDirectories.length, 0);
});

test('a required root cannot be silently omitted or replaced with a filtered subset', async (t) => {
  const f = fixture(t);
  await assert.rejects(createMigrationPackage({ ...f.options, sources: f.options.sources.slice(0, 1) }), /缺少必需目录的打包范围/);
  const filtered = f.options.sources.map((source) => source.kind === 'external' ? { ...source, includeRelativePaths: ['workspace/one.txt'] } : source);
  await assert.rejects(createMigrationPackage({ ...f.options, sources: filtered }), /缺少必需目录的打包范围/);
  const excluded = f.options.sources.map((source) => source.kind === 'external' ? { ...source, excludeNames: ['knowledge'] } : source);
  await assert.rejects(createMigrationPackage({ ...f.options, sources: excluded }), /缺少必需目录的打包范围/);
  assert.deepEqual(fs.readdirSync(f.options.destinationParent), []);
});

test('required empty workspaces and knowledge roots survive real package restore', async (t) => {
  const f = fixture(t);
  const created = await createMigrationPackage(f.options);
  const targetRoot = path.join(f.root, 'restored');
  const userDataDir = path.join(f.root, 'restored-state');
  const restored = await restoreMigrationPackage({ packageRoot: created.packagePath, targetRoot, userDataDir });
  const project = JSON.parse(fs.readFileSync(path.join(userDataDir, 'projects.json'), 'utf8')).projects[0];
  for (const field of ['projectRootPath', 'workspacePath', 'managerPath', 'knowledgeRootPath']) {
    assert.ok(sameOrInside(targetRoot, project[field]));
    assert.ok(fs.statSync(project[field]).isDirectory(), field);
  }
  assert.equal(restored.requiredDirectoryCount, 4);
});

test('removed external project stays in the package and its recovery registry remaps to the restored host', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project.workspacePath, 'original.txt'), 'preserved source');
  const snapshotPath = path.join(f.project.managerPath, '项目记录已移除.json');
  fs.writeFileSync(snapshotPath, JSON.stringify({ deletionType: 'record_only', project: f.project }));
  const removed = [{ snapshotPath, project: f.project }];
  const plan = hostPlan(f, { projects: [], removed });
  assert.equal(plan.external.length, 1);
  assert.equal(plan.external[0].required, true);
  assert.equal(plan.requiredDirectories.length, 4);
  const options = { ...f.options, sources: plan.sources, requiredDirectories: plan.requiredDirectories,
    virtualFiles: [
      { kind: 'state', relativePath: 'projects.json', content: JSON.stringify({ version: 1, projects: [] }) },
      { kind: 'state', relativePath: 'removed-projects.json', content: JSON.stringify({ version: 1,
        entries: [{ projectId: f.project.id, managerPath: f.project.managerPath, snapshotPath }] }) },
    ] };
  const created = await createMigrationPackage(options);
  const targetRoot = path.join(f.root, 'restored');
  const userDataDir = path.join(f.root, 'restored-state');
  await restoreMigrationPackage({ packageRoot: created.packagePath, targetRoot, userDataDir });
  const registry = JSON.parse(fs.readFileSync(path.join(userDataDir, 'removed-projects.json'), 'utf8'));
  assert.equal(registry.entries.length, 1);
  const restoredSnapshot = registry.entries[0].snapshotPath;
  assert.ok(sameOrInside(targetRoot, restoredSnapshot));
  assert.ok(fs.existsSync(restoredSnapshot));
  assert.equal(fs.readFileSync(path.join(path.dirname(restoredSnapshot), '..', 'workspace', 'original.txt'), 'utf8'), 'preserved source');
  const snapshot = JSON.parse(fs.readFileSync(restoredSnapshot, 'utf8'));
  assert.equal(snapshot.project.managerPath, registry.entries[0].managerPath);
});

test('same-size same-mtime content changes in a required project fail export instead of issuing a success warning', async (t) => {
  const f = fixture(t);
  const file = path.join(f.project.workspacePath, 'source.txt');
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  fs.writeFileSync(file, 'version-one');
  fs.utimesSync(file, timestamp, timestamp);
  let changed = false;
  await assert.rejects(createMigrationPackage({ ...f.options, onProgress: (progress) => {
    if (!changed && progress.phase === 'exporting' && progress.current === 'workspace/source.txt') {
      changed = true;
      fs.writeFileSync(file, 'version-two');
      fs.utimesSync(file, timestamp, timestamp);
    }
  } }), /完整项目资料在导出期间发生变化/);
  assert.equal(changed, true);
  assert.ok(fs.readdirSync(f.options.destinationParent).every((name) => name.includes('.failed-')));
});

test('linked project children and linked required roots are reported, not silently skipped', async (t) => {
  const f = fixture(t);
  const linked = path.join(f.project.workspacePath, 'linked');
  const outside = path.join(f.root, 'other-authorized-test-folder');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'source.txt'), 'synthetic');
  fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createMigrationPackage(f.options), /不能忽略链接资料/);
  const additional = { projectId: 'p1', field: 'workspacePath', rootPath: linked };
  assert.throws(() => inspectMigrationSources(f.options.sources, { requiredDirectories: [...f.options.requiredDirectories, additional] }), /不是普通目录或包含链接/);
  assert.equal(fs.readFileSync(path.join(outside, 'source.txt'), 'utf8'), 'synthetic');
  assert.deepEqual(fs.readdirSync(f.options.destinationParent), []);
});

test('a required source lost after selection is not treated as an empty source', (t) => {
  const f = fixture(t);
  assert.throws(() => inspectMigrationSources([{ kind: 'external', id: 'missing', rootPath: path.join(f.root, 'missing'), required: true }]), /必需迁移目录不可访问/);
});
