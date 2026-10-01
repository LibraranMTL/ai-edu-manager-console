const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectMaterialMigration } = require('../electron/project-material-migration.cjs');

async function fixture(t, hooks = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-migration-'));
  const project = { id: 'project-migration', name: 'Synthetic migration', status: 'active',
    materialStorageMode: 'legacy', materialMigrationState: 'not_started',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    stagingPath: path.join(root, 'staging'), managerPath: path.join(root, 'manager'),
    knowledgeRootPath: path.join(root, 'knowledge'), inboxRelativePath: '收件箱' };
  for (const directory of [project.workspacePath, project.rawPath, project.stagingPath,
    project.managerPath, project.knowledgeRootPath]) await fs.mkdir(directory, { recursive: true });
  const store = createProjectMaterialStore({ projectId: project.id, managerPath: project.managerPath,
    roots: { workspace: { kind: 'workspace', path: project.workspacePath },
      legacy: { kind: 'legacy_raw', path: project.rawPath },
      'legacy-staging': { kind: 'external', path: project.stagingPath } } });
  const service = createProjectMaterialMigration(project, store, hooks);
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-material-migration-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, project, store, service };
}

const admin = { actorId: 'host-admin', canRead: true, canWrite: true };

test('legacy raw and staging files migrate independently while workspace files are only associated', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.project.workspacePath, '方案设计'), { recursive: true });
  await fs.writeFile(path.join(f.project.workspacePath, '方案设计', '现有.md'), 'workspace');
  await fs.writeFile(path.join(f.project.rawPath, '报告.pdf'), 'raw report');
  await fs.writeFile(path.join(f.project.rawPath, 'site.html'), '<html>linked</html>');
  await fs.writeFile(path.join(f.project.stagingPath, '候选.txt'), 'candidate');

  const preview = await f.service.preview(admin);
  assert.deepEqual(preview.counts, { total: 4, workspace: 1, migratable: 2, preserved: 1, conflicts: 1 });
  assert.equal(preview.items.find((item) => item.title === 'site.html').code, 'dependency_group');
  const selected = preview.items.filter((item) => !item.code).map((item) => item.itemId);
  const result = await f.service.execute({ previewId: preview.previewId, itemIds: selected,
    idempotencyKey: 'migration-execute-1' }, admin);
  assert.equal(result.operation.counts.succeeded, 3);
  assert.equal(await fs.readFile(path.join(f.project.workspacePath, '方案设计', '现有.md'), 'utf8'), 'workspace');
  assert.equal(await fs.readFile(path.join(f.project.workspacePath, '收件箱', '历史迁移',
    '旧原始资料库', '报告.pdf'), 'utf8'), 'raw report');
  assert.equal(await fs.readFile(path.join(f.project.workspacePath, '收件箱', '历史迁移',
    '旧研究暂存', '候选.txt'), 'utf8'), 'candidate');
  await assert.rejects(fs.stat(path.join(f.project.rawPath, '报告.pdf')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.project.stagingPath, '候选.txt')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(f.project.rawPath, 'site.html'), 'utf8'), '<html>linked</html>');
  const records = (await f.store.read()).materials;
  assert.equal(records.length, 3);
  assert.equal(records.find((item) => item.location.relativePath.endsWith('报告.pdf')).adoption.state, 'accepted');
  assert.equal(records.find((item) => item.location.relativePath.endsWith('候选.txt')).adoption.state, 'candidate');
  const status = await f.service.status();
  assert.equal(status.backups.count, 2);
  const revision = (await f.store.read()).revision;
  const replay = await f.service.execute({ previewId: preview.previewId, itemIds: selected,
    idempotencyKey: 'migration-execute-1' }, admin);
  assert.equal(replay.idempotentReplay, true);
  assert.equal((await f.store.read()).revision, revision);
});

test('an exact workspace match is associated without a second workspace copy', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.project.workspacePath, '资料'), { recursive: true });
  await fs.mkdir(path.join(f.project.rawPath, '资料'), { recursive: true });
  await fs.writeFile(path.join(f.project.workspacePath, '资料', 'same.txt'), 'same bytes');
  await fs.writeFile(path.join(f.project.rawPath, '资料', 'same.txt'), 'same bytes');
  const preview = await f.service.preview(admin);
  const workspace = preview.items.find((item) => item.sourceKind === 'workspace');
  const legacy = preview.items.find((item) => item.sourceKind === 'legacy_raw');
  assert.equal(legacy.action, 'associate_existing');
  const result = await f.service.execute({ previewId: preview.previewId,
    itemIds: [workspace.itemId, legacy.itemId], idempotencyKey: 'associate-existing' }, admin);
  assert.equal(result.operation.counts.succeeded, 2);
  assert.equal((await f.store.read()).materials.length, 1);
  assert.equal(await fs.readFile(path.join(f.project.workspacePath, '资料', 'same.txt'), 'utf8'), 'same bytes');
  await assert.rejects(fs.stat(path.join(f.project.rawPath, '资料', 'same.txt')), { code: 'ENOENT' });
});

test('source edits and target collisions after preview stay in the old location', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rawPath, 'changed.pdf'), 'preview bytes');
  await fs.writeFile(path.join(f.project.stagingPath, 'collision.txt'), 'source bytes');
  const preview = await f.service.preview(admin);
  const changed = preview.items.find((item) => item.title === 'changed.pdf');
  const collision = preview.items.find((item) => item.title === 'collision.txt');
  await fs.writeFile(path.join(f.project.rawPath, 'changed.pdf'), 'edited after preview');
  const collisionTarget = path.join(f.project.workspacePath, ...collision.targetRelativePath.split('/'));
  await fs.mkdir(path.dirname(collisionTarget), { recursive: true });
  await fs.writeFile(collisionTarget, 'unrelated target');
  const result = await f.service.execute({ previewId: preview.previewId,
    itemIds: [changed.itemId, collision.itemId], idempotencyKey: 'conflict-run' }, admin);
  assert.equal(result.operation.counts.succeeded, 0);
  assert.equal(result.operation.items.find((item) => item.itemId === changed.itemId).code, 'source_changed');
  assert.equal(result.operation.items.find((item) => item.itemId === collision.itemId).code, 'target_occupied');
  assert.equal(await fs.readFile(path.join(f.project.rawPath, 'changed.pdf'), 'utf8'), 'edited after preview');
  assert.equal(await fs.readFile(path.join(f.project.stagingPath, 'collision.txt'), 'utf8'), 'source bytes');
  assert.equal(await fs.readFile(collisionTarget, 'utf8'), 'unrelated target');
});

test('an interrupted target publication can be retried from its owned hard-link proof', async (t) => {
  let interrupted = false;
  const f = await fixture(t, { checkpoint: async (stage) => {
    if (stage === 'after_target' && !interrupted) { interrupted = true; throw Object.assign(new Error('simulated stop'), { code: 'simulated_stop' }); }
  } });
  await fs.writeFile(path.join(f.project.rawPath, 'resume.pdf'), 'recoverable');
  const preview = await f.service.preview(admin);
  const item = preview.items.find((entry) => entry.title === 'resume.pdf');
  const first = await f.service.execute({ previewId: preview.previewId, itemIds: [item.itemId],
    idempotencyKey: 'interrupted-run' }, admin);
  assert.equal(first.operation.items[0].status, 'failed');
  assert.equal(first.operation.items[0].retryable, true);
  const retried = await f.service.retry(first.operation.operationId,
    { itemIds: [item.itemId], idempotencyKey: 'retry-interrupted-run' }, admin);
  assert.equal(retried.operation.counts.succeeded, 1);
  assert.equal(await fs.readFile(path.join(f.project.workspacePath, ...item.targetRelativePath.split('/')), 'utf8'), 'recoverable');
  await assert.rejects(fs.stat(path.join(f.project.rawPath, 'resume.pdf')), { code: 'ENOENT' });
});

test('rollback restores an unchanged migrated source but preserves later workspace edits as a conflict', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rawPath, 'rollback.pdf'), 'rollback bytes');
  const preview = await f.service.preview(admin);
  const item = preview.items.find((entry) => entry.title === 'rollback.pdf');
  const migrated = await f.service.execute({ previewId: preview.previewId, itemIds: [item.itemId],
    idempotencyKey: 'rollback-run' }, admin);
  const rolled = await f.service.rollback(migrated.operation.operationId,
    { idempotencyKey: 'rollback-1' }, admin);
  assert.equal(rolled.results[0].ok, true);
  assert.equal(await fs.readFile(path.join(f.project.rawPath, 'rollback.pdf'), 'utf8'), 'rollback bytes');
  await assert.rejects(fs.stat(path.join(f.project.workspacePath, ...item.targetRelativePath.split('/'))), { code: 'ENOENT' });

  await fs.writeFile(path.join(f.project.rawPath, 'conflict.pdf'), 'original');
  const secondPreview = await f.service.preview(admin);
  const conflict = secondPreview.items.find((entry) => entry.title === 'conflict.pdf');
  const second = await f.service.execute({ previewId: secondPreview.previewId, itemIds: [conflict.itemId],
    idempotencyKey: 'rollback-conflict-run' }, admin);
  const target = path.join(f.project.workspacePath, ...conflict.targetRelativePath.split('/'));
  await fs.writeFile(target, 'edited in workspace');
  const blocked = await f.service.rollback(second.operation.operationId,
    { idempotencyKey: 'rollback-conflict' }, admin);
  assert.equal(blocked.results[0].ok, false);
  assert.equal(blocked.results[0].code, 'rollback_conflict');
  assert.equal(await fs.readFile(target, 'utf8'), 'edited in workspace');
});

test('migration backups require explicit rechecked cleanup after rollback', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rawPath, 'cleanup.pdf'), 'cleanup bytes');
  const preview = await f.service.preview(admin);
  const item = preview.items.find((entry) => entry.title === 'cleanup.pdf');
  const migrated = await f.service.execute({ previewId: preview.previewId, itemIds: [item.itemId],
    idempotencyKey: 'cleanup-migrate' }, admin);
  assert.equal((await f.service.inspectBackupCleanup(admin)).candidates.length, 0,
    'a rollback-capable backup is not an automatic cleanup candidate');
  await f.service.rollback(migrated.operation.operationId,
    { idempotencyKey: 'cleanup-rollback' }, admin);
  const inspection = await f.service.inspectBackupCleanup(admin);
  assert.equal(inspection.candidates.length, 1);
  const request = { candidateIds: [inspection.candidates[0].candidateId],
    idempotencyKey: 'cleanup-backup' };
  const cleaned = await f.service.cleanupBackups(request, admin);
  assert.equal(cleaned.cleaned, 1);
  assert.equal((await f.service.status()).backups.count, 0);
  const replay = await f.service.cleanupBackups(request, admin);
  assert.equal(replay.idempotentReplay, true);
});
