const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectMaterialClassification } = require('../electron/project-material-classification.cjs');

async function fixture(t, projectPatch = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-classification-'));
  const workspace = path.join(root, 'workspace');
  const managerPath = path.join(root, 'manager');
  await fs.mkdir(workspace);
  const project = { id: 'project-1', materialStorageMode: 'workspace-v1', workspacePath: workspace,
    managerPath, inboxRelativePath: '收件箱', workspaceFolders: ['参考资料', '方案设计', '提交成果'],
    materialTagDefinitions: [], ...projectPatch };
  const store = createProjectMaterialStore({ projectId: project.id, managerPath,
    roots: { workspace: { path: workspace, kind: 'workspace' } } });
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-classification-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function material(name, content = name, options = {}) {
    const file = path.join(workspace, '收件箱', name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return (await store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace',
      relativePath: `收件箱/${name}` } }], options)).result[0];
  }
  return { root, workspace, project, store, material,
    service: createProjectMaterialClassification(project, store) };
}

test('workspace template initializes stable category IDs and later renames only update mapping', async (t) => {
  const f = await fixture(t);
  const first = await f.service.ensureWorkspaceCategories();
  assert.deepEqual(first.categories.map((item) => item.categoryId),
    ['workspace-slot-01', 'workspace-slot-02', 'workspace-slot-03']);
  assert.deepEqual(first.categories.map((item) => item.relativePath), ['参考资料', '方案设计', '提交成果']);
  const renamedProject = { ...f.project, workspaceFolders: ['背景材料', '方案设计', '提交成果'] };
  const renamed = await createProjectMaterialClassification(renamedProject, f.store).ensureWorkspaceCategories();
  assert.equal(renamed.categories[0].categoryId, 'workspace-slot-01');
  assert.equal(renamed.categories[0].name, '背景材料');
  assert.equal(renamed.categories[0].relativePath, '背景材料');
  assert.deepEqual(renamed.categories[0].aliases, ['参考资料']);
});

test('classification categories follow actual top-level workspace folders and ignore managed inboxes', async (t) => {
  const f = await fixture(t, { workspaceFolders: ['资料', '团队成员'] });
  for (const folder of ['收件箱', '研究暂存', '参考资料', '项目成果']) {
    await fs.mkdir(path.join(f.workspace, folder));
  }
  const first = await f.service.ensureWorkspaceCategories();
  const active = first.categories.filter((item) => item.active !== false);
  assert.deepEqual(new Set(active.map((item) => item.name)), new Set(['参考资料', '项目成果']));
  assert.equal(active.some((item) => ['资料', '团队成员', '收件箱', '研究暂存'].includes(item.name)), false);

  const prior = active.find((item) => item.name === '参考资料');
  await fs.rename(path.join(f.workspace, '参考资料'), path.join(f.workspace, '项目背景'));
  const renamed = await f.service.ensureWorkspaceCategories();
  const renamedCategory = renamed.categories.find((item) => item.name === '项目背景' && item.active !== false);
  assert.equal(renamedCategory.categoryId, prior.categoryId);
  assert.ok(renamedCategory.aliases.includes('参考资料'));
});

test('AI suggestions bind exact material revision and reject path move or unknown categories', async (t) => {
  const f = await fixture(t);
  await f.service.ensureWorkspaceCategories();
  const item = await f.material('资料.txt', 'source bytes');
  const suggestion = { materialId: item.materialId, expectedVersion: item.version,
    expectedRecordRevision: item.recordRevision, categoryId: 'workspace-slot-01',
    tags: [], reason: '内容是背景参考', needsConfirmation: true };
  await assert.rejects(f.service.recordSuggestions([{ ...suggestion, destinationPath: '方案设计/资料.txt' }], {
    actorId: 'ai-classifier', ruleVersion: 'rules-v1', requestId: 'suggest-unsafe',
  }), { code: 'unsafe_classification_instruction' });
  const missing = await f.service.recordSuggestions([{ ...suggestion, categoryId: 'invented-category' }], {
    actorId: 'ai-classifier', ruleVersion: 'rules-v1', requestId: 'suggest-missing',
  });
  assert.equal(missing.results[0].code, 'category_missing');
  const saved = await f.service.recordSuggestions([suggestion], {
    actorId: 'ai-classifier', ruleVersion: 'rules-v1', requestId: 'suggest-1',
  });
  assert.equal(saved.results[0].ok, true);
  const pending = await f.service.listSuggestions({ status: 'pending' });
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0].materialId, item.materialId);
  assert.equal(pending.items[0].recordRevision, item.recordRevision);
  assert.equal('relativePath' in pending.items[0], false);
});

test('classification batch reports per-item conflict and exact replay does not advance registry revision', async (t) => {
  const f = await fixture(t);
  await f.service.ensureWorkspaceCategories();
  const first = await f.material('a.txt');
  const second = await f.material('b.txt');
  const suggestion = await f.service.recordSuggestions([{
    materialId: first.materialId, expectedVersion: first.version,
    expectedRecordRevision: first.recordRevision, categoryId: 'workspace-slot-01', tags: [], reason: '参考',
  }], { actorId: 'ai-classifier', ruleVersion: 'rules-v1', requestId: 'suggest-a' });
  const action = { materialId: first.materialId, expectedVersion: first.version,
    expectedRecordRevision: first.recordRevision, categoryId: 'workspace-slot-01', tags: [],
    suggestionId: suggestion.results[0].suggestionId, decision: 'accept' };
  const applied = await f.service.applyBatch([action, {
    materialId: second.materialId, expectedVersion: 99,
    expectedRecordRevision: second.recordRevision, categoryId: 'workspace-slot-02', tags: [], decision: 'correct',
  }], { actorId: 'host-admin', idempotencyKey: 'apply-1', canWrite: true });
  assert.equal(applied.results[0].ok, true);
  assert.equal(applied.results[1].code, 'version_conflict');
  const afterApply = await f.store.read();
  assert.equal(afterApply.materials.find((item) => item.materialId === first.materialId).classification.manualLocked, true);
  assert.equal(afterApply.materials.find((item) => item.materialId === second.materialId).classification.categoryId, '');
  const replay = await f.service.applyBatch([action, {
    materialId: second.materialId, expectedVersion: 99,
    expectedRecordRevision: second.recordRevision, categoryId: 'workspace-slot-02', tags: [], decision: 'correct',
  }], { actorId: 'host-admin', idempotencyKey: 'apply-1', canWrite: true });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.registryRevision, applied.registryRevision);
  assert.equal((await f.store.read()).revision, applied.registryRevision);
});

test('formal permission denial changes no registry and manual classification blocks later AI overwrite', async (t) => {
  const f = await fixture(t);
  await f.service.ensureWorkspaceCategories();
  const item = await f.material('manual.txt');
  const before = await f.store.read();
  const denied = await f.service.applyBatch([{
    materialId: item.materialId, expectedVersion: item.version,
    expectedRecordRevision: item.recordRevision, categoryId: 'workspace-slot-02', tags: [], decision: 'correct',
  }], { actorId: 'teacher-without-grant', idempotencyKey: 'denied-1', canWrite: false });
  assert.equal(denied.results[0].code, 'forbidden');
  assert.equal((await f.store.read()).revision, before.revision);
  const accepted = await f.service.applyBatch([{
    materialId: item.materialId, expectedVersion: item.version,
    expectedRecordRevision: item.recordRevision, categoryId: 'workspace-slot-02', tags: [], decision: 'correct',
  }], { actorId: 'host-admin', idempotencyKey: 'manual-1', canWrite: true });
  const record = (await f.store.read()).materials[0];
  const ai = await f.service.recordSuggestions([{
    materialId: item.materialId, expectedVersion: item.version,
    expectedRecordRevision: accepted.results[0].recordRevision,
    categoryId: 'workspace-slot-01', tags: [], reason: 'try overwrite',
  }], { actorId: 'ai-classifier', ruleVersion: 'rules-v2', requestId: 'suggest-after-manual' });
  assert.equal(ai.results[0].code, 'manual_locked');
  assert.equal(record.classification.categoryId, 'workspace-slot-02');
});

test('logical undo restores metadata only when the applied version and revision are still current', async (t) => {
  const f = await fixture(t);
  await f.service.ensureWorkspaceCategories();
  const item = await f.material('undo.txt', 'original bytes');
  const sourcePath = path.join(f.workspace, '收件箱', 'undo.txt');
  const applied = await f.service.applyBatch([{
    materialId: item.materialId, expectedVersion: item.version,
    expectedRecordRevision: item.recordRevision, categoryId: 'workspace-slot-03', tags: [], decision: 'correct',
  }], { actorId: 'host-admin', idempotencyKey: 'apply-undo', canWrite: true });
  const undone = await f.service.undo(applied.operationId, {
    actorId: 'host-admin', idempotencyKey: 'undo-1', canWrite: true,
  });
  assert.equal(undone.results[0].ok, true);
  const record = (await f.store.read()).materials[0];
  assert.equal(record.classification.categoryId, '');
  assert.equal(record.organizationState, 'unclassified');
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'original bytes');
  assert.deepEqual(await fs.readdir(path.dirname(sourcePath)), ['undo.txt']);
  const secondUndo = await f.service.undo(applied.operationId, {
    actorId: 'host-admin', idempotencyKey: 'undo-2', canWrite: true,
  });
  assert.equal(secondUndo.results[0].code, 'undo_conflict');
});

test('classification and adoption remain independent state dimensions', async (t) => {
  const f = await fixture(t);
  await f.service.ensureWorkspaceCategories();
  const candidate = await f.material('candidate.txt', 'candidate', { intent: 'later' });
  const classified = await f.service.applyBatch([{
    materialId: candidate.materialId, expectedVersion: candidate.version,
    expectedRecordRevision: candidate.recordRevision, categoryId: 'workspace-slot-01', tags: [], decision: 'correct',
  }], { actorId: 'host-admin', idempotencyKey: 'classify-candidate', canWrite: true });
  assert.equal(classified.results[0].ok, true);
  const record = (await f.store.read()).materials[0];
  assert.equal(record.classification.categoryId, 'workspace-slot-01');
  assert.equal(record.adoption.state, 'candidate');
  assert.equal(record.processing.state, 'pending');
});
