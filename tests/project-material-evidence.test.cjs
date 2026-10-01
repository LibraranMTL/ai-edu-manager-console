const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const evidenceApi = require('../electron/project-material-evidence.cjs');
const hostApi = require('../electron/project-material-host.cjs');
const { createProjectArchiveTransactions } = require('../electron/project-archive-transaction.cjs');
const { createProjectMaterialAccess } = require('../electron/project-material-access.cjs');
const { verifiedStudentEvidenceForPublication } = require('../electron/project-evidence.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(mainSource); assert.ok(match, name);
  const end = mainSource.slice(match.index + match[0].length).search(/\n(?:async )?function /);
  return mainSource.slice(match.index, match.index + match[0].length + end);
}
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-material-evidence-'));
  const project = { id: 'p1', name: 'Synthetic Project', status: 'active', studentIds: ['s1', 's2'],
    materialStorageMode: 'workspace-v1', managerPath: path.join(root, '.edu-manager'),
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'legacy'),
    knowledgeRootPath: path.join(root, 'knowledge'), studentEvidence: [] };
  for (const [field, name] of Object.entries({ summaryPath: '摘要库', conceptPath: '概念库', entityPath: '实体库', qaPath: '问答精华库', synthesisPath: '综合汇总库', contributionPath: '知识贡献' })) project[field] = path.join(project.knowledgeRootPath, name);
  project.promotionPath = path.join(project.contributionPath, '申请.md');
  for (const dir of [project.workspacePath, project.rawPath, project.summaryPath, project.contributionPath]) await fsp.mkdir(dir, { recursive: true });
  const host = hostApi.createProjectMaterialHost(project);
  t.after(async () => {
    assert.equal(path.dirname(root), await fsp.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-material-evidence-'));
    for (const dir of ['snapshots', 'evidence-knowledge']) {
      const folder = path.join(host.store.directory, dir);
      for (const name of await fsp.readdir(folder).catch(() => [])) await fsp.chmod(path.join(folder, name), 0o600);
    }
    await fsp.rm(root, { recursive: true, force: true });
  });
  const original = path.join(project.workspacePath, '实验.txt');
  const register = async (content) => {
    await fsp.writeFile(original, content);
    return (await host.store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: '实验.txt' } }])).result[0];
  };
  const material = await register('Synthetic evidence v1, no real student data');
  const evidence = { ability: '数据分析', observation: '合成学生独立计算样本均值', confidence: '人工核对', status: 'verified', sourcePaths: [original] };
  const service = (authorize = async () => true) => evidenceApi.createProjectEvidenceService(project, { authorize });
  return { root, project, host, original, material, evidence, register, service };
}

test('preparation pins exact input, requires private one-use commit token, never creates confirmed evidence itself', async (t) => {
  const f = await fixture(t); const service = f.service();
  const binding = await service.prepare('s1', f.evidence);
  assert.equal(f.project.studentEvidence.length, 0);
  assert.equal(binding.materials[0].version, 1);
  assert.ok((await f.host.store.read()).materials[0].versions[0].pins.includes(binding.bindingId));
  await f.register('new registered v2');
  const confirmed = await service.confirm('s1', f.evidence, binding.bindingId, (token) => {
    const value = evidenceApi.consumeEvidenceBinding(token, 'p1', 's1', f.evidence);
    assert.throws(() => evidenceApi.consumeEvidenceBinding(token, 'p1', 's1', f.evidence), { code: 'evidence_confirmation_required' });
    return value;
  });
  assert.equal(confirmed.materials[0].version, 1);
  assert.throws(() => evidenceApi.consumeEvidenceBinding(JSON.parse(JSON.stringify(binding)), 'p1', 's1', f.evidence), { code: 'evidence_confirmation_required' });
});

test('changed observation or paths, other student and foreign project cannot reuse a binding', async (t) => {
  const f = await fixture(t); const binding = await f.service().prepare('s1', f.evidence);
  for (const changed of [{ ...f.evidence, observation: 'different' }, { ...f.evidence, sourcePaths: [f.project.workspacePath] }]) {
    await assert.rejects(f.service().readBinding('s1', changed, binding.bindingId), { code: 'evidence_changed' });
  }
  await assert.rejects(f.service().readBinding('s2', f.evidence, binding.bindingId), { code: 'evidence_binding_missing' });
  await assert.rejects(f.service().prepare('foreign', f.evidence), { code: 'forbidden' });
  const foreign = evidenceApi.createProjectEvidenceService({ ...f.project, id: 'other' }, { authorize: async () => true });
  await assert.rejects(foreign.readBinding('s1', f.evidence, binding.bindingId), { code: 'registry_corrupt' });
});

test('text corrections retain old fixed sources; new selection creates distinct preview identity', async (t) => {
  const f = await fixture(t); const old = await f.service().prepare('s1', f.evidence);
  const previous = { ...f.evidence, sourceBinding: evidenceApi.sourceBindingRef(old) };
  await f.register('new v2');
  const correction = { ...f.evidence, observation: '更正具体表现文字' };
  const binding = await f.service().prepare('s1', correction, previous);
  assert.equal(binding.materials[0].version, 1);
  assert.notEqual(binding.bindingId, old.bindingId);
  const newlySelected = await f.service().prepare('s1', correction);
  assert.equal(newlySelected.materials[0].version, 2);
});

test('withdrawal, tampered snapshot and expired permission block confirmation', async (t) => {
  const f = await fixture(t); const binding = await f.service().prepare('s1', f.evidence);
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  await assert.rejects(f.service().readBinding('s1', f.evidence, binding.bindingId), { code: 'source_withdrawn' });
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'accepted'; });
  const fixed = await f.host.store.resolve(f.material.materialId, 1);
  await fsp.chmod(fixed.path, 0o600); await fsp.writeFile(fixed.path, 'tampered');
  await assert.rejects(f.service().readBinding('s1', f.evidence, binding.bindingId), { code: 'source_changed' });
  await assert.rejects(f.service(async () => false).readBinding('s1', f.evidence, binding.bindingId), { code: 'forbidden' });
});

test('directory, foreign path, candidate and malformed selection cannot be accepted as source evidence', async (t) => {
  const f = await fixture(t);
  for (const source of [f.project.workspacePath, path.join(f.root, 'foreign.txt'), '实验.txt']) {
    await assert.rejects(f.service().prepare('s1', { ...f.evidence, sourcePaths: [source] }));
  }
  await assert.rejects(f.service().prepare('s1', { ...f.evidence, sourcePaths: 'bad' }), { code: 'evidence_sources_required' });
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'candidate'; });
  await assert.rejects(f.service().prepare('s1', f.evidence), { code: 'source_not_adopted' });
});

test('knowledge sources freeze both approved body and original version after knowledge edits', async (t) => {
  const f = await fixture(t); await f.host.store.snapshot(f.material.materialId, 1);
  const document = path.join(f.project.summaryPath, '摘要.md'); const body = '# Synthetic summary v1';
  await fsp.writeFile(document, body);
  await f.host.store.mutate((index) => { index.knowledge = [{ knowledgeId: 'k1', status: 'committed', relativePath: '摘要库/摘要.md', sha256: hash(body),
    sources: [{ materialId: f.material.materialId, version: 1, sha256: f.material.sha256 }] }]; });
  const evidence = { ...f.evidence, sourcePaths: [document] };
  const binding = await f.service().prepare('s1', evidence);
  await fsp.writeFile(document, '# edited afterwards'); await f.register('original v2');
  assert.equal((await f.service().readBinding('s1', evidence, binding.bindingId)).knowledge[0].sha256, hash(body));
  const fixed = path.join(f.host.store.directory, binding.knowledge[0].snapshot);
  assert.equal(await fsp.readFile(fixed, 'utf8'), body);
  await assert.rejects(f.service().prepare('s2', evidence), { code: 'knowledge_unlinked' });
  await fsp.chmod(fixed, 0o600); await fsp.writeFile(fixed, 'tampered');
  await assert.rejects(f.service().readBinding('s1', evidence, binding.bindingId), { code: 'source_changed' });
});

const { createEvidenceContext: mainContext } = require('./fixtures/project-evidence-runtime.cjs');

test('actual host preview is non-confirming, commit persists versioned evidence and corrections preserve old source', async (t) => {
  const f = await fixture(t); const main = mainContext(f);
  const preview = await main.call(); assert.equal(preview.ok, true, preview.message); assert.equal(preview.needsSourceConfirmation, true);
  assert.equal(main.context.readProjects()[0].studentEvidence.length, 0); assert.equal(fs.existsSync(main.reviewFile), false);
  const saved = await main.call(f.evidence, preview.bindingId); assert.equal(saved.ok, true, saved.message);
  assert.equal(saved.evidence.sourceBinding.bindingId, preview.bindingId); assert.equal(saved.evidence.status, 'verified');
  const review = main.context.readGrowthEvidenceReview(); assert.equal(review.candidates[0].status, 'confirmed');
  assert.equal(review.candidates[0].sourceMaterials[0].version, 1);
  assert.match(fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8'), /evidence-binding-/);
  const oldReplay = await main.call(f.evidence, preview.bindingId); assert.equal(oldReplay.alreadyConfirmed, true); assert.equal(oldReplay.confirmationId, saved.confirmationId);
  await f.register('v2'); const correction = { ...f.evidence, observation: 'corrected observation', status: 'published' };
  const next = await main.call(correction); const nextSaved = await main.call(correction, next.bindingId);
  assert.equal(nextSaved.ok, true, nextSaved.message); assert.equal(nextSaved.evidence.status, 'verified');
  assert.equal(main.context.readGrowthEvidenceReview().candidates[0].sourceMaterials[0].version, 1);
  assert.equal(fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8').match(/<!-- evidence:/g).length, 2);
});

test('actual host rejects forged sync confirmation, stale preview, changed scope and wrong renderer', async (t) => {
  const f = await fixture(t); const main = mainContext(f);
  const forged = JSON.parse(main.context.updateProjectStudentEvidence('p1', 's1', JSON.stringify(f.evidence), { bindingId: 'forged' }));
  assert.equal(forged.code, 'evidence_confirmation_required');
  const preview = await main.call();
  main.context.updateProjectRecord('p1', (p) => ({ ...p, studentEvidence: [{ ...f.evidence, studentId: 's1', status: 'draft', observation: 'concurrent edit' }] }));
  assert.equal((await main.call(f.evidence, preview.bindingId)).code, 'evidence_conflict');
  const wrong = JSON.parse(await main.context.updateProjectStudentEvidenceAsync({ sender: {}, senderFrame: {} }, 'p1', 's1', JSON.stringify(f.evidence)));
  assert.equal(wrong.code, 'forbidden');
  main.context.updateProjectRecord('p1', (p) => ({ ...p, studentIds: [] }));
  assert.equal((await main.call()).code, 'forbidden');
});

test('actual confirmation native write failure restores project, growth candidates and human-readable evidence file', async (t) => {
  const f = await fixture(t); const main = mainContext(f, {
    createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options, hooks: { afterFilesWritten: () => { throw new Error('injected native failure'); } } }),
  });
  const file = path.join(f.project.contributionPath, '学生独立成长证据', 'Synthetic Student-s1.md');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'existing text');
  const original = fs.readFileSync(main.projectFile, 'utf8'); const preview = await main.call();
  const result = await main.call(f.evidence, preview.bindingId); assert.equal(result.ok, false); assert.match(result.message, /injected/);
  assert.equal(fs.readFileSync(main.projectFile, 'utf8'), original); assert.equal(fs.readFileSync(file, 'utf8'), 'existing text');
  assert.equal(fs.existsSync(main.reviewFile), false);
});

test('generic review and automatic low-risk policy cannot bypass project fixed-source confirmation', async (t) => {
  const f = await fixture(t); const main = mainContext(f);
  main.context.ensureGrowthModelForStudent(main.context.readStudentsIndex()[0]);
  const candidate = { id: 'e1', projectId: 'p1', status: 'pending', sourcePath: f.original };
  main.context.writeGrowthEvidenceReview(null, { candidates: [candidate] });
  const result = JSON.parse(main.context.updateGrowthEvidenceStatus('s1', 'e1', 'confirmed'));
  assert.equal(result.code, 'project_confirmation_required'); assert.equal(main.context.readGrowthEvidenceReview().candidates[0].status, 'pending');
  assert.equal(JSON.parse(main.context.updateGrowthEvidenceStatus('s1', 'e1', 'rejected')).code, 'project_confirmation_required');
  Object.assign(main.context, { mapGrowthEvidenceReviewToEducationClaims: () => ({ reviewQueue: [] }),
    buildGrowthEvidenceBatchPlan: () => ({ summary: { batchProcessable: 1 }, confirmIds: ['e1'], watchIds: [] }),
    applyGrowthEvidenceReviewDecision: () => { throw new Error('must not automatically confirm'); } });
  const automatic = main.context.applyAutomaticGrowthEvidencePlan({ id: 's1' }, { candidates: [candidate] });
  assert.equal(automatic.confirmed, 0); assert.equal(candidate.status, 'pending');
});

test('legacy evidence still uses existing synchronous workflow', async (t) => {
  const f = await fixture(t); f.project.materialStorageMode = 'legacy'; const main = mainContext(f);
  const result = await main.call(); assert.equal(result.ok, true, result.message); assert.equal(result.needsSourceConfirmation, undefined);
  assert.equal(result.evidence.sourceBinding, undefined);
});

test('actual standalone publication preserves fixed sources after original updates, without student attribution to others', async (t) => {
  const f = await fixture(t); const main = mainContext(f); const preview = await main.call();
  assert.equal((await main.call(f.evidence, preview.bindingId)).ok, true);
  await f.register('v2 must not replace the confirmed v1');
  const result = JSON.parse(await main.context.performPublishProjectPromotion('p1', { taskId: 'task1', executionId: 'run1' }));
  assert.equal(result.ok, true, result.message); assert.equal(result.growthEvidencePublished, 1);
  assert.equal(result.project.studentEvidence[0].status, 'published');
  assert.equal(result.published[0].sourceMaterials[0].version, 1);
  assert.equal(main.context.readGrowthEvidenceReview().candidates[0].sourceBinding.bindingId, preview.bindingId);
  assert.equal(main.runs[0].published[0].sourceBinding.bindingId, preview.bindingId);
  const text = fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8');
  assert.match(text, /v1/); assert.doesNotMatch(text, /v2 must not/);
  const repeat = JSON.parse(await main.context.performPublishProjectPromotion('p1', { taskId: 'task1', executionId: 'run2' }));
  assert.equal(repeat.ok, true, repeat.message);
  assert.equal(fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8'), text);
});

test('legacy unbound verified evidence and withdrawn versions block standalone publication before student writes', async (t) => {
  const f = await fixture(t); const main = mainContext(f);
  main.context.updateProjectRecord('p1', (p) => ({ ...p, studentEvidence: [{ ...f.evidence, studentId: 's1' }] }));
  const missing = JSON.parse(await main.context.performPublishProjectPromotion('p1', {}));
  assert.equal(missing.ok, false); assert.equal(missing.code, 'evidence_binding_missing'); assert.equal(fs.existsSync(main.growthDir), false);
  const preview = await main.call(); assert.equal((await main.call(f.evidence, preview.bindingId)).ok, true);
  const before = fs.readFileSync(main.projectFile, 'utf8'); const evidenceBefore = fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8');
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  const withdrawn = JSON.parse(await main.context.performPublishProjectPromotion('p1', {}));
  assert.equal(withdrawn.ok, false); assert.equal(withdrawn.code, 'source_withdrawn');
  assert.equal(fs.readFileSync(main.projectFile, 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8'), evidenceBefore);
});

test('prepared publication rejects changed evidence, new scope and invented preparation objects', async (t) => {
  const f = await fixture(t); const main = mainContext(f); const preview = await main.call(); await main.call(f.evidence, preview.bindingId);
  const project = main.context.readProjects()[0]; const prepared = await evidenceApi.prepareEvidencePublication(project, { authorize: async () => true });
  assert.equal(evidenceApi.requireEvidencePublication(project, prepared).size, 1);
  assert.throws(() => evidenceApi.requireEvidencePublication(project, structuredClone(prepared)), { code: 'unprepared_evidence' });
  project.studentEvidence[0].observation = 'concurrent edit';
  assert.throws(() => evidenceApi.requireEvidencePublication(project, prepared), { code: 'evidence_changed' });
});

test('actual publication rollback and retry restore the same durable result rather than append duplicate evidence or audit rows', async (t) => {
  const f = await fixture(t); const main = mainContext(f, {
    createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options,
      hooks: { afterFilesWritten: ({ journal }) => { if (journal.metadata.operation === 'publish_growth_evidence') throw new Error('injected publication interruption'); } } }),
  });
  const preview = await main.call(); await main.call(f.evidence, preview.bindingId);
  const before = fs.readFileSync(main.projectFile, 'utf8');
  const dirtyBefore = fs.readFileSync(main.context.growthRefreshStatePath(), 'utf8');
  const evidenceBefore = fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8');
  const failed = JSON.parse(await main.context.performPublishProjectPromotion('p1', {}));
  assert.equal(failed.ok, false); assert.match(failed.message, /injected/);
  assert.equal(fs.readFileSync(main.projectFile, 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8'), evidenceBefore);
  assert.equal(fs.readFileSync(main.context.growthRefreshStatePath(), 'utf8'), dirtyBefore);
  main.context.createProjectArchiveTransactions = createProjectArchiveTransactions;
  const retry = JSON.parse(await main.context.performPublishProjectPromotion('p1', {}));
  assert.equal(retry.ok, true, retry.message); assert.equal(retry.recovered, true);
  assert.equal(main.runs.length, 1); assert.equal(main.context.readProjects()[0].studentEvidence[0].status, 'published');
  assert.deepEqual(JSON.parse(fs.readFileSync(main.context.growthRefreshStatePath())).dirty, ['s1']);
  assert.equal(fs.readFileSync(path.join(main.growthDir, '成长证据.md'), 'utf8'), evidenceBefore);
});

test('actual publication recovers a finalized write with lost acknowledgement; changed human text is never overwritten', async (t) => {
  const f = await fixture(t); const main = mainContext(f, {
    createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options,
      hooks: { afterFinalized: ({ journal }) => { if (journal.metadata.operation === 'publish_growth_evidence') throw new Error('lost receipt'); } } }),
  });
  const preview = await main.call(); await main.call(f.evidence, preview.bindingId);
  const failed = JSON.parse(await main.context.performPublishProjectPromotion('p1', {}));
  assert.equal(failed.ok, false); assert.equal(main.context.readProjects()[0].status, 'published');
  const summaryFile = path.join(f.root, 'student', 'summary', '项目贡献汇总.md');
  const intended = fs.readFileSync(summaryFile, 'utf8'); fs.appendFileSync(summaryFile, '\nhuman edit');
  main.context.createProjectArchiveTransactions = createProjectArchiveTransactions;
  const conflict = JSON.parse(await main.context.performPublishProjectPromotion('p1', {}));
  assert.equal(conflict.ok, false); assert.equal(conflict.code, 'recovery_conflict');
  assert.match(fs.readFileSync(summaryFile, 'utf8'), /human edit/);
  // Test fixture explicitly reconciles its synthetic edit, then resumes.
  fs.writeFileSync(summaryFile, intended);
  const recovered = JSON.parse(await main.context.performPublishProjectPromotion('p1', {}));
  assert.equal(recovered.ok, true, recovered.message); assert.equal(recovered.recovered, true); assert.equal(main.runs.length, 1);
  assert.equal(fs.readFileSync(summaryFile, 'utf8'), intended);
});

test('actual preload and IPC registration carry the preview binding through the licensed asynchronous host flow', async (t) => {
  const f = await fixture(t); const main = mainContext(f); const handlers = new Map();
  main.context.ipcMain = { handle: (channel, callback) => handlers.set(channel, callback) };
  main.context.setImmediate = setImmediate;
  main.context.licensedInvoke = Function('scope', `with (scope) { return (${extract('licensedInvoke')}); }`)(main.context);
  const registration = mainSource.split('\n').find((line) => line.startsWith("ipcMain.handle('bridge:updateProjectStudentEvidenceAsync'"));
  assert.ok(registration); Function('scope', `with (scope) { ${registration} }`)(main.context);
  let bridge;
  const preload = vm.createContext({ require: (name) => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } }, ipcRenderer: {
      invoke: (channel, ...args) => handlers.get(channel)(main.event, ...args),
      sendSync() { throw new Error('confirmation must use asynchronous IPC'); },
    } };
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), preload);
  const preview = JSON.parse(await bridge.updateProjectStudentEvidenceAsync('p1', 's1', JSON.stringify(f.evidence)));
  assert.equal(preview.needsSourceConfirmation, true);
  const result = JSON.parse(await bridge.updateProjectStudentEvidenceAsync('p1', 's1', JSON.stringify(f.evidence), preview.bindingId));
  assert.equal(result.ok, true, result.message); assert.equal(result.evidence.sourceBinding.bindingId, preview.bindingId);
});

test('permission loss while fixed versions are being prepared prevents a preview from being approved', async (t) => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(f.service(async () => ++calls < 3).prepare('s1', f.evidence), { code: 'forbidden' });
  assert.equal(f.project.studentEvidence.length, 0);
});
