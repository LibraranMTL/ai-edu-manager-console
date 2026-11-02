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
  t.cleanupTasks=[];
  t.after(async () => { for(const close of t.cleanupTasks)await close(); await fs.rm(root, { recursive: true, force: true }); });
  return path.join(root, 'tasks.json');
}
function snapshot(service, file) { const got = service.read(file); return service.track(got.value, got.revision); }
test('real Worker serializes ledger and events; repeated callers do not lose tasks', async t => {
  const file = await fixture(t), client = createTaskIoClient(); t.cleanupTasks.push(() => client.close());
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
  const file = await fixture(t), writer = createTaskStoreWriter(); t.cleanupTasks.push(()=>writer.close());
  const service = createTaskStoreService({ request: (...args) => writer.request(...args) });
  await service.initialize(file);
  const old = snapshot(service, file), current = snapshot(service, file);
  current.tasks.push({ id: 'a' }); service.write(file, current, current); current.tasks[0].id = 'not-saved';
  assert.throws(() => service.write(file, old, old), { code: 'TASK_STORE_CONFLICT' });
  await service.flush();
  const reopened = createTaskStateStore({ legacyPath: file }); reopened.open();
  assert.equal(reopened.readTasks().tasks[0].id, 'a'); reopened.close();
});
test('disk failure latches service and prevents downstream writes and dispatch barrier', async t => {
  const file = await fixture(t); await fs.writeFile(file, JSON.stringify({ tasks: [], history: [] })); let writes = 0, faults = 0;
  const writer = createTaskStoreWriter({ createStore: () => ({ dbPath: file, open() {}, info: () => ({ok:true,revision:0,value:{tasks:[],history:[]}}), readTasks:()=>({ok:true,tasks:[]}),
    applyDelta() { writes++; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); }, applyProgress: () => 0,
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
  const writer = createTaskStoreWriter(); t.cleanupTasks.push(()=>writer.close()); await writer.request(file,'store_open');
  await fs.writeFile(file, JSON.stringify({ tasks: [{ id:'external-change-longer' }] }));
  await writer.request(file,'store_delta',{ upserts:[{ id:'database-only', status:'pending' }] });
  await assert.rejects(writer.request(file,'store_write',{}), {code:'task_full_snapshot_write_forbidden'});
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).tasks[0].id, 'external-change-longer');
  const backupDir = path.join(path.dirname(file),'migration-backups');
  const backup = path.join(backupDir, (await fs.readdir(backupDir)).find(name => /^tasks-before-sqlite-.*\.json$/.test(name)));
  assert.equal(JSON.parse(await fs.readFile(backup,'utf8')).tasks[0].id, 'original');
  const corrupt = path.join(path.dirname(file), 'corrupt', 'tasks.json');
  await fs.mkdir(path.dirname(corrupt), { recursive: true }); await fs.writeFile(corrupt,'{bad');
  await assert.rejects(createTaskStoreWriter().request(corrupt,'store_open'));
  assert.equal(await fs.readFile(corrupt,'utf8'),'{bad');
});

test('deep Windows task paths migrate once without leaving zero-byte backup attempts', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-deep-task-'));
  let directory = base;
  while (path.join(directory, 'migration-backups', `task-state-v1-${Date.now()}-00000000-0000-0000-0000-000000000000.sqlite3`).length < 258) {
    directory = path.join(directory, 'deep-task-storage');
  }
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'tasks.json');
  await fs.writeFile(file, JSON.stringify({ tasks: [{ id: 'deep', status: 'pending', kind: 'student_digest', automaticExecution: true }], history: [] }));
  t.after(async () => fs.rm(base, { recursive: true, force: true }));

  const store = createTaskStateStore({ legacyPath: file });
  assert.doesNotThrow(() => store.open());
  store.close();
  const database = new DatabaseSync(databasePathForLegacy(file), { readOnly: true });
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 5);
  database.close();
  const backups = await fs.readdir(path.join(directory, 'migration-backups'));
  const sqliteBackups = backups.filter(name => /^v[1-4]-[a-z0-9]+-[a-f0-9]{8}\.db$/.test(name));
  assert.equal(sqliteBackups.length, 4);
  for (const name of sqliteBackups) {
    const stat = await fs.stat(path.join(directory, 'migration-backups', name));
    assert.ok(stat.size > 0, `${name} must be a complete SQLite snapshot`);
  }
});
test('initial legacy migration uses a compact temporary database beside a deep task path', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-deep-initial-task-'));
  let directory = base;
  const legacyTemporaryName = `task-state.sqlite3.${'0'.repeat(36)}.migrating`;
  while (path.join(directory, legacyTemporaryName).length <= 265) {
    directory = path.join(directory, 'deep-initial-storage');
  }
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'tasks.json');
  const databasePath = databasePathForLegacy(file);
  assert.ok(databasePath.length < 245, 'the authoritative database itself must remain a valid Windows path');
  assert.ok(path.join(directory, legacyTemporaryName).length > 260,
    'the historical UUID temporary name must reproduce the Windows failure');
  await fs.writeFile(file, JSON.stringify({ tasks: [{ id: 'initial-deep', status: 'pending' }], history: [] }));
  t.after(async () => fs.rm(base, { recursive: true, force: true }));

  const store = createTaskStateStore({ legacyPath: file });
  assert.doesNotThrow(() => store.open());
  store.close();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(Number(database.prepare('SELECT COUNT(*) count FROM tasks').get().count), 1);
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 5);
  database.close();
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.endsWith('.migrating')), []);
});
test('Worker transport rejects when closed; cannot fall back to main-process writer', async () => {
  const client = createTaskIoClient(); client.close();
  await assert.rejects(client.request('unused','store_write',{}),/关闭/);
});

test('heartbeats update one SQLite row without rewriting the legacy task ledger', async t => {
  const file = await fixture(t); await fs.writeFile(file, JSON.stringify({ tasks: [], history: [] }));
  const writer = createTaskStoreWriter(); t.cleanupTasks.push(()=>writer.close());
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
  const reopened = createTaskStoreWriter(); t.cleanupTasks.push(()=>reopened.close());
  await reopened.request(file, 'store_open');
  const opened = await reopened.request(file, 'records');
  assert.equal(opened.tasks[0].lastHeartbeatAt, 'after');
  assert.equal(service.writeProgress(file, [{ taskId: 'running', executionId: 'run-1', lastHeartbeatAt: 'after-2',
    status: 'succeeded', title: 'must-not-change' }]).accepted, 1);
  await service.flush();
  const guarded = service.read(file).value.tasks[0];
  assert.equal(guarded.lastHeartbeatAt, 'after-2');
  assert.equal(guarded.status, 'running');
  assert.equal(guarded.title, undefined);
  const current = snapshot(service, file); current.tasks[0].status = 'succeeded';
  service.write(file, current, current); await service.flush();
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).tasks.length, 0);
});

test('heartbeat interleaving rejects stale drafts and cannot overwrite a terminal task', async t => {
  const file = await fixture(t);
  const writer = createTaskStoreWriter(); t.cleanupTasks.push(() => writer.close());
  const service = createTaskStoreService({ request: (...args) => writer.request(...args) });
  await service.initialize(file);
  const initial = snapshot(service, file);
  initial.tasks.push({ id: 'interleaved', status: 'running', executionId: 'exec-1',
    lastHeartbeatAt: 'before' });
  service.write(file, initial, initial); await service.flush();

  const stale = snapshot(service, file);
  assert.equal(service.writeProgress(file, [{ taskId: 'interleaved', executionId: 'exec-1',
    lastHeartbeatAt: 'valid-heartbeat' }]).accepted, 1);
  stale.tasks[0].status = 'succeeded';
  assert.throws(() => service.write(file, stale, stale), { code: 'TASK_STORE_CONFLICT' });

  const fresh = snapshot(service, file);
  fresh.tasks[0].status = 'succeeded';
  fresh.tasks[0].completedAt = 'settled';
  service.write(file, fresh, fresh); await service.flush();
  assert.equal(service.writeProgress(file, [{ taskId: 'interleaved', executionId: 'exec-1',
    lastHeartbeatAt: 'late-heartbeat' }]).accepted, 0);
  await service.flush();

  const reopened = createTaskStoreWriter(); t.cleanupTasks.push(() => reopened.close());
  await reopened.request(file, 'store_open');
  const persisted = (await reopened.request(file, 'records')).tasks[0];
  assert.equal(persisted.status, 'succeeded');
  assert.equal(persisted.executionId, 'exec-1');
  assert.equal(persisted.lastHeartbeatAt, 'valid-heartbeat');
  assert.equal(persisted.completedAt, 'settled');
});
