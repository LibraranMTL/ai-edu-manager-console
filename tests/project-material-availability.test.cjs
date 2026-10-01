const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { projectMaterialDigestProjection } = require('../electron/project-material-host.cjs');
const { scanRootIdentity, relativePrefix, applyMaterialScanPage,
  markMaterialRootUnavailable } = require('../electron/project-material-availability.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-availability-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-availability-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  const store = createProjectMaterialStore({ projectId: 'p1', managerPath: path.join(root, 'manager'),
    roots: { workspace: { kind: 'workspace', path: workspace } } });
  async function add(name) {
    const target = path.join(workspace, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, name);
    const location = { kind: 'workspace', rootId: 'workspace', relativePath: name.replace(/\\/g, '/') };
    const item = (await store.registerFiles([{ location }])).result[0];
    return { target, location, item };
  }
  return { root, workspace, store, add };
}

const page = (store, sessionId, seenLocations, options = {}) => applyMaterialScanPage(store, {
  sessionId, scopeKey: 'workspace', rootId: 'workspace', seenLocations,
  ...options,
});

test('only a complete trusted multi-page scan marks a confirmed absent original missing', async (t) => {
  const f = await fixture(t);
  const a = await f.add('a.txt');
  const b = await f.add('b.txt');
  const c = await f.add('c.txt');
  const first = await page(f.store, 'scan-1', [a.location], { complete: false });
  assert.equal(first.missing, 0);
  await fs.rm(c.target);
  const last = await page(f.store, 'scan-1', [b.location], { complete: true, trustworthy: true });
  assert.equal(last.missing, 1);
  const index = await f.store.read();
  assert.equal(index.materials.find((item) => item.materialId === a.item.materialId).availability, 'available');
  assert.equal(index.materials.find((item) => item.materialId === b.item.materialId).availability, 'available');
  const missing = index.materials.find((item) => item.materialId === c.item.materialId);
  assert.equal(missing.availability, 'missing');
  assert.equal(missing.recordRevision, c.item.recordRevision + 1);
  const digest = projectMaterialDigestProjection({ id: 'p1', name: 'Synthetic',
    managerPath: path.join(f.root, 'manager'), rawPath: f.workspace }, index);
  assert.equal(digest.missingCount, 1);
  assert.equal(digest.pendingCount, 2);
  assert.equal((await page(f.store, 'scan-1', [], { complete: true, trustworthy: true })).missing, 0);
  await fs.writeFile(c.target, 'c.txt');
  const restored = (await f.store.registerFiles([{ location: c.location,
    materialId: c.item.materialId, expectedVersion: c.item.version }])).result[0];
  assert.equal(restored.materialId, c.item.materialId);
  assert.equal(restored.availability, 'available');
});

test('an incomplete scan or a file appearing after its cursor does not claim loss', async (t) => {
  const f = await fixture(t);
  const a = await f.add('a.txt');
  const b = await f.add('b.txt');
  await fs.rm(b.target);
  await page(f.store, 'scan-2', [a.location], { complete: false });
  const incomplete = await page(f.store, 'scan-2', [], { complete: true, trustworthy: false });
  assert.equal(incomplete.missing, 0);
  assert.equal((await f.store.read()).materials[1].availability, 'available');
  await fs.writeFile(b.target, 'b.txt');
  const late = await page(f.store, 'scan-3', [a.location], { complete: true, trustworthy: true });
  assert.equal(late.missing, 0);
  assert.equal((await f.store.read()).materials[1].availability, 'available');
});

test('scope exclusion protects legacy staging from workspace-only missing detection', async (t) => {
  const f = await fixture(t);
  const staging = await f.add('研究暂存/old.txt');
  assert.equal(relativePrefix(f.workspace, path.join(f.workspace, '研究暂存')), '研究暂存');
  const workspace = await page(f.store, 'scan-workspace', [], { complete: true, trustworthy: true,
    excludePrefixes: ['研究暂存'] });
  assert.equal(workspace.missing, 0);
  await fs.rm(staging.target);
  const legacy = await applyMaterialScanPage(f.store, { sessionId: 'scan-legacy', scopeKey: 'legacy-staging',
    rootId: 'workspace', includePrefix: '研究暂存', seenLocations: [], complete: true, trustworthy: true });
  assert.equal(legacy.missing, 1);
});

test('root identity changes when the scanned directory is replaced', async (t) => {
  const f = await fixture(t);
  const first = scanRootIdentity(f.workspace);
  assert.ok(first);
  await fs.rename(f.workspace, `${f.workspace}-old`);
  await fs.mkdir(f.workspace);
  const second = scanRootIdentity(f.workspace);
  assert.ok(second);
  assert.notEqual(second, first);
});

test('a missing source root is unavailable, not a confirmed missing individual file', async (t) => {
  const f = await fixture(t);
  const original = await f.add('研究暂存/old.txt');
  const directory = path.join(f.workspace, '研究暂存');
  await fs.rename(directory, `${directory}-offline`);
  const marked = await markMaterialRootUnavailable(f.store, { rootId: 'workspace',
    includePrefix: '研究暂存' });
  assert.equal(marked.unavailable, 1);
  assert.equal((await f.store.read()).materials[0].availability, 'unavailable');
  const digest = projectMaterialDigestProjection({ id: 'p1', name: 'Synthetic',
    managerPath: path.join(f.root, 'manager'), rawPath: f.workspace }, await f.store.read());
  assert.equal(digest.unavailableCount, 1);
  assert.equal(digest.pendingCount, 0);
  await fs.rename(`${directory}-offline`, directory);
  const restored = (await f.store.registerFiles([{ location: original.location,
    materialId: original.item.materialId, expectedVersion: original.item.version }])).result[0];
  assert.equal(restored.availability, 'available');
  assert.equal(restored.version, original.item.version);
});
