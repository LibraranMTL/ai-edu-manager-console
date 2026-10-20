const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fsSync = require('node:fs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createProjectMaterialAssetCompatibility } = require('../electron/project-material-asset-compat.cjs');
const { MaterialError } = require('../electron/project-material-contract.cjs');

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

async function fixture(t, { legacy = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-asset-compat-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-asset-compat-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'p1', name: 'Synthetic', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    stagingPath: path.join(root, 'legacy-staging'), managerPath: path.join(root, 'manager'),
    inboxRelativePath: '收件箱', assetIds: [] };
  const sourcePath = legacy ? path.join(project.stagingPath, 'research.txt')
    : path.join(project.workspacePath, '收件箱', 'draft.txt');
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, 'unchanged original');
  const host = createProjectMaterialHost(project);
  const location = legacy
    ? { kind: 'external', rootId: 'legacy-staging', relativePath: 'research.txt' }
    : { kind: 'workspace', rootId: 'workspace', relativePath: '收件箱/draft.txt' };
  const record = (await host.store.registerFiles([{ location }], { intent: 'active' })).result[0];
  const assets = new Map();
  let upserts = 0;
  let failOnce = false;
  const adapter = () => createProjectMaterialAssetCompatibility(project, host, {
    findAsset: (id) => assets.get(id),
    hasProjectAsset: (id) => project.assetIds.includes(id),
    upsertAsset: async (file, context) => {
      upserts++;
      if (failOnce) { failOnce = false; throw new Error('simulated asset index failure'); }
      const asset = { assetId: `asset-${record.sha1.slice(0, 16)}`, sha1: record.sha1,
        size: record.size, references: [{ spaceType: 'project', spaceId: project.id,
          path: file, role: context.role }] };
      assets.set(asset.assetId, asset);
      return asset;
    },
    addProjectAsset: async (id) => { if (!project.assetIds.includes(id)) project.assetIds.push(id); },
  });
  return { project, host, record, sourcePath, adapter, assets,
    get upserts() { return upserts; }, failNext() { failOnce = true; } };
}

test('accepted source gains an idempotent legacy asset link without moving the original', async (t) => {
  const f = await fixture(t);
  const first = await f.adapter().syncAccepted(f.record.materialId);
  assert.equal(first.unchanged, false);
  assert.equal(f.upserts, 1);
  assert.deepEqual(f.project.assetIds, [first.assetId]);
  const updated = (await f.host.store.read()).materials[0];
  assert.deepEqual(updated.links.assets.map((item) => item.assetId), [first.assetId]);
  assert.equal(await fs.readFile(f.sourcePath, 'utf8'), 'unchanged original');
  const repeat = await f.adapter().syncAccepted(f.record.materialId);
  assert.equal(repeat.unchanged, true);
  assert.equal(f.upserts, 1);
  assert.equal((await f.host.store.read()).materials[0].links.assets.length, 1);
});

test('failed compatibility write leaves adoption intact and a later repair links old staging in place', async (t) => {
  const f = await fixture(t, { legacy: true });
  f.failNext();
  await assert.rejects(f.adapter().syncAccepted(f.record.materialId), /simulated asset index failure/);
  assert.equal((await f.host.store.read()).materials[0].adoption.state, 'accepted');
  const repaired = await f.adapter().repair();
  assert.equal(repaired.linked, 1);
  assert.deepEqual(repaired.failed, []);
  assert.equal(repaired.remaining, 0);
  assert.equal(await fs.readFile(f.sourcePath, 'utf8'), 'unchanged original');
  const repeat = await f.adapter().repair();
  assert.equal(repeat.linked, 0);
  assert.equal(f.upserts, 2);
});

test('compatibility repair restores project asset membership after an interrupted final step', async (t) => {
  const f = await fixture(t);
  const first = await f.adapter().syncAccepted(f.record.materialId);
  f.project.assetIds = [];
  const repaired = await f.adapter().repair();
  assert.equal(repaired.linked, 1);
  assert.deepEqual(f.project.assetIds, [first.assetId]);
  assert.equal(f.upserts, 1);
});

test('host compatibility adapter accepts assets beyond the former 5000-row JSON cap', async (t) => {
  const f = await fixture(t);
  const assets = Array.from({ length: 5000 }, (_, index) => ({
    assetId: `other-${index}`, sha1: `other-${index}`, references: [],
  }));
  let writes = 0;
  const scope = { createProjectMaterialAssetCompatibility, ProjectMaterialError: MaterialError,
    readAssetIndex: () => assets, upsertAssetFromFile: (file, context) => { writes++; return { assetId: 'asset-new', sha1: f.record.sha1, size: f.record.size, references: [{ spaceType: 'project', spaceId: f.project.id, path: file, role: context.role }] }; },
    updateProjectRecord: (_id, change) => { f.project = change(f.project); return { project: f.project }; }, mergeUnique: (values) => [...new Set(values)] };
  bind(scope, 'projectMaterialAssetCompatibility');
  const result = await scope.projectMaterialAssetCompatibility(f.project, f.host).syncAccepted(f.record.materialId);
  assert.equal(result.assetId, 'asset-new');
  assert.equal(writes, 1);
  assert.ok(f.project.assetIds.includes('asset-new'));
  assert.equal((await f.host.store.read()).materials[0].adoption.state, 'accepted');
});

test('repairAll processes every missing project reference beyond 5000 with one index read', async () => {
  const total = 5_101;
  const project = { id: 'p-large', name: 'Large synthetic project' };
  const materials = Array.from({ length: total }, (_, index) => ({
    materialId: `material-${index}`, version: 1, sha1: String(index).padStart(40, '0'), sha256: String(index).padStart(64, '0'),
    size: index + 1, availability: 'available', adoption: { state: 'accepted' }, links: { assets: [] }, location: { index },
  }));
  let reads = 0;
  const host = {
    store: {
      read: async () => { reads += 1; return { materials }; },
      locationPath: async (location) => path.resolve(os.tmpdir(), `material-${location.index}.txt`),
      resolve: async (materialId) => {
        const index = Number(materialId.slice('material-'.length));
        return { path: path.resolve(os.tmpdir(), `${materialId}.txt`), version: 1, sha1: materials[index].sha1,
          sha256: materials[index].sha256, size: materials[index].size };
      },
    },
    bindUploadedAsset: async () => {},
  };
  let writes = 0;
  const progress = [];
  const adapter = createProjectMaterialAssetCompatibility(project, host, {
    findAsset: () => undefined,
    hasProjectAsset: () => false,
    upsertAsset: async (file, context) => {
      const index = Number(path.basename(file).match(/\d+/)[0]); writes += 1;
      return { assetId: `asset-${index}`, sha1: materials[index].sha1, size: materials[index].size,
        references: [{ spaceType: 'project', spaceId: project.id, path: file, role: context.role }] };
    },
    addProjectAsset: async () => {},
  });
  const result = await adapter.repairAll({ batchSize: 100, onProgress: item => progress.push(item) });
  assert.equal(reads, 1);
  assert.equal(writes, total);
  assert.equal(result.linked, total);
  assert.equal(result.remaining, 0);
  assert.equal(progress.at(-1).processed, total);
});
