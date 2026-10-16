const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createTaskStoreWriter } = require('../electron/task-store-writer.cjs');
const { createTaskStoreService } = require('../electron/task-store-service.cjs');
const { createTaskIoClient } = require('../electron/task-io-client.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-writer-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, 'tasks.json');
}
function snapshot(service, file) { const got = service.read(file); return service.track(got.value, got.revision); }
test('real Worker serializes ledger and events; repeated callers do not lose tasks', async t => {
  const file = await fixture(t), client = createTaskIoClient(); t.after(() => client.close());
  const service = createTaskStoreService({ request: (...args) => client.request(...args) });
  await service.initialize(file);
  for (let i = 0; i < 40; i++) {
    const s = snapshot(service, file); s.tasks.push({ id: `t${i}`, status: 'pending' });
    service.write(file, s, s); service.appendEvent({ id: `e${i}` });
  }
  await service.flush();
  assert.equal(service.pending(), false);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).tasks.length, 40);
  assert.equal((await fs.readFile(path.join(path.dirname(file), 'events.jsonl'), 'utf8')).trim().split('\n').length, 40);
  assert.equal((await client.request(file, 'list', {})).ready, true);
});
test('caller mutation after enqueue cannot change persisted bytes; stale revision rejects', async t => {
  const file = await fixture(t), writer = createTaskStoreWriter();
  const service = createTaskStoreService({ request: (...args) => writer.request(...args) });
  await service.initialize(file);
  const old = snapshot(service, file), current = snapshot(service, file);
  current.tasks.push({ id: 'a' }); service.write(file, current, current); current.tasks[0].id = 'not-saved';
  assert.throws(() => service.write(file, old, old), { code: 'TASK_STORE_CONFLICT' });
  await service.flush(); assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).tasks[0].id, 'a');
});
test('disk failure latches service and prevents downstream writes and dispatch barrier', async t => {
  const file = await fixture(t); let opens = 0, faults = 0;
  const writer = createTaskStoreWriter({ io: { ...fs, open: async () => { opens++; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } } });
  const service = createTaskStoreService({ request: (...args) => writer.request(...args), onFault: () => faults++ });
  await service.initialize(file);
  for (let i = 0; i < 3; i++) { const s = snapshot(service, file); s.tasks.push({ id: `${i}` }); service.write(file,s,s); }
  let dispatched = false;
  await assert.rejects(service.flush().then(() => { dispatched = true; }), /disk full|暂停/);
  assert.equal(dispatched, false); assert.equal(opens,1); assert.equal(faults,1);
  assert.throws(() => service.read(file), /暂停/);
});
test('external edit and corrupt startup never replaced; backup is immutable', async t => {
  const file = await fixture(t); await fs.writeFile(file, JSON.stringify({ tasks: [{ id:'original' }] }));
  const writer = createTaskStoreWriter(); await writer.request(file,'store_open');
  await fs.writeFile(file, JSON.stringify({ tasks: [{ id:'external-change-longer' }] }));
  await assert.rejects(writer.request(file,'store_write',{ revision:1, value:{tasks:[]} }), /外部变化/);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).tasks[0].id, 'external-change-longer');
  const backup = path.join(path.dirname(file),'migration-backups','tasks-before-async-writer.json');
  assert.equal(JSON.parse(await fs.readFile(backup,'utf8')).tasks[0].id, 'original');
  await fs.writeFile(file,'{bad');
  await assert.rejects(createTaskStoreWriter().request(file,'store_open'));
  assert.equal(await fs.readFile(file,'utf8'),'{bad');
});
test('Worker transport rejects when closed; cannot fall back to main-process writer', async () => {
  const client = createTaskIoClient(); client.close();
  await assert.rejects(client.request('unused','store_write',{}),/关闭/);
});

test('heartbeats append a compact journal and replay without rewriting the task ledger', async t => {
  const file = await fixture(t), writer = createTaskStoreWriter();
  const service = createTaskStoreService({ request: (...args) => writer.request(...args) });
  await service.initialize(file);
  const initial = snapshot(service, file);
  initial.tasks.push({ id: 'running', status: 'running', executionId: 'run-1', lastHeartbeatAt: 'before' });
  service.write(file, initial, initial); await service.flush();
  const before = await fs.stat(file);
  assert.equal(service.writeProgress(file, [{ taskId: 'running', executionId: 'run-1', lastHeartbeatAt: 'after' }]).accepted, 1);
  await service.flush();
  const after = await fs.stat(file);
  assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(service.read(file).value.tasks[0].lastHeartbeatAt, 'after');
  const journal = await fs.readFile(path.join(path.dirname(file), 'progress.jsonl'), 'utf8');
  assert.match(journal, /"executionId":"run-1"/);
  const reopened = createTaskStoreWriter();
  const opened = await reopened.request(file, 'store_open');
  assert.equal(opened.value.tasks[0].lastHeartbeatAt, 'after');
  const current = snapshot(service, file); current.tasks[0].status = 'succeeded';
  service.write(file, current, current); await service.flush();
  await assert.rejects(fs.stat(path.join(path.dirname(file), 'progress.jsonl')), { code: 'ENOENT' });
});
