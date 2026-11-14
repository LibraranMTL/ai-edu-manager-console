const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRoutingAgent } = require('../electron/smart-inbox-agent.cjs');
const { createSmartInboxHost } = require('../electron/smart-inbox-host.cjs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createProjectMaterialExtractor } = require('../electron/project-material-extract.cjs');

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-adapter-test-'));
  t.after(async () => { await t.closeTaskHost?.(); await fs.rm(directory, {recursive:true,force:true}); }); return directory;
}
const answer = input => ({ candidates: [{ studentId: input.context.studentId, type: 'project', id: input.context.projects[0].id,
  categoryId: '', score: .98, evidence: input.context.projects[0].id, reason: '项目编号' }], sensitive: false, conflict: false, reason: '' });

for (const partial of [false, true]) test(`real DOCX extraction and real task store: ${partial ? 'partial visual extraction permits evidence-based delivery' : 'complete trusted delivery'}`, async t => {
  const directory = await temporary(t), source = path.join(directory, 'source'); await fs.mkdir(source);
  const JSZip = require('node:module').createRequire(require.resolve('exceljs'))('jszip'), zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>project-a 教育实验记录</w:t>${partial ? '<w:drawing/>' : ''}</w:r></w:p></w:body></w:document>`);
  const original = path.join(source, 'report.docx'); await fs.writeFile(original, await zip.generateAsync({ type: 'nodebuffer' }));
  await fs.utimes(original, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
  const taskHost = await require('./helpers/smart-inbox-task-host.cjs').createTaskHost(path.join(directory, 'tasks'));
  t.closeTaskHost=()=>taskHost.close();
  const executable = path.join(directory, 'synthetic-cli'); await fs.writeFile(executable, 'test identity only');
  const p = { id: 'project-a', name: '实验项目', studentIds: ['a'], materialStorageMode: 'workspace-v1', workspacePath: path.join(directory, 'workspace'), managerPath: path.join(directory, 'manager'), rawPath: path.join(directory, 'raw') };
  const materialHost = createProjectMaterialHost(p); let calls = 0, delivered = 0, categoryReads = 0;
  materialHost.store.readCategories = () => { throw new Error('SmartInbox must not parse the project registry on the main path'); };
  const h = createSmartInboxHost({ directory: path.join(directory, 'state'), student: id => id === 'a' ? { id, name: '虚构学生' } : null,
    students: () => [], projects: () => [p], isWorkspace: () => true, materialHost: () => materialHost,
    materialCategories: async () => { categoryReads++; return [{ categoryId: 'reference', name: '参考资料', relativePath: '参考资料', active: true }]; },
    canWrite: () => true,
    forbiddenRoots: () => [p.workspacePath], automaticAllowed: () => true, acquire: () => () => {}, legacySettings: () => ({}),
    beginBatch: taskHost.beginBatch, endBatch: taskHost.endBatch, settleItems: taskHost.settleItems,
    agent: { select: () => ({ id: 'codex', executable }), run: async (_, input) => { calls++; if (input.context.studentId === 'a') { assert.equal(input.context.extractionLimitations.length, 2); assert.equal(input.context.projects[0].categories[0].categoryId, 'reference'); } return answer(input); } },
    validateTarget: async () => ({ project: p }),
    deliver: async (snapshot, _, item) => {
      delivered++; const copy = path.join(p.workspacePath, '收件箱', 'report.docx'); await fs.mkdir(path.dirname(copy), { recursive: true }); await fs.copyFile(snapshot, copy);
      const result = await materialHost.registerTerminalUpload(copy, { eventId: item.id, studentId: 'a', sourceType: 'host_material_source', intakeAssociation: { itemId: item.id, operationId: item.operationId } });
      return { ok: true, path: copy, recordId: result.material.materialId };
    },
  });
  t.after(() => h.engine.close()); await h.initialize();
  taskHost.context.smartInboxHostRuntime = { engine: h.engine };
  const s = await h.engine.updateSource({ folder: source, studentId: '', enabled: true, automatic: true });
  await h.engine.requestScan(s.id); await h.engine.tick();
  const row = (await h.engine.list()).rows[0];
  assert.equal((await h.engine.decide({ requestId: 'confirm-docx', action: 'confirm_student', items: [{ ...row, studentId: 'a' }] })).results[0].ok, true);
  await h.engine.tick();
  let item = await h.engine.detail(row.id);
  assert.equal(calls, 2); assert.equal(item.truncated, false); assert.equal(item.extractionPartial, partial);
  assert.equal(item.status, 'delivered'); assert.equal(delivered, 1);
  assert.ok(categoryReads >= 1);
  if (partial) assert.match(item.message, /图片|公式/);
  assert.equal(item.extractionReuse.reused, true); assert.equal(delivered, 1);
  assert.ok(taskHost.disk().tasks.every(task => task.status === 'succeeded'));
  await fs.access(original); await h.engine.requestScan(s.id); await h.engine.tick(); assert.equal(calls, 2); assert.equal(delivered, 1);
});

test('routing qualifies its own schema with synthetic data; executable changes require a fresh qualification', async t => {
  const dir = await temporary(t), executable = path.join(dir, 'fake-cli'); await fs.writeFile(executable, 'v1');
  const calls = [], outcomes = [];
  const agent = createRoutingAgent({ select: async () => ({ id: 'codex', executable }), run: async (_, input) => { calls.push(input); return answer(input); }, outcome: async (_, value) => outcomes.push(value) });
  const input = { context: { studentId: 'a', projects: [{ id: 'project-a', categories: [] }] }, text: 'project-a', executionId: 'one' };
  await agent.classify(input); await agent.classify(input);
  assert.equal(calls.length, 3); assert.equal(calls[0].context.studentId, 'synthetic-student');
  assert.equal(calls[0].context.projects.length, 1); assert.equal(outcomes.length, 2);
  await fs.writeFile(executable, 'v2'); await agent.classify(input);
  assert.equal(calls[3].context.studentId, 'synthetic-student'); assert.equal(calls.length, 5);
});

test('failed qualification and open circuit never send student content to the agent', async t => {
  const dir = await temporary(t), executable = path.join(dir, 'fake-cli'); await fs.writeFile(executable, 'v1');
  let calls = 0;
  const input = { context: { studentId: 'private', projects: [] }, text: 'private material' };
  const agent = createRoutingAgent({ select: async () => ({ id: 'codex', executable }), run: async (_, value) => {
    calls++; assert.equal(value.context.studentId, 'synthetic-student'); return { ...answer(value), path: 'not allowed' };
  } });
  await assert.rejects(agent.classify(input)); await assert.rejects(agent.classify(input)); assert.equal(calls, 1);
  const blocked = createRoutingAgent({ select: async () => ({ id: 'codex', executable }), circuit: () => ({ allowed: false, reason: 'open' }), run: () => { throw Error('must not run'); } });
  await assert.rejects(blocked.classify(input), /open/);
});

test('authorization circuit automatically qualifies with synthetic content before student routing', async t => {
  const dir = await temporary(t), executable = path.join(dir, 'fake-cli'); await fs.writeFile(executable, 'v1');
  const calls = [];
  const input = { context: { studentId: 'private-student', projects: [{ id: 'private-project', categories: [] }] }, text: 'private material for private-project', executionId: 'authorization-recovery' };
  const agent = createRoutingAgent({
    select: async () => ({ id: 'codex', executable }),
    circuit: () => ({ allowed: false, category: 'authorization', automaticProbe: true }),
    run: async (_, value) => { calls.push(value); return answer(value); },
  });
  const result = await agent.classify(input);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].context.studentId, 'synthetic-student');
  assert.doesNotMatch(calls[0].text, /private material/);
  assert.equal(calls[1].context.studentId, 'private-student');
  assert.equal(result.candidates[0].id, 'private-project');
});

test('classification falls through two unavailable Agent qualifications to the authorized LLM API', async t => {
  const dir = await temporary(t), executable = path.join(dir, 'fake-cli'); await fs.writeFile(executable, 'v1');
  const product = path.join(dir, 'product.json'); await fs.writeFile(product, '{}');
  const calls = [];
  const adapters = {
    codex: { id: 'codex', executable },
    workbuddy: { id: 'workbuddy', runtime: { cliPath: executable, nodePath: executable, productConfigPath: product } },
    'llm-api': { id: 'llm-api', runtimeHash: 'configured-api-v1', generate: async () => ({}) },
  };
  const agent = createRoutingAgent({
    route: async () => ({ providers: ['workbuddy', 'codex', 'llm-api'], policyVersion: 1 }),
    select: async (_studentId, id) => adapters[id],
    run: async (adapter, input) => {
      calls.push({ id: adapter.id, studentId: input.context.studentId });
      if (adapter.id !== 'llm-api') return { candidates: [], sensitive: true, conflict: true, reason: '合成资格失败' };
      return answer(input);
    },
  });
  const result = await agent.classify({ context: { studentId: 'private-student', projects: [{ id: 'private-project', categories: [] }] }, text: 'private-project' });
  assert.equal(result.candidates[0].id, 'private-project');
  assert.deepEqual(calls.map(item => item.id), ['workbuddy', 'codex', 'llm-api', 'llm-api']);
  assert.equal(calls.at(-1).studentId, 'private-student');
});

test('classification falls through only when the structured adapter proves the real request was not sent', async t => {
  const dir = await temporary(t), executable = path.join(dir, 'fake-cli'); await fs.writeFile(executable, 'v1');
  const calls = [];
  const agent = createRoutingAgent({
    route: async () => ({ providers: ['trae', 'qoder-work'], policyVersion: 1 }),
    select: async (_studentId, id) => ({ id, executable, runtimeHash: id, structuredBuiltin: true, generate() {} }),
    run: async (adapter, input) => {
      calls.push({ id: adapter.id, studentId: input.context.studentId });
      if (adapter.id === 'trae' && input.context.studentId !== 'synthetic-student') {
        throw Object.assign(Error('Windows argument limit'), { code: 'AGENT_INPUT_TOO_LARGE', stage: 'not_sent' });
      }
      return answer(input);
    },
  });
  const result = await agent.classify({ context: { studentId: 'private-student', projects: [{ id: 'private-project', categories: [] }] }, text: 'private-project' });
  assert.equal(result.candidates[0].id, 'private-project');
  assert.deepEqual(calls.map(item => `${item.id}:${item.studentId}`), [
    'trae:synthetic-student', 'trae:private-student', 'qoder-work:synthetic-student', 'qoder-work:private-student',
  ]);
});
test('post-send WorkBuddy authentication error retains diagnostic origin and never retries', async t => {
  const dir = await temporary(t), executable = path.join(dir, 'fake-cli'); await fs.writeFile(executable, 'v1');
  const calls = [];
  const agent = createRoutingAgent({ route: async () => ({ providers: ['workbuddy', 'codex'], policyVersion: 1 }),
    select: async (_student, id) => id === 'workbuddy' ? { id, runtime: { cliPath: executable, nodePath: executable } } : { id, executable },
    run: async (adapter, input) => { calls.push(`${adapter.id}:${input.context.studentId}`);
      if (input.context.studentId === 'synthetic-student') return answer(input);
      throw Object.assign(Error('authentication error'), { code: 'AUTHENTICATION_REQUIRED', stopConfirmed: true, diagnosticOrigin: 'stderr' }); } });
  await assert.rejects(agent.classify({ context: { studentId: 'private-student', projects: [{ id: 'private-project', categories: [] }] }, text: 'private-project' }), error => {
    assert.equal(error.code, 'execution_unknown'); assert.equal(error.blockReason.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(error.blockReason.processExitConfirmed, true); assert.equal(error.blockReason.diagnosticOrigin, 'stderr');
    assert.equal(error.blockReason.recoverable, false); return true;
  });
  assert.deepEqual(calls, ['workbuddy:synthetic-student', 'workbuddy:private-student']);
});

test('host adapter reuses the real text extractor, retains provenance and imports frozen conversation bytes', async t => {
  const directory = await temporary(t), source = path.join(directory, 'inputs'), destination = path.join(directory, 'received');
  await fs.mkdir(source); await fs.mkdir(destination);
  const file = path.join(source, 'conversation.md'); await fs.writeFile(file, 'project-a 项目记录');
  await fs.utimes(file, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
  let modelCalls = 0, receivedFrozen = false;
  const s = { id: 'a', name: '虚构学生', grade: '10', apiKey: 'must-not-leak', interests: '物理' };
  const h = createSmartInboxHost({ directory: path.join(directory, 'state'), student: id => id === s.id ? s : null, students: () => [s],
    projects: () => [{ id: 'project-a', name: '物理', studentIds: ['a'] }], isWorkspace: () => false,
    profile: async () => ({ source: 'test', summary: '辅助信息' }), forbiddenRoots: () => [destination], automaticAllowed: () => true,
    acquire: () => () => {}, legacySettings: () => ({}), agent: { select: () => { modelCalls++; return null; } },
    validateTarget: async value => { assert.equal(value.studentId, 'a'); return value; },
    conversations: async () => [{ assetId: 'asset-a', path: file, sourceScopeType: 'student', sourceScopeId: 'a' }],
    resolveConversation: () => ({ asset: { id: 'asset-a', storedPath: file } }),
    capture: () => ({ listStored: async () => [] }),
    deliverConversation: async (studentId, request, snapshot) => {
      assert.equal(studentId, 'a'); assert.equal(JSON.parse(request).sources[0].assetId, 'asset-a');
      assert.notEqual(snapshot.path, file); assert.equal(snapshot.assetId, 'asset-a'); receivedFrozen = true;
      const output = path.join(destination, 'copy.md'); await fs.copyFile(snapshot.path, output);
      return JSON.stringify({ ok: true, results: [{ id: 'receipt', path: output }] });
    },
  });
  t.after(() => h.engine.close()); await h.initialize();
  const context = await h.context('a'); assert.equal(JSON.stringify(context).includes('must-not-leak'), false); assert.equal(context.profile.growth.source, 'test');
  const entry = (await h.engine.sources()).sources.find(x => x.type === 'history');
  await h.engine.updateSource({ ...entry, enabled: true, automatic: true, target: { studentId: 'a', type: 'project', id: 'project-a' } });
  await h.engine.requestScan(entry.id); await h.engine.tick();
  assert.equal((await h.engine.list({ status: 'delivered' })).total, 1); assert.equal(receivedFrozen, true); assert.equal(modelCalls, 0);
  assert.equal((await h.engine.sources()).statistics.extracted, 1);
});

test('workspace hints resolve actual paths only within the authorized student projects', async t => {
  const directory = await temporary(t), a = path.join(directory, 'project-a'), b = path.join(directory, 'project-b');
  await fs.mkdir(a); await fs.mkdir(b);
  const h = createSmartInboxHost({ directory: path.join(directory, 'state'), student: id => ({ id }), students: () => [],
    projects: () => [{ id: 'a-project', studentIds: ['a'], workspacePath: a }, { id: 'b-project', studentIds: ['b'], workspacePath: b }],
    isWorkspace: () => true, agent: {} });
  assert.deepEqual(await h.workspaceCandidates('a', [a, b]), ['a-project']);
  assert.deepEqual(await h.workspaceCandidates('a', [path.join(a, 'missing')]), []);
  assert.deepEqual(await h.workspaceCandidates('', [a]), []);
});

test('duplicate same-student project intake reuses registered material and records distinct associations', async t => {
  const directory = await temporary(t), source = path.join(directory, 'source'); await fs.mkdir(source);
  const p = { id: 'project-a', name: 'a', studentIds: ['a'], materialStorageMode: 'workspace-v1',
    workspacePath: path.join(directory, 'workspace'), managerPath: path.join(directory, 'manager'), rawPath: path.join(directory, 'raw') };
  const materialHost = createProjectMaterialHost(p), s = { id: 'a', name: 'synthetic' }; let copies = 0;
  const h = createSmartInboxHost({ directory: path.join(directory, 'state'), student: id => id === 'a' ? s : null, students: () => [s],
    projects: () => [p], isWorkspace: () => true, materialHost: () => materialHost, canWrite: () => true,
    forbiddenRoots: () => [p.workspacePath], automaticAllowed: () => true, acquire: () => () => {}, legacySettings: () => ({}),
    agent: { select: () => { throw Error('unexpected classifier'); } }, validateTarget: async () => ({ project: p }),
    deliver: async (snapshot, _, item) => { copies++; const file = path.join(p.workspacePath, '收件箱', `${item.id}.txt`);
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(snapshot, file);
      const result = await materialHost.registerTerminalUpload(file, { eventId: item.id, studentId: 'a', sourceType: 'host_material_source',
        intakeAssociation: { itemId: item.id, operationId: item.operationId } });
      return { ok: true, path: file, recordId: result.material.materialId }; } });
  t.after(() => h.engine.close()); await h.initialize();
  for (const name of ['one.txt', 'two.txt']) { const file = path.join(source, name); await fs.writeFile(file, 'project-a 相同资料'); await fs.utimes(file, new Date(Date.now() - 5000), new Date(Date.now() - 5000)); }
  const entry = await h.engine.updateSource({ folder: source, studentId: 'a', enabled: true, automatic: true,
    target: { studentId: 'a', type: 'project', id: p.id } });
  await h.engine.requestScan(entry.id); await h.engine.tick();
  assert.equal((await h.engine.list({ status: 'delivered' })).total, 2); assert.equal(copies, 1);
  const index = await materialHost.store.read(); assert.equal(index.materials.length, 1);
  assert.equal(index.intakeAssociations.filter(a => a.active).length, 2);
});

for (const shared of [false, true]) test(`host delivery transfers full extraction; digest cache with ${shared ? 'per-item confirmation' : 'bound source'}`, async t => {
  const directory = await temporary(t), source = path.join(directory, 'source'); await fs.mkdir(source);
  const text = 'synthetic full extraction\n'.repeat(15000), file = path.join(source, 'full.txt');
  await fs.writeFile(file, text); await fs.utimes(file, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
  const p = { id: 'project-a', name: 'a', studentIds: ['a'], materialStorageMode: 'workspace-v1',
    workspacePath: path.join(directory, 'workspace'), managerPath: path.join(directory, 'manager'), rawPath: path.join(directory, 'raw') };
  const materialHost = createProjectMaterialHost(p), s = { id: 'a', name: 'synthetic' };
  const h = createSmartInboxHost({ directory: path.join(directory, 'state'), student: id => id === 'a' ? s : null, students: () => [s],
    projects: () => [p], isWorkspace: () => true, materialHost: () => materialHost, canWrite: () => true,
    forbiddenRoots: () => [p.workspacePath], automaticAllowed: () => true, acquire: () => () => {}, legacySettings: () => ({}),
    agent: { select: () => { throw Error('Truncated routing input must not call Agent'); } },
    validateTarget: async () => ({ project: p }),
    deliver: async (snapshot, _, item) => {
      const copy = path.join(p.workspacePath, '收件箱', 'full.txt'); await fs.mkdir(path.dirname(copy), { recursive: true }); await fs.copyFile(snapshot, copy);
      const result = await materialHost.registerTerminalUpload(copy, { eventId: item.id, studentId: 'a', sourceType: 'host_material_source',
        intakeAssociation: { itemId: item.id, operationId: item.operationId } });
      return { ok: true, path: copy, recordId: result.material.materialId };
    },
  });
  t.after(() => h.engine.close()); await h.initialize();
  const entry = await h.engine.updateSource({ name: 'full-text', folder: source, studentId: shared ? '' : 'a', enabled: true, automatic: true });
  await h.engine.requestScan(entry.id); await h.engine.tick();
  if (shared) {
    const rows = (await h.engine.list()).rows;
    const confirmed = await h.engine.decide({ requestId: 'student-only', action: 'confirm_student', items: rows.map(r => ({ id: r.id, revision: r.revision, studentId: 'a' })) });
    assert.equal(confirmed.results[0].ok, true); await h.engine.tick();
    assert.equal((await h.engine.sources()).sources.find(s => s.id === entry.id).studentId, '');
  }
  const row = (await h.engine.list()).rows[0]; assert.equal(row.status, 'review');
  const result = await h.engine.decide({ requestId: 'confirm', action: 'correct', items: [{ id: row.id, revision: row.revision,
    target: { studentId: 'a', type: 'project', id: p.id } }] });
  assert.equal(result.results[0].ok, true, JSON.stringify(result));
  const item = await h.engine.detail(row.id); assert.equal(item.extractionReuse.reason, 'full_extraction_reused');
  const input = await materialHost.store.resolve(item.receipt.recordId, 1);
  const extractor = createProjectMaterialExtractor({ store: materialHost.store, documentRunner: () => { throw Error('Repeated extraction'); } });
  assert.equal(await extractor.extractText(input), text.trimEnd());
  assert.equal((await extractor.extract(input)).cacheHit, true);
});
