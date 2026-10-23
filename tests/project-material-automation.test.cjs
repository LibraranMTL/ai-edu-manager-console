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

test('manual locks and unclassified files remain exceptions while digest work is not attention', async (t) => {
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
  assert.equal(result.adopted, 0);
  const index = await f.store.read();
  const overview = projectMaterialAutomationOverview(f.project, index);
  assert.equal(overview.needsConfirmation, 2);
  const exceptions = listProjectMaterialExceptions(f.project, index, { limit: 100 });
  assert.equal(exceptions.total, 2);
  assert.ok(exceptions.items.some((item) => item.reasons.includes('manual_locked')));
  assert.ok(exceptions.items.some((item) => item.reasons.includes('needs_classification')));
});

test('ambiguous paths use bounded AI suggestions while only host-validated high confidence is adopted', async (t) => {
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
  assert.equal(result.adopted, 1);

  const index = await f.store.read({ fresh: true });
  const accepted = index.materials.find((item) => item.location.relativePath === 'high-confidence.md');
  const pending = index.materials.find((item) => item.location.relativePath === 'medium-confidence.md');
  assert.equal(accepted.adoption.state, 'accepted');
  assert.equal(accepted.classification.source, 'ai');
  assert.equal(accepted.classification.hostValidated, true);
  assert.equal(pending.adoption.state, 'candidate');
  assert.equal(pending.classification.categoryId, '');
  assert.ok(index.classificationSuggestions.some((item) => item.materialId === pending.materialId
    && item.status === 'pending' && item.confidence === 'medium'));
  assert.equal(listProjectMaterialExceptions(f.project, index, { limit: 100 }).total, 1);
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
