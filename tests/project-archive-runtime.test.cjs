const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createProjectArchiveRuntime, createArchiveIpcGate } = require('../electron/project-archive-runtime.cjs');
const { createProjectArchiveTransactions } = require('../electron/project-archive-transaction.cjs');
const { createProjectArchiveStartup } = require('../electron/project-archive-startup.cjs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createPromotionContext } = require('./fixtures/project-promotion-runtime.cjs');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function extract(name) { const start = new RegExp(`(?:async )?function ${name}\\(`).exec(main).index; return main.slice(start, main.indexOf('\n}', start) + 2); }
function bind(scope, name) { scope[name] = Function('scope', `with (scope) { return (${extract(name)}); }`)(scope); }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function block(runtime, file) {
  await assert.rejects(runtime.run(async () => {
    runtime.markPrepared({ id: 'synthetic', projectId: 'p1' }, [{ path: file }]); throw new Error('synthetic stop');
  }), /synthetic stop/);
}
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-archive-runtime-'));
  t.after(async () => {
    assert.equal(path.dirname(root), await fsp.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-archive-runtime-'));
    await fsp.rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'projects.json'); fs.writeFileSync(file, JSON.stringify([{ id: 'p1' }]));
  return { root, file };
}

test('commit owner can access targets; concurrent callers and stale asynchronous capabilities cannot', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); const hold = deferred(), entered = deferred(), stale = deferred(); let staleCheck;
  const running = runtime.run(async () => {
    runtime.markPrepared({ id: 't1', projectId: 'p1' }, [{ path: f.file }]); runtime.assertFile(f.file);
    staleCheck = stale.promise.then(() => runtime.assertAccess());
    entered.resolve(); await hold.promise;
  });
  await entered.promise; assert.equal(runtime.status().phase, 'committing');
  assert.throws(() => runtime.assertAccess(), { code: 'archive_busy' }); assert.throws(() => runtime.assertFile(f.file), { code: 'archive_busy' });
  runtime.assertFile(path.join(f.root, 'tasks.json'));
  hold.resolve(); await running; assert.equal(runtime.status().ready, true);
  const later = deferred(), laterEntered = deferred(); const second = runtime.run(async () => { laterEntered.resolve(); await later.promise; });
  await laterEntered.promise; stale.resolve(); await assert.rejects(staleCheck, { code: 'archive_busy' });
  later.resolve(); await second;
});

test('failed preparation blocks business until verified recovery, but validation before preparation does not lock the app', async (t) => {
  const f = await fixture(t); let notices = 0, denied = false; let runtime;
  runtime = createProjectArchiveRuntime({ onBlocked: () => { notices++; try { runtime.assertAccess(); } catch { denied = true; } } });
  await assert.rejects(runtime.run(async () => { throw new Error('before staging'); })); assert.equal(runtime.status().ready, true);
  await block(runtime, f.file); assert.equal(runtime.status().phase, 'blocked'); assert.equal(notices, 1); assert.equal(denied, true);
  await assert.rejects(runtime.run(async () => {}), { code: 'archive_recovery_required' });
  await runtime.recover(async () => { runtime.assertFile(f.file); return { ready: false, issues: [{ message: 'still conflict' }] }; });
  assert.equal(runtime.status().ready, false);
  await runtime.recover(async () => { runtime.assertAccess(); return { ready: true }; }); assert.equal(runtime.status().ready, true);
});

test('registered native transaction interruption stays isolated, then same journal resumes without app restart', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime();
  const directory = path.join(f.root, 'manager', 'project-materials', 'archive-transactions');
  let fail = true;
  const manager = createProjectArchiveStartup({ catalogPath: path.join(f.root, 'catalog.json'), projectsPath: f.file, diagnosticPath: path.join(f.root, 'diagnostic.json'),
    recover: async (entry) => transactions().resume(entry.id) });
  const transactions = () => createProjectArchiveTransactions({ directory, projectId: 'p1', roots: [f.root], authorize: async () => true,
    runExclusive: runtime.run, registerPrepared: async (entry, entries) => { runtime.markPrepared(entry, entries); await manager.register(entry); },
    hooks: { afterFilesWritten: () => { if (fail) throw new Error('native interrupted'); } } });
  const transaction = transactions().begin(); transaction.io.writeFileSync(f.file, JSON.stringify([{ id: 'p1', archived: true }]));
  await assert.rejects(transaction.commit({ ok: true }), /native interrupted/); assert.equal(runtime.status().phase, 'blocked');
  assert.throws(() => runtime.assertFile(f.file), { code: 'archive_recovery_required' });
  fail = false; const result = await runtime.recover(() => manager.initialize());
  assert.equal(result.ready, true, JSON.stringify(result.issues)); assert.equal(runtime.status().ready, true);
  assert.equal(JSON.parse(fs.readFileSync(f.file))[0].archived, true);
});

test('actual shared readers and atomic writer reject protected data rather than swallowing busy state as empty data', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); await block(runtime, f.file);
  const scope = { fs, projectArchiveRuntime: runtime, projectsPath: () => f.file, projectDatabasePath: () => f.file, assetIndexPath: () => f.file,
    assertProjectStateReady() {}, projectStateStore: () => ({ readAll: () => JSON.parse(fs.readFileSync(f.file)) }),
    parseJsonText: JSON.parse, writeJsonAtomicUnchecked: (file, value) => fs.writeFileSync(file, JSON.stringify(value)) };
  for (const name of ['readProjects', 'readAssetIndex', 'safeReadJson', 'readJsonFile', 'readSmallTextFile', 'writeJsonAtomic']) bind(scope, name);
  for (const read of [() => scope.readProjects(), () => scope.readAssetIndex(), () => scope.safeReadJson(f.file, {}), () => scope.readJsonFile(f.file, {}), () => scope.readSmallTextFile(f.file)]) {
    assert.throws(read, { code: 'archive_recovery_required' });
  }
  assert.throws(() => scope.writeJsonAtomic(f.file, []), { code: 'archive_recovery_required' });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), [{ id: 'p1' }]);
  await runtime.recover(async () => { assert.deepEqual(scope.readProjects(), [{ id: 'p1' }]); return { ready: true }; });
});

test('legacy asset reader treats only an absent index as empty and never rewrites corrupt contents', async (t) => {
  const f = await fixture(t);
  const assetFile = path.join(f.root, 'asset-index.json');
  const scope = { fs, projectArchiveRuntime: { assertFile() {} }, assetIndexPath: () => assetFile };
  bind(scope, 'readAssetIndex');
  assert.deepEqual(scope.readAssetIndex(), []);
  fs.writeFileSync(assetFile, '{broken');
  assert.throws(() => scope.readAssetIndex(), SyntaxError);
  assert.equal(fs.readFileSync(assetFile, 'utf8'), '{broken');
  fs.writeFileSync(assetFile, JSON.stringify({ assets: {} }));
  assert.throws(() => scope.readAssetIndex(), /资产索引结构损坏/);
  assert.deepEqual(JSON.parse(fs.readFileSync(assetFile, 'utf8')), { assets: {} });
});

test('all registered synchronous/asynchronous IPC handlers gate business calls while explicit recovery channels stay callable', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); const handles = new Map(), listeners = new Map(); let calls = 0;
  const ipc = createArchiveIpcGate({ handle: (channel, fn) => handles.set(channel, fn), on: (channel, fn) => listeners.set(channel, fn) }, runtime, { exempt: ['recovery'] });
  ipc.handle('business', () => { calls++; return 'business'; }); ipc.on('sync', (event) => { calls++; event.returnValue = 'sync'; });
  ipc.handle('recovery', () => 'status'); await block(runtime, f.file);
  assert.equal(JSON.parse(await handles.get('business')({})).code, 'archive_recovery_required');
  const event = {}; listeners.get('sync')(event); assert.equal(JSON.parse(event.returnValue).code, 'archive_recovery_required');
  assert.equal(handles.get('recovery')({}), 'status'); assert.equal(calls, 0);
  await runtime.recover(async () => ({ ready: true })); assert.equal(handles.get('business')({}), 'business');
});

test('actual HTTP handler returns 503 before any private route while OPTIONS stays harmless', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); await block(runtime, f.file); const replies = [];
  const scope = { projectArchiveRuntime: runtime, sendJson: (_response, status, body) => replies.push({ status, body }) };
  bind(scope, 'handleHostRequest');
  scope.handleHostRequest({ method: 'POST', url: '/api/projects/p1/materials' }, {});
  assert.equal(replies[0].status, 503); assert.equal(replies[0].body.code, 'archive_recovery_required');
  scope.handleHostRequest({ method: 'OPTIONS' }, {}); assert.equal(replies[1].status, 200);
});

test('actual native recovery dialog can defer, then recover in place without removing protection early', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); await block(runtime, f.file); const hold = deferred(); let choice = 3;
  const scope = { projectArchiveRuntime: runtime, projectArchiveRecoveryDialogPending: false,
    projectArchiveStartupManager: () => ({ initialize: () => hold.promise }),
    dialog: { showMessageBox: async () => ({ response: choice }) }, projectDigestLookupCache: {}, scheduleGrowthRefresh() {}, notify() {} };
  bind(scope, 'showProjectArchiveRecoveryDialog');
  assert.equal((await scope.showProjectArchiveRecoveryDialog()).code, 'archive_recovery_required'); assert.equal(runtime.status().phase, 'blocked');
  choice = 0; const pending = scope.showProjectArchiveRecoveryDialog(); await tick(); assert.equal(runtime.status().phase, 'recovering');
  assert.equal((await scope.showProjectArchiveRecoveryDialog()).code, 'archive_busy');
  assert.throws(() => runtime.assertAccess(), { code: 'archive_busy' }); hold.resolve({ ready: true, recovered: ['t1'] });
  assert.equal((await pending).ok, true); assert.equal(runtime.status().ready, true);
});

test('actual recovery IPC plus preload reject other windows and child frames even on exempt channels', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); await block(runtime, f.file);
  const handles = new Map(); const webContents = { mainFrame: {} }; let opened = 0; let event = { sender: {}, senderFrame: {} };
  const scope = { projectArchiveRuntime: runtime, mainWindow: { isDestroyed: () => false, webContents },
    showProjectArchiveRecoveryDialog: async () => { opened++; return { ok: true }; },
    ipcMain: createArchiveIpcGate({ handle: (channel, fn) => handles.set(channel, fn) }, runtime,
      { exempt: ['bridge:getProjectArchiveRecoveryStatus', 'bridge:recoverProjectArchiveRuntime'] }) };
  bind(scope, 'projectArchiveRecoveryCallerAllowed');
  const start = main.indexOf("ipcMain.handle('bridge:getProjectArchiveRecoveryStatus'");
  const end = main.indexOf("ipcMain.handle('bridge:copyText'", start);
  Function('scope', `with (scope) { ${main.slice(start, end)} }`)(scope);
  let bridge; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), { require: () => ({
    contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } }, ipcRenderer: { invoke: (channel) => handles.get(channel)(event) },
  }) });
  assert.equal(JSON.parse(await bridge.recoverProjectArchiveRuntime()).code, 'forbidden');
  event = { sender: webContents, senderFrame: {} }; assert.equal(JSON.parse(await bridge.getProjectArchiveRecoveryStatus()).code, 'forbidden');
  event = { sender: webContents, senderFrame: webContents.mainFrame };
  assert.equal(JSON.parse(await bridge.getProjectArchiveRecoveryStatus()).phase, 'blocked');
  assert.equal(JSON.parse(await bridge.recoverProjectArchiveRuntime()).ok, true); assert.equal(opened, 1);
});

test('actual background scheduler entry points skip without claiming tasks while archive is blocked', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); await block(runtime, f.file);
  const scope = { projectArchiveRuntime: runtime, executionPlaneReadyAt: 0 };
  for (const name of ['runUnifiedTaskScheduler', 'runGrowthRefreshQueue', 'processDirectDeliveryQueue', 'publishStudentArchiveSync']) { bind(scope, name); assert.equal((await scope[name]()).reason, 'archive_busy'); }
  bind(scope, 'refreshStudentArchiveSyncWatchers'); assert.equal(scope.refreshStudentArchiveSyncWatchers(), undefined);
});

test('actual host archive gates shared data after failure and its recovery context resumes the original transaction', async (t) => {
  const f = await fixture(t);
  f.project = { id: 'p1', name: 'Synthetic', storageName: 'synthetic', status: 'active', materialStorageMode: 'workspace-v1', studentIds: ['s1'], studentEvidence: [],
    managerPath: path.join(f.root, 'manager'), workspacePath: path.join(f.root, 'workspace'), rawPath: path.join(f.root, 'legacy'), knowledgeRootPath: path.join(f.root, 'knowledge') };
  for (const [field, dir] of Object.entries({ summaryPath: '摘要库', conceptPath: '概念库', entityPath: '实体库', contributionPath: '知识贡献' })) f.project[field] = path.join(f.project.knowledgeRootPath, dir);
  f.project.promotionPath = path.join(f.project.contributionPath, 'promotion.md');
  f.student = { id: 's1', name: 'Synthetic', rootPath: path.join(f.root, 'student'), rawPath: path.join(f.root, 'student/raw'), summaryPath: path.join(f.root, 'student/summary') };
  await fsp.mkdir(f.project.workspacePath); await fsp.mkdir(f.project.contributionPath, { recursive: true });
  fs.writeFileSync(path.join(f.project.workspacePath, 'test.txt'), 'synthetic input');
  const host = createProjectMaterialHost(f.project);
  await host.store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: 'test.txt' } }]);
  const runtime = createProjectArchiveRuntime();
  const main = createPromotionContext(f, { projectArchiveRuntime: runtime,
    createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options, hooks: { afterFilesWritten: () => { throw new Error('runtime archive failure'); } } }) });
  bind(main.context, 'readProjects');
  const input = { items: JSON.parse(main.context.projectPromotionPlan('p1')).items.filter((item) => item.kind === 'file').map((item) => ({ ...item, action: 'absorb' })) };
  const failed = await main.execute(input); assert.equal(failed.ok, false); assert.equal(runtime.status().phase, 'blocked');
  assert.throws(() => main.context.readProjects(), { code: 'archive_recovery_required' });
  assert.throws(() => main.context.readAssetIndex(), { code: 'archive_recovery_required' });
  main.context.createProjectArchiveTransactions = createProjectArchiveTransactions;
  let result;
  const ready = await runtime.recover(async () => { result = await main.execute(input); return { ready: result.ok, issues: result.ok ? [] : [{ message: result.message }] }; });
  assert.equal(ready.ready, true, result.message); assert.equal(result.recovered, true);
  assert.equal(main.context.readProjects()[0].status, 'archived'); assert.equal(main.assets.length, 1); assert.equal(main.runs.length, 1);
});

test('notification failure after successful runtime recovery does not report the durable operation as failed', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); await block(runtime, f.file);
  const scope = { projectArchiveRuntime: runtime, projectArchiveRecoveryDialogPending: false, projectDigestLookupCache: {},
    projectArchiveStartupManager: () => ({ initialize: async () => ({ ready: true, recovered: ['t1'] }) }),
    dialog: { showMessageBox: async () => ({ response: 0 }) }, scheduleGrowthRefresh: () => { throw new Error('notification unavailable'); } };
  bind(scope, 'showProjectArchiveRecoveryDialog'); const result = await scope.showProjectArchiveRecoveryDialog();
  assert.equal(result.ok, true); assert.match(result.notificationWarning, /notification unavailable/); assert.equal(runtime.status().ready, true);
});

test('actual runtime dialog routes explicit cancellation and reports cancellation rather than archive success', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); await block(runtime, f.file);
  const messages = []; let requested;
  const scope = { projectArchiveRuntime: runtime, projectArchiveRecoveryDialogPending: false, projectDigestLookupCache: {},
    projectArchiveStartupManager: () => ({ initialize: async (options) => { requested = options; return { ready: true, recovered: ['committed1'], abandoned: ['t1'] }; } }),
    dialog: { showMessageBox: async (options) => { messages.push(options); return { response: 1 }; } }, scheduleGrowthRefresh() {}, notify() {} };
  bind(scope, 'showProjectArchiveRecoveryDialog');
  const result = await scope.showProjectArchiveRecoveryDialog(); assert.equal(result.ok, true);
  assert.deepEqual(result.abandoned, ['t1']); assert.deepEqual(result.recovered, ['committed1']);
  assert.deepEqual(requested, { abandonUnwritten: true }); assert.match(messages[1].detail, /已取消未写入操作 1 项/);
  assert.match(messages[1].detail, /核对提交回执 1 项/);
  assert.equal(runtime.status().ready, true); assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), [{ id: 'p1' }]);
});

test('student archive watcher defers publication during recovery and retains the original student for retry', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); await block(runtime, f.file);
  const timers = []; const published = [];
  const scope = { projectArchiveRuntime: runtime, studentArchiveSyncTimers: new Map(),
    resourceCoordinator: { run: (_resources, work) => Promise.resolve().then(work) },
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; }, clearTimeout() {},
    publishStudentArchiveSync: (studentId) => published.push(studentId), appendHostTimeline: () => { throw new Error('busy must not become sync failure'); } };
  bind(scope, 'scheduleStudentArchiveSync'); scope.scheduleStudentArchiveSync('s-original', 1000);
  timers[0].callback(); assert.equal(timers.length, 2); assert.equal(timers[1].delay, 30000); assert.deepEqual(published, []);
  assert.equal(scope.studentArchiveSyncTimers.get('s-original'), timers[1]);
  await runtime.recover(async () => ({ ready: true })); timers[1].callback();
  await tick();
  assert.deepEqual(published, ['s-original']); assert.equal(scope.studentArchiveSyncTimers.size, 0);
});

test('growth fallback timer does not read protected refresh state until runtime readiness returns', async (t) => {
  const f = await fixture(t); const runtime = createProjectArchiveRuntime(); let callback; let reads = 0, runs = 0;
  const scope = { projectArchiveRuntime: runtime, process: { env: {} }, growthRefreshFallbackTimer: null,
    stopGrowthRefreshMonitor() {}, readGrowthRefreshState: () => { runtime.assertAccess(); reads++; return {}; }, dirtyStudentIds: () => [],
    scheduleGrowthRefresh() {}, runGrowthRefreshQueue: () => { runs++; }, setInterval: (fn) => { callback = fn; return {}; } };
  bind(scope, 'startGrowthRefreshMonitor'); scope.startGrowthRefreshMonitor(); assert.equal(reads, 1);
  await block(runtime, f.file); callback(); assert.equal(reads, 1); assert.equal(runs, 0);
  await runtime.recover(async () => ({ ready: true })); callback(); assert.equal(reads, 2);
});
