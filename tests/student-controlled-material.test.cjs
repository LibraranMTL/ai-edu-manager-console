'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { studentControlledProject, registerStudentControlledBatch,
  finalizeStudentControlledDigest } = require('../electron/student-controlled-material.cjs');
const { createManualMaterialBatch } = require('../electron/project-material-manual.cjs');
const { RESULT_SCHEMA } = require('../electron/project-material-digest.cjs');

test('manual student digest commits frozen material and settles the original batch', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-manual-student-'));
  t.after(async () => { const snapshots = path.join(root, 'manager', 'project-materials', 'snapshots'); for (const file of await fs.readdir(snapshots).catch(() => [])) await fs.chmod(path.join(snapshots, file), 0o600); await fs.rm(root, { recursive: true, force: true }); });
  const raw = path.join(root, 'raw'), manager = path.join(root, 'manager'), summary = path.join(root, 'summary');
  await fs.mkdir(raw); const source = path.join(raw, 'source.txt'); await fs.writeFile(source, 'synthetic student material');
  const student = { id: 's1', name: 'Synthetic', rootPath: root, rawPath: raw, summaryPath: summary };
  const batch = { batchId: 'student-batch', files: [{ materialId: 'm1', path: source, relativePath: 'source.txt', sha1: crypto.createHash('sha1').update(await fs.readFile(source)).digest('hex') }] };
  const project = studentControlledProject(student, manager), host = createProjectMaterialHost(project);
  const registered = await registerStudentControlledBatch(host, batch, student.id);
  const manual = createManualMaterialBatch({ project, authorize: async () => true, scopeFingerprint: 'student-scope' });
  const packet = await manual.prepare(registered.map(item => item.projectMaterialId));
  const ref = packet.sources[0];
  const result = await manual.accept(packet.batchId, { schema: RESULT_SCHEMA, projectId: project.id, batchId: packet.batchId, scopeFingerprint: 'student-scope', status: 'completed', message: 'synthetic', artifacts: packet.baselines.map(target => ({ relativePath: target.relativePath, content: '# Synthetic\nstudent material', sources: [{ materialId: ref.materialId, version: ref.version, sha256: ref.sha256 }] })) });
  assert.equal(result.fullyCommitted, true);
  const receipt = await finalizeStudentControlledDigest({ student, batch, receiptPath: path.join(manager, 'receipt.json'), summaryPath: summary, output: result, registry: await host.store.read(), registered });
  assert.equal(receipt.processed[0].status, 'completed');
  assert.equal(await fs.readFile(source, 'utf8'), 'synthetic student material');
});

test('task-center manual student batch rechecks identity and writes a real receipt', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-manual-student-task-'));
  t.after(async () => { const snapshots = path.join(root, 'manager', 'controlled-materials', 'project-materials', 'snapshots'); for (const file of await fs.readdir(snapshots).catch(() => [])) await fs.chmod(path.join(snapshots, file), 0o600); await fs.rm(root, { recursive: true, force: true }); });
  const raw = path.join(root, 'raw'), manager = path.join(root, 'manager'), summary = path.join(root, 'summary');
  await fs.mkdir(raw); const source = path.join(raw, 'source.txt'); await fs.writeFile(source, 'synthetic student task');
  const student = { id:'s1', name:'Synthetic', rootPath:root, rawPath:raw, summaryPath:summary, status:'active' };
  const batch = { batchId:'student-batch', files:[{materialId:'m1',path:source,relativePath:'source.txt',sha1:crypto.createHash('sha1').update(await fs.readFile(source)).digest('hex')}] };
  const task = { id:'task-student', kind:'student_digest', sourceType:'student', sourceId:'s1', status:'approved', executionId:'', input:{},
    permissions:{read:[root],write:[root],operations:['read','write_knowledge']} };
  const store={tasks:[task]}, receiptPath=path.join(manager,'receipt.json');
  const main=await fs.readFile(path.join(__dirname,'../electron/main.cjs'),'utf8'), vm=require('node:vm');
  const context=vm.createContext({crypto,path,require:require('node:module').createRequire(path.join(__dirname,'../electron/main.cjs')),
    readStudentsIndex:()=>[student],toHostStudent:value=>value,studentControlledProject,studentManagerDir:()=>manager,createProjectMaterialHost,
    readStudentDigestState:()=>({digestBatchId:batch.batchId,status:'submitted'}),readDigestBatch:()=>batch,studentDigestBatchPath:()=>'',normalizeDigestStateStatus:x=>x,
    registerStudentControlledBatch,readTaskStore:()=>store,agentControlStore:()=>({read:()=>({global:{enabled:true}})}),licenseRequiredJson:()=>null,
    validateTaskPermissionDeclaration:()=>({ok:true}),taskPathAllowed:(candidate,roots)=>roots.some(root=>candidate===root||candidate.startsWith(`${root}${path.sep}`)),
    studentDigestReceiptPath:()=>receiptPath,finalizeStudentControlledDigest,getSummaryDir:()=>summary,taskNow:()=>new Date().toISOString(),RESEARCH_KINDS:new Set(),
    validateTaskCompletion:()=>({valid:require('node:fs').existsSync(receiptPath),message:'synthetic receipt checked'}) });
  for(const name of ['manualDigestContext','manualDigestPermissionAllowed','prepareManualDigest','validateImportedTaskCompletion']) { let start=main.indexOf(`function ${name}(`);if(main.slice(start-6,start)==='async ')start-=6;vm.runInContext(main.slice(start,main.indexOf('\n}',start)+2),context); }
  const prepared=await context.prepareManualDigest(task);
  task.input.manualMaterial={batchId:prepared.packet.batchId,fingerprint:prepared.fingerprint,registered:prepared.registered,studentBatchId:batch.batchId};
  task.executionId='manual-1';task.status='waiting_result';task.executionMode='manual';
  const ref=prepared.packet.sources[0], project=studentControlledProject(student,path.join(manager,'controlled-materials'));
  const data={schema:RESULT_SCHEMA,projectId:project.id,batchId:prepared.packet.batchId,scopeFingerprint:prepared.fingerprint,status:'completed',message:'synthetic',artifacts:prepared.packet.baselines.map(target=>({relativePath:target.relativePath,content:'# Synthetic\nstudent task',sources:[{materialId:ref.materialId,version:ref.version,sha256:ref.sha256}]}))};
  const result=await context.validateImportedTaskCompletion(task,{status:'completed',data});
  assert.equal(result.valid,true,result.message);assert.equal(JSON.parse(await fs.readFile(receiptPath,'utf8')).processed[0].status,'completed');
  assert.equal(await fs.readFile(source,'utf8'),'synthetic student task');
});

test('student controlled digest keeps a student-scoped synthetic registry and host-authored receipt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-student-controlled-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = path.join(root, 'raw'), summary = path.join(root, 'summary'), manager = path.join(root, 'manager');
  await fs.mkdir(raw); await fs.mkdir(path.join(root, '摘要库')); await fs.writeFile(path.join(root, '摘要库', 'knowledge.md'), '# Knowledge');
  const source = path.join(raw, 'source.txt'); await fs.writeFile(source, 'fixed source');
  const bytes = await fs.readFile(source), sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
  const student = { id: 'student-a', name: 'A', rootPath: root, rawPath: raw, summaryPath: summary, agentTool: 'workbuddy' };
  const project = studentControlledProject(student, manager);
  assert.equal(project.studentIds[0], 'student-a'); assert.equal(project.knowledgeRootPath, root);
  const batch = { batchId: 'batch-a', files: [{ materialId: 'm1', path: source, relativePath: 'source.txt', sha1 }] };
  const receiptPath = path.join(manager, 'receipt.json');
  const receipt = await finalizeStudentControlledDigest({ student, batch, receiptPath, summaryPath: summary, output: { fullyCommitted: true }, now: () => '2026-10-13T12:00:00.000Z' });
  assert.equal(receipt.processed[0].materialId, 'm1');
  assert.match(await fs.readFile(path.join(summary, 'index.md'), 'utf8'), /controlled-digest:batch-a/);
  assert.equal(JSON.parse(await fs.readFile(receiptPath, 'utf8')).studentId, 'student-a');
});

test('student controlled digest refuses settlement when the frozen original changes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-student-changed-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = path.join(root, 'raw'), summary = path.join(root, 'summary'); await fs.mkdir(raw); await fs.mkdir(summary);
  const source = path.join(raw, 'source.txt'); await fs.writeFile(source, 'changed');
  await assert.rejects(finalizeStudentControlledDigest({ student: { id: 's', rootPath: root },
    batch: { batchId: 'b', files: [{ materialId: 'm', path: source, sha1: '0'.repeat(40) }] },
    receiptPath: path.join(root, 'receipt.json'), summaryPath: summary, output: { fullyCommitted: true } }), { code: 'SOURCE_CHANGED' });
});

test('student controlled settlement rejects revoked authority before writing a receipt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-student-revoked-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.txt'); await fs.writeFile(source, 'synthetic');
  const sha1 = crypto.createHash('sha1').update('synthetic').digest('hex');
  const receiptPath = path.join(root, 'receipt.json');
  await assert.rejects(finalizeStudentControlledDigest({ student: { id: 's', rootPath: root },
    batch: { batchId: 'b', files: [{ materialId: 'm', path: source, sha1 }] }, receiptPath,
    summaryPath: path.join(root, 'summary'), output: { fullyCommitted: true }, authorize: async () => false }), { code: 'SCOPE_CHANGED' });
  await assert.rejects(fs.access(receiptPath), { code: 'ENOENT' });
});

test('student controlled settlement checks only the current batch instead of unrelated historical failures', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-student-current-batch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = path.join(root, 'raw'), summary = path.join(root, 'summary');
  await fs.mkdir(raw); await fs.mkdir(path.join(root, '摘要库'));
  await fs.writeFile(path.join(root, '摘要库', 'current.md'), '# current');
  const source = path.join(raw, 'current.txt'); await fs.writeFile(source, 'current batch');
  const sha1 = crypto.createHash('sha1').update(await fs.readFile(source)).digest('hex');
  const batch = { batchId: 'current-batch', files: [{ materialId: 'student-current', path: source, relativePath: 'current.txt', sha1 }] };
  const receipt = await finalizeStudentControlledDigest({ student: { id: 's', rootPath: root }, batch,
    receiptPath: path.join(root, 'receipt.json'), summaryPath: summary, output: { fullyCommitted: false, remainingCount: 1 },
    registered: [{ studentMaterialId: 'student-current', projectMaterialId: 'project-current' }],
    registry: { materials: [
      { materialId: 'project-current', processing: { state: 'completed' } },
      { materialId: 'unrelated-old', processing: { state: 'failed_retryable' } },
    ] } });
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.processed[0].status, 'completed');
});

test('student batch is registered once in the controlled material registry without moving its original', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-student-register-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = path.join(root, 'raw'), manager = path.join(root, 'manager');
  await fs.mkdir(raw);
  const source = path.join(raw, 'original.txt'); await fs.writeFile(source, 'student controlled original');
  const project = studentControlledProject({ id: 'student-a', name: 'A', rootPath: root, rawPath: raw }, manager);
  const host = createProjectMaterialHost(project);
  const batch = { batchId: 'batch-register', files: [{ materialId: 'student-material-1', path: source }] };
  const first = await registerStudentControlledBatch(host, batch, 'student-a');
  const repeated = await registerStudentControlledBatch(host, batch, 'student-a');
  assert.equal(first[0].projectMaterialId, repeated[0].projectMaterialId);
  const index = await host.store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources.length, 1);
  assert.equal(index.materials[0].sources[0].studentId, 'student-a');
  assert.equal(index.materials[0].sources[0].type, 'student_controlled_digest');
  assert.equal(await fs.readFile(source, 'utf8'), 'student controlled original');
});

test('main routes supported student digestion through the controlled material pipeline', async () => {
  const main = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(main, /providerSupportsProfile\(String\(student\.agentTool \|\| ''\), DIGEST_PROFILE\)/);
  assert.match(main, /registerStudentControlledBatch\(host, batch, student\.id\)/);
  assert.match(main, /submitProjectMaterialTask\(refreshed, controlledProject, selected, \{ student, batch/);
  const start = main.indexOf('async function submitProjectMaterialTask(');
  const end = main.indexOf('\nfunction submitCodexTask(', start);
  const submit = main.slice(start, end);
  assert.doesNotMatch(submit, /workbuddyControlledConsent/);
  assert.match(submit, /circuit\.category !== 'authorization'/);
  assert.match(submit, /persistWorkBuddyControlledStatus\(workBuddyRuntime, auth, qualification\)/);
  assert.match(submit, /系统会自动复检，不需要单独检测/);
});
