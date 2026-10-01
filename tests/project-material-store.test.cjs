const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createProjectMaterialStore, hashStableFile } = require('../electron/project-materials.cjs');

async function fixture(t, hooks = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-test-'));
  const workspace = path.join(root, 'workspace');
  const legacy = path.join(root, 'legacy');
  const managerPath = path.join(root, '.edu-manager');
  await fs.mkdir(workspace); await fs.mkdir(legacy);
  const options = { projectId: 'p1', managerPath,
    roots: { workspace: { path: workspace, kind: 'workspace' }, legacy: { path: legacy, kind: 'legacy_raw' } }, hooks };
  const store = createProjectMaterialStore(options);
  t.after(async () => {
    const snapshotRoot = path.join(store.directory, 'snapshots');
    for (const file of await fs.readdir(snapshotRoot).catch(() => [])) await fs.chmod(path.join(snapshotRoot, file), 0o600);
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const entry = (name, extra = {}) => ({ location: { kind: 'workspace', rootId: 'workspace', relativePath: name }, ...extra });
  async function file(name, content = name) {
    const target = path.join(workspace, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    return entry(name);
  }
  return { root, workspace, legacy, managerPath, store, options, entry, file };
}

test('batch registration persists distinct stable identities and only one index write', async (t) => {
  let writes = 0;
  const f = await fixture(t, { beforeIndexWrite: () => { writes++; } });
  const entries = await Promise.all([f.file('a.txt', 'same'), f.file('b.txt', 'same')]);
  const { result } = await f.store.registerFiles(entries);
  assert.equal(result.length, 2); assert.equal(writes, 1);
  assert.notEqual(result[0].materialId, result[1].materialId);
  assert.equal(result[0].sha256, result[1].sha256);
  assert.equal(result[0].adoption.state, 'accepted');
  assert.equal((await createProjectMaterialStore(f.options).list()).total, 2);
});

test('unchanged content retains version; changed content resets processing and keeps identity', async (t) => {
  const f = await fixture(t);
  const entry = await f.file('a.txt', 'old');
  const first = (await f.store.registerFiles([entry])).result[0];
  await f.store.mutate((data) => { data.materials[0].processing = { state: 'completed', processedVersion: 1 }; });
  const unchanged = (await f.store.registerFiles([entry])).result[0];
  assert.equal(unchanged.version, 1); assert.equal(unchanged.processing.state, 'completed');
  await f.file('a.txt', 'new');
  const next = (await f.store.registerFiles([entry])).result[0];
  assert.equal(next.materialId, first.materialId); assert.equal(next.version, 2);
  assert.equal(next.processing.state, 'pending'); assert.equal(next.processing.previousProcessedVersion, 1);
  await assert.rejects(f.store.resolve(first.materialId, 1), { code: 'version_unavailable' });
});

test('explicit verified relocation retains ID; occupied destination cannot steal another identity', async (t) => {
  const f = await fixture(t);
  const first = (await f.store.registerFiles([await f.file('a.txt')])).result[0];
  await fs.rename(path.join(f.workspace, 'a.txt'), path.join(f.workspace, 'renamed.txt'));
  const renamed = (await f.store.registerFiles([f.entry('renamed.txt', { materialId: first.materialId, expectedVersion: 1 })])).result[0];
  assert.equal(renamed.materialId, first.materialId); assert.equal(renamed.version, 1);
  const second = (await f.store.registerFiles([await f.file('b.txt')])).result[0];
  await assert.rejects(f.store.registerFiles([f.entry('b.txt', { materialId: first.materialId })]), { code: 'location_conflict' });
  assert.equal((await f.store.list()).items.find((item) => item.materialId === second.materialId).location.relativePath, 'b.txt');
});

test('batch relocation updates the position index before a new file reuses the old path', async (t) => {
  const f = await fixture(t);
  const original = (await f.store.registerFiles([await f.file('old.txt', 'old bytes')])).result[0];
  await fs.rename(path.join(f.workspace, 'old.txt'), path.join(f.workspace, 'moved.txt'));
  await f.file('old.txt', 'new bytes');
  const result = await f.store.registerFiles([
    f.entry('moved.txt', { materialId: original.materialId, expectedVersion: original.version }),
    f.entry('old.txt'),
  ]);
  assert.equal(result.result.length, 2);
  assert.equal(result.result[0].materialId, original.materialId);
  assert.notEqual(result.result[1].materialId, original.materialId);
  const index = await f.store.read();
  assert.equal(index.materials.length, 2);
  assert.equal(index.materials.find((item) => item.materialId === original.materialId).location.relativePath, 'moved.txt');
});

test('scan-identified relocation rejects a same-byte file substituted after listing', async (t) => {
  const f = await fixture(t);
  await f.file('old.txt', 'same bytes');
  const first = (await f.store.registerFiles([f.entry('old.txt')])).result[0];
  const target = path.join(f.workspace, 'new.txt');
  await fs.rename(path.join(f.workspace, 'old.txt'), target);
  const listed = await fs.stat(target);
  await fs.rename(target, path.join(f.workspace, 'original-kept.txt'));
  await fs.writeFile(target, 'same bytes');
  await assert.rejects(f.store.registerFiles([f.entry('new.txt', {
    materialId: first.materialId, expectedVersion: first.version,
    expectedSha256: first.sha256, expectedFileKey: `${listed.dev}:${listed.ino}`,
  })]), { code: 'source_changed' });
  const index = await f.store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].location.relativePath, 'old.txt');
});

test('resolver is project scoped, supports legacy roots and rejects unregistered roots', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.legacy, 'source.txt'), 'legacy bytes');
  const item = (await f.store.registerFiles([{ location: { kind: 'legacy_raw', rootId: 'legacy', relativePath: 'source.txt' } }])).result[0];
  assert.equal(await fs.readFile((await f.store.resolve(item.materialId)).path, 'utf8'), 'legacy bytes');
  const other = createProjectMaterialStore({ ...f.options, projectId: 'p2', managerPath: path.join(f.root, 'other-manager') });
  await assert.rejects(other.resolve(item.materialId), { code: 'material_missing' });
  await assert.rejects(f.store.registerFiles([{ location: { kind: 'external', rootId: 'elsewhere', relativePath: 'source.txt' } }]), { code: 'unknown_root' });
});

test('list and category queries use only registry even after original directory goes offline', async (t) => {
  let reads = 0;
  const f = await fixture(t, { afterSourceRead: () => { reads++; } });
  await f.store.registerFiles([await f.file('a.txt')]);
  await fs.rename(f.workspace, `${f.workspace}-offline`);
  for (let i = 0; i < 10; i++) assert.equal((await f.store.list({ limit: 1 })).total, 1);
  assert.equal(reads, 1);
});

test('separate store instances serialize commits without losing records', async (t) => {
  const f = await fixture(t);
  const secondStore = createProjectMaterialStore(f.options);
  await Promise.all([f.store.registerFiles([await f.file('a.txt')]), secondStore.registerFiles([await f.file('b.txt')])]);
  const index = await f.store.read();
  assert.equal(index.materials.length, 2); assert.equal(index.revision, 2);
  await assert.rejects(f.store.setCategories([], 0), { code: 'revision_conflict' });
});

test('slow observations cannot overwrite a newer registered content version', async (t) => {
  const f = await fixture(t);
  const first = (await f.store.registerFiles([await f.file('a.txt', 'first')])).result[0];
  const delayed = createProjectMaterialStore({ ...f.options, hooks: { afterObservation: async () => {
    await f.file('a.txt', 'third');
    await f.store.registerFiles([f.entry('a.txt')]);
  } } });
  await f.file('a.txt', 'second');
  await assert.rejects(delayed.registerFiles([f.entry('a.txt')]), { code: 'version_conflict' });
  assert.equal(await fs.readFile((await f.store.resolve(first.materialId)).path, 'utf8'), 'third');
  assert.equal((await f.store.read()).materials[0].version, 2);
});

test('index interruption leaves prior valid index and retry is safe', async (t) => {
  let fail = false;
  const f = await fixture(t, { beforeIndexWrite: () => { if (fail) throw new Error('simulated power loss'); } });
  await f.store.registerFiles([await f.file('a.txt')]);
  fail = true;
  await assert.rejects(f.store.registerFiles([await f.file('b.txt')]), /power loss/);
  assert.equal((await f.store.list()).total, 1);
  fail = false;
  await f.store.registerFiles([f.entry('b.txt')]);
  assert.equal((await f.store.list()).total, 2);
});

test('corrupt or cross-project registry fails closed instead of silently rebuilding empty state', async (t) => {
  const f = await fixture(t);
  await f.store.registerFiles([await f.file('a.txt')]);
  await fs.writeFile(f.store.indexPath, '{broken');
  await assert.rejects(f.store.list(), { code: 'registry_corrupt' });
  await assert.rejects(f.store.registerFiles([f.entry('a.txt')]), { code: 'registry_corrupt' });
  assert.equal(await fs.readFile(f.store.indexPath, 'utf8'), '{broken');
});

test('snapshots preserve exact old bytes and reuse content across distinct document identities', async (t) => {
  const f = await fixture(t);
  const { result } = await f.store.registerFiles([await f.file('a.txt', 'original'), await f.file('b.txt', 'original')]);
  const first = await f.store.snapshot(result[0].materialId, 1);
  const second = await f.store.snapshot(result[1].materialId, 1);
  assert.equal(first.path, second.path);
  await f.file('a.txt', 'replacement');
  await f.store.registerFiles([f.entry('a.txt')]);
  assert.equal(await fs.readFile((await f.store.resolve(result[0].materialId, 1)).path, 'utf8'), 'original');
  assert.equal(await fs.readFile((await f.store.resolve(result[0].materialId, 2)).path, 'utf8'), 'replacement');
});

test('snapshot capacity guard stops new copies but reuses an already verified content snapshot', async (t) => {
  const f = await fixture(t, { statfs: async () => ({ bavail: 1, bsize: 1 }) });
  const items = (await f.store.registerFiles([await f.file('a.txt', 'same'), await f.file('b.txt', 'same')])).result;
  await assert.rejects(f.store.snapshot(items[0].materialId), { code: 'insufficient_space' });
  assert.equal((await f.store.read()).materials[0].versions[0].snapshot, null);
  assert.deepEqual(await fs.readdir(path.join(f.store.directory, 'snapshots')), []);
  const enough = createProjectMaterialStore({ ...f.options, hooks: {
    statfs: async () => ({ bavail: 1024 * 1024 * 1024, bsize: 1 }),
  } });
  const first = await enough.snapshot(items[0].materialId);
  const second = await f.store.snapshot(items[1].materialId);
  assert.equal(first.path, second.path);
  assert.equal(await fs.readFile(second.path, 'utf8'), 'same');
});

test('unknown free-space information pauses snapshot creation without altering the original', async (t) => {
  const f = await fixture(t, { statfs: async () => ({ bavail: 0, bsize: 0 }) });
  const item = (await f.store.registerFiles([await f.file('a.txt', 'original')])).result[0];
  await assert.rejects(f.store.snapshot(item.materialId), { code: 'capacity_unknown' });
  assert.equal(await fs.readFile(path.join(f.workspace, 'a.txt'), 'utf8'), 'original');
  assert.equal((await f.store.read()).materials[0].versions[0].snapshot, null);
  const inaccessible = createProjectMaterialStore({ ...f.options, hooks: { statfs: async () => {
    throw Object.assign(new Error('synthetic offline volume'), { code: 'EIO' });
  } } });
  await assert.rejects(inaccessible.snapshot(item.materialId), { code: 'capacity_unknown' });
});

test('simultaneous snapshot requests for identical bytes reserve space once', async (t) => {
  let checked = 0;
  const f = await fixture(t, { statfs: async () => {
    checked += 1;
    return { bavail: 1024 * 1024 * 1024, bsize: 1 };
  } });
  const items = (await f.store.registerFiles([await f.file('a.txt', 'same'), await f.file('b.txt', 'same')])).result;
  const [left, right] = await Promise.all(items.map((item) => f.store.snapshot(item.materialId)));
  assert.equal(left.path, right.path);
  assert.equal(checked, 1);
  assert.deepEqual((await fs.readdir(path.join(f.store.directory, 'snapshots'))).length, 1);
});

test('unsupported atomic snapshot publication leaves no formal version or partial file', async (t) => {
  const f = await fixture(t, { link: async () => {
    throw Object.assign(new Error('synthetic unsupported link'), { code: 'ENOTSUP' });
  } });
  const item = (await f.store.registerFiles([await f.file('a.txt', 'original')])).result[0];
  await assert.rejects(f.store.snapshot(item.materialId), { code: 'atomic_publish_unavailable' });
  assert.equal((await f.store.read()).materials[0].versions[0].snapshot, null);
  assert.deepEqual(await fs.readdir(path.join(f.store.directory, 'snapshots')), []);
  assert.equal(await fs.readFile(path.join(f.workspace, 'a.txt'), 'utf8'), 'original');
});

test('source edits during hashing or snapshot copy are rejected', async (t) => {
  const f = await fixture(t);
  await f.file('a.txt', 'initial');
  const source = path.join(f.workspace, 'a.txt');
  await assert.rejects(hashStableFile(source, { afterRead: () => fs.writeFile(source, 'changed while read') }), { code: 'source_changed' });
  const item = (await f.store.registerFiles([f.entry('a.txt')])).result[0];
  const changing = createProjectMaterialStore({ ...f.options, hooks: { afterSnapshotRead: () => fs.writeFile(source, 'changed during snapshot') } });
  await assert.rejects(changing.snapshot(item.materialId), { code: 'source_changed' });
  assert.equal((await f.store.read()).materials[0].versions[0].snapshot, null);
  assert.deepEqual(await fs.readdir(path.join(f.store.directory, 'snapshots')), []);
});

test('tampered fixed versions are detected before use', async (t) => {
  const f = await fixture(t);
  const item = (await f.store.registerFiles([await f.file('a.txt')])).result[0];
  const snapshot = await f.store.snapshot(item.materialId);
  await fs.chmod(snapshot.path, 0o600); await fs.writeFile(snapshot.path, 'corrupted');
  await assert.rejects(f.store.resolve(item.materialId, 1), { code: 'source_changed' });
});

test('classification rename preserves membership and AI cannot overwrite manual decisions', async (t) => {
  const f = await fixture(t);
  const item = (await f.store.registerFiles([await f.file('a.txt')])).result[0];
  await f.store.setCategories([{ categoryId: 'design', name: '方案设计' }]);
  const applied = await f.store.updateClassification([{ materialId: item.materialId, expectedVersion: 1,
    expectedRecordRevision: item.recordRevision, categoryId: 'design' }], { actorId: 'teacher' });
  assert.equal(applied.result[0].ok, true);
  await f.store.setCategories([{ categoryId: 'design', name: '设计方案' }]);
  assert.equal((await f.store.list({ categoryId: 'design' })).total, 1);
  const ai = await f.store.updateClassification([{ materialId: item.materialId, expectedVersion: 1,
    expectedRecordRevision: applied.result[0].recordRevision, categoryId: 'design' }], { actorId: 'ai', source: 'ai' });
  assert.equal(ai.result[0].code, 'manual_locked');
  await f.store.setCategories([]);
  assert.equal((await f.store.list()).categories[0].active, false);
});

test('classification batch reports per-item conflicts without misreporting full success', async (t) => {
  const f = await fixture(t);
  const items = (await f.store.registerFiles([await f.file('a.txt'), await f.file('b.txt')])).result;
  await f.store.setCategories([{ categoryId: 'r', name: '参考资料' }]);
  const result = await f.store.updateClassification(items.map((item, i) => ({ materialId: item.materialId,
    expectedVersion: i ? 99 : 1, expectedRecordRevision: 1, categoryId: 'r' })), { actorId: 'u' });
  assert.equal(result.result[0].ok, true); assert.equal(result.result[1].code, 'version_conflict');
});

test('candidate adoption changes registry state without moving the original or admitting excluded files to digest', async (t) => {
  const f = await fixture(t);
  const source = path.join(f.workspace, '收件箱', 'research.txt');
  const candidate = (await f.store.registerFiles([await f.file('收件箱/research.txt', 'original')],
    { intent: 'later' })).result[0];
  assert.equal(candidate.adoption.state, 'candidate');
  const excluded = await f.store.decideAdoption([{ materialId: candidate.materialId,
    expectedVersion: candidate.version, expectedRecordRevision: candidate.recordRevision,
    state: 'excluded' }], { actorId: 'local-user', reason: '暂不采用' });
  assert.equal(excluded.result[0].ok, true);
  assert.equal((await f.store.list({ adoption: 'excluded' })).total, 1);
  const blocked = await f.store.decideAdoption([{ materialId: candidate.materialId,
    expectedVersion: candidate.version, expectedRecordRevision: excluded.result[0].recordRevision,
    state: 'accepted' }], { actorId: 'local-user' });
  assert.equal(blocked.result[0].code, 'reopen_required');
  const reopened = await f.store.decideAdoption([{ materialId: candidate.materialId,
    expectedVersion: candidate.version, expectedRecordRevision: excluded.result[0].recordRevision,
    state: 'candidate' }], { actorId: 'local-user' });
  assert.equal(reopened.result[0].ok, true);
  const adopted = await f.store.decideAdoption([{ materialId: candidate.materialId,
    expectedVersion: candidate.version, expectedRecordRevision: reopened.result[0].recordRevision,
    state: 'accepted' }], { actorId: 'local-user' });
  assert.equal(adopted.result[0].ok, true);
  assert.equal((await f.store.list({ adoption: 'accepted' })).total, 1);
  assert.equal((await f.store.read()).materials[0].processing.state, 'pending');
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(path.dirname(source)), ['research.txt']);
  const repeat = await f.store.decideAdoption([{ materialId: candidate.materialId,
    expectedVersion: candidate.version, expectedRecordRevision: adopted.result[0].recordRevision,
    state: 'accepted' }], { actorId: 'local-user' });
  assert.equal(repeat.result[0].unchanged, true);
});

test('candidate adoption rejects changed bytes and stale review revisions', async (t) => {
  const f = await fixture(t);
  const candidate = (await f.store.registerFiles([await f.file('a.txt', 'first')],
    { intent: 'later' })).result[0];
  const change = { materialId: candidate.materialId, expectedVersion: candidate.version,
    expectedRecordRevision: candidate.recordRevision, state: 'accepted' };
  await f.file('a.txt', 'changed');
  const rejected = await f.store.decideAdoption([change], { actorId: 'local-user' });
  assert.equal(rejected.result[0].code, 'source_changed');
  assert.equal((await f.store.list({ adoption: 'candidate' })).total, 1);
  const refreshed = (await f.store.registerFiles([f.entry('a.txt')])).result[0];
  const stale = await f.store.decideAdoption([change], { actorId: 'local-user' });
  assert.equal(stale.result[0].code, 'version_conflict');
  const adopted = await f.store.decideAdoption([{ ...change, expectedVersion: refreshed.version,
    expectedRecordRevision: refreshed.recordRevision }], { actorId: 'local-user' });
  assert.equal(adopted.result[0].ok, true);
});

test('adoption batch is idempotent without advancing the registry revision', async (t) => {
  const f = await fixture(t);
  const candidate = (await f.store.registerFiles([await f.file('review.txt', 'review')],
    { intent: 'later' })).result[0];
  const changes = [{ materialId: candidate.materialId, expectedVersion: candidate.version,
    expectedRecordRevision: candidate.recordRevision, state: 'excluded' }];
  const first = await f.store.decideAdoption(changes, { actorId: 'teacher-1',
    reason: '不属于本项目', idempotencyKey: 'adoption-request-1' });
  const replay = await f.store.decideAdoption(changes, { actorId: 'teacher-1',
    reason: '不属于本项目', idempotencyKey: 'adoption-request-1' });
  assert.equal(first.result[0].ok, true);
  assert.equal(replay.unchanged, true);
  assert.equal(replay.revision, first.revision);
  assert.deepEqual(replay.result, first.result);
  await assert.rejects(f.store.decideAdoption([{ ...changes[0], state: 'candidate' }], {
    actorId: 'teacher-1', reason: '不属于本项目', idempotencyKey: 'adoption-request-1',
  }), { code: 'idempotency_conflict' });
});

test('symlink or junction source cannot escape authorized project root', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.txt'), 'not authorized');
  await fs.symlink(outside, path.join(f.workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.store.registerFiles([f.entry('link/secret.txt')]), { code: 'linked_path' });
});

test('unregistered external changes fail explicit resolution rather than returning mislabeled current bytes', async (t) => {
  const f = await fixture(t);
  const item = (await f.store.registerFiles([await f.file('a.txt')])).result[0];
  await f.file('a.txt', 'changed');
  await assert.rejects(f.store.resolve(item.materialId), { code: 'source_changed' });
  assert.equal(item.sha256, crypto.createHash('sha256').update('a.txt').digest('hex'));
});
