const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fsSync = require('node:fs');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { relocateProjectMaterial } = require('../electron/project-material-relocate.cjs');

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const begin = main.slice(start - 6, start) === 'async ' ? start - 6 : start;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(begin, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-relocate-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-relocate-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'p1', name: 'Synthetic', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), managerPath: path.join(root, 'manager'),
    knowledgeRootPath: path.join(root, 'knowledge'), rawPath: path.join(root, 'raw'),
    stagingPath: path.join(root, 'staging'), inboxRelativePath: '收件箱' };
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  await fs.mkdir(project.knowledgeRootPath);
  const original = path.join(project.workspacePath, 'old.txt');
  await fs.writeFile(original, 'same exact bytes');
  const host = createProjectMaterialHost(project);
  const record = (await host.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: 'old.txt',
  } }])).result[0];
  await fs.rm(original);
  await host.store.mutate((index) => {
    index.materials[0].availability = 'missing';
    index.materials[0].recordRevision++;
  });
  const missing = (await host.store.read()).materials[0];
  const target = path.join(project.workspacePath, '方案设计', 'renamed.txt');
  await fs.mkdir(path.dirname(target));
  return { root, project, host, record: missing, target };
}

const request = (f) => ({ materialId: f.record.materialId, expectedVersion: f.record.version,
  expectedRecordRevision: f.record.recordRevision, targetPath: f.target });

test('explicit same-byte relocation preserves material ID/version and old path alias without moving bytes', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'same exact bytes');
  const moved = await relocateProjectMaterial(f.project, f.host, request(f));
  assert.equal(moved.unchanged, false);
  const record = (await f.host.store.read()).materials[0];
  assert.equal(record.materialId, f.record.materialId);
  assert.equal(record.version, f.record.version);
  assert.equal(record.availability, 'available');
  assert.equal(record.location.relativePath, '方案设计/renamed.txt');
  assert.equal(record.legacyAliases.at(-1).location.relativePath, 'old.txt');
  assert.equal(await fs.readFile(f.target, 'utf8'), 'same exact bytes');
  const retry = await relocateProjectMaterial(f.project, f.host, request(f));
  assert.equal(retry.unchanged, true);
  assert.equal((await f.host.store.read()).materials.length, 1);
});

test('same filename or size cannot substitute a different source version', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'DIFF exact bytes');
  await assert.rejects(relocateProjectMaterial(f.project, f.host, request(f)),
    { code: 'content_mismatch' });
  const record = (await f.host.store.read()).materials[0];
  assert.equal(record.availability, 'missing');
  assert.equal(record.location.relativePath, 'old.txt');
});

test('a target already owned by another material or outside project scope is never silently merged', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'same exact bytes');
  const targetMaterial = (await f.host.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: '方案设计/renamed.txt',
  } }], { intent: 'later' })).result[0];
  await assert.rejects(relocateProjectMaterial(f.project, f.host, request(f)),
    { code: 'duplicate_has_dependencies' });
  assert.equal((await f.host.store.read()).materials.find((item) => item.materialId === targetMaterial.materialId).location.relativePath,
    '方案设计/renamed.txt');
  const outside = path.join(f.root, 'ungranted.txt');
  await fs.writeFile(outside, 'same exact bytes');
  await assert.rejects(relocateProjectMaterial(f.project, f.host, { ...request(f), targetPath: outside }),
    { code: 'ungranted_source' });
});

test('an explicitly confirmed scan-only duplicate merges metadata without deleting the file or old ID alias', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'same exact bytes');
  const duplicate = (await f.host.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: '方案设计/renamed.txt',
  }, source: { eventId: 'scan-duplicate-1', type: 'workspace_scan', deviceId: 'local-host', studentId: '' } }],
  { intent: 'later' })).result[0];
  let confirmation;
  await assert.rejects(relocateProjectMaterial(f.project, f.host, request(f)), (error) => {
    assert.equal(error.code, 'duplicate_confirmation_required');
    confirmation = error.details;
    return true;
  });
  assert.equal((await f.host.store.read()).materials.length, 2);
  await assert.rejects(relocateProjectMaterial(f.project, f.host, {
    ...request(f), confirmedDuplicateId: duplicate.materialId,
    confirmedDuplicateRevision: duplicate.recordRevision + 1,
  }), { code: 'duplicate_confirmation_required' });
  const moved = await relocateProjectMaterial(f.project, f.host, {
    ...request(f), confirmedDuplicateId: confirmation.duplicateMaterialId,
    confirmedDuplicateRevision: confirmation.duplicateRecordRevision,
  });
  assert.equal(moved.mergedDuplicateId, duplicate.materialId);
  const index = await f.host.store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].materialId, f.record.materialId);
  assert.equal(index.materials[0].version, f.record.version);
  assert.equal(index.materials[0].location.relativePath, '方案设计/renamed.txt');
  assert.ok(index.materials[0].sources.some((event) => event.eventId === 'scan-duplicate-1'));
  assert.equal(index.materialIdAliases[0].materialId, duplicate.materialId);
  assert.equal(index.materialMergeHistory.length, 1);
  assert.equal(index.materialMergeHistory[0].sourceBefore.materialId, f.record.materialId);
  assert.equal(index.materialMergeHistory[0].duplicateBefore.materialId, duplicate.materialId);
  const resolved = await f.host.store.resolve(duplicate.materialId, duplicate.version);
  assert.equal(resolved.materialId, f.record.materialId);
  assert.equal(await fs.readFile(f.target, 'utf8'), 'same exact bytes');
});

test('scan duplicate with manual classification or links cannot be merged even after confirmation', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'same exact bytes');
  const duplicate = (await f.host.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: '方案设计/renamed.txt',
  }, source: { eventId: 'scan-duplicate-2', type: 'workspace_scan', deviceId: 'local-host', studentId: '' } }],
  { intent: 'later' })).result[0];
  await f.host.store.mutate((index) => {
    const target = index.materials.find((item) => item.materialId === duplicate.materialId);
    target.classification.manualLocked = true;
    target.recordRevision++;
  });
  await assert.rejects(relocateProjectMaterial(f.project, f.host, {
    ...request(f), confirmedDuplicateId: duplicate.materialId,
    confirmedDuplicateRevision: duplicate.recordRevision + 1,
  }), { code: 'duplicate_has_dependencies' });
  await f.host.store.mutate((index) => {
    const target = index.materials.find((item) => item.materialId === duplicate.materialId);
    target.classification.manualLocked = false;
    target.links.assets = [{ assetId: 'a1', version: 1, sha256: target.sha256 }];
    target.recordRevision++;
  });
  await assert.rejects(relocateProjectMaterial(f.project, f.host, request(f)),
    { code: 'duplicate_has_dependencies' });
  await f.host.store.mutate((index) => {
    const target = index.materials.find((item) => item.materialId === duplicate.materialId);
    target.links.assets = [];
    index.evidenceBindings = [{ materialId: duplicate.materialId }];
    target.recordRevision++;
  });
  await assert.rejects(relocateProjectMaterial(f.project, f.host, request(f)),
    { code: 'duplicate_has_dependencies' });
  assert.equal((await f.host.store.read()).materials.length, 2);
});

test('interrupted duplicate merge leaves both original registry records and permits a verified retry', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'same exact bytes');
  const duplicate = (await f.host.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: '方案设计/renamed.txt',
  }, source: { eventId: 'scan-interrupted-merge', type: 'workspace_scan', deviceId: 'local-host', studentId: '' } }],
  { intent: 'later' })).result[0];
  const confirmed = { ...request(f), confirmedDuplicateId: duplicate.materialId,
    confirmedDuplicateRevision: duplicate.recordRevision };
  const failingStore = createProjectMaterialStore({ projectId: f.project.id,
    managerPath: f.project.managerPath,
    roots: { workspace: { kind: 'workspace', path: f.project.workspacePath },
      legacy: { kind: 'legacy_raw', path: f.project.rawPath },
      'legacy-staging': { kind: 'external', path: f.project.stagingPath } },
    hooks: { beforeIndexWrite: (index) => {
      if (index.materialIdAliases?.length) throw new Error('synthetic interrupted merge');
    } },
  });
  await assert.rejects(relocateProjectMaterial(f.project, { store: failingStore }, confirmed),
    /synthetic interrupted merge/);
  const afterFailure = await f.host.store.read({ fresh: true });
  assert.equal(afterFailure.materials.length, 2);
  assert.equal(afterFailure.materialIdAliases, undefined);
  assert.equal(afterFailure.materialMergeHistory, undefined);
  const retry = await relocateProjectMaterial(f.project, f.host, confirmed);
  assert.equal(retry.mergedDuplicateId, duplicate.materialId);
  assert.equal((await f.host.store.read()).materials.length, 1);
});

test('Windows host relocation action commits the verified source and returns refreshed project state', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'same exact bytes');
  let project = f.project;
  let linked = 0;
  const scope = { mainWindow: {}, dialog: { showOpenDialogSync: () => [f.target] },
    activeProjectWorkspaceScans: new Map(), mutableProject: () => ({ project }),
    isWorkspaceMaterialProject: () => true, createProjectMaterialHost,
    relocateProjectMaterial, projectMaterialAssetCompatibility: () => ({
      syncAccepted: async () => { linked++; },
    }),
    updateProjectRecord: (_id, change) => { project = change(project); return { project }; },
    readProjects: () => [project], normalizeProject: (value) => value,
    appendHostTimeline: () => {},
  };
  bind(scope, 'relocateProjectMaterialAsync');
  const result = JSON.parse(await scope.relocateProjectMaterialAsync(project.id,
    f.record.materialId, f.record.version, f.record.recordRevision));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.moved.materialId, f.record.materialId);
  assert.equal(result.moved.version, f.record.version);
  assert.equal(result.project.id, project.id);
  assert.equal(linked, 1);
  assert.equal((await f.host.store.read()).materials[0].availability, 'available');
});

test('Windows host requires a separate confirmation before merging a scan-only duplicate', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'same exact bytes');
  const duplicate = (await f.host.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: '方案设计/renamed.txt',
  }, source: { eventId: 'scan-duplicate-host', type: 'workspace_scan', deviceId: 'local-host', studentId: '' } }],
  { intent: 'later' })).result[0];
  let project = f.project;
  let decision = 1;
  let prompts = 0;
  const scope = { mainWindow: {}, dialog: {
    showOpenDialogSync: () => [f.target],
    showMessageBoxSync: () => { prompts++; return decision; },
  }, activeProjectWorkspaceScans: new Map(), mutableProject: () => ({ project }),
  isWorkspaceMaterialProject: () => true, createProjectMaterialHost,
  relocateProjectMaterial, projectMaterialAssetCompatibility: () => ({ syncAccepted: async () => {} }),
  updateProjectRecord: (_id, change) => { project = change(project); return { project }; },
  readProjects: () => [project], normalizeProject: (value) => value,
  appendHostTimeline: () => {},
  };
  bind(scope, 'relocateProjectMaterialAsync');
  const cancelled = JSON.parse(await scope.relocateProjectMaterialAsync(project.id,
    f.record.materialId, f.record.version, f.record.recordRevision));
  assert.equal(cancelled.cancelled, true);
  assert.equal(prompts, 1);
  assert.equal((await f.host.store.read()).materials.length, 2);
  decision = 0;
  const accepted = JSON.parse(await scope.relocateProjectMaterialAsync(project.id,
    f.record.materialId, f.record.version, f.record.recordRevision));
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(accepted.moved.mergedDuplicateId, duplicate.materialId);
  assert.equal(prompts, 2);
  assert.equal((await f.host.store.read()).materials.length, 1);
});
