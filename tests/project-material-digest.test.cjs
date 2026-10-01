const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectDigestWorkspace, RESULT_SCHEMA } = require('../electron/project-material-digest.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-digest-test-'));
  const workspace = path.join(root, 'workspace');
  const knowledge = path.join(root, 'knowledge');
  await fs.mkdir(workspace); await fs.mkdir(knowledge);
  const store = createProjectMaterialStore({ projectId: 'p1', managerPath: path.join(root, '.edu-manager'),
    roots: { workspace: { kind: 'workspace', path: workspace } } });
  const digest = createProjectDigestWorkspace({ store, knowledgeRoot: knowledge, allowedDirectories: ['摘要库', '概念库'] });
  t.after(async () => {
    const snapshots = path.join(store.directory, 'snapshots');
    for (const file of await fs.readdir(snapshots).catch(() => [])) await fs.chmod(path.join(snapshots, file), 0o600);
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-digest-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function add(name, text = name, intent = 'active') {
    await fs.writeFile(path.join(workspace, name), text);
    return (await store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: name } }], { intent })).result[0];
  }
  async function prepare(items, targets = ['摘要库/result.md']) {
    return digest.prepare({ materialIds: items.map((item) => item.materialId), targets, ruleVersion: 'r1' });
  }
  async function output(batch, refs = batch.sources, relative = '摘要库/result.md') {
    await fs.mkdir(path.dirname(path.join(batch.outputRoot, relative)), { recursive: true });
    await fs.writeFile(path.join(batch.outputRoot, relative), '# Synthetic summary\n');
    return { schema: RESULT_SCHEMA, projectId: 'p1', batchId: batch.batchId,
      artifacts: [{ relativePath: relative, sources: refs.map(({ materialId, version, sha256 }) => ({ materialId, version, sha256 })) }] };
  }
  return { root, workspace, knowledge, store, digest, add, prepare, output };
}

test('batch pins fixed snapshots and separates its output directory from official knowledge', async (t) => {
  const f = await fixture(t);
  const item = await f.add('a.txt', 'original');
  const batch = await f.prepare([item]);
  assert.equal(await fs.readFile(batch.inputFiles[0].path, 'utf8'), 'original');
  assert.ok(!batch.inputFiles[0].path.startsWith(f.workspace));
  assert.ok(!batch.outputRoot.startsWith(f.knowledge));
  assert.equal((await f.store.read()).materials[0].versions[0].pins[0], batch.batchId);
  await fs.writeFile(path.join(f.workspace, 'a.txt'), 'edited after prepare');
  assert.equal(await fs.readFile(batch.inputFiles[0].path, 'utf8'), 'original');
});

test('validated output is not a commit and does not mark sources completed', async (t) => {
  const f = await fixture(t);
  const batch = await f.prepare([await f.add('a.txt')]);
  const receipt = await f.output(batch);
  const result = await f.digest.validate(batch.batchId, receipt);
  assert.equal(result.artifacts[0].status, 'validated');
  assert.equal(result.requiresCommit, true); assert.deepEqual(result.processedMaterialIds, []);
  assert.equal((await f.store.read()).materials[0].processing.state, 'pending');
  await assert.rejects(fs.readFile(path.join(f.knowledge, '摘要库/result.md')), { code: 'ENOENT' });
});

test('foreign project, foreign batch and completion-only receipts are rejected', async (t) => {
  const f = await fixture(t);
  const batch = await f.prepare([await f.add('a.txt')]);
  const receipt = await f.output(batch);
  for (const patch of [{ projectId: 'other' }, { batchId: 'other' }, { schema: 'legacy' }]) {
    await assert.rejects(f.digest.validate(batch.batchId, { ...receipt, ...patch }), { code: 'receipt_scope_mismatch' });
  }
  await assert.rejects(f.digest.validate(batch.batchId, { ...receipt, artifacts: undefined, status: 'completed' }), { code: 'invalid_artifacts' });
});

test('invalid output paths and references are rejected rather than permissively matched', async (t) => {
  const f = await fixture(t);
  const batch = await f.prepare([await f.add('a.txt')]);
  const valid = await f.output(batch);
  for (const relativePath of ['../outside.md', '摘要库/../../outside.md', 'C:/outside.md', '摘要库/script.exe']) {
    await assert.rejects(f.digest.validate(batch.batchId, { ...valid, artifacts: [{ ...valid.artifacts[0], relativePath }] }));
  }
  await assert.rejects(f.digest.validate(batch.batchId, { ...valid,
    artifacts: [{ ...valid.artifacts[0], sources: [{ ...valid.artifacts[0].sources[0], sha256: 'f'.repeat(64) }] }] }), { code: 'source_mismatch' });
  await assert.rejects(f.digest.validate(batch.batchId, { ...valid,
    artifacts: [{ ...valid.artifacts[0], sources: [] }] }), { code: 'sources_missing' });
});

test('registered source updates and unregistered external edits both yield stale candidates', async (t) => {
  const f = await fixture(t);
  const item = await f.add('a.txt', 'initial');
  const batch = await f.prepare([item]);
  const receipt = await f.output(batch);
  await fs.writeFile(path.join(f.workspace, 'a.txt'), 'external edit');
  assert.equal((await f.digest.validate(batch.batchId, receipt)).artifacts[0].status, 'stale_sources');
  await f.add('a.txt', 'registered new edit');
  assert.equal((await f.digest.validate(batch.batchId, receipt)).artifacts[0].status, 'stale_sources');
  assert.equal((await f.store.read()).materials[0].version, 2);
});

test('concurrent human knowledge edits are preserved and flagged', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.knowledge, '摘要库'));
  const destination = path.join(f.knowledge, '摘要库/result.md');
  await fs.writeFile(destination, 'knowledge baseline');
  const batch = await f.prepare([await f.add('a.txt')]);
  const receipt = await f.output(batch);
  await fs.writeFile(destination, 'human changes');
  assert.equal((await f.digest.validate(batch.batchId, receipt)).artifacts[0].status, 'knowledge_conflict');
  assert.equal(await fs.readFile(destination, 'utf8'), 'human changes');
});

test('multi-source artifact checks every source; omitted inputs do not count as processed', async (t) => {
  const f = await fixture(t);
  const batch = await f.prepare([await f.add('a.txt'), await f.add('b.txt')]);
  await f.add('b.txt', 'new version');
  const combined = await f.output(batch);
  assert.equal((await f.digest.validate(batch.batchId, combined)).artifacts[0].status, 'stale_sources');
  const partial = await f.output(batch, [batch.sources[0]]);
  const result = await f.digest.validate(batch.batchId, partial);
  assert.equal(result.artifacts[0].status, 'validated');
  assert.deepEqual(result.processedMaterialIds, []);
});

test('candidate inputs cannot be digested and withdrawal after preparation invalidates the result', async (t) => {
  const f = await fixture(t);
  const candidate = await f.add('candidate.txt', 'candidate', 'later');
  await assert.rejects(f.prepare([candidate]), { code: 'source_not_adopted' });
  const item = await f.add('a.txt');
  const batch = await f.prepare([item]);
  const receipt = await f.output(batch);
  await f.store.mutate((index) => { index.materials.find((entry) => entry.materialId === item.materialId).adoption.state = 'excluded'; });
  assert.equal((await f.digest.validate(batch.batchId, receipt)).artifacts[0].status, 'stale_sources');
});

test('output junction cannot substitute an external file', async (t) => {
  const f = await fixture(t);
  const batch = await f.prepare([await f.add('a.txt')]);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'result.md'), 'outside');
  await fs.symlink(outside, path.join(batch.outputRoot, '摘要库'), process.platform === 'win32' ? 'junction' : 'dir');
  const receipt = { schema: RESULT_SCHEMA, projectId: 'p1', batchId: batch.batchId,
    artifacts: [{ relativePath: '摘要库/result.md', sources: batch.sources }] };
  await assert.rejects(f.digest.validate(batch.batchId, receipt), { code: 'linked_path' });
});
