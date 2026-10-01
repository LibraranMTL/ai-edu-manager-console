const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createProjectMaterialAccess, saveSourceCopy } = require('../electron/project-material-access.cjs');
const { createProjectMaterialHost, isWorkspaceMaterialProject } = require('../electron/project-material-host.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const mainSource = syncFs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(mainSource);
  assert.ok(match, name);
  const end = mainSource.slice(match.index + match[0].length).search(/\n(?:async )?function /);
  return mainSource.slice(match.index, match.index + match[0].length + end);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-access-'));
  const project = { id: crypto.randomUUID(), name: '合成来源项目', materialStorageMode: 'workspace-v1',
    managerPath: path.join(root, '.edu-manager'), workspacePath: path.join(root, 'workspace'),
    rawPath: path.join(root, 'knowledge', '旧原始库'), knowledgeRootPath: path.join(root, 'knowledge') };
  for (const [field, name] of Object.entries({ conceptPath: '概念库', entityPath: '实体库', summaryPath: '摘要库', qaPath: '问答精华库', synthesisPath: '综合汇总库' })) project[field] = path.join(project.knowledgeRootPath, name);
  for (const dir of [project.workspacePath, project.rawPath, project.summaryPath]) await fs.mkdir(dir, { recursive: true });
  const host = createProjectMaterialHost(project);
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-access-'));
    for (const item of await fs.readdir(path.join(host.store.directory, 'snapshots')).catch(() => [])) await fs.chmod(path.join(host.store.directory, 'snapshots', item), 0o600);
    await fs.rm(root, { force: true, recursive: true });
  });
  const location = { kind: 'workspace', rootId: 'workspace', relativePath: '实验.txt' };
  const original = path.join(project.workspacePath, location.relativePath);
  async function register(content) {
    await fs.writeFile(original, content);
    return (await host.store.registerFiles([{ location }])).result[0];
  }
  const material = await register('合成温度20/25/30');
  await host.store.snapshot(material.materialId, 1);
  const document = path.join(project.summaryPath, '实验摘要.md');
  const content = '# 合成摘要\n温度20/25/30，并非真实学生资料。';
  await fs.writeFile(document, content);
  await host.store.mutate((index) => { index.knowledge = [{ knowledgeId: 'k1', relativePath: '摘要库/实验摘要.md',
    status: 'committed', sha256: hash(content), sources: [{ materialId: material.materialId, version: 1, sha256: material.sha256 }] }]; });
  const access = (authorize = async () => true, options = {}) => createProjectMaterialAccess(project, { authorize, ...options });
  return { root, project, host, original, material, document, content, register, access };
}

test('knowledge reader supplies scoped fixed provenance without touching original directories', async (t) => {
  const f = await fixture(t);
  await fs.rename(f.project.workspacePath, `${f.project.workspacePath}-offline`);
  const result = await f.access().readKnowledge(f.document);
  assert.equal(result.content, f.content); assert.equal(result.sha256, hash(f.content));
  assert.equal(result.provenance, 'linked'); assert.equal(result.sources[0].version, 1);
  assert.equal(result.sources[0].materialId, f.material.materialId);
  assert.equal(JSON.stringify(result).includes(f.root.replaceAll('\\', '\\\\')), false);
  assert.equal(Object.hasOwn(result.sources[0], 'path'), false);
});

test('source export reads the cited fixed bytes after newer original edits, never latest bytes', async (t) => {
  const f = await fixture(t); await f.register('最新版不能冒充旧证据');
  const result = await f.access().readKnowledge(f.document);
  assert.equal(result.sources[0].status, 'updated'); assert.equal(result.sources[0].currentVersion, 2);
  const source = await f.access().prepareKnowledgeSource(f.document, result.sha256, f.material.materialId, 1);
  assert.equal(source.bytes.toString(), '合成温度20/25/30'); assert.match(source.name, /引用版本1.txt$/);
  assert.equal(await fs.readFile(f.original, 'utf8'), '最新版不能冒充旧证据');
});

test('missing historical snapshots fail instead of substituting the current original', async (t) => {
  const f = await fixture(t); await f.register('v2');
  const snapshot = await f.host.store.resolve(f.material.materialId, 1);
  await fs.chmod(snapshot.path, 0o600); await fs.unlink(snapshot.path);
  await assert.rejects(f.access().prepareKnowledgeSource(f.document, hash(f.content), f.material.materialId, 1), { code: 'ENOENT' });
});

test('manual knowledge edits, recovery conflicts and unregistered knowledge are not labelled verified provenance', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.document, '人工改写');
  const changed = await f.access().readKnowledge(f.document);
  assert.equal(changed.provenance, 'modified'); assert.deepEqual(changed.sources, []);
  await assert.rejects(f.access().prepareKnowledgeSource(f.document, hash(f.content), f.material.materialId, 1), { code: 'knowledge_changed' });
  await fs.writeFile(f.document, f.content);
  await f.host.store.mutate((index) => { index.knowledge[0].status = 'recovery_conflict'; });
  assert.equal((await f.access().readKnowledge(f.document)).provenance, 'conflict');
  await f.host.store.mutate((index) => { index.knowledge = []; });
  assert.equal((await f.access().readKnowledge(f.document)).provenance, 'unregistered');
});

test('project IDs and source versions cannot be substituted even for identical bytes', async (t) => {
  const a = await fixture(t); const b = await fixture(t);
  assert.equal(a.material.sha256, b.material.sha256);
  await assert.rejects(a.access().prepareKnowledgeSource(a.document, hash(a.content), b.material.materialId, 1), { code: 'source_unavailable' });
  await assert.rejects(a.access().prepareKnowledgeSource(a.document, hash(a.content), a.material.materialId, 2), { code: 'source_unavailable' });
  await assert.rejects(a.access().readKnowledge(b.document), { code: 'invalid_path' });
});

test('restricted source metadata is redacted and export authority is separate from read', async (t) => {
  const f = await fixture(t);
  const hidden = await f.access(async ({ capability }) => capability === 'readKnowledge').readKnowledge(f.document);
  assert.deepEqual(hidden.sources, [{ status: 'restricted', name: '来源访问受限' }]);
  const readonly = f.access(async ({ capability }) => capability !== 'export');
  assert.equal((await readonly.readKnowledge(f.document)).sources[0].exportAllowed, false);
  await assert.rejects(readonly.prepareKnowledgeSource(f.document, hash(f.content), f.material.materialId, 1), { code: 'forbidden' });
  let checks = 0;
  await assert.rejects(f.access(async () => ++checks < 4).readKnowledge(f.document), { code: 'forbidden' });
  assert.throws(() => createProjectMaterialAccess(f.project), { code: 'forbidden' });
});

test('knowledge raw-library paths, traversal, links and oversized text are refused', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rawPath, 'private.md'), 'not knowledge');
  for (const file of ['../outside.md', path.join(f.project.rawPath, 'private.md'), path.join(f.project.summaryPath, '..', 'private.md')]) await assert.rejects(f.access().readKnowledge(file), { code: 'invalid_path' });
  await assert.rejects(f.access(undefined, { limits: { knowledgeBytes: 2 } }).readKnowledge(f.document), { code: 'file_too_large' });
  const foreign = path.join(f.root, 'foreign'); await fs.mkdir(foreign); await fs.writeFile(path.join(foreign, 'secret.md'), 'private');
  await fs.symlink(foreign, path.join(f.project.summaryPath, 'linked'), 'junction');
  await assert.rejects(f.access().readKnowledge(path.join(f.project.summaryPath, 'linked', 'secret.md')), { code: 'linked_path' });
});

test('legacy knowledge remains readable but receives no invented material provenance', async (t) => {
  const f = await fixture(t);
  const access = createProjectMaterialAccess({ ...f.project, materialStorageMode: 'legacy' }, { authorize: async () => true });
  const result = await access.readKnowledge(f.document);
  assert.equal(result.content, f.content); assert.equal(result.provenance, 'legacy'); assert.deepEqual(result.sources, []);
});

test('export is hash checked and exclusive; existing originals and exports stay unchanged', async (t) => {
  const f = await fixture(t);
  const source = await f.access().prepareKnowledgeSource(f.document, hash(f.content), f.material.materialId, 1);
  const destination = path.join(f.root, 'export.txt');
  await saveSourceCopy(destination, source);
  assert.equal(hash(await fs.readFile(destination)), f.material.sha256);
  await assert.rejects(saveSourceCopy(destination, source), { code: 'EEXIST' });
  await assert.rejects(saveSourceCopy(f.original, source), { code: 'EEXIST' });
  await assert.rejects(saveSourceCopy(path.join(f.root, 'bad.txt'), { ...source, bytes: Buffer.from('tampered') }), { code: 'source_changed' });
  assert.equal(hash(await fs.readFile(f.original)), f.material.sha256);
});

function mainContext(f, overrides = {}) {
  const webContents = { mainFrame: {} };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const opens = [];
  const context = vm.createContext({ path, createProjectMaterialAccess, saveSourceCopy, isWorkspaceMaterialProject,
    mainWindow: { isDestroyed: () => false, webContents },
    readProjects: () => [f.project], normalizeProjectMetadata: (p) => p,
    dialog: { showSaveDialog: async () => ({ filePath: path.join(f.root, 'copy.txt') }) },
    shell: { openPath: async (file) => { opens.push(file); return ''; } }, ...overrides });
  for (const name of ['localProjectSourceAccess', 'readProjectKnowledgeFileAsync', 'exportProjectKnowledgeSource']) vm.runInContext(extract(name), context);
  return { context, event, opens,
    read: () => context.readProjectKnowledgeFileAsync(event, f.project.id, f.document).then(JSON.parse),
    export: () => context.exportProjectKnowledgeSource(event, f.project.id, f.document, hash(f.content), f.material.materialId, 1).then(JSON.parse) };
}

test('actual main-process reader/export chain checks sender, returns real shell failures and keeps saved bytes', async (t) => {
  const f = await fixture(t);
  const main = mainContext(f, { shell: { openPath: async () => '没有关联程序' } });
  assert.equal((await main.read()).provenance, 'linked');
  const denied = JSON.parse(await main.context.readProjectKnowledgeFileAsync({ sender: {}, senderFrame: {} }, f.project.id, f.document));
  assert.equal(denied.code, 'forbidden');
  const output = await main.export();
  assert.equal(output.ok, true); assert.equal(output.opened, false); assert.match(output.message, /没有关联程序/);
  assert.equal(hash(await fs.readFile(output.path)), f.material.sha256);
});

test('actual save dialog cannot retain stale scope or knowledge authorization across its await', async (t) => {
  const f = await fixture(t);
  const changed = mainContext(f, { dialog: { showSaveDialog: async () => {
    await fs.writeFile(f.document, 'edited while dialog open'); return { filePath: path.join(f.root, 'must-not-exist.txt') };
  } } });
  assert.equal((await changed.export()).code, 'knowledge_changed');
  assert.equal(changed.opens.length, 0);
  await assert.rejects(fs.stat(path.join(f.root, 'must-not-exist.txt')), { code: 'ENOENT' });
  await fs.writeFile(f.document, f.content);
  const originalRoot = f.project.workspacePath;
  const moved = mainContext(f, { dialog: { showSaveDialog: async () => {
    f.project.workspacePath = `${originalRoot}-other`; return { filePath: path.join(f.root, 'must-not-exist.txt') };
  } } });
  assert.equal((await moved.export()).code, 'forbidden');
  assert.equal(moved.opens.length, 0); f.project.workspacePath = originalRoot;
});

test('cancelled exports and executable destination extensions do not invoke the shell', async (t) => {
  const f = await fixture(t);
  const canceled = mainContext(f, { dialog: { showSaveDialog: async () => ({ canceled: true }) } });
  assert.equal((await canceled.export()).canceled, true); assert.equal(canceled.opens.length, 0);
  const renamed = mainContext(f, { dialog: { showSaveDialog: async () => ({ filePath: path.join(f.root, 'copy.cmd') }) } });
  assert.equal((await renamed.export()).opened, false); assert.equal(renamed.opens.length, 0);
});

test('actual preload methods invoke registered async handlers through the scoped main service', async (t) => {
  const f = await fixture(t); const main = mainContext(f);
  const handlers = new Map();
  main.context.ipcMain = { handle: (name, handle) => handlers.set(name, handle) };
  for (const method of ['readProjectKnowledgeFileAsync', 'exportProjectKnowledgeSource']) {
    const line = mainSource.split('\n').find((value) => value.startsWith(`ipcMain.handle('bridge:${method}'`));
    assert.ok(line); vm.runInContext(line, main.context);
  }
  let bridge;
  const preload = vm.createContext({ require: (name) => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { invoke: (name, ...args) => handlers.get(name)(main.event, ...args), sendSync() { throw new Error('source I/O must be async'); } } };
  } });
  vm.runInContext(syncFs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), preload);
  const document = JSON.parse(await bridge.readProjectKnowledgeFileAsync(f.project.id, f.document));
  assert.equal(document.provenance, 'linked');
  const output = JSON.parse(await bridge.exportProjectKnowledgeSource(f.project.id, f.document, document.sha256, f.material.materialId, 1));
  assert.equal(output.ok, true); assert.equal(main.opens.length, 1);
  assert.equal(hash(await fs.readFile(output.path)), f.material.sha256);
});
