const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createTaskStoreWriter } = require('../electron/task-store-writer.cjs');
const { createTaskStateStore, databasePathForLegacy } = require('../electron/task-state-store.cjs');
const { DatabaseSync } = require('node:sqlite');
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
  const db = new DatabaseSync(databasePathForLegacy(file), { readOnly: true });
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM tasks').get().count), 40);
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM task_events').get().count), 40);
  db.close();
  assert.equal((await client.request(file, 'list', {})).ready, true);
});
test('caller mutation after enqueue cannot change persisted bytes; stale revision rejects', async t => {
  const file = await fixture(t), writer = createTaskStoreWriter();
  const service = createTaskStoreService({ request: (...args) => writer.request(...args) });
  await service.initialize(file);
  const old = snapshot(service, file), current = snapshot(service, file);
  current.tasks.push({ id: 'a' }); service.write(file, current, current); current.tasks[0].id = 'not-saved';
  assert.throws(() => service.write(file, old, old), { code: 'TASK_STORE_CONFLICT' });
  await service.flush();
  const reopened = createTaskStateStore({ legacyPath: file }); reopened.open();
  assert.equal(reopened.value().tasks[0].id, 'a'); reopened.close();
});
test('disk failure latches service and prevents downstream writes and dispatch barrier', async t => {
  const file = await fixture(t); await fs.writeFile(file, JSON.stringify({ tasks: [], history: [] })); let writes = 0, faults = 0;
  const writer = createTaskStoreWriter({ createStore: () => ({ dbPath: file, open() {}, value: () => ({ tasks: [], history: [] }),
    writeSnapshot() { writes++; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); }, applyProgress: () => 0,
    appendEvent() {}, release() {}, close() {} }) });
  const service = createTaskStoreService({ request: (...args) => writer.request(...args), onFault: () => faults++ });
  await service.initialize(file);
  for (let i = 0; i < 3; i++) { const s = snapshot(service, file); s.tasks.push({ id: `${i}` }); service.write(file,s,s); }
  let dispatched = false;
  await assert.rejects(service.flush().then(() => { dispatched = true; }), /disk full|暂停/);
  assert.equal(dispatched, false); assert.equal(writes,1); assert.equal(faults,1);
  assert.throws(() => service.read(file), /暂停/);
});
test('legacy input becomes immutable after atomic migration and corrupt input is rejected', async t => {
  const file = await fixture(t); await fs.writeFile(file, JSON.stringify({ tasks: [{ id:'original' }] }));
  const writer = createTaskStoreWriter(); await writer.request(file,'store_open');
  await fs.writeFile(file, JSON.stringify({ tasks: [{ id:'external-change-longer' }] }));
  await writer.request(file,'store_write',{ revision:1, value:{tasks:[{ id:'database-only', status:'pending' }], history:[]} });
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).tasks[0].id, 'external-change-longer');
  const backupDir = path.join(path.dirname(file),'migration-backups');
  const backup = path.join(backupDir, (await fs.readdir(backupDir)).find(name => /^tasks-before-sqlite-.*\.json$/.test(name)));
  assert.equal(JSON.parse(await fs.readFile(backup,'utf8')).tasks[0].id, 'original');
  const corrupt = path.join(path.dirname(file), 'corrupt', 'tasks.json');
  await fs.mkdir(path.dirname(corrupt), { recursive: true }); await fs.writeFile(corrupt,'{bad');
  await assert.rejects(createTaskStoreWriter().request(corrupt,'store_open'));
  assert.equal(await fs.readFile(corrupt,'utf8'),'{bad');
});
test('Worker transport rejects when closed; cannot fall back to main-process writer', async () => {
  const client = createTaskIoClient(); client.close();
  await assert.rejects(client.request('unused','store_write',{}),/关闭/);
});

test('heartbeats update one SQLite row without rewriting the legacy task ledger', async t => {
  const file = await fixture(t); await fs.writeFile(file, JSON.stringify({ tasks: [], history: [] }));
  const writer = createTaskStoreWriter();
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
  const reopened = createTaskStoreWriter();
  const opened = await reopened.request(file, 'store_open');
  assert.equal(opened.value.tasks[0].lastHeartbeatAt, 'after');
  const current = snapshot(service, file); current.tasks[0].status = 'succeeded';
  service.write(file, current, current); await service.flush();
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).tasks.length, 0);
});
