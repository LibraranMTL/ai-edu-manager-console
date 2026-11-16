const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createProjectMaterialAccess } = require('../electron/project-material-access.cjs');
const { createProjectMaterialTask, materialTaskCheckpointForCandidate } = require('../electron/project-material-task.cjs');
const { stageMaterialResponse } = require('../electron/project-material-agent.cjs');
const { RESULT_SCHEMA } = require('../electron/project-material-digest.cjs');
const { createManualMaterialBatch } = require('../electron/project-material-manual.cjs');
const windowsOnly = { skip: process.platform !== 'win32' };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-task-test-'));
  const project = { id: 'p1', name: 'Synthetic', studentIds: ['s1'], status: 'active', agentTool: 'codex',
    materialStorageMode: 'workspace-v1', projectRootPath: root, agentPath: path.join(root, 'AGENT.md'),
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'legacy'),
    knowledgeRootPath: path.join(root, 'knowledge'), managerPath: path.join(root, '.edu-manager') };
  for (const dir of [project.workspacePath, project.rawPath, project.knowledgeRootPath]) await fs.mkdir(dir);
  await fs.writeFile(project.agentPath, '项目分类遵守人工决定；不得推断个人贡献。');
  await fs.writeFile(path.join(project.workspacePath, 'a.txt'), 'SYNTHETIC temperature 20 25 30');
  const { store } = createProjectMaterialHost(project);
  const item = (await store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: 'a.txt' } }])).result[0];
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-task-test-'));
    for (const file of await fs.readdir(path.join(store.directory, 'snapshots')).catch(() => [])) await fs.chmod(path.join(store.directory, 'snapshots', file), 0o600);
    await fs.rm(root, { recursive: true, force: true });
  });
  let checkpoint = {}, calls = 0, authorized = true;
  const execute = async ({ batch, projectRules }) => {
    calls++;
    assert.match(projectRules, /人工决定/);
    return stageMaterialResponse(batch, { schema: RESULT_SCHEMA, projectId: batch.projectId, batchId: batch.batchId,
      status: 'completed', message: 'synthetic result', artifacts: batch.baselines.map((target) => ({ relativePath: target.relativePath,
        content: '# Synthetic\n20 25 30；并非学生贡献。', sources: batch.sources.filter((source) => target.materialIds.includes(source.materialId)) })) });
  };
  const options = { project, executionId: 'e1', executable: 'synthetic.exe',
    onCheckpoint: async (value) => { checkpoint = structuredClone(value); }, authorize: async () => authorized,
    verifySandbox: async () => ({ passed: true }), execute };
  return { root, project, store, item, execute, options,
    get checkpoint() { return checkpoint; }, get calls() { return calls; }, revoke() { authorized = false; } };
}

test('task execution fixes rules and sources, commits five knowledge categories, then settles source version', windowsOnly, async (t) => {
  const f = await fixture(t); const result = await createProjectMaterialTask(f.options).run();
  assert.equal(result.fullyCommitted, true); assert.equal(result.remainingCount, 0); assert.equal(f.calls, 1);
  assert.equal(f.checkpoint.phase, 'committed');
  const index = await f.store.read();
  assert.equal(index.materials[0].processing.processedVersion, 1); assert.equal(index.knowledge.length, 5);
  const access = createProjectMaterialAccess({ ...f.project,
    summaryPath: path.join(f.project.knowledgeRootPath, '摘要库'), conceptPath: path.join(f.project.knowledgeRootPath, '概念库'),
    entityPath: path.join(f.project.knowledgeRootPath, '实体库'), qaPath: path.join(f.project.knowledgeRootPath, '问答精华库'),
    synthesisPath: path.join(f.project.knowledgeRootPath, '综合汇总库') }, { authorize: async () => true });
  for (const artifact of index.knowledge) {
    const document = await access.readKnowledge(artifact.relativePath);
    assert.equal(document.provenance, 'linked'); assert.equal(document.sources[0].materialId, f.item.materialId);
    const source = await access.prepareKnowledgeSource(artifact.relativePath, document.sha256, f.item.materialId, 1);
    assert.equal(source.bytes.toString(), 'SYNTHETIC temperature 20 25 30');
  }
  assert.match(await fs.readFile(path.join(f.project.workspacePath, 'a.txt'), 'utf8'), /SYNTHETIC/);
});

test('manual frozen batch validates sources and commits isolated project knowledge', windowsOnly, async t => {
  const f = await fixture(t);
  const manual = createManualMaterialBatch({ project: f.project, authorize: async () => true, scopeFingerprint: 'scope-1' });
  const packet = await manual.prepare([f.item.materialId]);
  assert.match(packet.sources[0].text, /SYNTHETIC/);
  const source = packet.sources[0];
  const response = { schema: RESULT_SCHEMA, projectId: f.project.id, batchId: packet.batchId, scopeFingerprint: 'scope-1', status: 'completed', message: 'synthetic',
    artifacts: packet.baselines.map(target => ({ relativePath: target.relativePath, content: '# Synthetic\n20 25 30', sources: [{ materialId: source.materialId, version: source.version, sha256: source.sha256 }] })) };
  const incomplete = structuredClone(response); incomplete.artifacts.pop();
  await assert.rejects(manual.accept(packet.batchId, incomplete), { code: 'incomplete_artifacts' });
  assert.equal(((await f.store.read()).knowledge || []).length, 0);
  const invalid = structuredClone(response); invalid.artifacts[0].sources[0].sha256 = '0'.repeat(64);
  await assert.rejects(manual.accept(packet.batchId, invalid), { code: 'source_mismatch' });
  assert.equal(((await f.store.read()).knowledge || []).length, 0);
  const result = await manual.accept(packet.batchId, response);
  assert.equal(result.fullyCommitted, true);
  const index = await f.store.read();
  assert.equal(index.materials[0].processing.processedVersion, 1);
  assert.equal(index.knowledge.length, 5);
  assert.match(await fs.readFile(path.join(f.project.workspacePath, 'a.txt'), 'utf8'), /SYNTHETIC/);
});
test('manual batch cannot commit after source mutation or authority revocation', windowsOnly, async t => {
  const f = await fixture(t); let allowed = true;
  const manual = createManualMaterialBatch({ project: f.project, authorize: async () => allowed, scopeFingerprint: 'scope-1' });
  const packet = await manual.prepare([f.item.materialId]), ref = packet.sources[0];
  const response = { schema: RESULT_SCHEMA, projectId: f.project.id, batchId: packet.batchId, scopeFingerprint: 'scope-1', status: 'completed', message: 'synthetic',
    artifacts: packet.baselines.map(target => ({ relativePath: target.relativePath, content: '# Candidate', sources: [{ materialId: ref.materialId, version: ref.version, sha256: ref.sha256 }] })) };
  allowed = false; await assert.rejects(manual.accept(packet.batchId, response), { code: 'project_scope_changed' });
  allowed = true; await fs.writeFile(path.join(f.project.workspacePath, 'a.txt'), 'changed source');
  const result = await manual.accept(packet.batchId, response);
  assert.equal(result.fullyCommitted, false);
  assert.equal(((await f.store.read()).knowledge || []).length, 0);
});

test('manual project work retains 21 frozen sources across two validated batches', windowsOnly, async t => {
  const f = await fixture(t);
  const entries = [];
  for (let i = 0; i < 20; i++) {
    const relativePath = `extra-${i}.txt`;
    await fs.writeFile(path.join(f.project.workspacePath, relativePath), `synthetic source ${i}`);
    entries.push({ location: { rootId: 'workspace', kind: 'workspace', relativePath } });
  }
  await f.store.registerFiles(entries);
  const task = { id:'task-project', kind:'project_digest', sourceType:'project', sourceId:f.project.id, status:'approved', executionId:'', input:{},
    permissions:{read:[f.project.workspacePath,f.project.rawPath],write:[f.project.knowledgeRootPath,f.project.managerPath],operations:['read','write_project_knowledge']} };
  const store={tasks:[task]}, main=await fs.readFile(path.join(__dirname,'../electron/main.cjs'),'utf8');
  const context=vm.createContext({crypto:require('node:crypto'),path,require:require('node:module').createRequire(path.join(__dirname,'../electron/main.cjs')),
    mutableProject:()=>({project:f.project}),isWorkspaceMaterialProject:()=>true,createProjectMaterialHost,readTaskStore:()=>store,
    agentControlStore:()=>({read:()=>({global:{enabled:true}})}),licenseRequiredJson:()=>null,validateTaskPermissionDeclaration:()=>({ok:true}),
    taskPathAllowed:(candidate,roots)=>roots.some(root=>candidate===root||candidate.startsWith(`${root}${path.sep}`)),
    RESEARCH_KINDS:new Set(),PROJECT_SCOPE_CONTRACT_VERSION:'v2',taskNow:()=>new Date().toISOString(),parseJsonText:JSON.parse });
  for(const name of ['manualDigestContext','manualDigestPermissionAllowed','prepareManualDigest','validateImportedTaskCompletion']) { let start=main.indexOf(`function ${name}(`);if(main.slice(start-6,start)==='async ')start-=6;vm.runInContext(main.slice(start,main.indexOf('\n}',start)+2),context); }
  for (let part=0;part<2;part++) {
    task.status='approved'; const prepared=await context.prepareManualDigest(task);
    assert.equal(prepared.queue.length,21); assert.equal(prepared.packet.sources.length,part===0?20:1);
    task.input.manualMaterial={batchId:prepared.packet.batchId,fingerprint:prepared.fingerprint,registered:[],studentBatchId:'',queue:prepared.queue};
    task.executionId=`manual-${part}`;task.status='waiting_result';task.executionMode='manual';
    const data={schema:RESULT_SCHEMA,projectId:f.project.id,batchId:prepared.packet.batchId,scopeFingerprint:prepared.fingerprint,status:'completed',message:'synthetic',
      artifacts:prepared.packet.baselines.map(target=>({relativePath:target.relativePath,content:'# Synthetic',sources:prepared.packet.sources.filter(ref=>target.materialIds.includes(ref.materialId)).map(({materialId,version,sha256})=>({materialId,version,sha256}))}))};
    const result=await context.validateImportedTaskCompletion(task,{status:'completed',data});
    assert.equal(result.valid,true,result.message); assert.equal(Boolean(result.partial),part===0);
  }
  const index=await f.store.read();assert.equal(index.materials.filter(x=>x.processing.state==='completed').length,21);assert.equal(index.knowledge.length,105);
});

test('task-center manual project batch prepares and settles through the real knowledge committer', windowsOnly, async t => {
  const f = await fixture(t);
  const task = { id: 'task-project', kind: 'project_digest', sourceType: 'project', sourceId: f.project.id, status: 'approved', executionId: '', input: {},
    permissions: { read: [f.project.workspacePath, f.project.rawPath], write: [f.project.knowledgeRootPath, f.project.managerPath], operations: ['read','write_project_knowledge'] } };
  const store = { tasks: [task] }, main = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const context = vm.createContext({ crypto: require('node:crypto'), path, require: require('node:module').createRequire(path.join(__dirname, '../electron/main.cjs')),
    mutableProject: () => ({ project: f.project }), isWorkspaceMaterialProject: () => true, createProjectMaterialHost,
    readTaskStore: () => store, agentControlStore: () => ({ read: () => ({ global: { enabled: true } }) }), licenseRequiredJson: () => null,
    validateTaskPermissionDeclaration: () => ({ ok: true }), taskPathAllowed: (candidate, roots) => roots.some(root => candidate === root || candidate.startsWith(`${root}${path.sep}`)),
    RESEARCH_KINDS: new Set(), PROJECT_SCOPE_CONTRACT_VERSION: 'edu-manager.agent-capabilities.v2', taskNow: () => new Date().toISOString(), parseJsonText: JSON.parse });
  for (const name of ['manualDigestContext','manualDigestPermissionAllowed','prepareManualDigest','validateImportedTaskCompletion']) {
    let start = main.indexOf(`function ${name}(`); if (main.slice(start-6,start)==='async ') start-=6;
    vm.runInContext(main.slice(start,main.indexOf('\n}',start)+2),context);
  }
  const prepared = await context.prepareManualDigest(task);
  task.input.manualMaterial = { batchId: prepared.packet.batchId, fingerprint: prepared.fingerprint, registered: [], studentBatchId: '' };
  task.executionId = 'manual-1'; task.status = 'waiting_result'; task.executionMode = 'manual';
  const ref = prepared.packet.sources[0];
  const data = { schema: RESULT_SCHEMA, projectId: f.project.id, batchId: prepared.packet.batchId, scopeFingerprint: prepared.fingerprint, status:'completed', message:'synthetic',
    artifacts: prepared.packet.baselines.map(target => ({ relativePath: target.relativePath, content:'# Synthetic\n20 25 30', sources:[{ materialId:ref.materialId, version:ref.version, sha256:ref.sha256 }] })) };
  const result = await context.validateImportedTaskCompletion(task, { status:'completed', data });
  assert.equal(result.valid, true, result.message);
  assert.equal((await f.store.read()).materials[0].processing.state, 'completed');
  assert.equal((await f.store.read()).knowledge.length, 5);
});

test('scope revoked after Agent output prevents official knowledge writes and leaves source incomplete', windowsOnly, async (t) => {
  const f = await fixture(t);
  const runtime = createProjectMaterialTask({ ...f.options, execute: async (options) => { const result = await f.execute(options); f.revoke(); return result; } });
  await assert.rejects(runtime.run(), { code: 'project_scope_changed' });
  assert.equal((await f.store.read()).materials[0].processing.state, 'failed_terminal');
  assert.equal((await fs.readdir(f.project.knowledgeRootPath)).length, 0);
});

test('cancelled extraction restores pending state without publishing staged knowledge', windowsOnly, async (t) => {
  const f = await fixture(t); const controller = new AbortController();
  const runtime = createProjectMaterialTask({ ...f.options, signal: controller.signal,
    execute: async (options) => { controller.abort(); return f.execute(options); } });
  await assert.rejects(runtime.run(), { code: 'cancelled' });
  assert.equal((await f.store.read()).materials[0].processing.state, 'pending');
  assert.equal((await fs.readdir(f.project.knowledgeRootPath)).length, 0);
});

test('retry recovers output-ready checkpoint without a second AI call', windowsOnly, async (t) => {
  const f = await fixture(t); let persisted;
  const first = createProjectMaterialTask({ ...f.options, onCheckpoint: async (value) => {
    await f.options.onCheckpoint(value);
    if (value.phase === 'output_ready') { persisted = value; throw new Error('synthetic application exit'); }
  } });
  await assert.rejects(first.run(), /synthetic application exit/);
  assert.equal(f.calls, 1);
  const result = await createProjectMaterialTask({ ...f.options, executionId: 'e2', checkpoint: persisted }).run();
  assert.equal(result.fullyCommitted, true); assert.equal(f.calls, 1);
});

test('retry after knowledge commit before task checkpoint uses journal replay, not new AI output', windowsOnly, async (t) => {
  const f = await fixture(t);
  await assert.rejects(createProjectMaterialTask({ ...f.options, hooks: { afterCommit() { throw new Error('exit after ledger'); } } }).run(), /exit after ledger/);
  assert.equal(f.checkpoint.phase, 'committing');
  const result = await createProjectMaterialTask({ ...f.options, executionId: 'e2', checkpoint: f.checkpoint }).run();
  assert.equal(result.fullyCommitted, true); assert.equal(f.calls, 1);
  assert.equal((await f.store.read()).commits.length, 1);
});

test('commit window cannot be cancelled; authority loss under locks rolls back target files', windowsOnly, async (t) => {
  const f = await fixture(t); let runtime;
  runtime = createProjectMaterialTask({ ...f.options, hooks: { commit: { async afterLocked() {
    assert.equal(runtime.canCancel, false);
    f.revoke();
    throw Object.assign(new Error('scope revoked'), { code: 'project_scope_changed' });
  } } } });
  await assert.rejects(runtime.run(), { code: 'project_scope_changed' });
  const index = await f.store.read(); assert.equal(index.commits.length, 0);
  assert.notEqual(index.materials[0].processing.state, 'completed');
});

test('failed sandbox probe never invokes Agent or creates a batch', async (t) => {
  const f = await fixture(t);
  await assert.rejects(createProjectMaterialTask({ ...f.options, verifySandbox: async () => { throw Object.assign(new Error('denied'), { code: 'sandbox_unverified' }); } }).run(), { code: 'sandbox_unverified' });
  assert.equal(f.calls, 0); assert.deepEqual(f.checkpoint, {});
  assert.equal((await f.store.read()).materials[0].processing.state, 'pending');
});

test('host-mediated no-tool isolation continues automatically and records degraded evidence', windowsOnly, async (t) => {
  const f = await fixture(t);
  let received;
  const result = await createProjectMaterialTask({ ...f.options,
    verifySandbox: async () => ({ passed: false, mode: 'host-mediated-no-tools', executable: 'synthetic.exe', executableSha256: 'synthetic' }),
    execute: async (options) => { received = options.sandboxEvidence; return f.execute(options); },
  }).run();
  assert.equal(result.fullyCommitted, true);
  assert.equal(received.mode, 'host-mediated-no-tools');
  assert.equal(f.checkpoint.isolationMode, 'host-mediated-no-tools');
  assert.equal(f.checkpoint.sandboxVerified, false);
});

test('task refresh keeps interrupted commit checkpoints but not a previous completed cycle', () => {
  const current = { kind: 'project_digest', sourceId: 'p1', status: 'failed',
    input: { materialExecution: { phase: 'committing', batchId: 'b1' } } };
  const candidate = { kind: 'project_digest', sourceId: 'p1', input: { controlledMaterial: true } };
  assert.equal(materialTaskCheckpointForCandidate(current, candidate).materialExecution.batchId, 'b1');
  assert.equal(materialTaskCheckpointForCandidate({ ...current, status: 'succeeded' }, candidate), null);
  assert.equal(materialTaskCheckpointForCandidate(current, { ...candidate, sourceId: 'p2' }), null);
});

test('more than one bounded batch continues in the same task until all pending versions settle', windowsOnly, async (t) => {
  const f = await fixture(t);
  const entries = [];
  for (let i = 0; i < 20; i++) {
    const name = `item-${i}.txt`;
    await fs.writeFile(path.join(f.project.workspacePath, name), `SYNTHETIC ${i}`);
    entries.push({ location: { rootId: 'workspace', kind: 'workspace', relativePath: name } });
  }
  await f.store.registerFiles(entries);
  const result = await createProjectMaterialTask(f.options).run();
  assert.equal(result.fullyCommitted, true); assert.equal(result.remainingCount, 0);
  assert.equal(result.batches.length, 2); assert.equal(f.calls, 2);
  assert.equal((await f.store.read()).materials.filter((item) => item.processing.state === 'completed').length, 21);
});

test('unsupported source is terminally skipped and never blocks or repeats valid work', windowsOnly, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.workspacePath, 'old.doc'), Buffer.from([0, 1, 2]));
  const bad = (await f.store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: 'old.doc' } }])).result[0];
  const result = await createProjectMaterialTask(f.options).run();
  assert.equal(result.fullyCommitted, true); assert.equal(result.remainingCount, 0); assert.equal(f.calls, 1);
  assert.equal(result.failures[0].materialId, bad.materialId); assert.equal(result.failures[0].code, 'unsupported');
  const index = await f.store.read();
  assert.equal(index.materials.find((item) => item.materialId === f.item.materialId).processing.state, 'completed');
  assert.equal(index.materials.find((item) => item.materialId === bad.materialId).processing.state, 'skipped_unsupported');
  assert.equal(f.checkpoint.phase, 'committed');
  const noWork = await createProjectMaterialTask({ ...f.options, executionId: 'e2' }).run();
  assert.equal(noWork.fullyCommitted, true); assert.equal(noWork.businessOutcome, 'no_work');
  assert.equal(f.calls, 1);
});

test('configured local transcription turns WebM into a normal digest source', windowsOnly, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.workspacePath, 'lesson.webm'), Buffer.from('synthetic audio bytes'));
  const audio = (await f.store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: 'lesson.webm' } }])).result[0];
  let transcriptions = 0;
  const result = await createProjectMaterialTask({ ...f.options, transcribeSource: async (input) => {
    transcriptions++;
    assert.equal(input.materialId, audio.materialId);
    return 'synthetic transcript for project learning';
  } }).run();
  assert.equal(result.fullyCommitted, true);
  assert.equal(transcriptions, 1);
  assert.equal((await f.store.read()).materials.find((item) => item.materialId === audio.materialId).processing.state, 'completed');
});

test('a stable source edit refreshes its registered version and continues without manual repair', windowsOnly, async (t) => {
  const f = await fixture(t);
  const source = path.join(f.project.workspacePath, 'a.txt');
  await fs.writeFile(source, 'SYNTHETIC updated before digest');
  const result = await createProjectMaterialTask(f.options).run();
  assert.equal(result.fullyCommitted, true);
  assert.equal(result.remainingCount, 0);
  assert.equal(result.failures.length, 0);
  const updated = (await f.store.read()).materials.find((item) => item.materialId === f.item.materialId);
  assert.equal(updated.version, 2);
  assert.equal(updated.processing.state, 'completed');
  assert.equal(updated.processing.processedVersion, 2);
});

test('batch size uses extracted text bytes and pre-extracted text reaches the executor unchanged', windowsOnly, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.workspacePath, 'b.txt'), 'small original');
  await f.store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: 'b.txt' } }]);
  const expanded = 'x'.repeat(2 * 1024 * 1024 + 1); let executions = 0;
  const result = await createProjectMaterialTask({ ...f.options, extractSource: async () => expanded,
    execute: async (options) => {
      executions++; assert.equal(options.batch.sources.length, 1);
      assert.equal(await options.extractSource(options.batch.inputFiles[0]), expanded);
      return f.execute(options);
    } }).run();
  assert.equal(result.fullyCommitted, true); assert.equal(executions, 2);
});

test('Office bytes travel through the default extractor and fixed-source executor into guarded knowledge', windowsOnly, async (t) => {
  const f = await fixture(t);
  const Zip = require('node:module').createRequire(require.resolve('exceljs'))('jszip');
  const zip = new Zip();
  zip.file('word/document.xml', '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>合成实验温度20、25、30；不是学生贡献</w:t></w:r></w:p></w:body></w:document>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const file = path.join(f.project.workspacePath, '实验.docx'); await fs.writeFile(file, bytes);
  const doc = (await f.store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: '实验.docx' } }])).result[0];
  const result = await createProjectMaterialTask({ ...f.options, execute: async (options) => {
    const input = options.batch.inputFiles.find((item) => item.materialId === doc.materialId);
    const text = await options.extractSource(input);
    assert.match(text, /合成实验温度20、25、30/); assert.match(text, /提取范围与限制/);
    return f.execute(options);
  } }).run();
  assert.equal(result.fullyCommitted, true);
  assert.equal((await f.store.read()).materials.find((item) => item.materialId === doc.materialId).processing.processedVersion, 1);
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('PDF pages pass through the default source adapter and settle the same immutable material version', windowsOnly, async (t) => {
  const f = await fixture(t), { PDFDocument } = require('@napi-rs/canvas');
  const pdf = new PDFDocument(); const context = pdf.beginPage(600, 800);
  context.font = '24px Arial'; context.fillText('SYNTHETIC PDF 20 25 30', 30, 60); pdf.endPage();
  const bytes = pdf.close(), file = path.join(f.project.workspacePath, '实验.pdf'); await fs.writeFile(file, bytes);
  const doc = (await f.store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: '实验.pdf' } }])).result[0];
  const result = await createProjectMaterialTask({ ...f.options, execute: async (options) => {
    const input = options.batch.inputFiles.find((item) => item.materialId === doc.materialId);
    const text = await options.extractSource(input);
    assert.match(text, /PDF 第1页/); assert.match(text, /SYNTHETIC PDF 20 25 30/);
    return f.execute(options);
  } }).run();
  assert.equal(result.fullyCommitted, true);
  assert.equal((await f.store.read()).materials.find((item) => item.materialId === doc.materialId).processing.processedVersion, 1);
  assert.deepEqual(await fs.readFile(file), bytes);
});

for (const fallback of [false, true]) test(`host task adapter persists checkpoints and settles; WorkBuddy auth fallback=${fallback}`, windowsOnly, async (t) => {
  const f = await fixture(t);
  const main = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const start = main.indexOf('async function submitProjectMaterialTask('), end = main.indexOf('\nfunction submitCodexTask(', start);
  let store = { tasks: [{ id: 'task-p1', kind: 'project_digest', sourceId: 'p1', sourceType: 'project', status: 'approved', attempt: 0, input: {}, requestedExecutor: 'codex' }] };
  let released = 0, settled = 0;
  const runs = new Map();
  const context = vm.createContext({ crypto: require('node:crypto'), fs: require('node:fs'), AbortController, setInterval, clearInterval,
    require: name => name === './smart-inbox-agent.cjs' ? { routingRuntimeHash: async () => 'synthetic-runtime' } : require(path.join(__dirname, '../electron', name)),
    findStudentByKey: () => ({ id: 's1', agentTool: 'codex' }), readProjects: () => [f.project],
    readProjectMetadata: () => [f.project], getProjectMetadata: id => String(id) === String(f.project.id) ? f.project : null,
    normalizeProject: p => p, normalizeProjectMetadata: p => p,
    agentControlPolicy: () => ({ primary: fallback ? 'workbuddy' : 'codex', fallbacks: fallback ? ['codex'] : [], enabled: true, desktopHandoff: false, version: 0 }),
    ensureTaskDispatchReadiness:async(task,providers)=>({decision:'dispatch',providerId:providers[0],reasons:providers.map(providerId=>({providerId,state:'available'}))}),
    externalTaskDispatchBarrier:()=>({claim:async()=>{store.tasks[0].executionId='synthetic-claim';store.tasks[0].executionPhase='claimed';return {ok:true,executionId:'synthetic-claim'};},sendIntent:async()=>({ok:true}),started:async()=>({ok:true})}),
    releaseUnstartedTaskClaim: async () => {},
    admitRunnableTaskToRunning: require('../electron/task-execution-admission.cjs').admitRunnableTaskToRunning,
    settlePersistentTaskAttempt:async()=>{},
    classificationAdapter: async id => id === 'workbuddy' ? { id, runtime: { cliPath: f.project.agentPath, configDir: f.root } } : { id: 'codex', executable: 'C:\\synthetic.exe', authScope: 'synthetic', authVersion: 1 },
    workBuddyQualification: { peek: () => ({ ready: false, code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' }) },
    adapterCapabilities: () => ({ codex: { available: true, authorized: true, exePath: 'C:\\synthetic.exe' } }),
    mutableProject: () => ({ project: f.project }), captureHeavyWorkGate: { tryAcquire: () => () => { released++; } }, captureTimelineResourceSnapshot: () => ({}),
    licenseRequiredJson: () => null, validateTaskPermissionDeclaration: () => ({ ok: true }), taskPathAllowed: () => true,
    readTaskStore: () => structuredClone(store), writeTaskStoreDurably: async (value) => { store = structuredClone(value); },
    taskStorePath:()=>'',taskStoreGuard: {read:()=>({value:structuredClone(store)}),recordExecutionBudget: async ({ budgetKey, maxAttempts = 2 }) => ({
      ok: true,
      budget: { budget_key: budgetKey, attempt_count: 1, max_attempts: maxAttempts, terminal_state: '' },
    }) },
    executionBudgetKey: require('../electron/task-work-identity.cjs').executionBudgetKey,
    circuitDecision: require('../electron/task-executor-circuit.cjs').circuitDecision,
    recordCircuitOutcome: require('../electron/task-executor-circuit.cjs').recordCircuitOutcome,
    providerSupportsProfile: require('../electron/agent-invocation-service.cjs').providerSupportsProfile,
    aiExecutorRegistry: () => require('../electron/ai-executor-registry.cjs').executorRegistry(),
    DIGEST_PROFILE: require('../electron/agent-invocation-service.cjs').DIGEST_PROFILE,
    taskNow: () => new Date().toISOString(), taskChildProcesses: runs, activeAdapterTask: () => null, heartbeatTask() {}, notify() {},
    transitionTaskInStore: (value, id, status, patch) => { const task = value.tasks.find((item) => item.id === id); Object.assign(task, patch, { status }); return { ok: true, task }; },
    createProjectMaterialTask: (options) => createProjectMaterialTask({ ...options, verifySandbox: f.options.verifySandbox, execute: f.execute }),
    normalizeTaskResult: (task, output) => output,
    commitValidatedTaskResult: (value, task, output, validation) => { settled++; task.status = validation.valid ? 'succeeded' : 'failed'; task.result = output; return { ok: true, task }; },
  });
  store.runtime = { agentQualifications: { codex: { 'digest_host_mediated.v1': { ready: true, runtimeHash: 'synthetic-runtime', authScope: JSON.stringify(['synthetic', 1]), expiresAt: new Date(Date.now() + 60000).toISOString() } } } };
  vm.runInContext(main.slice(start, end), context);
  const dispatched = await context.submitProjectMaterialTask(store.tasks[0], f.project, 'auto');
  assert.equal(dispatched.ok, true); assert.equal(store.tasks[0].status, 'running');
  await runs.get('task-p1').completion;
  assert.equal(settled, 1,JSON.stringify(store.tasks[0].error)); assert.equal(store.tasks[0].status, 'succeeded', JSON.stringify(store.tasks[0]));
  assert.equal(store.tasks[0].input.materialExecution.phase, 'committed');
  assert.equal(released, 1); assert.equal(runs.size, 0);
  assert.deepEqual(Array.from(store.tasks[0].routeDecision.attempts, a => a.providerId), fallback ? ['workbuddy', 'codex'] : ['codex']);
});
