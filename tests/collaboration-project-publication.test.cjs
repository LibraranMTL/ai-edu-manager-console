const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  PROJECT_PUBLICATION_SCHEMA,
  createProjectPublication,
  dismissProjectLineage,
  isVersionedConflictPath,
  isProjectLineageDismissed,
  normalizeProjectSyncProfile,
  publicationEntryPackagePath,
  publicationImportDisposition,
  recordPublication,
  restoreProjectLineage,
  stableProjectLineageId,
  stablePublicationObjectId,
  validateProjectPublication,
} = require('../electron/collaboration-project-publication.cjs');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('project publication uses stable lineage and object identities without absolute paths', () => {
  const lineageId = stableProjectLineageId('node-teacher', 'project-1');
  const objectId = stablePublicationObjectId(lineageId, 'raw_material', '教材/第一课.pdf');
  const publication = createProjectPublication({
    sourceNodeId: 'node-teacher',
    sourceProjectId: 'project-1',
    targetNodeId: 'node-student',
    project: {
      name: '共同研究',
      workspacePath: 'D:\\private\\must-not-leak',
      deliverables: ['研究报告'],
    },
    entries: [{
      kind: 'raw_material',
      relativePath: '教材/第一课.pdf',
      sha256: HASH_A,
      size: 12,
    }],
  });
  assert.equal(publication.schema, PROJECT_PUBLICATION_SCHEMA);
  assert.equal(publication.lineageId, lineageId);
  assert.equal(publication.entries[0].objectId, objectId);
  assert.equal('workspacePath' in publication.project, false);
  assert.deepEqual(validateProjectPublication(publication, { targetNodeId: 'node-student' }), { ok: true, errors: [] });
});

test('project publication carries a path-neutral workspace screening baseline', () => {
  const publication = createProjectPublication({
    sourceNodeId: 'node-teacher',
    sourceProjectId: 'project-1',
    targetNodeId: 'node-student',
    project: {
      name: '协作研究',
      workspaceBaseline: [{
        id: 'staging-source-1',
        relativePath: '资料/结论.md',
        filename: '结论.md',
        sha1: 'a'.repeat(40),
        status: 'analyzed',
        reviewStatus: 'accepted',
        sourceStrategy: 'reference_only',
        path: 'D:\\private\\must-not-leak',
      }],
    },
  });
  assert.deepEqual(publication.project.workspaceBaseline[0], {
    sourceStagingId: 'staging-source-1',
    relativePath: '资料/结论.md',
    filename: '结论.md',
    sha1: 'a'.repeat(40),
    status: 'analyzed',
    reviewStatus: 'accepted',
    sourceStrategy: 'reference_only',
    aiAction: '',
    aiReason: '',
  });
  assert.equal(JSON.stringify(publication).includes('must-not-leak'), false);
});

test('project publication carries a path-neutral digest baseline', () => {
  const publication = createProjectPublication({
    sourceNodeId: 'node-teacher',
    sourceProjectId: 'project-1',
    targetNodeId: 'node-student',
    project: {
      name: '协作研究',
      digestBaseline: [{
        relativePath: '资料/结论.md',
        sha1: 'b'.repeat(40),
        digestedAt: '2026-07-25T10:00:00.000Z',
        path: 'D:\\private\\must-not-leak',
        batchId: 'local-secret',
      }],
    },
  });
  assert.deepEqual(publication.project.digestBaseline, [{
    relativePath: '资料/结论.md',
    sha1: 'b'.repeat(40),
    digestedAt: '2026-07-25T10:00:00.000Z',
  }]);
  assert.equal(JSON.stringify(publication).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(publication).includes('local-secret'), false);
});

test('project publication rejects target mismatch, unsafe paths and duplicate objects', () => {
  const publication = createProjectPublication({
    sourceNodeId: 'node-a',
    sourceProjectId: 'project-a',
    targetNodeId: 'node-b',
    project: { name: '测试项目' },
    entries: [
      { objectId: 'same', kind: 'raw_material', relativePath: '../secret.txt', sha256: HASH_A },
      { objectId: 'same', kind: 'raw_material', relativePath: 'safe.txt', sha256: HASH_A },
    ],
  });
  const validation = validateProjectPublication(publication, { targetNodeId: 'node-c' });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('目标节点')));
  assert.ok(validation.errors.some((error) => error.includes('对象无效')));
  assert.ok(validation.errors.some((error) => error.includes('对象重复')));
});

test('project publication defaults to direct snapshot and isolates path conflicts', () => {
  assert.deepEqual(normalizeProjectSyncProfile({}), {
    schema: 'edu-manager.project-sync-profile.v1',
    mode: 'snapshot',
    scope: 'whole',
    transferResponsibility: 'direct',
    includeRawMaterials: true,
    includeVerifiedKnowledge: true,
    includeSourceRelations: true,
  });
  assert.equal(publicationImportDisposition(
    { relativePath: '知识/结论.md', sha256: HASH_A },
    { '知识/结论.md': { sha256: HASH_A } },
    'pub-1',
  ).action, 'skip');
  const conflict = publicationImportDisposition(
    { relativePath: '知识/结论.md', sha256: HASH_B },
    { '知识/结论.md': { sha256: HASH_A } },
    'pub-1',
  );
  assert.equal(conflict.action, 'isolate');
  assert.match(conflict.relativePath, /来自协作-pub-1/);
  assert.equal(isVersionedConflictPath(conflict.relativePath), true);
  assert.equal(isVersionedConflictPath('summary/ordinary.md'), false);
});

test('project publication resolves content beside its envelope when the object ledger is stale', () => {
  const envelope = path.join('D:\\exchange', 'projects', 'publication-1', 'publication.json');
  assert.equal(
    publicationEntryPackagePath(envelope, { kind: 'knowledge_snapshot', relativePath: 'summary/结论.md' }),
    path.resolve('D:\\exchange', 'projects', 'publication-1', 'knowledge_snapshot', 'summary', '结论.md'),
  );
  assert.equal(publicationEntryPackagePath(envelope, { kind: 'raw_material', relativePath: '../越界.txt' }), '');
});

test('publication store is idempotent and tracks latest lineage version', () => {
  const first = createProjectPublication({
    publicationId: 'pub-1',
    sourceNodeId: 'node-a',
    sourceProjectId: 'project-a',
    targetNodeId: 'node-b',
    version: 2,
    project: { name: '测试项目' },
  });
  const store = recordPublication({}, first, 'imported', { localProjectId: 'local-1', importedCount: 3 });
  const repeated = recordPublication(store, first, 'imported', { localProjectId: 'local-1', duplicateCount: 3 });
  assert.equal(Object.keys(repeated.publications).length, 1);
  assert.equal(repeated.lineages[first.lineageId].latestVersion, 2);
  assert.equal(repeated.publications['pub-1'].duplicateCount, 3);
});

test('publication store only marks project contents complete after every expected entry is resolved', () => {
  const publication = createProjectPublication({
    publicationId: 'pub-repair',
    sourceNodeId: 'node-a',
    sourceProjectId: 'project-a',
    targetNodeId: 'node-b',
    project: { name: '可自愈项目' },
    entries: [
      { kind: 'raw_material', relativePath: '资料.txt', sha256: HASH_A },
      { kind: 'knowledge_snapshot', relativePath: 'summary/知识.md', knowledgeKind: 'summary', sha256: HASH_B },
    ],
  });
  const partial = recordPublication({}, publication, 'partial', {
    expectedCount: 2,
    resolvedCount: 0,
    contentComplete: false,
  });
  assert.equal(partial.publications['pub-repair'].contentComplete, false);
  assert.equal(partial.publications['pub-repair'].expectedCount, 2);
  const repaired = recordPublication(partial, publication, 'imported', {
    expectedCount: 2,
    resolvedCount: 2,
    contentComplete: true,
    materializationVersion: 1,
  });
  assert.equal(repaired.publications['pub-repair'].contentComplete, true);
  assert.equal(repaired.publications['pub-repair'].resolvedCount, 2);
  assert.equal(repaired.publications['pub-repair'].materializationVersion, 1);
});

test('dismissed collaboration project lineages stay dismissed until explicitly restored', () => {
  const dismissed = dismissProjectLineage({}, 'lineage-1', {
    dismissedAt: '2026-07-25T11:00:00.000Z',
    projectName: '误发项目',
  });
  assert.equal(isProjectLineageDismissed(dismissed, 'lineage-1'), true);
  assert.equal(dismissed.lineages['lineage-1'].localProjectId, '');
  const recorded = recordPublication(dismissed, createProjectPublication({
    publicationId: 'pub-new',
    lineageId: 'lineage-1',
    sourceNodeId: 'node-a',
    sourceProjectId: 'project-a',
    targetNodeId: 'node-b',
    version: 2,
    project: { name: '误发项目' },
  }), 'queued');
  assert.equal(isProjectLineageDismissed(recorded, 'lineage-1'), true);
  const restored = restoreProjectLineage(recorded, 'lineage-1', {
    localProjectId: 'local-1',
    restoredAt: '2026-07-25T12:00:00.000Z',
  });
  assert.equal(isProjectLineageDismissed(restored, 'lineage-1'), false);
  assert.equal(restored.lineages['lineage-1'].localProjectId, 'local-1');
});
