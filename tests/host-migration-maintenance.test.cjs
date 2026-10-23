const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createProjectArchiveRuntime, createArchiveIpcGate, createArchiveHttpGate } = require('../electron/project-archive-runtime.cjs');
const { createStudentPortableMigrationManager } = require('../electron/student-portable-migration.cjs');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(main).index;
  const code = main.slice(start, main.indexOf('\n}', start) + 2);
  scope[name] = Function('scope', `with (scope) { return (${code}); }`)(scope);
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise((resolve) => setImmediate(resolve));
class Response extends EventEmitter {
  end() { this.writableFinished = true; this.emit('finish'); }
  destroy() { this.destroyed = true; this.emit('close'); }
}
function hostScope(runtime) {
  const events = [];
  const scope = { fs, path, os, projectArchiveRuntime: runtime, activeCaptureRuntime: null, taskChildProcesses: new Map(), taskSchedulerRunning: false,
    digestWorkflowRunning: false, growthRefreshRunning: false, collaborationDirectDeliveryRunning: false,
    captureVisionRunning: false, captureTimelineScheduler: null, hostServer: null,
    taskStorePath: () => 'synthetic-tasks.json', taskDatabasePath: () => 'synthetic-missing-task-state.sqlite3',
    assetIndexPath: () => 'synthetic-assets.json', projectsPath: () => 'synthetic-projects.json',
    safeReadJson: (file) => file === 'synthetic-tasks.json' ? ({ tasks: [] })
      : file === 'synthetic-projects.json' ? [] : ({ assets: [] }),
    taskStoreGuard: { flush: async () => {} }, readTaskStore: () => ({ tasks: [], history: [], runtime: {}, deletedTasks: [] }),
    writeTaskStoreDurably: async () => {}, restoreTaskSnapshotEvents: () => {},
    stopHostDiscovery: () => events.push('stop-discovery'), stopStudentArchiveSyncWatchers: () => events.push('stop-watchers'),
    refreshStudentArchiveSyncWatchers: () => { assert.equal(runtime.status().ready, true); events.push('resume-watchers'); },
    startHostService: () => events.push('resume-server'), notify() {}, getHostServiceStatus: () => '{}',
    dialog: { showOpenDialog: async () => ({ filePaths: ['synthetic-destination'] }) }, mainWindow: {},
    app: { getPath: () => 'synthetic-userdata' }, APP_VERSION: '0.18.4', getHostIdentity: () => ({ displayName: 'Synthetic' }),
    emitHostMigrationProgress() {}, appendHostTimeline: (event) => events.push(event.type),
    hostMigrationSources: () => { assert.equal(runtime.status().phase, 'maintenance'); return { sources: [], external: [], requiredDirectories: [] }; },
    migrationStateVirtualFiles: () => { assert.equal(runtime.status().phase, 'maintenance'); return []; },
    assetStore: () => ({ backupTo: async (file) => fs.writeFileSync(file, 'synthetic sqlite snapshot'),
      importSnapshot: () => ({ assetCount: 0 }), replaceAll: () => {} }),
    projectStateStore: () => ({ backupTo: async (file) => fs.writeFileSync(file, 'synthetic project sqlite snapshot'), replaceAll: () => {} }),
    publicLicenseStatus: () => ({ maxActiveStudents: 1 }), courseCatalogStoreInstance: {}, platformCourseDraftStoreInstance: {}, licenseTrustStoreInstance: {},
    invalidateArchiveAccessCache: () => { assert.equal(runtime.status().phase, 'maintenance'); events.push('invalidate'); },
    recoverInterruptedMigrationStateInstalls: () => ({ ready: true, recovered: [], issues: [] }),
    readStudentsIndex: () => [], toHostStudent: (value) => value, readProjects: () => [], normalizeProject: (value) => value };
  for (const name of ['quiesceHostForMigration', 'resumeHostAfterMigration', 'withHostMigrationMaintenance', 'createHostMigrationPackage', 'restoreHostMigrationPackage']) bind(scope, name);
  return { scope, events };
}

test('IPC admission blocks maintenance while another request runs, allows the migration caller, and rejects new requests', async () => {
  const runtime = createProjectArchiveRuntime(), handlers = new Map(), hold = deferred(), entered = deferred();
  const ipc = createArchiveIpcGate({ handle: (channel, handler) => handlers.set(channel, handler) }, runtime,
    { exempt: ['status', 'license-write'], maintenanceExempt: ['status'] });
  ipc.handle('slow', () => hold.promise);
  ipc.handle('migration', () => runtime.maintenance(async () => { entered.resolve(); await hold.promise; return 'done'; }));
  ipc.handle('status', () => runtime.status()); ipc.handle('license-write', () => 'should-not-run');
  const slow = handlers.get('slow')({});
  await assert.rejects(runtime.maintenance(() => assert.fail('must not start')), { code: 'archive_busy' });
  hold.resolve(); await slow;
  const wait = deferred(); ipc.handle('migration', () => runtime.maintenance(async () => { entered.resolve(); await wait.promise; return 'done'; }));
  const migration = handlers.get('migration')({}); await entered.promise;
  assert.equal(JSON.parse(handlers.get('slow')({})).code, 'archive_busy');
  assert.equal(JSON.parse(handlers.get('license-write')({})).code, 'archive_busy');
  assert.equal(handlers.get('status')({}).phase, 'maintenance');
  assert.throws(() => runtime.assertFile(path.resolve('unlisted-state.json')), { code: 'archive_busy' });
  await assert.rejects(runtime.recover(async () => ({ ready: true })), { code: 'archive_busy' });
  wait.resolve(); assert.equal(await migration, 'done'); assert.equal(runtime.status().activeOperations, 0);
});

test('detached tracked children keep their own lifetime and stale maintenance capabilities do not cross operations', async () => {
  const runtime = createProjectArchiveRuntime(), childHold = deferred(); let child;
  runtime.track(() => { child = runtime.track(() => childHold.promise); });
  assert.equal(runtime.status().activeOperations, 1);
  await assert.rejects(runtime.maintenance(() => {}), { code: 'archive_busy' });
  childHold.resolve(); await child;
  const stale = deferred(); let late;
  await runtime.maintenance(() => { late = stale.promise.then(() => runtime.assertFile(path.resolve('settings.json'))); });
  const second = deferred(); const active = runtime.maintenance(() => second.promise);
  stale.resolve(); await assert.rejects(late, { code: 'archive_busy' }); second.resolve(); await active;
});

test('HTTP disconnect does not release an async writer and maintenance returns 503 to new requests', async () => {
  const runtime = createProjectArchiveRuntime(), hold = deferred(); let completed = false; const replies = [];
  const gate = createArchiveHttpGate(runtime, async () => { await hold.promise; completed = true; },
    (response, status, body) => { replies.push({ status, body }); response.end(); });
  const response = new Response(); gate({ method: 'POST' }, response); response.destroy();
  await assert.rejects(runtime.maintenance(() => {}), { code: 'archive_busy' });
  assert.equal(completed, false); hold.resolve(); await tick();
  assert.equal(runtime.status().activeOperations, 0);
  const wait = deferred(); const migration = runtime.maintenance(() => wait.promise);
  gate({ method: 'POST' }, new Response()); assert.equal(replies[0].status, 503); assert.equal(replies[0].body.code, 'archive_busy');
  wait.resolve(); await migration;
});

test('actual HTTP router propagates asynchronous material handlers and Agent body promises', async () => {
  const runtime = createProjectArchiveRuntime(), hold = deferred(); let called = false;
  const scope = { projectArchiveRuntime: runtime, URL, agentTokenFromAuthorization: () => '', REMOTE_ARCHIVE_PATH: '/synthetic-remote',
    handleProjectMaterialUpload: async () => { called = true; await hold.promise; return 'received'; },
    requireAuth: () => true, parseJsonBody: () => hold.promise, readAgentWriteIntents: () => ({ intents: [] }), sendJson: () => {} };
  bind(scope, 'handleHostRequest');
  const request = { method: 'POST', url: '/api/projects/p1/materials', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } };
  const result = scope.handleHostRequest(request, {});
  assert.equal(called, true); assert.equal(typeof result.then, 'function'); hold.resolve({}); assert.equal(await result, 'received');
  const review = scope.handleHostRequest({ ...request, url: '/api/agent/write/review', authContext: { type: 'admin' } }, {});
  assert.equal(typeof review.then, 'function'); await review;
});

for (const action of ['create', 'restore']) {
  test(`actual ${action} entry owns maintenance through worker completion and resumes only after release`, async () => {
    const runtime = createProjectArchiveRuntime(), hold = deferred(), entered = deferred();
    const { scope, events } = hostScope(runtime);
    scope.hostServer = { close: (done) => { events.push('close-server'); done(); } };
    scope.runHostMigrationWorker = async (kind) => {
      if (kind === 'inspect-package') return { requiresPassword: false };
      assert.equal(runtime.status().phase, 'maintenance'); assert.equal(scope.hostServer, null);
      entered.resolve(); await hold.promise; return { ok: true, packagePath: 'synthetic-package', fileCount: 0 };
    };
    const work = runtime.track(() => action === 'create' ? scope.createHostMigrationPackage({}, '{}') : scope.restoreHostMigrationPackage({}, '{"packagePath":"synthetic-package"}'));
    await entered.promise; assert.equal(events.includes('resume-watchers'), false);
    await assert.rejects(runtime.maintenance(() => {}), { code: 'archive_busy' });
    hold.resolve(); assert.equal(JSON.parse(await work).ok, true);
    assert.equal(runtime.status().ready, true); assert.ok(events.includes('resume-watchers')); assert.ok(events.includes('resume-server'));
    if (action === 'restore') assert.ok(events.indexOf('invalidate') < events.indexOf('resume-watchers'));
  });
}

test('actual maintenance resumes after worker failure but refuses active tasks without stopping them', async () => {
  const runtime = createProjectArchiveRuntime(); const { scope, events } = hostScope(runtime);
  scope.runHostMigrationWorker = async () => { throw new Error('synthetic worker failure'); };
  assert.equal(JSON.parse(await scope.createHostMigrationPackage({}, '{}')).ok, false);
  assert.equal(runtime.status().ready, true); assert.ok(events.includes('resume-watchers')); events.length = 0;
  scope.taskChildProcesses.set('task-1', {});
  assert.match(JSON.parse(await scope.createHostMigrationPackage({}, '{}')).message, /不会强制终止/);
  assert.deepEqual(events, []); assert.equal(scope.taskChildProcesses.size, 1);
  scope.taskChildProcesses.clear(); scope.readTaskStore = () => ({ tasks: [{ status: 'waiting_result' }] });
  assert.match(JSON.parse(await scope.createHostMigrationPackage({}, '{}')).message, /尚不能确认写入已停止/);
  assert.deepEqual(events, []);
});

test('unresolved migration state stops host resume and startup before business opens', async () => {
  const runtime = createProjectArchiveRuntime(), { scope, events } = hostScope(runtime);
  let quits = 0, warnings = 0;
  scope.projectArchiveStartupReady = true;
  scope.app.quit = () => { quits++; };
  scope.dialog.showErrorBox = () => { warnings++; };
  scope.recoverInterruptedMigrationStateInstalls = () => ({ ready: false, issues: [{ journalPath: 'synthetic-journal', message: 'synthetic conflict' }] });
  scope.runHostMigrationWorker = async () => ({ ok: true, packagePath: 'synthetic-package' });
  const result = JSON.parse(await scope.createHostMigrationPackage({}, '{}'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'migration_recovery_required');
  assert.equal(quits, 1); assert.equal(warnings, 1);
  assert.equal(scope.projectArchiveStartupReady, false);
  assert.equal(events.includes('resume-watchers'), false);
  assert.equal(events.includes('resume-server'), false);
  bind(scope, 'prepareHostMigrationStateStartup');
  scope.dialog.showMessageBox = async () => ({ response: 0 });
  assert.equal(await scope.prepareHostMigrationStateStartup(), false);
  assert.equal(quits, 2);
});

test('actual timer entry points defer during maintenance without reading or writing project data', async () => {
  const runtime = createProjectArchiveRuntime(), hold = deferred(); const work = runtime.maintenance(() => hold.promise);
  const timers = []; let created = 0;
  const scope = { projectArchiveRuntime: runtime, educationArchiveVersionTimers: new Map(),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {},
    createEducationArchiveVersion: () => { created++; } };
  for (const name of ['runProjectAutomationSweep', 'reconcileDigestWorkflows', 'drainAgentLifecycleQueue']) {
    bind(scope, name); assert.equal((await scope[name]()).reason, 'archive_busy');
  }
  bind(scope, 'scheduleEducationArchiveVersion'); scope.scheduleEducationArchiveVersion('original-student', 1000);
  timers[0].callback(); assert.equal(created, 0); assert.equal(timers[1].delay, 30000);
  assert.ok(scope.educationArchiveVersionTimers.has('original-student'));
  scope.captureVisionSweepTimer = null;
  bind(scope, 'scheduleCaptureVisionSweep'); bind(scope, 'drainCaptureVisionQueue');
  await scope.drainCaptureVisionQueue();
  assert.equal(timers[2].delay, 60000);
  assert.equal(created, 0);
  hold.resolve(); await work; timers[1].callback(); assert.equal(created, 1);
});

test('normal app quit waits for maintenance completion and schedules only one deferred quit', async () => {
  const runtime = createProjectArchiveRuntime(), hold = deferred(); const work = runtime.maintenance(() => hold.promise);
  let handler, prevented = 0, quits = 0;
  const scope = { projectArchiveRuntime: runtime, projectArchiveStartupReady: true, materialQuitPending: false, setImmediate,
    taskStoreQuitReady: false, taskStoreGuard: { pending: () => false },
    app: { on: (_event, fn) => { handler = fn; }, quit: () => { quits++; } } };
  const start = main.indexOf("app.on('before-quit',");
  Function('scope', `with (scope) { ${main.slice(start, main.indexOf("\napp.on('window-all-closed'", start))} }`)(scope);
  handler({ preventDefault: () => { prevented++; } }); handler({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2); assert.equal(quits, 0);
  hold.resolve(); await work; await tick(); assert.equal(quits, 1);
});

test('portable student package background build remains tracked after the create response', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-maintenance-portable-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-maintenance-portable-')); fs.rmSync(root, { recursive: true, force: true }); });
  const runtime = createProjectArchiveRuntime(), hold = deferred(); let completion;
  const manager = createStudentPortableMigrationManager({ rootDir: path.join(root, 'sessions'), resolveStudentRoot: () => path.join(root, 'absent-synthetic-student'),
    runBackground: (work) => { completion = runtime.track(async () => { await hold.promise; await work(); }); return completion; } });
  const result = manager.create({ id: 'student-1' }); assert.equal(result.status, 'queued');
  await assert.rejects(runtime.maintenance(() => {}), { code: 'archive_busy' }); hold.resolve(); await completion;
  assert.equal(runtime.status().activeOperations, 0);
  assert.equal(manager.requireSession(result.sessionId, 'student-1').status, 'failed');
});

test('a real loopback HTTP connection cannot make migration idle by disconnecting mid-handler', async (t) => {
  const runtime = createProjectArchiveRuntime(), entered = deferred(), hold = deferred(), done = deferred();
  const server = http.createServer(createArchiveHttpGate(runtime, async (_request, response) => {
    entered.resolve(); await hold.promise; if (!response.destroyed) response.end('saved'); done.resolve();
  }, (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = { hostname: '127.0.0.1', port: server.address().port, path: '/', agent: false };
  const client = http.get(endpoint); client.on('error', () => {});
  await entered.promise; client.destroy(); await tick();
  await assert.rejects(runtime.maintenance(() => {}), { code: 'archive_busy' });
  hold.resolve(); await done.promise; await tick();
  const wait = deferred(); const migration = runtime.maintenance(() => wait.promise);
  const reply = await new Promise((resolve, reject) => {
    http.get(endpoint, (response) => { let body = ''; response.on('data', (bytes) => { body += bytes; }); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) })); }).on('error', reject);
  });
  assert.equal(reply.status, 503); assert.equal(reply.body.code, 'archive_busy'); wait.resolve(); await migration;
});

test('normally exempt asynchronous IPC is tracked before maintenance starts', async () => {
  const runtime = createProjectArchiveRuntime(), handlers = new Map(), hold = deferred();
  const ipc = createArchiveIpcGate({ handle: (name, fn) => handlers.set(name, fn) }, runtime, { exempt: ['license'] });
  ipc.handle('license', () => hold.promise);
  const active = handlers.get('license')({}); await assert.rejects(runtime.maintenance(() => {}), { code: 'archive_busy' });
  hold.resolve(); await active; assert.equal(runtime.status().activeOperations, 0);
});

test('asynchronous HTTP project publication and confirmation await their actual commit result', async () => {
  const hold = deferred(); const replies = [];
  const scope = { requireAuth: () => true, publishProjectPromotion: () => hold.promise, executeProjectPromotionPlan: () => hold.promise,
    parseJsonBody: async () => ({}), sendJson: (_response, status, body) => replies.push({ status, body }) };
  bind(scope, 'handleProjectPromotionPublish'); bind(scope, 'handleProjectPromotionExecute');
  const request = { authContext: { type: 'admin' } };
  const publish = scope.handleProjectPromotionPublish(request, {}, 'p1');
  const execute = scope.handleProjectPromotionExecute(request, {}, 'p1'); await tick(); assert.equal(replies.length, 0);
  hold.resolve('{"ok":true}'); await Promise.all([publish, execute]);
  assert.deepEqual(replies, [{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true } }]);
});
