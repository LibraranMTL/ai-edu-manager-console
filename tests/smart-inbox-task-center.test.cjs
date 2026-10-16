'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createTaskHost } = require('./helpers/smart-inbox-task-host.cjs');
const { createSmartInbox } = require('../electron/smart-inbox.cjs');
const { validateTaskTransition } = require('../electron/task-protocol.cjs');
const source = { id: 'synthetic-source', name: 'Synthetic', studentId: 'synthetic-student' };

test('resource wait and failed batch resume existing discoveries, preserve history and clear stale source error', async t => {
  const { root, host } = await fixture(t);
  const folder = path.join(root, 'input'); await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'synthetic.txt'), 'synthetic data');
  let busy = true, fail = true, releases = 0;
  // An older pending task may remain after the reported bug. Do not erase it.
  host.context.upsertTaskCandidates([{ id: 'old-pending-batch', kind: 'smart_material_intake', status: 'pending' }]);
  await host.service.flush();
  const engine = createSmartInbox({ directory: path.join(root, 'inbox'), stableAgeMs: 0,
    forbiddenRoots: () => [], automaticAllowed: () => true,
    acquire: () => busy ? null : () => { releases++; },
    beginBatch: async (...args) => { if (fail) throw Error('synthetic registration failure'); return host.beginBatch(...args); },
    endBatch: host.endBatch,
    extract: () => { throw Error('shared source must never read content'); },
    classify: () => { throw Error('shared source must never call Agent'); },
  });
  t.after(() => engine.close());
  const s = await engine.updateSource({ folder, enabled: true, studentId: '', automatic: true });
  await engine.requestScan(s.id); await engine.tick();
  assert.equal((await engine.list()).rows[0].status, 'pending');
  assert.equal(host.disk().tasks.length, 1, 'resource wait creates no batch');
  busy = false; await engine.tick();
  assert.match((await engine.sources()).sources.find(r => r.id === s.id).error, /synthetic registration failure/);
  fail = false; await engine.tick();
  assert.equal((await engine.list()).total, 1); assert.equal((await engine.list()).rows[0].status, 'review');
  assert.equal((await engine.sources()).sources.find(r => r.id === s.id).error, '');
  assert.equal(host.disk().tasks.length, 2);
  assert.equal(host.disk().tasks.find(r => r.id === 'old-pending-batch').status, 'pending');
  assert.equal(releases, 2);
});

async function fixture(t, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-intake-task-integration-'));
  const host = await createTaskHost(root, options);
  t.after(async () => { await host.close().catch(() => {}); await fs.rm(root, { recursive: true, force: true }); });
  return { root, host };
}

for (const manual of [true, false]) test(`real main batch + Worker ledger completes (${manual ? 'manual' : 'scheduled'})`, async t => {
  const { host } = await fixture(t);
  assert.equal(validateTaskTransition('pending', 'running').ok, false, 'global guard must remain strict');
  const id = await host.beginBatch(source, manual);
  const running = host.disk().tasks.find(t => t.id === id);
  assert.equal(running.status, 'running'); assert.ok(running.executionId);
  assert.equal(running.trigger, manual ? 'manual' : 'scheduled');
  assert.equal(host.context.taskChildProcesses.size, 1);
  await host.endBatch(id, null, { count: 5 });
  assert.equal(host.disk().tasks[0].status, 'succeeded');
  assert.deepEqual(host.events().filter(e => e.detail?.to).map(e => e.detail.to), ['approved', 'running', 'reviewing', 'succeeded']);
  assert.equal(host.context.taskChildProcesses.size, 0);
  const count = host.events().length; await host.endBatch(id, null, { count: 5 });
  assert.equal(host.events().length, count, 'duplicate finish is a no-op');
});

test('real batch failure records failure and releases runtime entry without claiming success', async t => {
  const { host } = await fixture(t); const id = await host.beginBatch(source, true);
  await host.endBatch(id, Error('synthetic extraction failure'));
  assert.equal(host.disk().tasks[0].status, 'failed');
  assert.equal(host.disk().tasks[0].autoRetry, false);
  assert.equal(host.context.taskChildProcesses.size, 0);
});

test('actual async storage barrier blocks processing; disk failure never registers a live execution', async t => {
  let release, reached;
  const entered = new Promise(r => { reached = r; });
  const { host } = await fixture(t, { beforeRequest: async (_file, op) => {
    if (op === 'store_write') { reached(); await new Promise((resolve, reject) => { release = reject; }); }
  } });
  const pending = host.beginBatch(source, true);
  const rejected = assert.rejects(pending, /disk full|暂停/);
  await entered; assert.equal(host.context.taskChildProcesses.size, 0);
  release(Object.assign(Error('disk full'), { code: 'ENOSPC' }));
  await rejected; assert.equal(host.context.taskChildProcesses.size, 0);
});

for (const bound of [false, true]) test(`discovery -> actual task center -> ${bound ? 'delivery' : 'shared-source review'}; rescan is idempotent`, async t => {
  const { root, host } = await fixture(t);
  const folder = path.join(root, 'input'), destination = path.join(root, 'output');
  await fs.mkdir(folder); await fs.mkdir(destination);
  await fs.writeFile(path.join(folder, 'synthetic.txt'), '项目编号 synthetic-project');
  let extracts = 0, deliveries = 0, modelCalls = 0, released = 0;
  const target = { studentId: source.studentId, type: 'project', id: 'synthetic-project' };
  const engine = createSmartInbox({ directory: path.join(root, 'inbox'), stableAgeMs: 0,
    forbiddenRoots: () => [destination], automaticAllowed: () => true,
    acquire: () => () => { released++; }, beginBatch: host.beginBatch, endBatch: host.endBatch,
    context: async () => ({ studentId: source.studentId, projects: [{ id: target.id, categories: [] }] }),
    validateTarget: async () => ({}),
    extract: async () => {
      assert.equal(host.disk().tasks.at(-1).status, 'running', 'must be durably running before reading content');
      extracts++; return { text: '项目编号 synthetic-project', warnings: [] };
    },
    classify: async () => { modelCalls++; return { candidates: [{ ...target, categoryId: '', score: .98, evidence: 'synthetic-project', reason: 'synthetic project ID' }], sensitive: false, conflict: false, reason: '' }; },
    deliver: async (snapshot, _, item, checkpoint) => {
      deliveries++; const file = path.join(destination, 'synthetic.txt');
      await checkpoint({ destinationPath: file }); await fs.copyFile(snapshot, file);
      return { ok: true, path: file, recordId: item.operationId };
    },
  });
  t.after(() => engine.close());
  const s = await engine.updateSource({ folder, name: 'Synthetic', enabled: true, automatic: true,
    studentId: bound ? source.studentId : '', target: bound ? target : null });
  await engine.requestScan(s.id); await engine.tick();
  const rows = await engine.list({ status: bound ? 'delivered' : 'pending' });
  assert.equal(rows.total, 1); assert.equal(rows.rows[0].status, bound ? 'delivered' : 'review');
  assert.equal(host.disk().tasks[0].status, 'succeeded');
  assert.equal(extracts, bound ? 1 : 0); assert.equal(deliveries, bound ? 1 : 0); assert.equal(modelCalls, 0);
  await engine.requestScan(s.id); await engine.tick();
  assert.equal(host.disk().tasks.length, 1); assert.equal(released, 1);
  assert.equal(await fs.readFile(path.join(folder, 'synthetic.txt'), 'utf8'), '项目编号 synthetic-project');
  if (!bound) {
    const row = (await engine.list()).rows[0];
    const result = await engine.decide({ requestId: 'confirm-then-analyze', action: 'confirm_student', items: [{ id: row.id, revision: row.revision, studentId: source.studentId }] });
    assert.equal(result.results[0].ok, true); await engine.tick();
    assert.equal((await engine.list({ status: 'delivered' })).total, 1);
    assert.equal(host.disk().tasks.length, 2); assert.ok(host.disk().tasks.every(t => t.status === 'succeeded'));
    assert.equal(modelCalls, 1); assert.equal(deliveries, 1);
  }
});
