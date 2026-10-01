const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const promotion = require('../electron/project-material-promotion.cjs');
const host = require('../electron/project-material-host.cjs');
const evidenceApi = require('../electron/project-material-evidence.cjs');
const { createProjectArchiveTransactions } = require('../electron/project-archive-transaction.cjs');
const { spawnSync } = require('node:child_process');
const hash = (value, algorithm = 'sha256') => crypto.createHash(algorithm).update(value).digest('hex');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(main); assert.ok(match, name);
  const end = main.slice(match.index + match[0].length).search(/\n(?:async )?function /);
  return main.slice(match.index, match.index + match[0].length + end);
}
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-material-promotion-'));
  const project = { id: 'p1', name: '合成项目', storageName: '合成项目', materialStorageMode: 'workspace-v1', status: 'active', studentIds: ['s1'],
    managerPath: path.join(root, '.edu-manager'), workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'legacy'),
    knowledgeRootPath: path.join(root, 'knowledge'), studentEvidence: [] };
  for (const [field, dir] of Object.entries({ conceptPath: '概念库', entityPath: '实体库', summaryPath: '摘要库', qaPath: '问答精华库', synthesisPath: '综合汇总库', contributionPath: '知识贡献' })) project[field] = path.join(project.knowledgeRootPath, dir);
  project.promotionPath = path.join(project.contributionPath, '申请.md');
  for (const dir of [project.workspacePath, project.rawPath, project.contributionPath]) await fsp.mkdir(dir, { recursive: true });
  const service = host.createProjectMaterialHost(project);
  const original = path.join(project.workspacePath, '实验.txt');
  const location = { kind: 'workspace', rootId: 'workspace', relativePath: '实验.txt' };
  await fsp.writeFile(original, 'Synthetic temperature 20 25 30');
  const item = (await service.store.registerFiles([{ location }])).result[0];
  const student = { id: 's1', name: 'Synthetic Student', rootPath: path.join(root, 'student'), summaryPath: path.join(root, 'student', 'summary'), rawPath: path.join(root, 'student', 'raw') };
  t.after(async () => {
    assert.equal(path.dirname(root), await fsp.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-material-promotion-'));
    for (const name of await fsp.readdir(path.join(service.store.directory, 'snapshots')).catch(() => [])) await fsp.chmod(path.join(service.store.directory, 'snapshots', name), 0o600);
    await fsp.rm(root, { recursive: true, force: true });
  });
  const canonical = () => ({ items: promotion.projectMaterialPromotionItems(project) });
  const input = (action = 'absorb') => ({ items: canonical().items.map((item) => ({ ...item, action })) });
  return { root, project, student, service, item, original, location, canonical, input };
}

test('actual growth archive uses the confirmed student version and retains the binding in run records', async (t) => {
  const f = await fixture(t);
  const evidence = { studentId: 's1', ability: '独立分析', observation: 'Synthetic individual observation', confidence: '人工核对', status: 'verified', sourcePaths: [f.original] };
  const service = evidenceApi.createProjectEvidenceService(f.project, { authorize: async () => true });
  const binding = await service.prepare('s1', evidence);
  evidence.sourceBinding = evidenceApi.sourceBindingRef(binding); f.project.studentEvidence = [evidence];
  const candidates = [];
  const main = mainContext(f, {
    appendGrowthEvidenceCandidate: (_student, candidate, io = fs) => { candidates.push(candidate); io.writeFileSync(path.join(f.student.rootPath, 'growth', 'review.json'), JSON.stringify({ candidates })); return candidate; },
    appendTextSection: (file, title, text, io = fs) => { io.mkdirSync(path.dirname(file), { recursive: true }); io.appendFileSync(file, `\n## ${title}\n${text}\n`); },
  });
  const preview = JSON.parse(main.context.projectPromotionPlan('p1')); const growth = preview.items.find((item) => item.kind === 'growth');
  assert.equal(growth.evidenceBindingId, binding.bindingId);
  await fsp.writeFile(f.original, 'new original v2'); await f.service.store.registerFiles([{ location: f.location }]);
  const result = await main.execute({ items: [growth] }); assert.equal(result.ok, true, result.message);
  assert.equal(result.results[0].sourceBinding.bindingId, binding.bindingId); assert.equal(result.results[0].sourceMaterials[0].version, 1);
  assert.equal(candidates[0].status, 'confirmed'); assert.equal(candidates[0].sourceBinding.bindingId, binding.bindingId);
  assert.match(fs.readFileSync(result.results[0].target, 'utf8'), /evidence-binding-/);
  const retry = await main.execute({ items: [growth] }); assert.equal(retry.ok, true, retry.message); assert.equal(retry.results[0].idempotent, true);
  assert.equal(candidates.length, 1);
});

test('unbound evidence cannot be published through archive and stale evidence previews fail before student writes', async (t) => {
  const f = await fixture(t);
  const evidence = { studentId: 's1', ability: 'analysis', observation: 'synthetic observation', confidence: 'manual', status: 'verified', sourcePaths: [f.original] };
  f.project.studentEvidence = [evidence];
  const legacy = mainContext(f); const oldItem = JSON.parse(legacy.context.projectPromotionPlan('p1')).items.find((item) => item.kind === 'growth');
  assert.equal(oldItem.action, 'skip'); assert.deepEqual(oldItem.allowedActions, ['skip']);
  assert.equal((await legacy.execute({ items: [{ ...oldItem, action: 'publish' }] })).ok, false);
  const binding = await evidenceApi.createProjectEvidenceService(f.project, { authorize: async () => true }).prepare('s1', evidence);
  evidence.sourceBinding = evidenceApi.sourceBindingRef(binding);
  const main = mainContext(f); const preview = JSON.parse(main.context.projectPromotionPlan('p1')); const item = preview.items.find((item) => item.kind === 'growth');
  main.mutateProjects((projects) => { projects[0].studentEvidence[0].observation = 'changed after preview'; });
  const result = await main.execute({ items: [item] }); assert.equal(result.ok, false); assert.equal(result.code, 'evidence_changed');
  assert.equal(fs.existsSync(f.student.rootPath), false);
});

test('promotion metadata lists only adopted IDs/versions without global assets or original scanning', async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.project.workspacePath, 'draft.txt'), 'draft');
  await f.service.store.registerFiles([{ location: { ...f.location, relativePath: 'draft.txt' } }], { intent: 'later' });
  await fsp.rename(f.project.workspacePath, `${f.project.workspacePath}-offline`);
  const items = promotion.projectMaterialPromotionItems(f.project);
  assert.equal(items.length, 1); assert.equal(items[0].id, f.item.materialId);
  assert.equal(items[0].sourcePath, ''); assert.equal(items[0].materialVersion, 1);
});

test('canonical plan rejects invented IDs/actions/versions and ignores forged paths/content/student assignments', async (t) => {
  const f = await fixture(t); const input = f.input();
  input.items[0] = { ...input.items[0], sourcePath: 'C:\\foreign\\secret.txt', title: 'pretend.txt', studentId: 'other', content: 'forged claim' };
  const selected = promotion.canonicalPromotionSelection(input, f.canonical());
  assert.equal(selected[0].sourcePath, ''); assert.equal(selected[0].title, '实验.txt'); assert.equal(selected[0].studentId, undefined);
  for (const [patch, code] of [[{ id: 'foreign' }, 'invalid_plan'], [{ action: 'publish' }, 'invalid_action'], [{ materialVersion: 2 }, 'version_conflict'], [{ materialId: 'foreign' }, 'version_conflict']]) {
    assert.throws(() => promotion.canonicalPromotionSelection({ items: [{ ...f.input().items[0], ...patch }] }, f.canonical()), { code });
  }
  assert.throws(() => promotion.canonicalPromotionSelection({ items: [input.items[0], input.items[0]] }, f.canonical()), { code: 'invalid_plan' });
});

test('prepared reference/absorb inputs use pinned snapshots and retain filename/identity', async (t) => {
  const f = await fixture(t);
  const prepared = await promotion.prepareProjectMaterialPromotion(f.project, f.input(), f.canonical(), { authorize: async () => true });
  await fsp.writeFile(f.original, 'unregistered subsequent edit');
  const item = promotion.requirePreparedProjectPromotion(f.project, prepared).items[0];
  assert.equal(await fsp.readFile(item.sourcePath, 'utf8'), 'Synthetic temperature 20 25 30');
  assert.equal(item.sourceMaterial.materialId, f.item.materialId); assert.equal(item.title, '实验.txt');
  const record = (await f.service.store.read()).materials[0];
  assert.ok(record.versions[0].pins.some((value) => value.startsWith('promotion:')));
  assert.throws(() => promotion.requirePreparedProjectPromotion(f.project, JSON.parse(JSON.stringify(prepared))), { code: 'unprepared_promotion' });
});

test('changed original, withdrawn adoption and expired authority cannot be committed', async (t) => {
  const f = await fixture(t); const input = f.input();
  await fsp.writeFile(f.original, 'changed');
  await assert.rejects(promotion.prepareProjectMaterialPromotion(f.project, input, f.canonical(), { authorize: async () => true }), { code: 'source_changed' });
  await fsp.writeFile(f.original, 'Synthetic temperature 20 25 30');
  let checks = 0;
  await assert.rejects(promotion.prepareProjectMaterialPromotion(f.project, input, f.canonical(), { authorize: async () => ++checks < 3 }), { code: 'forbidden' });
  const prepared = await promotion.prepareProjectMaterialPromotion(f.project, input, f.canonical(), { authorize: async () => true });
  await f.service.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  assert.throws(() => promotion.requirePreparedProjectPromotion(f.project, prepared), { code: 'source_changed' });
});

const { createPromotionContext: mainContext } = require('./fixtures/project-promotion-runtime.cjs');

test('actual host preview and execution ignore global asset paths and write exactly selected file version', async (t) => {
  const f = await fixture(t); const main = mainContext(f);
  const preview = JSON.parse(main.context.projectPromotionPlan(f.project.id));
  assert.equal(preview.items.filter((item) => item.kind === 'file').length, 1);
  const input = { items: preview.items.filter((item) => item.kind === 'file').map((item) => ({ ...item, action: 'absorb', sourcePath: 'C:\\foreign\\secret.txt' })) };
  const result = await main.execute(input);
  assert.equal(result.ok, true, result.message); assert.equal(main.assets.length, 1);
  const target = result.results[0].target;
  assert.equal(path.basename(target), '实验.txt'); assert.equal(hash(await fsp.readFile(target)), f.item.sha256);
  assert.equal(result.results[0].sourceMaterial.materialId, f.item.materialId);
  assert.equal(result.results[0].sourceMaterial.version, 1);
  assert.equal(main.projects[0].status, 'archived');
  assert.equal(fs.existsSync(path.join(f.student.rootPath, 'growth', '项目贡献.md')), false);
  const retry = await main.execute(input);
  assert.equal(retry.ok, true); assert.equal(retry.results[0].idempotent, true); assert.equal(main.assets.length, 1);
});

test('actual preflight failures cause no student writes or false archive status', async (t) => {
  const f = await fixture(t); const main = mainContext(f);
  const bad = f.input(); bad.items[0].materialVersion = 9;
  const result = await main.execute(bad);
  assert.equal(result.ok, false); assert.equal(result.code, 'version_conflict');
  assert.equal(main.projects[0].status, 'active'); assert.equal(fs.existsSync(f.student.rootPath), false);
  const denied = mainContext(f, { authorizeInternalTaskOperation: () => ({ ok: false, message: 'revoked' }) });
  assert.equal((await denied.execute()).code, 'forbidden'); assert.equal(fs.existsSync(f.student.rootPath), false);
});

test('async source preparation preserves unrelated project updates and never changes selected version silently', async (t) => {
  const f = await fixture(t); let main;
  main = mainContext(f, { prepareProjectMaterialPromotion: async (...args) => {
    const result = await promotion.prepareProjectMaterialPromotion(...args);
    main.mutateProjects((projects) => { projects[1].note = 'edited during preparation'; projects[0].description = 'new note'; });
    return result;
  } });
  assert.equal((await main.execute()).ok, true);
  assert.equal(main.projects[1].note, 'edited during preparation'); assert.equal(main.projects[0].description, 'new note');
});

test('tampering with a prepared snapshot fails copy validation and rolls back the generated target', async (t) => {
  const f = await fixture(t);
  const main = mainContext(f, { prepareProjectMaterialPromotion: async (...args) => {
    const prepared = await promotion.prepareProjectMaterialPromotion(...args);
    const source = prepared.plan.items[0].sourcePath;
    await fsp.chmod(source, 0o600); await fsp.writeFile(source, 'tampered after preparation');
    return prepared;
  } });
  const result = await main.execute();
  assert.equal(result.ok, false); assert.match(result.message, /固定来源版本不符/);
  assert.equal(fs.existsSync(path.join(f.student.rawPath, '实验.txt')), false); assert.equal(main.assets.length, 0);
  assert.equal(await fsp.readFile(f.original, 'utf8'), 'Synthetic temperature 20 25 30');
});

test('a destination appearing after name selection is never overwritten or deleted by rollback', async (t) => {
  const f = await fixture(t);
  const main = mainContext(f, { uniqueTargetFile: (root, name) => {
    fs.mkdirSync(root, { recursive: true }); const target = path.join(root, name); fs.writeFileSync(target, 'concurrent user file'); return target;
  } });
  assert.equal((await main.execute()).ok, false);
  assert.equal(await fsp.readFile(path.join(f.student.rawPath, '实验.txt'), 'utf8'), 'concurrent user file');
  assert.equal(main.assets.length, 0);
});

test('actual rollback removes only unchanged generated copies and preserves external replacement bytes', async (t) => {
  const f = await fixture(t); const context = mainContext(f).context;
  const transaction = context.createArchiveFileTransaction();
  const unchanged = path.join(f.root, 'created.txt'); const edited = path.join(f.root, 'edited.txt');
  await fsp.writeFile(unchanged, 'copy'); await fsp.writeFile(edited, 'copy');
  transaction.created(unchanged, hash('copy')); transaction.created(edited, hash('copy'));
  await fsp.writeFile(edited, 'user edit'); transaction.rollback();
  assert.equal(fs.existsSync(unchanged), false); assert.equal(await fsp.readFile(edited, 'utf8'), 'user edit');
});

async function knowledgeFixture(f) {
  await fsp.mkdir(f.project.summaryPath, { recursive: true });
  const file = path.join(f.project.summaryPath, '实验摘要.md');
  const content = '# 合成摘要\n20 25 30，不属于真实学生贡献。';
  await fsp.writeFile(file, content);
  await f.service.store.snapshot(f.item.materialId, 1);
  await f.service.store.mutate((index) => { index.knowledge = [{ knowledgeId: 'k1', relativePath: '摘要库/实验摘要.md', sha256: hash(content),
    status: 'committed', sources: [{ materialId: f.item.materialId, version: 1, sha256: f.item.sha256 }] }]; });
  const review = () => ({ records: [{ id: 'k1', path: file, title: '实验摘要', kind: 'summary', status: 'verified', contentSha1: hash(fs.readFileSync(file), 'sha1') }] });
  await fsp.writeFile(path.join(f.project.managerPath, 'knowledge-review.json'), JSON.stringify(review()));
  return { file, content, review };
}

test('actual approved knowledge publication writes fixed content and all source identities without overwriting a student file', async (t) => {
  const f = await fixture(t); const k = await knowledgeFixture(f);
  const main = mainContext(f, { readProjectKnowledgeReview: k.review, appendTextSection: (file, title, content, io = fs) => io.appendFileSync(file, `${title}\n${content}\n`) });
  const preview = JSON.parse(main.context.projectPromotionPlan(f.project.id));
  const item = preview.items.find((entry) => entry.id === 'knowledge-summary');
  assert.equal(item.knowledgeVersions[0].contentSha1, hash(k.content, 'sha1'));
  const existing = path.join(f.student.summaryPath, '摘要库', '实验摘要__合成项目.md');
  await fsp.mkdir(path.dirname(existing), { recursive: true }); await fsp.writeFile(existing, 'student manual original');
  const result = await main.execute({ items: [{ ...item, action: 'publish' }] });
  assert.equal(result.ok, true, result.message);
  const published = result.results.find((entry) => entry.knowledgeKind === 'summary');
  assert.ok(published); assert.notEqual(published.target, existing);
  const content = await fsp.readFile(published.target, 'utf8');
  assert.ok(content.includes(k.content)); assert.ok(content.includes(f.item.materialId));
  assert.equal(published.sourceMaterials[0].version, 1);
  assert.equal(await fsp.readFile(existing, 'utf8'), 'student manual original');
  const retry = await main.execute({ items: [{ ...item, action: 'publish' }] });
  assert.equal(retry.results[0].idempotent, true);
});

test('knowledge review/content changes after confirmation cannot be published by an old plan', async (t) => {
  const f = await fixture(t); const k = await knowledgeFixture(f);
  const main = mainContext(f, { readProjectKnowledgeReview: k.review });
  const item = JSON.parse(main.context.projectPromotionPlan(f.project.id)).items.find((entry) => entry.id === 'knowledge-summary');
  await fsp.writeFile(k.file, 'modified after approval');
  const stale = await main.execute({ items: [{ ...item, action: 'publish' }] });
  assert.equal(stale.code, 'knowledge_changed'); assert.equal(fs.existsSync(f.student.rootPath), false);
  const updated = JSON.parse(main.context.projectPromotionPlan(f.project.id)).items.find((entry) => entry.id === 'knowledge-summary');
  const unlinked = await main.execute({ items: [{ ...updated, action: 'publish' }] });
  assert.equal(unlinked.code, 'knowledge_changed'); assert.equal(fs.existsSync(f.student.rootPath), false);
});

test('knowledge source withdrawal after preparation stops the commit before student writes', async (t) => {
  const f = await fixture(t); const k = await knowledgeFixture(f);
  const main = mainContext(f, { readProjectKnowledgeReview: k.review, prepareProjectMaterialPromotion: async (...args) => {
    const prepared = await promotion.prepareProjectMaterialPromotion(...args);
    await f.service.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
    return prepared;
  } });
  const item = JSON.parse(main.context.projectPromotionPlan(f.project.id)).items.find((entry) => entry.id === 'knowledge-summary');
  const result = await main.execute({ items: [{ ...item, action: 'publish' }] });
  assert.equal(result.ok, false); assert.equal(result.code, 'source_changed'); assert.equal(fs.existsSync(f.student.rootPath), false);
});

test('internal task adapter waits for asynchronous preflight and settles the existing task, not a Promise object', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  let store = { tasks: [{ id: 'task1', sourceId: 'p1', status: 'approved', attempt: 0, input: { operation: 'execute_archive_plan', plan: { items: [] } } }] };
  const processes = new Map();
  const context = vm.createContext({ crypto, fs, setInterval, clearInterval,
    readTaskStore: () => structuredClone(store), writeTaskStore: (value) => { store = structuredClone(value); }, taskNow: () => new Date().toISOString(),
    transitionTaskInStore: (value, id, status, patch) => { const task = value.tasks.find((item) => item.id === id); Object.assign(task, patch, { status }); return { ok: true, task }; },
    performProjectPromotionPlan: () => pending, heartbeatTask() {}, notify() {}, taskChildProcesses: processes,
    normalizeTaskResult: (_task, output) => output });
  vm.runInContext(extract('submitInternalTask'), context);
  const submitted = context.submitInternalTask(store.tasks[0]);
  assert.equal(submitted.ok, true); assert.equal(store.tasks[0].status, 'running');
  const running = processes.get('task1'); assert.equal(running.materialRuntime.canCancel, false);
  resolve(JSON.stringify({ ok: true, results: [], message: 'synthetic done' }));
  await running.completion;
  assert.equal(store.tasks[0].status, 'reviewing'); assert.equal(store.tasks[0].result.structuredOutput.ok, true);
  assert.equal(processes.size, 0);
});

test('durable archive rolls back absorbed files, asset index, growth queue and project together, then resumes the same journal', async (t) => {
  const f = await fixture(t);
  const main = mainContext(f, { createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options,
    hooks: { afterFilesWritten: () => { throw new Error('archive commit interrupted'); } } }) });
  fs.writeFileSync(main.assetFile, JSON.stringify({ assets: [{ assetId: 'unrelated', path: 'unrelated-do-not-read', references: [] }] }));
  const before = fs.readFileSync(main.projectFile), beforeAssets = fs.readFileSync(main.assetFile);
  const failed = await main.execute(); assert.equal(failed.ok, false); assert.match(failed.message, /archive commit interrupted/);
  assert.deepEqual(fs.readFileSync(main.projectFile), before); assert.deepEqual(fs.readFileSync(main.assetFile), beforeAssets);
  assert.equal(fs.existsSync(path.join(f.student.rawPath, '实验.txt')), false);
  assert.equal(fs.existsSync(main.runFile), false); assert.equal(fs.existsSync(main.context.growthRefreshStatePath()), false);
  main.context.createProjectArchiveTransactions = createProjectArchiveTransactions;
  const recovered = await main.execute(); assert.equal(recovered.ok, true, recovered.message); assert.equal(recovered.recovered, true);
  assert.equal(main.assets.length, 2); assert.ok(main.assets.some((asset) => asset.assetId === 'unrelated'));
  assert.equal(main.runs.length, 1); assert.equal(main.projects[0].status, 'archived');
  assert.equal(hash(fs.readFileSync(recovered.results[0].target)), f.item.sha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(main.context.growthRefreshStatePath())).dirty, ['s1']);
});

test('actual archive survives process kill at staging, written and lost-receipt boundaries including asset side effects', { timeout: 40000 }, async (t) => {
  for (const phase of ['afterPrepared', 'afterFilesWritten', 'afterFinalized']) {
    const f = await fixture(t); const main = mainContext(f);
    fs.writeFileSync(path.join(f.root, 'crash-input.json'), JSON.stringify({ root: f.root, project: f.project, student: f.student, input: f.input() }));
    const child = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/project-promotion-crash.cjs'), f.root, phase],
      { windowsHide: true, timeout: 15000, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    assert.equal(child.error, undefined); assert.notEqual(child.status, 0, child.stderr);
    const directory = path.join(f.service.store.directory, 'archive-transactions');
    const ids = fs.readdirSync(directory).filter((id) => id.startsWith('archive-tx-')); assert.equal(ids.length, 1, child.stderr);
    const journal = JSON.parse(fs.readFileSync(path.join(directory, ids[0], 'journal.json')));
    assert.equal(journal.state, phase === 'afterPrepared' ? 'prepared' : 'files_written');
    const restored = await main.execute(); assert.equal(restored.ok, true, restored.message); assert.equal(restored.recovered, true);
    assert.equal(restored.transactionId, ids[0]); assert.equal(main.runs.length, 1); assert.equal(main.assets.length, 1);
    assert.equal(main.projects[0].status, 'archived'); assert.equal(hash(fs.readFileSync(restored.results[0].target)), f.item.sha256);
    assert.equal((await main.execute()).results[0].idempotent, true); assert.equal(main.assets.length, 1);
  }
});

test('durable archive preserves an externally changed asset index and will not replace an unfinished plan with a different action', async (t) => {
  const f = await fixture(t);
  const main = mainContext(f, { createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options,
    hooks: { afterPrepared: () => fs.writeFileSync(main.assetFile, JSON.stringify({ assets: [{ assetId: 'human-new' }] })) } }) });
  const failed = await main.execute(); assert.equal(failed.ok, false); assert.equal(failed.code, 'recovery_conflict');
  assert.equal(main.assets[0].assetId, 'human-new'); assert.equal(main.projects[0].status, 'active');
  assert.equal(fs.existsSync(path.join(f.student.rawPath, '实验.txt')), false);
  main.context.createProjectArchiveTransactions = createProjectArchiveTransactions;
  const different = await main.execute(f.input('reference')); assert.equal(different.ok, false); assert.match(different.message, /其他未完成事务/);
  assert.equal((await main.execute()).code, 'recovery_conflict'); assert.equal(main.assets[0].assetId, 'human-new');
});

test('archive rejects malformed asset data without writes and preserves entries beyond the old 5000-item cap', async (t) => {
  const f = await fixture(t); const main = mainContext(f);
  fs.writeFileSync(main.assetFile, '{invalid');
  assert.equal((await main.execute()).ok, false); assert.equal(fs.readFileSync(main.assetFile, 'utf8'), '{invalid');
  assert.equal(fs.existsSync(path.join(f.student.rawPath, '实验.txt')), false); assert.equal(main.projects[0].status, 'active');
  fs.writeFileSync(main.assetFile, JSON.stringify({ assets: Array.from({ length: 5001 }, (_, n) => ({ assetId: `retained-${n}` })) }));
  const result = await main.execute(); assert.equal(result.ok, true, result.message);
  assert.equal(main.assets.length, 5002); assert.equal(main.assets.at(-1).assetId, 'retained-5000');
});

test('same-named files in one staged archive receive distinct targets before either exists on disk', async (t) => {
  const f = await fixture(t); await fsp.mkdir(path.join(f.project.workspacePath, 'other'));
  await fsp.writeFile(path.join(f.project.workspacePath, 'other', '实验.txt'), 'different synthetic source');
  await f.service.store.registerFiles([{ location: { ...f.location, relativePath: 'other/实验.txt' } }]);
  const main = mainContext(f); const result = await main.execute(); assert.equal(result.ok, true, result.message);
  assert.equal(new Set(result.results.map((entry) => entry.target)).size, 2); assert.equal(main.assets.length, 2);
  for (const entry of result.results) assert.equal(hash(fs.readFileSync(entry.target)), entry.sourceMaterial.sha256);
});

test('mixed file, knowledge and confirmed growth archive rolls back and resumes using actual growth helpers', async (t) => {
  const f = await fixture(t); const k = await knowledgeFixture(f);
  const evidence = { studentId: 's1', ability: 'independent analysis', observation: 'synthetic observed calculation', confidence: 'teacher checked', status: 'verified', sourcePaths: [f.original] };
  const binding = await evidenceApi.createProjectEvidenceService(f.project, { authorize: async () => true }).prepare('s1', evidence);
  evidence.sourceBinding = evidenceApi.sourceBindingRef(binding); f.project.studentEvidence = [evidence];
  const main = mainContext(f, { readProjectKnowledgeReview: k.review,
    createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options,
      hooks: { afterFilesWritten: () => { throw new Error('mixed archive failure'); } } }) });
  main.useRealGrowthHelpers();
  const preview = JSON.parse(main.context.projectPromotionPlan('p1'));
  const input = { items: preview.items.filter((entry) => entry.kind === 'file' || entry.kind === 'growth' || entry.id === 'knowledge-summary')
    .map((entry) => ({ ...entry, action: entry.kind === 'file' ? 'absorb' : 'publish' })) };
  const before = fs.readFileSync(main.projectFile);
  const failed = await main.execute(input); assert.equal(failed.ok, false); assert.match(failed.message, /mixed archive failure/);
  assert.deepEqual(fs.readFileSync(main.projectFile), before);
  assert.equal(fs.existsSync(main.context.growthEvidenceReviewPath()), false);
  assert.equal(fs.existsSync(path.join(f.student.rootPath, 'growth', '能力画像.md')), false);
  assert.equal(fs.existsSync(main.assetFile), false); assert.equal(fs.existsSync(main.runFile), false);
  main.context.createProjectArchiveTransactions = createProjectArchiveTransactions;
  const result = await main.execute(input); assert.equal(result.ok, true, result.message); assert.equal(result.recovered, true);
  const candidate = main.context.readGrowthEvidenceReview().candidates[0];
  assert.equal(candidate.ability, evidence.ability); assert.equal(candidate.content, evidence.observation); assert.equal(candidate.confidence, evidence.confidence);
  assert.equal(candidate.sourceBinding.bindingId, binding.bindingId); assert.equal(candidate.status, 'confirmed');
  assert.ok(fs.readFileSync(result.results.find((entry) => entry.knowledgeKind).target, 'utf8').includes(k.content));
  const evidenceFile = path.join(f.student.rootPath, 'growth', '成长证据.md');
  assert.equal(fs.readFileSync(evidenceFile, 'utf8').match(/<!-- evidence:/g).length, 1);
  assert.equal((await main.execute(input)).ok, true); assert.equal(fs.readFileSync(evidenceFile, 'utf8').match(/<!-- evidence:/g).length, 1);
});

test('adoption withdrawal during final source resolution cannot become the accepted guarded baseline', async (t) => {
  const f = await fixture(t);
  const main = mainContext(f, { createProjectMaterialHost: (project) => {
    const service = host.createProjectMaterialHost(project); const resolve = service.store.resolve;
    service.store.resolve = async (...args) => {
      const result = await resolve(...args);
      await service.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
      return result;
    };
    return service;
  } });
  const result = await main.execute(); assert.equal(result.ok, false); assert.equal(result.code, 'source_changed');
  assert.equal(main.projects[0].status, 'active'); assert.equal(fs.existsSync(main.assetFile), false);
  assert.equal(fs.existsSync(path.join(f.student.rawPath, '实验.txt')), false);
});

test('knowledge approval revoked after durable staging blocks all student writes', async (t) => {
  const f = await fixture(t); await knowledgeFixture(f);
  const reviewFile = path.join(f.project.managerPath, 'knowledge-review.json');
  const main = mainContext(f, { readProjectKnowledgeReview: () => JSON.parse(fs.readFileSync(reviewFile)),
    appendTextSection: (file, title, content, io = fs) => io.appendFileSync(file, `${title}\n${content}\n`),
    createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options, hooks: { afterPrepared: () => {
      const review = JSON.parse(fs.readFileSync(reviewFile)); review.records[0].status = 'rejected'; fs.writeFileSync(reviewFile, JSON.stringify(review));
    } } }) });
  const item = JSON.parse(main.context.projectPromotionPlan('p1')).items.find((entry) => entry.id === 'knowledge-summary');
  const result = await main.execute({ items: [item] }); assert.equal(result.ok, false); assert.match(result.message, /审核状态已经变化/);
  assert.equal(main.projects[0].status, 'active'); assert.equal(fs.existsSync(main.runFile), false);
  assert.deepEqual(fs.readdirSync(path.join(f.student.summaryPath, '摘要库')), []);
});
