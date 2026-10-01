const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createProjectArchiveTransactions } = require('../electron/project-archive-transaction.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-archive-transaction-'));
  const student = path.join(root, 'student'), host = path.join(root, 'host');
  await fs.mkdir(student); await fs.mkdir(host);
  const evidence = path.join(student, 'evidence.md'), projects = path.join(host, 'projects.json');
  await fs.writeFile(evidence, 'old evidence'); await fs.writeFile(projects, '{"published":false}');
  const directory = path.join(root, 'journal');
  const options = { directory, projectId: 'p1', roots: [student, host], authorize: async () => true };
  const service = (overrides = {}) => createProjectArchiveTransactions({ ...options, ...overrides });
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-archive-transaction-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const build = (manager = service()) => {
    const transaction = manager.begin({ operation: 'synthetic' });
    transaction.io.writeFileSync(evidence, 'new evidence'); transaction.io.writeFileSync(projects, '{"published":true}');
    return transaction;
  };
  return { root, student, host, evidence, projects, directory, options, service, build };
}

test('staged cross-root writes stay invisible until durable native commit, then replay does not write twice', async (t) => {
  const f = await fixture(t); const manager = f.service(); const tx = f.build(manager);
  tx.io.appendFileSync(f.evidence, '\nappend');
  assert.equal(tx.io.readFileSync(f.evidence, 'utf8'), 'new evidence\nappend');
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence');
  const result = await tx.commit({ ok: true, marker: 'result' });
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'new evidence\nappend');
  assert.equal(JSON.parse(await fs.readFile(f.projects)).published, true);
  assert.deepEqual(await manager.pending(), []);
  const stat = await fs.stat(f.evidence); const replay = await manager.resume(result.transactionId);
  assert.equal(replay.replay, true); assert.equal(replay.result.marker, 'result'); assert.equal((await fs.stat(f.evidence)).mtimeMs, stat.mtimeMs);
});

test('native commit failure restores files and pending transaction can be retried from durable inputs', async (t) => {
  const f = await fixture(t); const manager = f.service({ hooks: { afterFilesWritten: () => { throw new Error('injected failure'); } } });
  await assert.rejects(f.build(manager).commit({ ok: true }), /injected/);
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence'); assert.equal(JSON.parse(await fs.readFile(f.projects)).published, false);
  const [pending] = await manager.pending(); assert.equal(pending.state, 'interrupted');
  await f.service().resume(pending.id);
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'new evidence'); assert.equal(JSON.parse(await fs.readFile(f.projects)).published, true);
});

test('a newly appearing or externally edited target is preserved and blocks the entire transaction', async (t) => {
  const f = await fixture(t);
  const manager = f.service({ hooks: { afterPrepared: () => fs.writeFile(f.evidence, 'human edit') } });
  await assert.rejects(f.build(manager).commit({ ok: true }), { code: 'recovery_conflict' });
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'human edit'); assert.equal(JSON.parse(await fs.readFile(f.projects)).published, false);
  const [pending] = await manager.pending();
  await assert.rejects(f.service().resume(pending.id), { code: 'recovery_conflict' });
  const journal = JSON.parse(await fs.readFile(path.join(f.directory, pending.id, 'journal.json')));
  assert.equal(await fs.readFile(path.join(f.directory, pending.id, journal.entries[0].before), 'utf8'), 'old evidence');
});

test('authority loss, outside targets and linked paths fail without writing official data', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.build(f.service({ authorize: async () => false })).commit({ ok: true }), { code: 'forbidden' });
  const tx = f.service({ roots: [f.student], files: [f.projects] }).begin();
  assert.throws(() => tx.io.writeFileSync(path.join(f.host, 'not-granted.json'), 'bad'), { code: 'invalid_path' });
  tx.io.writeFileSync(f.projects, 'exact file grant');
  const external = path.join(f.root, 'external'); await fs.mkdir(external);
  await fs.symlink(external, path.join(f.student, 'link'), 'junction');
  assert.throws(() => tx.io.writeFileSync(path.join(f.student, 'link', 'escape'), 'bad'), { code: 'linked_path' });
  await assert.rejects(f.build(f.service({ authorizeLocked: async () => false })).commit({ ok: true }), { code: 'forbidden' });
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence');
});

test('first read/existence observation is the baseline, not a later value captured just before writing', async (t) => {
  const f = await fixture(t); const tx = f.service().begin();
  assert.equal(tx.io.readFileSync(f.evidence, 'utf8'), 'old evidence');
  await fs.writeFile(f.evidence, 'human change between read and staged write');
  tx.io.appendFileSync(f.evidence, '\nplanned append');
  await assert.rejects(tx.commit({ ok: true }), { code: 'recovery_conflict' });
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'human change between read and staged write');
  const other = await fixture(t); const fresh = other.service().begin(); const absent = path.join(other.student, 'new.md');
  assert.equal(fresh.io.existsSync(absent), false); await fs.writeFile(absent, 'human new file');
  fresh.io.writeFileSync(absent, 'planned new file');
  await assert.rejects(fresh.commit({ ok: true }), { code: 'recovery_conflict' });
  assert.equal(await fs.readFile(absent, 'utf8'), 'human new file');
});

test('corrupt durable images or altered journal target cannot be replayed', async (t) => {
  const f = await fixture(t); const manager = f.service({ hooks: { afterPrepared: () => { throw new Error('pause after durable staging'); } } });
  await assert.rejects(f.build(manager).commit({ ok: true }), /pause/);
  const [pending] = await manager.pending(); const folder = path.join(f.directory, pending.id);
  await fs.writeFile(path.join(folder, '0.after'), 'corrupt');
  await assert.rejects(f.service().resume(pending.id), { code: 'transaction_corrupt' });
  const journal = JSON.parse(await fs.readFile(path.join(folder, 'journal.json')));
  journal.entries[0].path = path.join(f.root, 'outside.md'); await fs.writeFile(path.join(folder, 'journal.json'), JSON.stringify(journal));
  await assert.rejects(f.service().resume(pending.id), { code: 'invalid_path' });
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence');
});

test('process kill at durable staging, files-written and finalized boundaries resumes without duplicate writes', { timeout: 30000 }, async (t) => {
  for (const phase of ['afterPrepared', 'afterFilesWritten', 'afterFinalized']) {
    const f = await fixture(t);
    const child = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/project-archive-crash.cjs'), f.root, phase],
      { windowsHide: true, timeout: 15000, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    assert.equal(child.error, undefined); assert.notEqual(child.status, 0, child.stderr);
    const [pending] = await f.service().pending(); assert.ok(pending, phase);
    const result = await f.service().resume(pending.id); assert.equal(result.result.message, 'synthetic done');
    assert.equal(await fs.readFile(f.evidence, 'utf8'), 'new evidence'); assert.equal(JSON.parse(await fs.readFile(f.projects)).published, true);
    assert.deepEqual(await f.service().pending(), []);
  }
});

test('empty files and payloads larger than knowledge-document limits are supported only by bounded archive profile', async (t) => {
  const f = await fixture(t); const tx = f.service().begin();
  const large = Buffer.alloc(3 * 1024 * 1024, 33); tx.io.writeFileSync(f.evidence, large); tx.io.writeFileSync(f.projects, '');
  await tx.commit({ ok: true }); assert.equal((await fs.stat(f.evidence)).size, large.length); assert.equal((await fs.stat(f.projects)).size, 0);
  const oversized = f.service().begin(); assert.throws(() => oversized.io.writeFileSync(f.evidence, Buffer.alloc(64 * 1024 * 1024 + 1)), { code: 'archive_limit' });
});

test('unfinished journal prevents a different new transaction', async (t) => {
  const f = await fixture(t); const manager = f.service({ hooks: { afterPrepared: () => { throw new Error('interruption'); } } });
  await assert.rejects(f.build(manager).commit({ ok: true }), /interruption/);
  await assert.rejects(f.build(f.service()).commit({ ok: true }), { code: 'archive_recovery_required' });
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence');
  assert.equal(syncFs.existsSync(f.projects), true);
});

test('journal ancestors cannot redirect durable copies through a junction before or after service creation', async (t) => {
  const f = await fixture(t); const outside = path.join(f.root, 'external-journal'); await fs.mkdir(outside);
  const manager = f.service();
  await fs.symlink(outside, f.directory, 'junction');
  assert.throws(() => f.service(), { code: 'linked_path' });
  await assert.rejects(manager.pending(), { code: 'linked_path' });
  await assert.rejects(f.build(manager).commit({ ok: true }), { code: 'linked_path' });
  assert.deepEqual(await fs.readdir(outside), []); assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence');
});

test('orphan staging and missing journal folders do not report an official commit or block a fresh transaction', async (t) => {
  const f = await fixture(t); const { randomUUID } = require('node:crypto');
  const stagingId = `archive-tx-${randomUUID()}`;
  const staging = path.join(f.directory, stagingId); await fs.mkdir(staging, { recursive: true });
  await fs.writeFile(path.join(staging, 'journal.json'), JSON.stringify({ schema: 'edu-manager.project-archive-transaction.v1', projectId: 'p1', id: stagingId, state: 'staging', entries: [] }));
  await fs.mkdir(path.join(f.directory, `archive-tx-${randomUUID()}`));
  assert.deepEqual(await f.service().pending(), []); assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence');
  await f.build().commit({ ok: true }); assert.equal(await fs.readFile(f.evidence, 'utf8'), 'new evidence');
  assert.equal(syncFs.existsSync(path.join(staging, 'journal.json')), true);
});

test('explicit abandon of prepared or rolled-back operations changes only the journal and cannot be replayed', async (t) => {
  for (const phase of ['afterPrepared', 'afterFilesWritten']) {
    const f = await fixture(t);
    const manager = f.service({ hooks: { [phase]: () => { throw new Error('stop before completion'); } } });
    const tx = f.build(manager); const absent = path.join(f.student, 'new.md');
    tx.io.writeFileSync(absent, 'new item');
    await assert.rejects(tx.commit({ ok: true }), /stop before completion/);
    const [pending] = await manager.pending();
    const before = await fs.stat(f.evidence);
    const cancelled = await f.service().abandon(pending.id);
    assert.equal(cancelled.abandoned, true);
    assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence');
    assert.equal(await fs.readFile(f.projects, 'utf8'), '{"published":false}');
    assert.equal((await fs.stat(f.evidence)).mtimeMs, before.mtimeMs);
    assert.equal(syncFs.existsSync(absent), false);
    assert.deepEqual(await f.service().pending(), []);
    const folder = path.join(f.directory, pending.id);
    const journal = JSON.parse(await fs.readFile(path.join(folder, 'journal.json')));
    assert.equal(journal.state, 'abandoned'); assert.ok(journal.abandonedAt);
    assert.equal(await fs.readFile(path.join(folder, '0.before'), 'utf8'), 'old evidence');
    assert.equal((await f.service().abandon(pending.id)).abandoned, true);
    await assert.rejects(f.service().resume(pending.id), { code: 'archive_abandoned' });
    // A distinct, newly authorized operation is no longer blocked by the old one.
    await f.build().commit({ ok: true });
    assert.equal(await fs.readFile(f.evidence, 'utf8'), 'new evidence');
  }
});

test('abandon refuses committed, partly written, externally modified and newly appearing targets without altering them', async (t) => {
  const committed = await fixture(t); const done = await committed.build().commit({ ok: true });
  await assert.rejects(committed.service().abandon(done.transactionId), { code: 'invalid_transaction' });
  assert.equal(await fs.readFile(committed.evidence, 'utf8'), 'new evidence');
  for (const mode of ['partial', 'external', 'new-target', 'finalized']) {
    const f = await fixture(t);
    const manager = f.service({ hooks: { [mode === 'finalized' ? 'afterFinalized' : 'afterPrepared']: () => { throw new Error('interrupt'); } } });
    const tx = f.build(manager); const target = path.join(f.student, 'new.md'); tx.io.writeFileSync(target, 'planned');
    await assert.rejects(tx.commit({ ok: true }), /interrupt/);
    if (mode === 'partial') await fs.writeFile(f.evidence, 'new evidence');
    if (mode === 'external') await fs.writeFile(f.evidence, 'human edit');
    if (mode === 'new-target') await fs.writeFile(target, 'human created');
    const [pending] = await manager.pending();
    const before = await fs.readFile(f.evidence); const projectBefore = await fs.readFile(f.projects);
    const targetBefore = syncFs.existsSync(target) ? await fs.readFile(target) : null;
    await assert.rejects(f.service().abandon(pending.id), { code: 'recovery_conflict' });
    assert.deepEqual(await fs.readFile(f.evidence), before); assert.deepEqual(await fs.readFile(f.projects), projectBefore);
    if (targetBefore) assert.deepEqual(await fs.readFile(target), targetBefore);
    assert.equal((await f.service().pending()).length, 1);
  }
});

test('abandon rechecks authority, project target scope and before-image integrity', async (t) => {
  const f = await fixture(t);
  const manager = f.service({ hooks: { afterPrepared: () => { throw new Error('interrupt'); } } });
  await assert.rejects(f.build(manager).commit({ ok: true }), /interrupt/);
  const [pending] = await manager.pending();
  await assert.rejects(f.service({ authorize: async () => false }).abandon(pending.id), { code: 'forbidden' });
  await assert.rejects(f.service({ roots: [f.host] }).abandon(pending.id), { code: 'invalid_path' });
  await fs.writeFile(path.join(f.directory, pending.id, '0.before'), 'damaged backup');
  await assert.rejects(f.service().abandon(pending.id), { code: 'transaction_corrupt' });
  assert.equal(await fs.readFile(f.evidence, 'utf8'), 'old evidence');
  assert.equal((await manager.pending()).length, 1);
});
