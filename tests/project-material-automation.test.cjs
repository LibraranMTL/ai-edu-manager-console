const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { projectMaterialDigestProjection } = require('../electron/project-material-host.cjs');
const { projectStagingProjection } = require('../electron/project-staging-projection.cjs');
const { projectMaterialWorkspaceView } = require('../electron/project-material-views.cjs');
const { normalizeMaterialAutomation, projectMaterialAutomationOverview,
  listProjectMaterialExceptions, runProjectMaterialAutomation } = require('../electron/project-material-automation.cjs');
const { runProjectMaterialAutomationWorker } = require('../electron/project-material-automation-client.cjs');
const { createProjectMaterialReadClient } = require('../electron/project-material-read-client.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-auto-'));
  const workspacePath = path.join(root, 'workspace');
  const managerPath = path.join(root, '.edu-manager');
  await fs.mkdir(path.join(workspacePath, '参考资料'), { recursive: true });
  await fs.mkdir(path.join(workspacePath, '研究暂存'), { recursive: true });
  const project = { id: 'project-auto', name: '自动化项目', materialStorageMode: 'workspace-v1',
    workspacePath, managerPath, rawPath: path.join(root, 'raw'), stagingPath: path.join(root, 'staging'),
    workspaceFolders: ['参考资料'], inboxRelativePath: '收件箱', studentIds: ['student-1'],
    materialOrganization: { enabled: true, authorizationId: 'legacy-auth', maxBatch: 20 } };
  await fs.mkdir(project.rawPath);
  const store = createProjectMaterialStore({ projectId: project.id, managerPath,
    roots: { workspace: { path: workspacePath, kind: 'workspace' } } });
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  async function add(relativePath, content) {
    const file = path.join(workspacePath, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return (await store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath } }],
      { intent: 'later' })).result[0];
  }
  return { root, project, workspacePath, store, add };
}

test('legacy organization authorization enables metadata-only auto adoption without moving files', async (t) => {
  const f = await fixture(t);
  await f.add('参考资料/a.md', 'same content');
  await f.add('参考资料/copy.md', 'same content');
  await f.add('研究暂存/staging-index.json', '{}');
  assert.equal(normalizeMaterialAutomation(f.project).enabled, true);

  const result = await runProjectMaterialAutomation(f.project, f.store, { reason: 'manual',
    idempotencyKey: 'auto-run-1' });
  assert.equal(result.adopted, 2);
  assert.equal(await fs.readFile(path.join(f.workspacePath, '参考资料', 'a.md'), 'utf8'), 'same content');
  assert.equal(await fs.readFile(path.join(f.workspacePath, '参考资料', 'copy.md'), 'utf8'), 'same content');

  const index = await f.store.read();
  const overview = projectMaterialAutomationOverview(f.project, index);
  assert.equal(overview.businessMaterialCount, 2);
  assert.equal(overview.uniqueContentCount, 1);
  assert.equal(overview.systemGeneratedCount, 1);
  assert.equal(overview.acceptedCount, 2);
  assert.equal(overview.needsConfirmation, 0);
  assert.equal(overview.errors, 0);
  assert.equal(listProjectMaterialExceptions(f.project, index).total, 0);

  const digest = projectMaterialDigestProjection(f.project, index);
  assert.equal(digest.pendingCount, 1);
  assert.equal(digest.pendingReferenceCount, 2);
  assert.equal(digest.pendingFiles[0].referenceCount, 2);
  assert.equal(digest.pendingFiles[0].referenceMaterialIds.length, 2);
  assert.equal(digest.materialCount, 2);

  const view = projectMaterialWorkspaceView(f.project, index, { view: 'materials', limit: 100 });
  assert.equal(view.counts.materials, 2);
  assert.equal(view.counts.uniqueContents, 1);
  assert.equal(view.counts.systemGenerated, 1);
  assert.equal(view.items.some((item) => item.title === 'staging-index.json'), false);
  assert.equal(projectStagingProjection(f.project, index).some((item) => item.filename === 'staging-index.json'), false);
});

test('ordinary project material views are bounded and computed in the read Worker', async (t) => {
  const f = await fixture(t);
  await f.add('参考资料/a.md', 'worker view');
  const client = createProjectMaterialReadClient();
  t.after(() => client.close());
  const overview = await client.request('overview', { project: f.project });
  assert.equal(overview.businessMaterialCount, 1);
  const view = await client.request('workspace_view', { project: f.project,
    query: { view: 'materials', offset: 0, limit: 50 } });
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].title, 'a.md');
  const exceptions = await client.request('exceptions', { project: f.project,
    request: { offset: 0, limit: 100 } });
  assert.ok(exceptions.items.length <= 100);
  const authContext = { type: 'admin' };
  const list = await client.request('material_list', { project: f.project, authContext,
    query: { offset: 0, limit: 50 } });
  assert.equal(list.items.length, 1);
  const remote = await client.request('remote_view', { project: f.project, authContext,
    query: { view: 'materials', offset: 0, limit: 50 } });
  assert.equal(remote.items.length, 1);
  const detail = await client.request('material_detail', { project: f.project, authContext,
    materialId: list.items[0].materialId });
  assert.equal(detail.material.title, 'a.md');
});

test('project material read Worker returns only categories and observes registry category changes', async (t) => {
  const f = await fixture(t);
  await f.add('参考资料/a.md', 'worker category projection');
  await f.store.setCategories([{ categoryId: 'reference', name: '参考资料',
    relativePath: '参考资料', active: true }]);
  const client = createProjectMaterialReadClient();
  t.after(() => client.close());

  const first = await client.request('categories', { project: f.project });
  assert.deepEqual(first, [{ categoryId: 'reference', name: '参考资料',
    relativePath: '参考资料', active: true, templateSource: '', templateSlot: null, aliases: [] }]);
  assert.equal('materials' in first, false);

  await f.store.setCategories([{ categoryId: 'reference', name: '项目参考',
    relativePath: '参考资料', active: true }]);
  const refreshed = await client.request('categories', { project: f.project });
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].name, '项目参考');
});

test('project material category projection excludes retained inactive history and enforces its byte budget', async (t) => {
  const f = await fixture(t);
  const firstGeneration = Array.from({ length: 500 }, (_, index) => ({
    categoryId: `old-${index}`, name: `旧分类${index}`, relativePath: `旧分类${index}`, active: true,
  }));
  const currentGeneration = Array.from({ length: 500 }, (_, index) => ({
    categoryId: `current-${index}`, name: `当前分类${index}`, relativePath: `当前分类${index}`, active: true,
  }));
  await f.store.setCategories(firstGeneration);
  await f.store.setCategories(currentGeneration);
  assert.equal((await f.store.read()).categories.length, 1_000);

  const client = createProjectMaterialReadClient();
  t.after(() => client.close());
  const projected = await client.request('categories', { project: f.project });
  assert.equal(projected.length, 500);
  assert.ok(projected.every((category) => category.active !== false && category.categoryId.startsWith('current-')));

  const largeValue = '分'.repeat(256);
  const largePath = `大分类/${'路'.repeat(1_900)}`;
  const oversized = Array.from({ length: 500 }, (_, index) => ({
    categoryId: `large-${index}`, name: largeValue, relativePath: largePath, active: true,
    aliases: Array.from({ length: 20 }, (__, aliasIndex) => `${String(aliasIndex).padStart(2, '0')}${'别'.repeat(254)}`),
  }));
  await f.store.setCategories(oversized);
  await assert.rejects(client.request('categories', { project: f.project }), (error) => {
    assert.equal(error.code, 'project_material_categories_projection_too_large');
    return true;
  });
});

test('explicit unified automation settings override legacy authorization and preserve pause state', async (t) => {
  const f = await fixture(t);
  const normalized = normalizeMaterialAutomation({ ...f.project,
    materialAutomation: { enabled: false, processingPaused: true,
      autoAdoptPathClassified: true, autoDigest: true, maxBatch: 12 } });
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.processingPaused, true);
  assert.equal(normalized.migratedFromMaterialOrganization, false);
  assert.equal(normalized.maxBatch, 12);
});

test('manual locks remain exceptions while unclassified project files enter the provisional inbox', async (t) => {
  const f = await fixture(t);
  const locked = await f.add('参考资料/locked.md', 'locked');
  const loose = await f.add('loose.md', 'loose');
  await f.store.setCategories([{ categoryId: 'manual-category', name: '人工分类', relativePath: '参考资料', active: true }]);
  const freshLocked = (await f.store.read()).materials.find((item) => item.materialId === locked.materialId);
  await f.store.updateClassification([{
    materialId: locked.materialId, expectedVersion: freshLocked.version,
    expectedRecordRevision: freshLocked.recordRevision, categoryId: 'manual-category', tags: [],
  }], { actorId: 'host-admin', source: 'manual' });
  const result = await runProjectMaterialAutomation(f.project, f.store, { reason: 'manual',
    idempotencyKey: 'auto-run-2' });
  assert.equal(result.adopted, 1);
  const index = await f.store.read();
  const overview = projectMaterialAutomationOverview(f.project, index);
  assert.equal(overview.needsConfirmation, 1);
  const exceptions = listProjectMaterialExceptions(f.project, index, { limit: 100 });
  assert.equal(exceptions.total, 1);
  assert.ok(exceptions.items.some((item) => item.reasons.includes('manual_locked')));
  assert.equal(index.materials.find((item) => item.materialId === loose.materialId).adoption.state, 'accepted');
});

test('ambiguous paths use bounded AI suggestions while category uncertainty does not block project adoption', async (t) => {
  const f = await fixture(t);
  await f.add('high-confidence.md', '这是一份内容充分且可安全分类的参考资料。');
  await f.add('medium-confidence.md', '分类线索仍需确认。');
  let calls = 0;
  const result = await runProjectMaterialAutomation(f.project, f.store, {
    reason: 'manual', idempotencyKey: 'auto-run-ai', maxAiBatch: 5,
    async requestAiSuggestions({ candidates, categories }) {
      calls++;
      assert.equal(candidates.length, 2);
      assert.ok(categories.length > 0);
      return { ruleVersion: 'test-ai-v1', failed: [], suggestions: candidates.map((item, index) => ({
        materialId: item.materialId,
        expectedVersion: item.version,
        expectedRecordRevision: item.recordRevision,
        categoryId: categories[0].categoryId,
        tags: [],
        reason: index === 0 ? '证据充分' : '仍需确认',
        evidence: index === 0 ? ['内容充分且可安全分类'] : ['分类线索'],
        confidence: index === 0 ? 'high' : 'medium',
        needsConfirmation: index !== 0,
      })) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ai.attempted, 2);
  assert.equal(result.ai.recorded, 2);
  assert.equal(result.ai.needsConfirmation, 1);
  assert.equal(result.adopted, 2);

  const index = await f.store.read({ fresh: true });
  const accepted = index.materials.find((item) => item.location.relativePath === 'high-confidence.md');
  const pending = index.materials.find((item) => item.location.relativePath === 'medium-confidence.md');
  assert.equal(accepted.adoption.state, 'accepted');
  assert.equal(accepted.classification.source, 'ai');
  assert.equal(accepted.classification.hostValidated, true);
  assert.equal(pending.adoption.state, 'accepted');
  assert.equal(pending.classification.categoryId, '');
  assert.ok(index.classificationSuggestions.some((item) => item.materialId === pending.materialId
    && item.status === 'pending' && item.confidence === 'medium'));
  assert.equal(listProjectMaterialExceptions(f.project, index, { limit: 100 }).total, 0);
});

test('directory-classified materials never invoke the AI callback', async (t) => {
  const f = await fixture(t);
  await f.add('参考资料/path-rule.md', '目录规则已足够。');
  let calls = 0;
  const result = await runProjectMaterialAutomation(f.project, f.store, {
    reason: 'manual', idempotencyKey: 'auto-run-path-only',
    async requestAiSuggestions() { calls++; return { suggestions: [], failed: [] }; },
  });
  assert.equal(calls, 0);
  assert.equal(result.adopted, 1);
});

test('project material automation worker returns only a compact result and commits the batch', async (t) => {
  const f = await fixture(t);
  await f.add('参考资料/worker.md', 'worker content');
  const result = await runProjectMaterialAutomationWorker({ project: f.project,
    options: { reason: 'manual', maxBatch: 20, idempotencyKey: 'worker-auto-1' },
    onAiRequest: async () => ({ suggestions: [], failed: [] }) });
  assert.equal(result.adopted, 1);
  assert.equal('index' in result, false);
  assert.equal(result.overview.businessMaterialCount, 1);
  assert.equal((await f.store.read({ fresh: true })).materials[0].adoption.state, 'accepted');
});

test('project material automation worker sends at most five extracted candidates through the AI bridge', async (t) => {
  const f = await fixture(t);
  await f.add('worker-ai.md', 'worker ai evidence');
  let received = 0;
  const result = await runProjectMaterialAutomationWorker({ project: f.project,
    options: { reason: 'manual', maxBatch: 20, maxAiBatch: 5, idempotencyKey: 'worker-ai-1' },
    onAiRequest: async ({ candidates, categories }) => {
      received += candidates.length;
      assert.ok(candidates.length <= 5);
      assert.match(candidates[0].extractedText, /worker ai evidence/);
      return { ruleVersion: 'worker-ai-test-v1', failed: [], suggestions: [{
        materialId: candidates[0].materialId, expectedVersion: candidates[0].version,
        expectedRecordRevision: candidates[0].recordRevision, categoryId: categories[0].categoryId,
        tags: [], reason: 'worker evidence', evidence: ['worker ai evidence'],
        confidence: 'high', needsConfirmation: false,
      }] };
    } });
  assert.equal(received, 1);
  assert.equal(result.adopted, 1);
  assert.equal((await f.store.read({ fresh: true })).materials[0].classification.source, 'ai');
});

test('a new registry revision gives the automatic digest candidate an explicit new work identity', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const start = source.indexOf('function projectDigestCandidateForAutomation(');
  const end = source.indexOf('\nfunction emitProjectMaterialAutomationProgress(', start);
  assert.ok(start >= 0 && end > start);
  const vm = require('node:vm');
  const context = vm.createContext({
    projectMaterialDigestProjection: () => { throw new Error('digest hint must avoid a full registry read'); },
    readProjectMaterialIndexSync: () => { throw new Error('digest hint must avoid a full registry read'); },
    normalizeMaterialAutomation: () => ({ enabled: true, processingPaused: false, autoDigest: true }),
    providerSupportsProfile: () => true,
    DIGEST_PROFILE: 'digest',
    PROJECT_SCOPE_CONTRACT_VERSION: 'synthetic-scope-v1',
    agentControlStore: () => ({ read: () => ({ global: { enabled: true, version: 1 } }) }),
    digestIdempotencyKey: () => 'unused',
    normalizeTaskEnvelope: (value) => value,
    taskStableId: () => 'task-project',
    projectDigestRequestPath: () => 'request.json',
    projectDigestReceiptPath: () => 'receipt.json',
    isWorkspaceMaterialProject: () => true,
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.makeCandidate = projectDigestCandidateForAutomation;`, context);
  const project = { id: 'project-1', name: 'Synthetic', agentTool: 'codex', knowledgeRootPath: 'knowledge' };
  const first = context.makeCandidate(project, { pendingCount: 1, pendingReferenceCount: 1, registryRevision: 10 });
  const second = context.makeCandidate(project, { pendingCount: 1, pendingReferenceCount: 1, registryRevision: 11 });
  assert.equal(first.workKey, first.idempotencyKey);
  assert.equal(first.sourceVersion, first.idempotencyKey);
  assert.notEqual(second.workKey, first.workKey);
});
