const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectMaterialClassification } = require('../electron/project-material-classification.cjs');
const { createProjectMaterialOrganization, CLEANUP_MIN_AGE_MS } = require('../electron/project-material-organization.cjs');

async function fixture(t, patch = {}, hooks = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-organization-'));
  const workspace = path.join(root, 'workspace');
  const managerPath = path.join(root, 'manager');
  await fs.mkdir(path.join(workspace, '收件箱'), { recursive: true });
  const project = { id: 'project-organization', materialStorageMode: 'workspace-v1',
    workspacePath: workspace, managerPath, inboxRelativePath: '收件箱',
    workspaceFolders: ['参考资料', '方案设计', '提交成果'], materialTagDefinitions: [],
    materialOrganization: { enabled: true, authorizationId: 'authorization-1',
      authorizedAt: '2026-09-30T00:00:00.000Z', authorizedBy: 'host-admin', maxBatch: 20 },
    ...patch };
  const store = createProjectMaterialStore({ projectId: project.id, managerPath,
    roots: { workspace: { path: workspace, kind: 'workspace' } } });
  await createProjectMaterialClassification(project, store).ensureWorkspaceCategories();
  const service = createProjectMaterialOrganization(project, store, hooks);
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-organization-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function add(name, content = name, options = {}) {
    const file = path.join(workspace, '收件箱', name);
    await fs.writeFile(file, content);
    return (await store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace',
      relativePath: `收件箱/${name}` } }], { intent: 'active', ...options })).result[0];
  }
  return { root, workspace, managerPath, project, store, service, add };
}

const runRequest = (id = 'organize-1', materialIds) => ({
  ...(materialIds ? { materialIds } : {}), idempotencyKey: id, trigger: 'manual',
});
const host = { actorId: 'host-admin', canWrite: true };

test('authorized automatic organization moves an independent inbox file and records rule classification', async (t) => {
  const f = await fixture(t);
  const material = await f.add('参考资料.pdf', 'reference bytes');
  const result = await f.service.run(runRequest(), host);
  assert.equal(result.ok, true);
  assert.equal(result.operation.counts.succeeded, 1);
  await assert.rejects(fs.stat(path.join(f.workspace, '收件箱', '参考资料.pdf')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(f.workspace, '参考资料', '参考资料.pdf'), 'utf8'), 'reference bytes');
  const record = (await f.store.read()).materials.find((item) => item.materialId === material.materialId);
  assert.equal(record.location.relativePath, '参考资料/参考资料.pdf');
  assert.equal(record.classification.categoryId, 'workspace-slot-01');
  assert.equal(record.classification.source, 'rule');
  assert.equal(record.classification.manualLocked, false);
  assert.equal(record.organizationState, 'organized');
  assert.equal(record.version, 1);
});

test('unified disabled setting overrides a stale legacy authorization', async (t) => {
  const f = await fixture(t, { materialAutomation: { enabled: false,
    processingPaused: false, autoAdoptPathClassified: true, autoDigest: true, maxBatch: 20 } });
  const status = await f.service.status();
  assert.equal(status.configuration.enabled, false);
  await f.add('参考资料.pdf', 'reference bytes');
  await assert.rejects(f.service.run(runRequest('disabled-run'), host), { code: 'organization_not_authorized' });
});

test('manual classification is respected and automatic move never rewrites it', async (t) => {
  const f = await fixture(t);
  const material = await f.add('参考资料.pdf', 'manual destination');
  const classification = createProjectMaterialClassification(f.project, f.store);
  const applied = await classification.applyBatch([{
    materialId: material.materialId, expectedVersion: material.version,
    expectedRecordRevision: material.recordRevision, categoryId: 'workspace-slot-02',
    tags: [], decision: 'correct',
  }], { actorId: 'host-admin', idempotencyKey: 'manual-category', canWrite: true });
  assert.equal(applied.results[0].ok, true);
  const result = await f.service.run(runRequest(), host);
  assert.equal(result.operation.counts.succeeded, 1);
  assert.equal(await fs.readFile(path.join(f.workspace, '方案设计', '参考资料.pdf'), 'utf8'), 'manual destination');
  const record = (await f.store.read()).materials[0];
  assert.equal(record.classification.categoryId, 'workspace-slot-02');
  assert.equal(record.classification.source, 'manual');
  assert.equal(record.classification.manualLocked, true);
});

test('code and unclassified files remain in inbox without creating a move operation', async (t) => {
  const f = await fixture(t);
  await f.add('参考脚本.js', 'console.log(1)');
  await f.add('无明显线索.pdf', 'unknown');
  const before = await f.store.read();
  const result = await f.service.run(runRequest(), host);
  assert.equal(result.ok, true);
  assert.equal(result.operation, null);
  assert.equal(await fs.readFile(path.join(f.workspace, '收件箱', '参考脚本.js'), 'utf8'), 'console.log(1)');
  assert.equal(await fs.readFile(path.join(f.workspace, '收件箱', '无明显线索.pdf'), 'utf8'), 'unknown');
  assert.equal((await f.store.read()).revision, before.revision);
});

test('occupied target is not overwritten and can be retried after the conflict is removed', async (t) => {
  const f = await fixture(t);
  const material = await f.add('参考资料.pdf', 'new bytes');
  await fs.mkdir(path.join(f.workspace, '参考资料'));
  await fs.writeFile(path.join(f.workspace, '参考资料', '参考资料.pdf'), 'existing bytes');
  const failed = await f.service.run(runRequest(), host);
  assert.equal(failed.operation.counts.failed, 1);
  assert.equal(failed.operation.items[0].code, 'target_occupied');
  assert.equal(failed.operation.items[0].retryable, true);
  assert.equal(await fs.readFile(path.join(f.workspace, '参考资料', '参考资料.pdf'), 'utf8'), 'existing bytes');
  assert.equal(await fs.readFile(path.join(f.workspace, '收件箱', '参考资料.pdf'), 'utf8'), 'new bytes');
  await fs.unlink(path.join(f.workspace, '参考资料', '参考资料.pdf'));
  const retried = await f.service.retry(failed.operation.operationId,
    { materialIds: [material.materialId], idempotencyKey: 'retry-1' }, host);
  assert.equal(retried.operation.counts.succeeded, 1);
  assert.equal(await fs.readFile(path.join(f.workspace, '参考资料', '参考资料.pdf'), 'utf8'), 'new bytes');
});

test('undo restores the original path and metadata only while the organized record is unchanged', async (t) => {
  const f = await fixture(t);
  await f.add('方案设计.docx', 'proposal');
  const moved = await f.service.run(runRequest(), host);
  const undone = await f.service.undo(moved.operation.operationId,
    { idempotencyKey: 'undo-organization-1' }, host);
  assert.equal(undone.results[0].ok, true);
  assert.equal(await fs.readFile(path.join(f.workspace, '收件箱', '方案设计.docx'), 'utf8'), 'proposal');
  await assert.rejects(fs.stat(path.join(f.workspace, '方案设计', '方案设计.docx')), { code: 'ENOENT' });
  const record = (await f.store.read()).materials[0];
  assert.equal(record.location.relativePath, '收件箱/方案设计.docx');
  assert.equal(record.classification.categoryId, '');
  assert.equal(record.organizationState, 'unclassified');
});

test('exact replay is read-only and low disk state pauses before any move', async (t) => {
  const f = await fixture(t);
  await f.add('提交成果.pdf', 'deliverable');
  const first = await f.service.run(runRequest(), host);
  const revision = (await f.store.read()).revision;
  const replay = await f.service.run(runRequest(), host);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.operation.operationId, first.operation.operationId);
  assert.equal((await f.store.read()).revision, revision);

  const low = await fixture(t, { id: 'project-low-space' }, {
    statfs: async () => ({ bavail: 1, bsize: 4096 }),
  });
  await low.add('参考资料.pdf', 'kept');
  const paused = await low.service.run(runRequest('low-space'), host);
  assert.equal(paused.ok, false);
  assert.equal(paused.code, 'insufficient_space');
  assert.equal(await fs.readFile(path.join(low.workspace, '收件箱', '参考资料.pdf'), 'utf8'), 'kept');
});

test('capacity cleanup exposes only old known partials and deletes only explicitly selected candidates', async (t) => {
  const f = await fixture(t);
  const snapshotRoot = path.join(f.store.directory, 'snapshots');
  await fs.mkdir(snapshotRoot, { recursive: true });
  const oldPartial = path.join(snapshotRoot, '11111111-1111-1111-1111-111111111111.partial');
  const protectedSnapshot = path.join(snapshotRoot, 'a'.repeat(64));
  const recentPartial = path.join(f.workspace, '收件箱', '._edu-import-22222222-2222-2222-2222-222222222222.partial');
  await fs.writeFile(oldPartial, 'old');
  await fs.writeFile(protectedSnapshot, 'protected');
  await fs.writeFile(recentPartial, 'recent');
  const old = new Date(Date.now() - CLEANUP_MIN_AGE_MS - 60_000);
  await fs.utimes(oldPartial, old, old);
  const inspection = await f.service.inspectCleanup();
  assert.equal(inspection.candidates.length, 1);
  assert.equal(inspection.candidates[0].area, 'snapshot-partial');
  const cleaned = await f.service.cleanup({ candidateIds: [inspection.candidates[0].candidateId],
    idempotencyKey: 'cleanup-1' }, host);
  assert.equal(cleaned.results[0].ok, true);
  const cleanupRevision = (await f.store.read()).revision;
  const replay = await f.service.cleanup({ candidateIds: [inspection.candidates[0].candidateId],
    idempotencyKey: 'cleanup-1' }, host);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.results[0].ok, true);
  assert.equal((await f.store.read()).revision, cleanupRevision);
  await assert.rejects(fs.stat(oldPartial), { code: 'ENOENT' });
  assert.equal(await fs.readFile(protectedSnapshot, 'utf8'), 'protected');
  assert.equal(await fs.readFile(recentPartial, 'utf8'), 'recent');
});

test('interrupted hard-link stages recover without guessing or duplicating a material', async (t) => {
  const f = await fixture(t);
  const first = await f.add('参考资料.pdf', 'recover-link');
  const before = (await f.store.read()).materials[0];
  const operationId = 'organization-operation-interrupted-link';
  const targetLocation = { kind: 'workspace', rootId: 'workspace', relativePath: '参考资料/参考资料.pdf' };
  await f.store.mutate((index) => {
    index.organizationOperations = [{ operationId, projectId: f.project.id, actorId: 'host-admin',
      idempotencyKey: 'interrupted-link', trigger: 'manual', status: 'running',
      createdAt: new Date().toISOString(), completedAt: '', items: [{
        materialId: first.materialId, version: first.version, beforeRecordRevision: before.recordRevision,
        categoryId: 'workspace-slot-01', ruleVersion: 'workspace-classifier-rule-v1', sha256: first.sha256,
        before: { location: before.location, classification: before.classification,
          organizationState: before.organizationState }, target: targetLocation,
        status: 'moving', retryable: false, undoStatus: '',
      }] }];
    index.organizationReceipts = [];
  });
  await fs.mkdir(path.join(f.workspace, '参考资料'));
  await fs.link(path.join(f.workspace, '收件箱', '参考资料.pdf'),
    path.join(f.workspace, '参考资料', '参考资料.pdf'));
  const recoveredLink = await f.service.recoverInterrupted();
  assert.equal(recoveredLink.recovered, 1);
  assert.equal(await fs.readFile(path.join(f.workspace, '收件箱', '参考资料.pdf'), 'utf8'), 'recover-link');
  await assert.rejects(fs.stat(path.join(f.workspace, '参考资料', '参考资料.pdf')), { code: 'ENOENT' });
  let operation = (await f.store.read()).organizationOperations[0];
  assert.equal(operation.items[0].status, 'failed');
  assert.equal(operation.items[0].retryable, true);

  const second = await f.add('方案设计.docx', 'recover-commit');
  const secondRecord = (await f.store.read()).materials.find((item) => item.materialId === second.materialId);
  const secondOperationId = 'organization-operation-interrupted-commit';
  await f.store.mutate((index) => {
    index.organizationOperations.push({ operationId: secondOperationId, projectId: f.project.id,
      actorId: 'host-admin', idempotencyKey: 'interrupted-commit', trigger: 'manual', status: 'running',
      createdAt: new Date().toISOString(), completedAt: '', items: [{
        materialId: second.materialId, version: second.version,
        beforeRecordRevision: secondRecord.recordRevision, categoryId: 'workspace-slot-02',
        ruleVersion: 'workspace-classifier-rule-v1', sha256: second.sha256,
        before: { location: secondRecord.location, classification: secondRecord.classification,
          organizationState: secondRecord.organizationState },
        target: { kind: 'workspace', rootId: 'workspace', relativePath: '方案设计/方案设计.docx' },
        status: 'moving', retryable: false, undoStatus: '',
      }] });
  });
  await fs.mkdir(path.join(f.workspace, '方案设计'));
  await fs.link(path.join(f.workspace, '收件箱', '方案设计.docx'),
    path.join(f.workspace, '方案设计', '方案设计.docx'));
  await fs.unlink(path.join(f.workspace, '收件箱', '方案设计.docx'));
  const recoveredCommit = await f.service.recoverInterrupted();
  assert.equal(recoveredCommit.recovered, 1);
  const after = (await f.store.read()).materials.find((item) => item.materialId === second.materialId);
  assert.equal(after.location.relativePath, '方案设计/方案设计.docx');
  assert.equal(after.classification.categoryId, 'workspace-slot-02');
  operation = (await f.store.read()).organizationOperations.find((item) => item.operationId === secondOperationId);
  assert.equal(operation.items[0].status, 'succeeded');
  assert.equal(operation.items[0].recovered, true);
});
