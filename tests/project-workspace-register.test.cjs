const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { registerProjectWorkspaceScan } = require('../electron/project-workspace-register.cjs');
const { registerLegacyStagingFiles, legacyStagingLocation } = require('../electron/project-legacy-staging-register.cjs');
const { auditProjectMaterialContent } = require('../electron/project-material-content-audit.cjs');
const { scanRootIdentity, relativePrefix, applyMaterialScanPage,
  markMaterialRootUnavailable } = require('../electron/project-material-availability.cjs');
const { inspectWorkspacePath, isPathInside: canonicalIsPathInside } = require('../electron/project-workspace.cjs');
const { createProjectMaterialHost, isWorkspaceMaterialProject,
  readProjectMaterialIndexSync, projectMaterialDigestProjection } = require('../electron/project-material-host.cjs');
const { projectStagingProjection } = require('../electron/project-staging-projection.cjs');
const { createProjectMaterialAssetCompatibility } = require('../electron/project-material-asset-compat.cjs');

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const functionStart = main.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0);
  const start = main.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', functionStart) + 2)}); }`)(scope);
}

test('workspace scan registers originals in place with inbox adoption and outside candidates', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-workspace-register-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-workspace-register-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const workspacePath = path.join(root, 'workspace');
  const managerPath = path.join(root, 'manager');
  const project = { id: 'p1', workspacePath, managerPath, inboxRelativePath: '收件箱' };
  const store = createProjectMaterialStore({ projectId: project.id, managerPath,
    roots: { workspace: { kind: 'workspace', path: workspacePath } } });
  async function file(relativePath, content) {
    const target = path.join(workspacePath, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    const stat = await fs.stat(target);
    return { relativePath, size: stat.size, mtimeMs: stat.mtimeMs };
  }
  const inbox = await file('收件箱/received.txt', 'received');
  const design = await file('方案设计/draft.txt', 'draft');
  const first = await registerProjectWorkspaceScan(project, [inbox, design], store);
  assert.deepEqual({ added: first.added, updated: first.updated, unchanged: first.unchanged },
    { added: 2, updated: 0, unchanged: 0 });
  const index = await store.read();
  assert.equal(index.materials.find((item) => item.location.relativePath === inbox.relativePath).adoption.state, 'accepted');
  const designRecord = index.materials.find((item) => item.location.relativePath === design.relativePath);
  assert.equal(designRecord.adoption.state, 'candidate');
  assert.ok(designRecord.classification.categoryId);
  assert.equal(designRecord.classification.source, 'workspace_path');
  assert.equal(designRecord.classification.manualLocked, false);
  assert.equal(designRecord.organizationState, 'classified');
  assert.equal(first.pathClassification.classified, 1);
  const second = await registerProjectWorkspaceScan(project, [inbox, design], store);
  assert.equal(second.registered, 0);
  assert.equal((await store.read()).revision, index.revision);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const changed = await file('方案设计/draft.txt', 'revised draft');
  const third = await registerProjectWorkspaceScan(project, [inbox, changed], store);
  assert.equal(third.updated, 1);
  const revised = (await store.read()).materials.find((item) => item.location.relativePath === design.relativePath);
  assert.equal(revised.version, 2);
  assert.equal(revised.adoption.state, 'candidate');
  assert.equal(await fs.readFile(path.join(workspacePath, '方案设计', 'draft.txt'), 'utf8'), 'revised draft');
});

test('workspace scan recognizes a unique same-byte rename before creating another material ID', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-workspace-register-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-workspace-register-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const workspacePath = path.join(root, 'workspace');
  const managerPath = path.join(root, 'manager');
  await fs.mkdir(workspacePath);
  const project = { id: 'p1', workspacePath, managerPath, inboxRelativePath: '收件箱' };
  const store = createProjectMaterialStore({ projectId: project.id, managerPath,
    roots: { workspace: { kind: 'workspace', path: workspacePath } } });
  const original = path.join(workspacePath, 'draft.txt');
  const target = path.join(workspacePath, '方案设计', 'draft.txt');
  await fs.writeFile(original, 'same file after rename');
  const first = (await store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: 'draft.txt',
  } }], { intent: 'active' })).result[0];
  await store.mutate((index) => {
    index.materials[0].classification = { categoryId: 'design', tags: [], source: 'manual', manualLocked: true };
    index.materials[0].organizationState = 'classified';
    index.materials[0].recordRevision++;
  });
  await fs.mkdir(path.dirname(target));
  await fs.rename(original, target);
  const stat = await fs.stat(target);
  const result = await registerProjectWorkspaceScan(project, [{ relativePath: '方案设计/draft.txt',
    size: stat.size, mtimeMs: stat.mtimeMs, fileKey: `${stat.dev}:${stat.ino}`, nlink: stat.nlink }], store);
  assert.equal(result.moved, 1);
  assert.equal(result.added, 0);
  const index = await store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].materialId, first.materialId);
  assert.equal(index.materials[0].version, first.version);
  assert.equal(index.materials[0].location.relativePath, '方案设计/draft.txt');
  assert.equal(index.materials[0].classification.categoryId, 'design');
  assert.equal(index.materials[0].classification.manualLocked, true);
  assert.equal(index.materials[0].legacyAliases.at(-1).location.relativePath, 'draft.txt');
});

test('workspace scan does not infer identity from duplicate hardlinks or matching filename alone', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-workspace-register-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-workspace-register-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const workspacePath = path.join(root, 'workspace');
  await fs.mkdir(workspacePath);
  const project = { id: 'p1', workspacePath, managerPath: path.join(root, 'manager'), inboxRelativePath: '收件箱' };
  const store = createProjectMaterialStore({ projectId: project.id, managerPath: project.managerPath,
    roots: { workspace: { kind: 'workspace', path: workspacePath } } });
  const oldPath = path.join(workspacePath, 'old.txt');
  const firstTarget = path.join(workspacePath, 'one.txt');
  const secondTarget = path.join(workspacePath, 'two.txt');
  await fs.writeFile(oldPath, 'same file');
  const first = (await store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: 'old.txt',
  } }])).result[0];
  await fs.rename(oldPath, firstTarget);
  await fs.link(firstTarget, secondTarget);
  const stat = await fs.stat(firstTarget);
  const files = ['one.txt', 'two.txt'].map((relativePath) => ({ relativePath, size: stat.size,
    mtimeMs: stat.mtimeMs, fileKey: `${stat.dev}:${stat.ino}`, nlink: stat.nlink }));
  const result = await registerProjectWorkspaceScan(project, files, store);
  assert.equal(result.moved, 0);
  assert.equal(result.added, 2);
  const index = await store.read();
  assert.equal(index.materials.length, 3);
  assert.equal(index.materials.find((item) => item.materialId === first.materialId).location.relativePath, 'old.txt');
});

test('actual Windows workspace scan returns registry candidates and keeps the original in place', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-workspace-register-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-workspace-register-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'p1', name: 'Synthetic', status: 'active', workspaceMode: 'managed',
    materialStorageMode: 'workspace-v1', inboxRelativePath: '收件箱',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    managerPath: path.join(root, 'manager'), stagingPath: path.join(root, 'old-staging'),
    knowledgeRootPath: path.join(root, 'knowledge') };
  const original = path.join(project.workspacePath, '方案设计', 'draft.txt');
  const oldOriginal = path.join(project.stagingPath, 'old-research.txt');
  await fs.mkdir(path.dirname(original), { recursive: true });
  await fs.mkdir(project.stagingPath, { recursive: true });
  await fs.mkdir(project.rawPath);
  await fs.writeFile(original, 'manual draft');
  await fs.writeFile(oldOriginal, 'old research');
  const gonePath = path.join(project.workspacePath, 'gone.txt');
  await fs.writeFile(gonePath, 'previous original');
  const goneHost = createProjectMaterialHost(project);
  const gone = (await goneHost.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: 'gone.txt',
  } }], { intent: 'active' })).result[0];
  await goneHost.store.mutate((index) => {
    index.materials.find((item) => item.materialId === gone.materialId).processing = {
      state: 'completed', processedVersion: gone.version,
    };
  });
  await fs.rm(gonePath);
  const stat = await fs.stat(original);
  const oldStat = await fs.stat(oldOriginal);
  const file = { filename: 'draft.txt', path: original, relativePath: '方案设计/draft.txt',
    size: stat.size, mtimeMs: stat.mtimeMs };
  const oldFile = { filename: 'old-research.txt', path: oldOriginal, relativePath: 'old-research.txt',
    size: oldStat.size, mtimeMs: oldStat.mtimeMs };
  let projects = [project];
  const assets = new Map();
  const cursorCalls = [];
  const scope = { activeProjectWorkspaceScans: new Map(), path, fs: fsSync,
    mutableProject: () => ({ project: projects[0] }),
    normalizeProjectMetadata: (value) => value,
    normalizeProject: (value) => {
      const index = readProjectMaterialIndexSync(value);
      return { ...value, stagingItems: projectStagingProjection(value, index, value.stagingItems || []),
        digestState: projectMaterialDigestProjection(value, index) };
    },
    ensureProjectWorkspace: (value) => value, isWorkspaceMaterialProject,
    createProjectMaterialHost, registerProjectWorkspaceScan, registerLegacyStagingFiles,
    legacyStagingLocation, auditProjectMaterialContent, scanRootIdentity, relativePrefix,
    applyMaterialScanPage, markMaterialRootUnavailable, inspectWorkspacePath, canonicalIsPathInside, crypto,
    readProjects: () => projects,
    updateProjectRecord: (_id, change) => {
      projects = projects.map((item) => change(item));
      return { project: projects[0], projects };
    },
    projectWithNewInputs: (value) => value,
    projectMaterialAssetCompatibility: (value, host) => createProjectMaterialAssetCompatibility(value, host, {
      findAsset: (id) => assets.get(id),
      hasProjectAsset: (id) => (projects[0].assetIds || []).includes(id),
      upsertAsset: async (sourcePath, context) => {
        const bytes = await fs.readFile(sourcePath);
        const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
        const asset = { assetId: `asset-${sha1.slice(0, 16)}`, sha1, size: bytes.length,
          references: [{ spaceType: 'project', spaceId: value.id, path: sourcePath, role: context.role }] };
        assets.set(asset.assetId, asset);
        return asset;
      },
      addProjectAsset: async (id) => {
        projects = projects.map((item) => ({ ...item,
          assetIds: [...new Set([...(item.assetIds || []), id])] }));
      },
    }),
    appendHostTimeline: () => {},
    collectWorkspaceFiles: async (_root, options) => {
      if (path.resolve(_root) === path.resolve(project.stagingPath)) return { files: [oldFile],
        skippedLinks: 0, skippedUnavailable: 0, skippedDirectories: 0,
        skippedGenerated: 0, limitReached: false, nextCursor: '' };
      cursorCalls.push(options.afterRelativePath);
      return { files: cursorCalls.length === 1 ? [file] : [], skippedLinks: 0,
        skippedUnavailable: 0, skippedGenerated: 0,
        limitReached: cursorCalls.length === 1,
        nextCursor: cursorCalls.length === 1 ? file.relativePath : '' };
    },
    emitProjectScanProgress: () => {},
  };
  bind(scope, 'projectWithNewInputs');
  bind(scope, 'scanProjectWorkspace');
  bind(scope, 'decideNewProjectStagingItems');
  const result = JSON.parse(await scope.scanProjectWorkspace(project.id));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.added, 1);
  assert.equal(result.legacyStaging.added, 1);
  assert.equal(result.project.stagingItems[0].status, 'collected');
  assert.equal(result.project.digestState.pendingCount, 0);
  assert.equal(result.project.stagingItems.length, 2);
  assert.equal(readProjectMaterialIndexSync(project).materials.find((item) => item.location.rootId === 'legacy-staging').adoption.state, 'candidate');
  assert.equal(result.project.workspaceScanCoverage, 'partial');
  assert.equal(result.project.workspaceScanCursor, file.relativePath);
  assert.equal(readProjectMaterialIndexSync(project).materials.find((item) => item.materialId === gone.materialId).availability,
    'available');
  const resumed = JSON.parse(await scope.scanProjectWorkspace(project.id));
  assert.equal(resumed.ok, true, resumed.message);
  assert.deepEqual(cursorCalls, ['', file.relativePath]);
  assert.equal(resumed.project.workspaceScanCoverage, 'enumerated');
  assert.equal(resumed.project.workspaceScanCursor, '');
  assert.equal(resumed.project.workspaceScanPageCount, 2);
  assert.equal(resumed.availability.workspace.missing, 1);
  assert.equal(readProjectMaterialIndexSync(project).materials.find((item) => item.materialId === gone.materialId).availability,
    'missing');
  const legacy = readProjectMaterialIndexSync(project).materials.find((item) => item.location.rootId === 'legacy-staging');
  const adopted = JSON.parse(await scope.decideNewProjectStagingItems(project.id,
    JSON.stringify([{ id: legacy.materialId, expectedVersion: legacy.version,
      expectedRecordRevision: legacy.recordRevision }]), 'accepted', '采用旧暂存来源'));
  assert.equal(adopted.ok, true, adopted.message);
  assert.equal(adopted.project.digestState.pendingCount, 1);
  assert.equal(adopted.compatibilityLinked.length, 1);
  assert.deepEqual(adopted.compatibilityFailed, []);
  assert.deepEqual(adopted.project.assetIds, [adopted.compatibilityLinked[0].assetId]);
  assert.equal(await fs.readFile(oldOriginal, 'utf8'), 'old research');
  assert.deepEqual(await fs.readdir(project.rawPath), []);
  assert.equal((await fs.readFile(original, 'utf8')), 'manual draft');
  assert.equal(await fs.readFile(oldOriginal, 'utf8'), 'old research');

  // The listing metadata deliberately stays unchanged: a hash audit, not the
  // size/mtime shortcut, must discover this edit in the old staging source.
  await fs.writeFile(oldOriginal, 'new research');
  const host = createProjectMaterialHost(project);
  await host.store.mutate((index) => {
    index.materials.find((item) => item.materialId === legacy.materialId).contentVerifiedAt = '2000-01-01T00:00:00.000Z';
  });
  projects = projects.map((item) => ({ ...item, status: 'published' }));
  const audited = JSON.parse(await scope.scanProjectWorkspace(project.id, null, { restart: true }));
  assert.equal(audited.ok, true, audited.message);
  assert.equal(audited.contentAudit.updated, 1);
  const newer = readProjectMaterialIndexSync(project).materials.find((item) => item.materialId === legacy.materialId);
  assert.equal(newer.version, 2);
  assert.equal(newer.adoption.state, 'accepted');
  assert.equal(audited.project.status, 'pending_review');
  assert.equal(await fs.readFile(oldOriginal, 'utf8'), 'new research');

  const offlineStaging = `${project.stagingPath}-offline`;
  await fs.rename(project.stagingPath, offlineStaging);
  const offline = JSON.parse(await scope.scanProjectWorkspace(project.id, null, { restart: true }));
  assert.equal(offline.ok, true, offline.message);
  assert.equal(offline.availability.legacyStaging.unavailable, 1);
  assert.equal(readProjectMaterialIndexSync(project).materials.find((item) => item.materialId === legacy.materialId).availability,
    'unavailable');
  await fs.rename(offlineStaging, project.stagingPath);
  const back = JSON.parse(await scope.scanProjectWorkspace(project.id, null, { restart: true }));
  assert.equal(back.ok, true, back.message);
  assert.equal(readProjectMaterialIndexSync(project).materials.find((item) => item.materialId === legacy.materialId).availability,
    'available');

  const offlineWorkspace = `${project.workspacePath}-offline`;
  await fs.rename(project.workspacePath, offlineWorkspace);
  const disconnected = JSON.parse(await scope.scanProjectWorkspace(project.id));
  assert.equal(disconnected.ok, false);
  assert.equal(disconnected.code, 'workspace_missing');
  assert.ok(disconnected.unavailable >= 1);
  assert.equal(readProjectMaterialIndexSync(project).materials.find((item) => item.location.relativePath === file.relativePath).availability,
    'unavailable');
  assert.equal(await fs.stat(offlineWorkspace).then((stat) => stat.isDirectory()), true);
  await fs.rename(offlineWorkspace, project.workspacePath);
});
