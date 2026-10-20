const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createProjectMaterialAssetCompatibility } = require('../electron/project-material-asset-compat.cjs');

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const begin = main.slice(start - 6, start) === 'async ' ? start - 6 : start;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(begin, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

test('asset rebuild repairs workspace registry links without scanning old raw directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-asset-rebuild-workspace-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-asset-rebuild-workspace-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic project', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'old-raw'),
    managerPath: path.join(root, 'manager'), inboxRelativePath: '收件箱', assetIds: [] };
  await fs.mkdir(path.join(project.workspacePath, '收件箱'), { recursive: true });
  await fs.mkdir(project.rawPath);
  const original = path.join(project.workspacePath, '收件箱', 'source.txt');
  await fs.writeFile(original, 'registered workspace original');
  await fs.writeFile(path.join(project.rawPath, 'stale.txt'), 'not a registered original');
  const host = createProjectMaterialHost(project);
  const registered = (await host.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: '收件箱/source.txt',
  } }], { intent: 'active' })).result[0];
  let currentProject = project;
  let assets = [];
  const scope = {
    fs: fsSync, path, ProjectMaterialError: Error,
    createProjectMaterialHost, createProjectMaterialAssetCompatibility,
    readAssetIndex: () => assets,
    writeAssetIndex: (value) => { assets = value; },
    readUploadRecords: () => [], registerAssetsFromUploadRecords: () => {},
    readStudentsIndex: () => [], readProjects: () => [currentProject], normalizeProject: (value) => value,
    isWorkspaceMaterialProject: (value) => value.materialStorageMode === 'workspace-v1',
    collectFilesRecursive: () => { throw new Error('old raw directory must not be scanned'); },
    projectPathsFor: () => { throw new Error('old raw path must not be resolved'); },
    upsertAssetFromFile: (file, context) => {
      assert.equal(file, original);
      const asset = { assetId: `asset-${registered.sha1.slice(0, 16)}`, sha1: registered.sha1,
        size: registered.size, updatedAt: new Date().toISOString(),
        references: [{ spaceType: 'project', spaceId: project.id, path: file, role: context.role }] };
      assets = [asset];
      return asset;
    },
    updateProjectRecord: (_id, change) => {
      currentProject = change(currentProject);
      return { project: currentProject };
    },
    mergeUnique: (values) => [...new Set(values)],
    assetIndexSummary: () => ({ ok: true, total: assets.length }),
    appendHostTimeline: () => {},
  };
  bind(scope, 'projectMaterialAssetCompatibility');
  const result = await scope.projectMaterialAssetCompatibility(currentProject, host).repair({ limit: 100 });
  assert.equal(result.linked, 1);
  assert.equal(result.remaining, 0);
  assert.ok(currentProject.assetIds.includes(assets[0].assetId));
  const index = await host.store.read();
  assert.equal(index.materials[0].materialId, registered.materialId);
  assert.equal(index.materials[0].links.assets[0].assetId, assets[0].assetId);
  assert.equal(assets[0].references[0].path, original);
  assert.match(main, /new Worker\(path\.join\(__dirname, 'asset-index-worker\.cjs'\)\)/);
});
