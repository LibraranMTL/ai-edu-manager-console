const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createProjectArchiveStartup } = require('../electron/project-archive-startup.cjs');
const { createProjectArchiveTransactions } = require('../electron/project-archive-transaction.cjs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createPromotionContext } = require('./fixtures/project-promotion-runtime.cjs');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function extract(name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source).index;
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function bind(context, name) { context[name] = Function('scope', `with (scope) { return (${extract(name)}); }`)(context); }
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-archive-startup-'));
  t.after(async () => {
    assert.equal(path.dirname(root), await fsp.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-archive-startup-'));
    await fsp.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'p1', materialStorageMode: 'workspace-v1', managerPath: path.join(root, 'manager') };
  const directory = path.join(project.managerPath, 'project-materials', 'archive-transactions');
  const catalogPath = path.join(root, 'recovery.json'), projectsPath = path.join(root, 'projects.json'), diagnosticPath = path.join(root, 'diagnostic.json');
  const document = path.join(root, 'student.md');
  fs.writeFileSync(projectsPath, JSON.stringify([project])); fs.writeFileSync(document, 'before');
  const options = { catalogPath, projectsPath, diagnosticPath };
  const startup = (overrides = {}) => createProjectArchiveStartup({ ...options, recover: async () => { throw new Error('unexpected recovery'); }, ...overrides });
  const transactions = (overrides = {}) => createProjectArchiveTransactions({ directory, projectId: 'p1', roots: [root], authorize: async () => true, ...overrides });
  const interrupt = async (manager, overrides = {}) => {
    const tx = transactions({ registerPrepared: manager.register, hooks: { afterPrepared: () => { throw new Error('simulated stop'); } }, ...overrides }).begin({ operation: 'synthetic' });
    tx.io.writeFileSync(document, 'after');
    await assert.rejects(tx.commit({ ok: true }), /simulated stop/);
    return JSON.parse(fs.readFileSync(catalogPath)).entries[0];
  };
  return { root, project, directory, document, options, startup, transactions, interrupt };
}

test('startup reads an empty installation without creating catalog or scanning source trees', async (t) => {
  const f = await fixture(t); await fsp.unlink(f.options.projectsPath);
  const state = await f.startup().initialize(); assert.equal(state.ready, true); assert.equal(fs.existsSync(f.options.catalogPath), false);
});

test('prepared registration failure stops official writes and compatibility discovery still finds its journal', async (t) => {
  const f = await fixture(t); let visited = 0;
  const tx = f.transactions({ registerPrepared: async () => { throw new Error('catalog full'); } }).begin();
  tx.io.writeFileSync(f.document, 'after'); await assert.rejects(tx.commit({ ok: true }), /catalog full/);
  assert.equal(fs.readFileSync(f.document, 'utf8'), 'before');
  const state = await f.startup({ recover: async (entry) => { visited++; return f.transactions().resume(entry.id); } }).initialize();
  assert.equal(state.ready, true); assert.equal(visited, 1); assert.equal(fs.readFileSync(f.document, 'utf8'), 'after');
});

test('new startup instance discovers and resumes durable operation before reporting ready', async (t) => {
  const f = await fixture(t); const entry = await f.interrupt(f.startup()); let reconciled = 0;
  const manager = f.startup({ recover: async (record) => f.transactions().resume(record.id), reconcile: async (_entry, journal) => {
    assert.equal(journal.state, 'committed'); reconciled++;
  } });
  assert.equal(manager.status().ready, false); const state = await manager.initialize();
  assert.equal(state.ready, true); assert.deepEqual(state.recovered, [entry.id]); assert.equal(reconciled, 1);
  assert.equal(fs.readFileSync(f.document, 'utf8'), 'after'); assert.deepEqual(JSON.parse(fs.readFileSync(f.options.catalogPath)).entries, []);
});

test('committed receipt with failed task reconciliation remains registered and retries without rewriting files', async (t) => {
  const f = await fixture(t); const manager = f.startup();
  const tx = f.transactions({ registerPrepared: manager.register }).begin(); tx.io.writeFileSync(f.document, 'after');
  await tx.commit({ ok: true }); const before = fs.statSync(f.document).mtimeMs;
  const blocked = await f.startup({ reconcile: async () => { throw new Error('task store unavailable'); } }).initialize();
  assert.equal(blocked.ready, false); assert.equal(JSON.parse(fs.readFileSync(f.options.catalogPath)).entries.length, 1);
  assert.equal((await f.startup().initialize()).ready, true); assert.equal(fs.statSync(f.document).mtimeMs, before);
});

test('corrupt project index does not hide known transactions or become an empty usable project list', async (t) => {
  const f = await fixture(t); const entry = await f.interrupt(f.startup()); fs.writeFileSync(f.options.projectsPath, '{torn');
  let visits = 0; const state = await f.startup({ recover: async (record) => { visits++; assert.equal(record.id, entry.id); return { ok: false, code: 'recovery_conflict', message: 'preserve damaged index' }; } }).initialize();
  assert.equal(visits, 1); assert.equal(state.ready, false); assert.equal(fs.readFileSync(f.options.projectsPath, 'utf8'), '{torn');
  assert.equal(fs.readFileSync(f.document, 'utf8'), 'before'); assert.equal(JSON.parse(fs.readFileSync(f.options.diagnosticPath)).ready, false);
});

test('missing registered journal, malformed catalog and linked catalog paths fail closed', async (t) => {
  const f = await fixture(t); const entry = await f.interrupt(f.startup());
  await fsp.rename(path.join(f.directory, entry.id, 'journal.json'), path.join(f.directory, entry.id, 'journal-preserved.json'));
  assert.equal((await f.startup().initialize()).ready, false);
  fs.writeFileSync(f.options.catalogPath, '{broken'); assert.equal((await f.startup().initialize()).ready, false);
  const external = path.join(f.root, 'outside'); await fsp.mkdir(external);
  const link = path.join(f.root, 'link'); await fsp.symlink(external, link, 'junction');
  const bad = createProjectArchiveStartup({ ...f.options, catalogPath: path.join(link, 'catalog.json'), recover: async () => ({ ok: true }) });
  assert.equal((await bad.initialize()).ready, false); assert.deepEqual(fs.readdirSync(external), []);
});

test('one recovered project does not conceal another unavailable project journal directory', async (t) => {
  const f = await fixture(t); await f.interrupt(f.startup());
  const outside = path.join(f.root, 'external'); await fsp.mkdir(outside);
  const linked = path.join(f.root, 'linked-manager'); await fsp.symlink(outside, linked, 'junction');
  fs.writeFileSync(f.options.projectsPath, JSON.stringify([f.project, { ...f.project, id: 'other', managerPath: linked }]));
  const state = await f.startup({ recover: async (entry) => f.transactions().resume(entry.id) }).initialize();
  assert.equal(state.ready, false); assert.equal(state.recovered.length, 1); assert.ok(state.issues.some((item) => item.code === 'linked_path'));
});

async function hostFixture(t) {
  const f = await fixture(t);
  Object.assign(f.project, { name: 'Synthetic Project', storageName: 'synthetic', status: 'active', studentIds: ['s1'], studentEvidence: [],
    workspacePath: path.join(f.root, 'workspace'), rawPath: path.join(f.root, 'legacy'), knowledgeRootPath: path.join(f.root, 'knowledge') });
  for (const [key, value] of Object.entries({ conceptPath: '概念库', entityPath: '实体库', summaryPath: '摘要库', qaPath: '问答精华库', synthesisPath: '综合汇总库', contributionPath: '知识贡献' })) f.project[key] = path.join(f.project.knowledgeRootPath, value);
  f.project.promotionPath = path.join(f.project.contributionPath, 'promotion.md');
  await fsp.mkdir(f.project.workspacePath); await fsp.mkdir(f.project.contributionPath, { recursive: true });
  fs.writeFileSync(path.join(f.project.workspacePath, 'source.txt'), 'synthetic original');
  f.student = { id: 's1', name: 'Synthetic Student', rootPath: path.join(f.root, 'student'), rawPath: path.join(f.root, 'student/raw'), summaryPath: path.join(f.root, 'student/summary') };
  const host = createProjectMaterialHost(f.project);
  await host.store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: 'source.txt' } }]);
  const main = createPromotionContext(f); const ctx = main.context; let tasks = [];
  const startup = f.startup({ recover: (...args) => ctx.recoverProjectArchiveAtStartup(...args), abandon: (...args) => ctx.abandonProjectArchiveAtStartup(...args), reconcile: (...args) => ctx.reconcileProjectArchiveAtStartup(...args) });
  Object.assign(ctx, { archiveStartupRecoveryContexts: new WeakSet(), projectArchiveStartupReady: false,
    projectArchiveStartupManager: () => startup, readTaskStore: () => structuredClone({ tasks }), writeTaskStore: (store) => { tasks = structuredClone(store.tasks); },
    validateTaskPermissionDeclaration: (task) => ({ ok: true, permissions: task.permissions }), taskNow: () => new Date().toISOString(),
    normalizeTaskResult: (_task, result) => result, appendTaskEvent() {}, scheduleGrowthRefresh: () => { throw new Error('startup must not schedule growth monitor'); } });
  for (const name of ['recoverProjectArchiveAtStartup', 'abandonProjectArchiveAtStartup', 'reconcileProjectArchiveAtStartup', 'authorizeInternalTaskOperation']) bind(ctx, name);
  const input = { items: JSON.parse(ctx.projectPromotionPlan('p1')).items.filter((item) => item.kind === 'file').map((item) => ({ ...item, action: 'absorb' })) };
  tasks = [{ id: 'task1', executionId: 'run1', sourceType: 'project', sourceId: 'p1', status: 'running', approval: { status: 'approved' },
    input: { operation: 'execute_archive_plan', plan: input }, permissions: { read: [f.root], write: [f.root], operations: ['execute_archive_plan'] } }];
  return { ...f, main, ctx, startup, input, tasks: () => tasks, mutateTask: (fn) => fn(tasks[0]) };
}

test('actual host startup resumes failed approved archive and settles original task into review without background refresh', async (t) => {
  const f = await hostFixture(t);
  f.ctx.createProjectArchiveTransactions = (options) => createProjectArchiveTransactions({ ...options, hooks: { afterFilesWritten: () => { throw new Error('interrupted'); } } });
  assert.equal((await f.main.execute(f.input)).ok, false); f.mutateTask((task) => { task.status = 'failed'; });
  f.ctx.createProjectArchiveTransactions = createProjectArchiveTransactions;
  const state = await f.startup.initialize(); assert.equal(state.ready, true, JSON.stringify(state.issues));
  assert.equal(f.tasks()[0].status, 'reviewing'); assert.equal(f.tasks()[0].result.structuredOutput.recovered, true);
  assert.equal(f.main.projects[0].status, 'archived'); assert.equal(f.main.assets.length, 1); assert.equal(f.main.runs.length, 1);
  assert.equal(f.ctx.archiveStartupRecoveryContexts.has({ taskId: 'task1', executionId: 'run1' }), false);
});

test('startup recovery never reapproves a revoked task or accepts a forged recovery flag', async (t) => {
  const f = await hostFixture(t);
  f.ctx.createProjectArchiveTransactions = (options) => createProjectArchiveTransactions({ ...options, hooks: { afterPrepared: () => { throw new Error('interrupted'); } } });
  assert.equal((await f.main.execute(f.input)).ok, false);
  f.mutateTask((task) => { task.status = 'failed'; task.approval.status = 'rejected'; });
  f.ctx.createProjectArchiveTransactions = createProjectArchiveTransactions;
  const state = await f.startup.initialize(); assert.equal(state.ready, false); assert.equal(f.main.assets.length, 0);
  assert.equal(f.main.projects[0].status, 'active'); assert.ok(state.issues.some((issue) => issue.code === 'recovery_approval_required'));
  f.mutateTask((task) => { task.approval.status = 'approved'; });
  assert.equal(f.ctx.authorizeInternalTaskOperation({ taskId: 'task1', executionId: 'run1', recovery: true }, 'execute_archive_plan', []).ok, false);
});

test('actual startup reconciles committed archive without re-running or overwriting a newer task execution', async (t) => {
  const f = await hostFixture(t);
  const result = await f.main.execute(f.input); assert.equal(result.ok, true, result.message);
  const file = result.results[0].target; const before = fs.statSync(file).mtimeMs;
  f.ctx.performProjectPromotionPlan = () => { throw new Error('committed archive must not execute again'); };
  assert.equal((await f.startup.initialize()).ready, true); assert.equal(f.tasks()[0].status, 'reviewing'); assert.equal(fs.statSync(file).mtimeMs, before);
  const journalFile = path.join(f.directory, result.transactionId, 'journal.json'); const journal = JSON.parse(fs.readFileSync(journalFile));
  f.mutateTask((task) => { task.executionId = 'newer-run'; task.status = 'running'; task.result = null; });
  await f.ctx.reconcileProjectArchiveAtStartup({ id: result.transactionId, projectId: 'p1' }, journal);
  assert.equal(f.tasks()[0].status, 'running'); assert.equal(f.tasks()[0].result, null);
});

test('startup blocks rather than overwrite user changes after a partial commit', async (t) => {
  const f = await hostFixture(t);
  f.ctx.createProjectArchiveTransactions = (options) => createProjectArchiveTransactions({ ...options, hooks: { afterFinalized: () => { throw new Error('lost acknowledgement'); } } });
  const failed = await f.main.execute(f.input); assert.equal(failed.ok, false);
  fs.appendFileSync(path.join(f.student.summaryPath, '项目归档记录.md'), '\nhuman note');
  f.mutateTask((task) => { task.status = 'failed'; }); f.ctx.createProjectArchiveTransactions = createProjectArchiveTransactions;
  const state = await f.startup.initialize(); assert.equal(state.ready, false); assert.ok(state.issues.some((issue) => issue.code === 'recovery_conflict'));
  assert.match(fs.readFileSync(path.join(f.student.summaryPath, '项目归档记录.md'), 'utf8'), /human note/);
  assert.equal(f.tasks()[0].status, 'failed');
});

test('native recovery gate offers diagnostics and exit without starting business services', async () => {
  let checks = 0; let opened = ''; let quits = 0; const choices = [1, 0];
  const ctx = { projectArchiveStartupReady: false,
    projectArchiveRuntime: { recover: (work) => work() },
    projectArchiveStartupManager: () => ({ diagnosticPath: 'synthetic-diagnostic.json', initialize: async () => { checks++; return { ready: false, issues: [{ message: 'conflict' }] }; } }),
    dialog: { showMessageBox: async () => ({ response: choices.shift() }) },
    shell: { openPath: async (file) => { opened = file; return ''; } }, app: { quit: () => { quits++; } } };
  bind(ctx, 'prepareProjectArchiveStartup'); assert.equal(await ctx.prepareProjectArchiveStartup(), false);
  assert.equal(ctx.projectArchiveStartupReady, false); assert.equal(checks, 2); assert.equal(opened, 'synthetic-diagnostic.json'); assert.equal(quits, 1);
});

test('actual startup body does not launch any writer or business window until recovery readiness resolves', async () => {
  const start = source.indexOf('  app.whenReady().then(async () => {');
  const end = source.indexOf('\n  });', start) + 6;
  assert.ok(start > 0 && end > start);
  for (const ready of [false, true]) {
    let release; const waiting = new Promise((resolve) => { release = resolve; }); const calls = [];
    const ctx = { app: { whenReady: () => Promise.resolve(), quit: () => calls.push('quit') }, dialog: { showErrorBox: () => calls.push('startup-error') }, prepareHostMigrationStateStartup: async () => true, prepareProjectRecordLifecycleStartup: async () => true, prepareProjectArchiveStartup: () => waiting,
      prepareProjectUploadIntakeStartup: async () => [], projectUploadRecoveryIssues: [],
      recoverInterruptedProjectMaterialMigrations: async () => calls.push('material-migration'),
      getCloudReportRuntime: () => { calls.push('cloud'); return Promise.resolve(); },
      ensureCaptureTimelineScheduler: () => ({ start: () => calls.push('capture') }), captureVisionConsent: () => ({ enabled: false }),
      readCollaborationState: () => ({ enabled: false }), taskAutomationEnabled: () => false, process: { env: {} } };
    for (const name of ['createWindow', 'createCaptureTray', 'registerCaptureShortcuts', 'restoreHeavyTaskRetries', 'startDigestWorkflowMonitor', 'startGrowthRefreshMonitor',
      'startDirectDeliveryMonitor', 'startAgentLifecycleDrainMonitor', 'startAgentLifecycleInstallMonitor', 'startStudentArchiveSyncWatchers', 'scheduleTeamKnowledgeIndexWarmup']) ctx[name] = () => calls.push(name);
    Function('scope', `with (scope) { ${source.slice(start, end)} }`)(ctx);
    await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(calls, []);
    release(ready); await new Promise((resolve) => setImmediate(resolve));
    if (ready) { assert.ok(calls.includes('createWindow')); assert.ok(calls.includes('startGrowthRefreshMonitor')); }
    else assert.deepEqual(calls, []);
  }
});

test('project record recovery gates archive startup and the business window', async () => {
  const start = source.indexOf('  app.whenReady().then(async () => {');
  const end = source.indexOf('\n  });', start) + 6;
  const calls = [];
  const ctx = { app: { whenReady: () => Promise.resolve(), quit: () => calls.push('quit') },
    dialog: { showErrorBox: () => calls.push('startup-error') },
    prepareHostMigrationStateStartup: async () => { calls.push('migration'); return true; },
    prepareProjectRecordLifecycleStartup: async () => { calls.push('record'); return false; },
    prepareProjectArchiveStartup: async () => { calls.push('archive'); return true; },
    createWindow: () => calls.push('window') };
  Function('scope', `with (scope) { ${source.slice(start, end)} }`)(ctx);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['migration', 'record']);
});

test('cancelled journal survives task-settlement failure and is reconciled on the next startup without replay', async (t) => {
  const f = await fixture(t); const entry = await f.interrupt(f.startup()); let replays = 0;
  const state = await f.startup({ abandon: (record) => f.transactions().abandon(record.id),
    reconcile: async () => { throw new Error('task store unavailable'); } }).initialize({ abandonUnwritten: true });
  assert.equal(state.ready, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, entry.id, 'journal.json'))).state, 'abandoned');
  assert.equal(JSON.parse(fs.readFileSync(f.options.catalogPath)).entries.length, 1);
  const restarted = await f.startup({ recover: () => { replays++; }, reconcile: (_entry, journal) => { assert.equal(journal.state, 'abandoned'); } }).initialize();
  assert.equal(restarted.ready, true); assert.equal(replays, 0);
  assert.deepEqual(restarted.abandoned, [entry.id]); assert.deepEqual(restarted.recovered, []);
  assert.equal(fs.readFileSync(f.document, 'utf8'), 'before');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.options.catalogPath)).entries, []);
});

test('unwritten cancellation requires adapter and rejects changed targets while keeping recovery registration', async (t) => {
  const f = await fixture(t); await f.interrupt(f.startup());
  const missing = await f.startup().initialize({ abandonUnwritten: true });
  assert.equal(missing.ready, false); assert.equal(missing.issues[0].code, 'invalid_recovery');
  fs.writeFileSync(f.document, 'human note');
  const changed = await f.startup({ abandon: (entry) => f.transactions().abandon(entry.id) }).initialize({ abandonUnwritten: true });
  assert.equal(changed.ready, false); assert.equal(changed.issues[0].code, 'recovery_conflict');
  assert.equal(fs.readFileSync(f.document, 'utf8'), 'human note');
  assert.equal(JSON.parse(fs.readFileSync(f.options.catalogPath)).entries.length, 1);
});

test('actual host cancels an unwritten revoked task without publishing it or retaining a stale success result', async (t) => {
  const f = await hostFixture(t);
  f.ctx.createProjectArchiveTransactions = (options) => createProjectArchiveTransactions({ ...options, hooks: { afterFilesWritten: () => { throw new Error('interrupt'); } } });
  assert.equal((await f.main.execute(f.input)).ok, false);
  f.mutateTask((task) => { task.status = 'failed'; task.approval.status = 'rejected'; task.result = { structuredOutput: { ok: true, stale: true } }; });
  f.ctx.createProjectArchiveTransactions = createProjectArchiveTransactions;
  assert.equal((await f.startup.initialize()).ready, false);
  const state = await f.startup.initialize({ abandonUnwritten: true });
  assert.equal(state.ready, true, JSON.stringify(state.issues));
  assert.equal(state.abandoned.length, 1); assert.deepEqual(state.recovered, []);
  assert.equal(f.tasks()[0].status, 'cancelled'); assert.equal(f.tasks()[0].error.code, 'ARCHIVE_ABANDONED'); assert.equal(f.tasks()[0].result, null);
  assert.equal(f.tasks()[0].approval.status, 'rejected');
  assert.equal(f.main.projects[0].status, 'active'); assert.equal(f.main.assets.length, 0); assert.equal(f.main.runs.length, 0);
  assert.equal(fs.readFileSync(path.join(f.project.workspacePath, 'source.txt'), 'utf8'), 'synthetic original');
});

test('actual startup native cancel selection requests checked cancellation, not normal replay', async () => {
  const options = []; let calls = 0;
  const ctx = { projectArchiveStartupReady: false, projectArchiveRuntime: { recover: (work) => work() },
    projectArchiveStartupManager: () => ({ initialize: async (option) => { options.push(option); return option?.abandonUnwritten ? { ready: true } : { ready: false, issues: [{ message: 'revoked' }] }; } }),
    dialog: { showMessageBox: async (value) => { calls++; assert.match(value.detail, /取消仅针对/); return { response: 3 }; } } };
  bind(ctx, 'prepareProjectArchiveStartup');
  assert.equal(await ctx.prepareProjectArchiveStartup(), true); assert.equal(calls, 1);
  assert.deepEqual(options, [undefined, { abandonUnwritten: true }]); assert.equal(ctx.projectArchiveStartupReady, true);
});
