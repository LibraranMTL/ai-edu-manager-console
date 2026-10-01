const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { auditProjectMaterialContent } = require('../electron/project-material-content-audit.cjs');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-audit-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-audit-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'p1' };
  const workspace = path.join(root, 'workspace');
  const legacy = path.join(root, 'legacy-staging');
  await fs.mkdir(workspace); await fs.mkdir(legacy);
  const store = createProjectMaterialStore({ projectId: project.id,
    managerPath: path.join(root, 'manager'), roots: {
      workspace: { kind: 'workspace', path: workspace },
      'legacy-staging': { kind: 'external', path: legacy },
    } });
  async function add(name, content, old = false) {
    const location = old ? { kind: 'external', rootId: 'legacy-staging', relativePath: name }
      : { kind: 'workspace', rootId: 'workspace', relativePath: name };
    const sourcePath = path.join(old ? legacy : workspace, name);
    await fs.writeFile(sourcePath, content);
    const record = (await store.registerFiles([{ location }], { intent: old ? 'later' : 'active' })).result[0];
    const stat = await fs.stat(sourcePath);
    return { sourcePath, record, observed: { location, size: stat.size, mtimeMs: stat.mtimeMs } };
  }
  return { project, store, add };
}

test('due content verification leaves unchanged version and decision revision alone', async (t) => {
  const f = await fixture(t);
  const file = await f.add('same.txt', 'same');
  const nowMs = Date.now() + WEEK_MS + 1000;
  const before = (await f.store.read()).materials[0];
  const result = await auditProjectMaterialContent(f.project, [file.observed], f.store, { nowMs });
  assert.deepEqual({ checked: result.checked, updated: result.updated,
    unchanged: result.unchanged, pending: result.pending },
  { checked: 1, updated: 0, unchanged: 1, pending: 0 });
  const after = (await f.store.read()).materials[0];
  assert.equal(after.version, before.version);
  assert.equal(after.recordRevision, before.recordRevision);
  assert.equal(after.contentVerifiedAt, new Date(nowMs).toISOString());
  assert.equal((await auditProjectMaterialContent(f.project, [file.observed], f.store, { nowMs })).checked, 0);
});

test('content audit detects a same-size same-observed-mtime edit and preserves material identity', async (t) => {
  const f = await fixture(t);
  const file = await f.add('research.txt', 'OLD', true);
  const before = await fs.stat(file.sourcePath);
  const anchoredTime = new Date(Math.floor(before.mtimeMs));
  await fs.utimes(file.sourcePath, anchoredTime, anchoredTime);
  await f.store.registerFiles([{ location: file.observed.location }], { intent: 'later' });
  const baseline = await fs.stat(file.sourcePath);
  await fs.writeFile(file.sourcePath, 'NEW');
  await fs.utimes(file.sourcePath, anchoredTime, anchoredTime);
  const afterWrite = await fs.stat(file.sourcePath);
  assert.equal(afterWrite.size, baseline.size);
  assert.equal(afterWrite.mtimeMs, baseline.mtimeMs);
  const result = await auditProjectMaterialContent(f.project, [{ ...file.observed,
    size: afterWrite.size, mtimeMs: afterWrite.mtimeMs }], f.store,
    { nowMs: Date.now() + WEEK_MS + 1000 });
  assert.equal(result.updated, 1);
  assert.deepEqual(result.failed, []);
  const after = (await f.store.read()).materials[0];
  assert.equal(after.materialId, file.record.materialId);
  assert.equal(after.version, 2);
  assert.equal(after.adoption.state, 'candidate');
  assert.equal(after.processing.state, 'pending');
  assert.equal(await fs.readFile(file.sourcePath, 'utf8'), 'NEW');
});

test('content audit is bounded, resumes from oldest verification time and reports missing originals', async (t) => {
  const f = await fixture(t);
  const files = [];
  for (let index = 0; index < 3; index++) files.push(await f.add(`${index}.txt`, String(index)));
  const nowMs = Date.now() + WEEK_MS + 1000;
  const first = await auditProjectMaterialContent(f.project, files.map((item) => item.observed), f.store,
    { nowMs, limit: 1 });
  assert.equal(first.checked, 1);
  assert.equal(first.pending, 2);
  await fs.rm(files[1].sourcePath);
  const second = await auditProjectMaterialContent(f.project, files.map((item) => item.observed), f.store,
    { nowMs, limit: 2 });
  assert.equal(second.checked, 2);
  assert.equal(second.failed.length, 1);
  assert.equal(second.failed[0].code, 'ENOENT');
  assert.equal(second.unchanged, 1);
  assert.equal((await f.store.read()).materials.length, 3);
});
