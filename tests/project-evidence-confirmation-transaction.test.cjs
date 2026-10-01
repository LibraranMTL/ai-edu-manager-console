const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createEvidenceContext } = require('./fixtures/project-evidence-runtime.cjs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createProjectArchiveTransactions } = require('../electron/project-archive-transaction.cjs');
const { createProjectArchiveStartup } = require('../electron/project-archive-startup.cjs');
const { createProjectArchiveRuntime } = require('../electron/project-archive-runtime.cjs');
const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(mainSource).index;
  scope[name] = Function('scope', `with (scope) { return (${mainSource.slice(start, mainSource.indexOf('\n}', start) + 2)}); }`)(scope);
}
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-evidence-durable-'));
  const project = { id: 'p1', name: 'Synthetic', status: 'active', studentIds: ['s1'], studentEvidence: [], materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'legacy'), managerPath: path.join(root, 'manager'), knowledgeRootPath: path.join(root, 'knowledge') };
  for (const [field, dir] of Object.entries({ summaryPath: '摘要库', conceptPath: '概念库', entityPath: '实体库', contributionPath: '知识贡献' })) project[field] = path.join(project.knowledgeRootPath, dir);
  await fsp.mkdir(project.workspacePath); await fsp.mkdir(project.contributionPath, { recursive: true });
  const original = path.join(project.workspacePath, 'original.txt'); fs.writeFileSync(original, 'synthetic personal evidence');
  const host = createProjectMaterialHost(project);
  await host.store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: 'original.txt' } }]);
  const evidence = { ability: '分析', observation: '合成个人观察', status: 'verified', confidence: '人工核对', sourcePaths: [original] };
  t.after(async () => {
    assert.equal(path.dirname(root), await fsp.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-evidence-durable-'));
    await fsp.rm(root, { recursive: true, force: true });
  });
  const f = { root, project, original, host, evidence };
  const create = (overrides = {}, reuseProject = false) => {
    const runtime = createProjectArchiveRuntime();
    const main = createEvidenceContext(f, { projectArchiveRuntime: runtime, ...overrides }, { reuseProject });
    const ctx = main.context;
    for (const name of ['recoverProjectArchiveAtStartup', 'abandonProjectArchiveAtStartup', 'reconcileProjectArchiveAtStartup']) bind(ctx, name);
    const startup = createProjectArchiveStartup({ catalogPath: path.join(root, 'recovery.json'), projectsPath: main.projectFile,
      diagnosticPath: path.join(root, 'diagnostic.json'), recover: ctx.recoverProjectArchiveAtStartup, abandon: ctx.abandonProjectArchiveAtStartup,
      reconcile: ctx.reconcileProjectArchiveAtStartup });
    ctx.projectArchiveStartupManager = () => startup;
    return { ...main, runtime, startup };
  };
  return { ...f, create };
}

test('confirmation commits project, readable evidence, growth candidate and dirty marker together using actual growth helpers', async (t) => {
  const f = await fixture(t); let refreshed = 0;
  const main = f.create({ rebuildGrowthIndex: () => { throw new Error('derived index must not run inside commit'); }, scheduleGrowthRefresh: () => { refreshed++; } });
  const preview = await main.call(); assert.equal(preview.needsSourceConfirmation, true);
  assert.equal(fs.existsSync(main.reviewFile), false);
  const result = await main.call(f.evidence, preview.bindingId); assert.equal(result.ok, true, result.message); assert.equal(result.growthRefreshPending, true);
  assert.equal(result.evidence.status, 'verified'); assert.equal(refreshed, 1);
  assert.equal(main.context.readGrowthEvidenceReview().candidates[0].sourceBinding.bindingId, preview.bindingId);
  assert.match(fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8'), /evidence-binding-/);
  assert.deepEqual(JSON.parse(fs.readFileSync(main.context.growthRefreshStatePath())).dirty, ['s1']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'recovery.json'))).entries, []);
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'synthetic personal evidence');
  const before = fs.readFileSync(main.projectFile, 'utf8'); const timestamp = fs.statSync(main.projectFile).mtimeMs;
  const repeated = await main.call(f.evidence, preview.bindingId);
  assert.equal(repeated.alreadyConfirmed, true); assert.equal(repeated.confirmationId, result.confirmationId);
  assert.equal(fs.readFileSync(main.projectFile, 'utf8'), before); assert.equal(fs.statSync(main.projectFile).mtimeMs, timestamp); assert.equal(refreshed, 1);
  assert.equal((await main.call({ ...f.evidence, observation: 'different intent' }, preview.bindingId)).ok, false);
  assert.equal((await main.call({ ...f.evidence, generatedBy: 'changed attribution' }, preview.bindingId)).ok, false);
});

test('new process context recovers confirmation after rollback or lost acknowledgement without creating another evidence row', async (t) => {
  for (const phase of ['afterPrepared', 'afterFilesWritten', 'afterFinalized']) {
    const f = await fixture(t); const main = f.create({ createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options,
      hooks: { [phase]: () => { throw new Error('injected interruption'); } } }) });
    const preview = await main.call(); assert.equal((await main.call(f.evidence, preview.bindingId)).ok, false);
    assert.equal(main.runtime.status().phase, 'blocked');
    const restored = f.create({}, true); const state = await restored.runtime.recover(() => restored.startup.initialize());
    assert.equal(state.ready, true, JSON.stringify(state.issues)); assert.equal(state.recovered.length, 1);
    assert.equal(restored.context.readProjects()[0].studentEvidence[0].sourceBinding.bindingId, preview.bindingId);
    const text = fs.readFileSync(path.join(restored.growthDir, '成长证据.md'), 'utf8');
    assert.equal(text.match(/<!-- evidence:/g).length, 1); assert.equal(restored.context.readGrowthEvidenceReview().candidates.length, 1);
    assert.equal((await restored.startup.initialize()).ready, true); assert.equal(fs.readFileSync(path.join(restored.growthDir, '成长证据.md'), 'utf8'), text);
  }
});

test('real writer process kill at each confirmation boundary recovers durable intent and fixed sources', { timeout: 35000 }, async (t) => {
  for (const phase of ['afterPrepared', 'afterFilesWritten', 'afterFinalized']) {
    const f = await fixture(t); const main = f.create(); const preview = await main.call();
    fs.writeFileSync(path.join(f.root, 'crash-input.json'), JSON.stringify({ root: f.root, project: f.project, evidence: f.evidence, bindingId: preview.bindingId }));
    const child = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/project-evidence-crash.cjs'), f.root, phase],
      { windowsHide: true, timeout: 15000, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    assert.equal(child.error, undefined); assert.notEqual(child.status, 0); assert.notEqual(child.status, 2, child.stderr); assert.notEqual(child.status, 3, child.stderr);
    const resumed = f.create({}, true); const state = await resumed.runtime.recover(() => resumed.startup.initialize());
    assert.equal(state.ready, true, JSON.stringify(state.issues)); assert.equal(state.recovered.length, 1, child.stderr);
    assert.equal(resumed.context.readProjects()[0].studentEvidence[0].sourceBinding.bindingId, preview.bindingId);
    assert.equal(fs.readFileSync(path.join(resumed.growthDir, '成长证据.md'), 'utf8').match(/<!-- evidence:/g).length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(resumed.context.growthRefreshStatePath())).dirty, ['s1']);
  }
});

test('withdrawn source blocks confirmation recovery; explicitly cancelling the fully rolled-back intent preserves originals', async (t) => {
  const f = await fixture(t); const main = f.create({ createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options,
    hooks: { afterPrepared: () => { throw new Error('interrupt'); } } }) });
  const preview = await main.call(); await main.call(f.evidence, preview.bindingId);
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  const resumed = f.create({}, true); const blocked = await resumed.runtime.recover(() => resumed.startup.initialize());
  assert.equal(blocked.ready, false); assert.ok(blocked.issues.some((issue) => issue.code === 'source_withdrawn'));
  const cancelled = await resumed.runtime.recover(() => resumed.startup.initialize({ abandonUnwritten: true }));
  assert.equal(cancelled.ready, true, JSON.stringify(cancelled.issues)); assert.equal(cancelled.abandoned.length, 1);
  assert.equal(resumed.context.readProjects()[0].studentEvidence.length, 0); assert.equal(fs.existsSync(resumed.reviewFile), false);
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'synthetic personal evidence');
});

test('confirmation source withdrawn after durable preparation or host window revoked is never committed', async (t) => {
  for (const changed of ['source', 'window']) {
    const f = await fixture(t); const main = f.create();
    main.context.createProjectArchiveTransactions = (options) => createProjectArchiveTransactions({ ...options, hooks: {
      afterPrepared: async () => {
        if (changed === 'source') await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
        else main.context.mainWindow.isDestroyed = () => true;
      },
    } });
    const preview = await main.call(); const result = await main.call(f.evidence, preview.bindingId);
    assert.equal(result.ok, false); assert.equal(main.context.readProjects()[0].studentEvidence.length, 0); assert.equal(fs.existsSync(main.reviewFile), false);
  }
});

test('committed confirmation remains successful when recovery catalog cleanup or scheduling fails', async (t) => {
  const f = await fixture(t); const main = f.create();
  main.startup.complete = async () => { throw new Error('catalog temporarily unavailable'); };
  const preview = await main.call(); const result = await main.call(f.evidence, preview.bindingId);
  assert.equal(result.ok, true, result.message); assert.match(result.notificationWarning, /catalog temporarily unavailable/);
  const before = fs.readFileSync(main.projectFile, 'utf8'); const resumed = f.create({}, true);
  assert.equal((await resumed.runtime.recover(() => resumed.startup.initialize())).ready, true);
  assert.equal(fs.readFileSync(main.projectFile, 'utf8'), before); assert.equal(resumed.context.readGrowthEvidenceReview().candidates.length, 1);
});

test('malformed existing growth review is preserved rather than replaced by a new evidence-only ledger', async (t) => {
  const f = await fixture(t); const main = f.create(); bind(main.context, 'readGrowthEvidenceReview');
  fs.mkdirSync(main.growthDir, { recursive: true }); fs.writeFileSync(main.reviewFile, '{"candidates":"broken"}');
  const before = fs.readFileSync(main.projectFile, 'utf8'); const preview = await main.call();
  const result = await main.call(f.evidence, preview.bindingId); assert.equal(result.ok, false); assert.match(result.message, /结构损坏/);
  assert.equal(fs.readFileSync(main.projectFile, 'utf8'), before); assert.equal(fs.readFileSync(main.reviewFile, 'utf8'), '{"candidates":"broken"}');
  assert.equal(main.runtime.status().ready, true);
});

test('external target edit after confirmation intent is prepared blocks all evidence writes and remains untouched on recovery', async (t) => {
  const f = await fixture(t); const main = f.create();
  const file = path.join(f.project.contributionPath, '学生独立成长证据', 'Synthetic Student-s1.md');
  main.context.createProjectArchiveTransactions = (options) => createProjectArchiveTransactions({ ...options, hooks: {
    afterPrepared: () => fs.writeFileSync(file, 'human created evidence'),
  } });
  const preview = await main.call(); const result = await main.call(f.evidence, preview.bindingId);
  assert.equal(result.code, 'recovery_conflict'); assert.equal(main.context.readProjects()[0].studentEvidence.length, 0);
  const resumed = f.create({}, true); const state = await resumed.runtime.recover(() => resumed.startup.initialize());
  assert.equal(state.ready, false); assert.ok(state.issues.some((issue) => issue.code === 'recovery_conflict'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'human created evidence'); assert.equal(fs.existsSync(main.reviewFile), false);
});
