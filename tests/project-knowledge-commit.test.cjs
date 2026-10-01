const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectDigestWorkspace, RESULT_SCHEMA } = require('../electron/project-material-digest.cjs');
const { createProjectKnowledgeCommitter, dependencyGroups } = require('../electron/project-knowledge-commit.cjs');

const native = { skip: process.platform !== 'win32' };

async function fixture(t, { storeHooks = {}, commitHooks = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-commit-test-'));
  const raw = path.join(root, 'workspace');
  const knowledgeRoot = path.join(root, 'knowledge');
  await fs.mkdir(raw); await fs.mkdir(knowledgeRoot);
  const store = createProjectMaterialStore({ projectId: 'p1', managerPath: path.join(root, '.edu-manager'),
    roots: { workspace: { kind: 'workspace', path: raw } }, hooks: storeHooks });
  const workspace = createProjectDigestWorkspace({ store, knowledgeRoot, allowedDirectories: ['摘要库', '概念库'] });
  const committer = createProjectKnowledgeCommitter({ store, workspace, knowledgeRoot, hooks: commitHooks });
  t.after(async () => {
    const snapshotRoot = path.join(store.directory, 'snapshots');
    for (const file of await fs.readdir(snapshotRoot).catch(() => [])) await fs.chmod(path.join(snapshotRoot, file), 0o600);
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-commit-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function setup({ count = 1, targetNames = ['摘要库/a.md'], existing = true, independent = false } = {}) {
    const entries = [];
    for (let i = 0; i < count; i++) {
      await fs.writeFile(path.join(raw, `${i}.txt`), `source ${i}`);
      entries.push({ location: { rootId: 'workspace', kind: 'workspace', relativePath: `${i}.txt` } });
    }
    const items = (await store.registerFiles(entries)).result;
    for (const target of targetNames) {
      await fs.mkdir(path.dirname(path.join(knowledgeRoot, target)), { recursive: true });
      if (existing) await fs.writeFile(path.join(knowledgeRoot, target), `old ${target}`);
    }
    const targets = targetNames.map((relativePath, index) => ({ relativePath,
      materialIds: independent ? [items[index].materialId] : items.map((item) => item.materialId) }));
    const batch = await workspace.prepare({ materialIds: items.map((item) => item.materialId), ruleVersion: 'r1', targets });
    const artifacts = [];
    for (const target of targets) {
      const file = path.join(batch.outputRoot, target.relativePath);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `new ${target.relativePath}`);
      artifacts.push({ relativePath: target.relativePath, sources: batch.sources.filter((source) => target.materialIds.includes(source.materialId)) });
    }
    return { items, batch, receipt: { schema: RESULT_SCHEMA, projectId: 'p1', batchId: batch.batchId, artifacts } };
  }
  return { root, raw, knowledgeRoot, store, workspace, committer, setup };
}

test('dependency grouping joins shared synthesis sources transitively', () => {
  const artifact = (ids) => ({ sources: ids.map((materialId) => ({ materialId })) });
  const groups = dependencyGroups([artifact(['a']), artifact(['b']), artifact(['a', 'b']), artifact(['c'])]);
  assert.deepEqual(groups.map((group) => group.length).sort(), [1, 3]);
});

test('commit writes official knowledge and source ledger once; replay is idempotent', native, async (t) => {
  const f = await fixture(t);
  const { batch, receipt, items } = await f.setup();
  const result = await f.committer.commit(batch.batchId, receipt);
  assert.equal(result.fullyCommitted, true);
  assert.equal(await fs.readFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'utf8'), 'new 摘要库/a.md');
  const index = await f.store.read();
  assert.equal(index.materials[0].processing.state, 'completed');
  assert.equal(index.materials[0].processing.processedVersion, 1);
  assert.equal(index.knowledge[0].sources[0].materialId, items[0].materialId);
  const repeated = await f.committer.commit(batch.batchId, receipt);
  assert.equal(repeated.results[0].reused, true);
  assert.equal((await f.store.read()).commits.length, 1);
});

test('metadata failure restores original knowledge and does not settle processing', native, async (t) => {
  let fail = false;
  const f = await fixture(t, { storeHooks: { beforeIndexWrite: () => { if (fail) throw new Error('disk full'); } } });
  const { batch, receipt } = await f.setup();
  fail = true;
  await assert.rejects(f.committer.commit(batch.batchId, receipt), /disk full/);
  assert.equal(await fs.readFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'utf8'), 'old 摘要库/a.md');
  assert.equal((await f.store.read()).materials[0].processing.state, 'pending');
  fail = false;
  assert.equal((await f.committer.commit(batch.batchId, receipt)).fullyCommitted, true);
});

test('unreferenced or missing target output cannot mark the entire batch processed', native, async (t) => {
  const f = await fixture(t);
  const { batch, receipt } = await f.setup({ targetNames: ['摘要库/a.md', '概念库/b.md'] });
  receipt.artifacts.pop();
  const result = await f.committer.commit(batch.batchId, receipt);
  assert.equal(result.results[0].state, 'committed');
  assert.equal(result.fullyCommitted, false); assert.equal(result.remainingMaterialIds.length, 1);
  assert.equal((await f.store.read()).materials[0].processing.state, 'pending');
});

test('shared-source outputs form one conflict group while independent work can commit', native, async (t) => {
  const f = await fixture(t);
  const { batch, receipt, items } = await f.setup({ count: 2, targetNames: ['摘要库/a.md', '概念库/b.md'], independent: true });
  await fs.writeFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'human update');
  const result = await f.committer.commit(batch.batchId, receipt);
  assert.equal(result.fullyCommitted, false);
  assert.equal(result.results.filter((item) => item.state === 'committed').length, 1);
  const index = await f.store.read();
  assert.equal(index.materials.find((item) => item.materialId === items[0].materialId).processing.state, 'pending');
  assert.equal(index.materials.find((item) => item.materialId === items[1].materialId).processing.state, 'completed');
  assert.equal(await fs.readFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'utf8'), 'human update');
});

test('source adoption changed while guard is open aborts and restores knowledge', native, async (t) => {
  let f;
  f = await fixture(t, { commitHooks: { afterLocked: () => f.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; }) } });
  const { batch, receipt } = await f.setup();
  await assert.rejects(f.committer.commit(batch.batchId, receipt), { code: 'source_changed' });
  assert.equal(await fs.readFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'utf8'), 'old 摘要库/a.md');
  assert.equal((await f.store.read()).materials[0].processing.state, 'pending');
});

test('killed guard after writing files can resume the durable journal without duplicate commits', native, async (t) => {
  let crash = true;
  const f = await fixture(t, { commitHooks: { afterFilesWritten: async ({ guard }) => {
    if (crash) { crash = false; await guard.terminate(); throw Object.assign(new Error('power loss'), { code: 'simulated_crash' }); }
  } } });
  const { batch, receipt } = await f.setup({ targetNames: ['摘要库/a.md', '概念库/b.md'] });
  await assert.rejects(f.committer.commit(batch.batchId, receipt), { code: 'simulated_crash' });
  const ids = await fs.readdir(path.join(f.store.directory, 'commits'));
  const result = await f.committer.recover(ids[0]);
  assert.equal(result.state, 'committed'); assert.equal((await f.store.read()).commits.length, 1);
  assert.equal((await f.store.read()).materials[0].processing.state, 'completed');
  for (const artifact of receipt.artifacts) assert.equal(await fs.readFile(path.join(f.knowledgeRoot, artifact.relativePath), 'utf8'), `new ${artifact.relativePath}`);
});

test('external edits after a crash are preserved; journal retains backups and reports conflict', native, async (t) => {
  const f = await fixture(t, { commitHooks: { afterFilesWritten: async ({ guard }) => {
    await guard.terminate(); throw Object.assign(new Error('power loss'), { code: 'simulated_crash' });
  } } });
  const { batch, receipt } = await f.setup();
  await assert.rejects(f.committer.commit(batch.batchId, receipt));
  await fs.writeFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'new human content');
  const [commitId] = await fs.readdir(path.join(f.store.directory, 'commits'));
  await assert.rejects(f.committer.recover(commitId), { code: 'recovery_conflict' });
  const journalRoot = path.join(f.store.directory, 'commits', commitId);
  const journal = JSON.parse(await fs.readFile(path.join(journalRoot, 'journal.json')));
  assert.equal(journal.state, 'recovery_conflict');
  const backup = path.join(journalRoot, journal.attempts[0].backupDirectory, '0.bin');
  assert.equal(await fs.readFile(backup, 'utf8'), 'old 摘要库/a.md');
  assert.equal(await fs.readFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'utf8'), 'new human content');
});

test('failure after ledger commit retains written bytes and recovery does not overwrite a later human edit', native, async (t) => {
  let crash = true;
  const f = await fixture(t, { commitHooks: { afterLedgerCommitted: async ({ guard }) => {
    if (crash) { crash = false; await guard.terminate(); throw Object.assign(new Error('power loss'), { code: 'simulated_crash' }); }
  } } });
  const { batch, receipt } = await f.setup();
  await assert.rejects(f.committer.commit(batch.batchId, receipt));
  const [commitId] = await fs.readdir(path.join(f.store.directory, 'commits'));
  assert.equal((await f.store.read()).commits[0].state, 'committed');
  await fs.writeFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'human after commit');
  await assert.rejects(f.committer.recover(commitId), { code: 'recovery_conflict' });
  assert.equal((await f.store.read()).materials[0].processing.state, 'pending');
  assert.equal((await f.store.read()).knowledge[0].status, 'recovery_conflict');
  assert.equal(await fs.readFile(path.join(f.knowledgeRoot, '摘要库/a.md'), 'utf8'), 'human after commit');
});
