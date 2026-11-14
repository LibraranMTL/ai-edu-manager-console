const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createProjectUploadIntake } = require('../electron/project-upload-intake.cjs');
const { stageProjectDirectImport } = require('../electron/project-direct-import.cjs');
const { withCommitLock } = require('../electron/project-materials.cjs');

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const begin = main.slice(start - 6, start) === 'async ' ? start - 6 : start;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(begin, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-publication-workspace-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-publication-workspace-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic project', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'old-raw'),
    knowledgeRootPath: path.join(root, 'knowledge'), summaryPath: path.join(root, 'knowledge', 'summary'),
    managerPath: path.join(root, 'manager'), inboxRelativePath: '收件箱', studentIds: [], assetIds: [],
    projectLineageId: 'lineage-1' };
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  await fs.mkdir(project.summaryPath, { recursive: true });
  const source = path.join(root, 'remote-source.txt');
  const knowledgeSource = path.join(root, 'remote-summary.md');
  await fs.writeFile(source, 'remote original bytes');
  await fs.writeFile(knowledgeSource, '# Verified remote summary');
  const hash = (file) => crypto.createHash('sha256').update(fsSync.readFileSync(file)).digest('hex');
  const publication = { publicationId: 'publication-1', sourceNodeId: 'remote-node-1',
    sourceProjectId: 'remote-project-1', targetNodeId: 'local-node', lineageId: project.projectLineageId,
    createdAt: '2026-09-29T12:00:00.000Z', project: { name: project.name, workspaceBaseline: [] },
    entries: [{ objectId: 'remote-raw-1', kind: 'raw_material', relativePath: 'workspace/source.txt',
      sha256: hash(source), sourceAssetIds: ['remote-asset-1'], sourceMaterial: {
        materialId: 'remote-material-1', version: 2, sha256: hash(source),
      } }, { objectId: 'remote-knowledge-1', kind: 'knowledge_snapshot', knowledgeKind: 'summary',
      relativePath: 'summary/summary.md', sha256: hash(knowledgeSource),
      sourceAssetIds: ['remote-asset-1'] }] };
  let currentProject = project;
  const assetCalls = [];
  const scope = {
    fs: fsSync, path, crypto, isDeepStrictEqual, projectUploadRecoveryIssues: [],
    createProjectMaterialHost, createProjectUploadIntake, stageProjectDirectImport,
    withProjectMaterialLock: withCommitLock,
    readProjects: () => [currentProject], readProjectMetadata: () => [currentProject],
    getProjectMetadata: (id) => String(id) === currentProject.id ? currentProject : null,
    normalizeProject: (item) => item,
    normalizeProjectMetadata: (item) => item,
    isWorkspaceMaterialProject: (item) => item.materialStorageMode === 'workspace-v1',
    findStudent: () => null,
    writeProjects: (projects) => { currentProject = projects.find((item) => item.id === project.id); },
    updateProjectMetadataRecord: (_id, mutate) => { currentProject = mutate(currentProject); return { project: currentProject }; },
    projectWithNewInputs: (item) => item,
    readProjectDigestState: () => ({ status: 'pending' }),
    mergeUnique: (items) => [...new Set(items)],
    uniqueTargetFile: (dir, filename) => {
      const target = path.join(dir, filename);
      return fsSync.existsSync(target) ? path.join(dir, `copy-${filename}`) : target;
    },
    upsertAssetFromFile: (file, metadata) => {
      assetCalls.push(metadata);
      const bytes = fsSync.readFileSync(file);
      return { assetId: `asset-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}`,
        sha1: crypto.createHash('sha1').update(bytes).digest('hex'), size: bytes.length,
        references: [{ spaceType: 'project', spaceId: project.id, path: file, role: metadata.role }] };
    },
  };
  bind(scope, 'existingWorkspacePublicationRaw');
  bind(scope, 'registerWorkspacePublicationRaw');
  bind(scope, 'prepareProjectUploadIntakeStartup');
  return { root, project, source, knowledgeSource, publication, scope, assetCalls,
    currentProject: () => currentProject,
    setProject: (value) => { currentProject = value; } };
}

test('received publication raw material is registered once in workspace with remote origin', async (t) => {
  const f = await fixture(t);
  const entry = f.publication.entries[0];
  const first = await f.scope.registerWorkspacePublicationRaw(f.project, f.publication, entry, f.source);
  const second = await f.scope.registerWorkspacePublicationRaw(f.project, f.publication, entry, f.source);
  assert.equal(second.materialId, first.materialId);
  assert.equal(second.deduplicated, true);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].publicationId, f.publication.publicationId);
  assert.equal(index.materials[0].sources[0].publicationMaterialId, 'remote-material-1');
  assert.equal(index.materials[0].sources[0].publicationMaterialVersion, 2);
  assert.equal(index.materials[0].adoption.state, 'accepted');
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  await assert.rejects(f.scope.registerWorkspacePublicationRaw(f.project, f.publication,
    { ...entry, sha256: '0'.repeat(64) }, f.source), { code: 'source_changed' });
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
});

test('publication raw intake recovers after interrupted asset binding', async (t) => {
  const f = await fixture(t);
  const original = f.scope.upsertAssetFromFile;
  let interrupt = true;
  f.scope.upsertAssetFromFile = (...args) => {
    if (interrupt) { interrupt = false; throw new Error('synthetic asset interruption'); }
    return original(...args);
  };
  await assert.rejects(f.scope.registerWorkspacePublicationRaw(f.project, f.publication,
    f.publication.entries[0], f.source), /synthetic asset interruption/);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  const recovered = await f.scope.registerWorkspacePublicationRaw(f.project, f.publication,
    f.publication.entries[0], f.source);
  assert.ok(recovered.materialId);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
});

test('publication intake startup recovery preserves remote material identity', async (t) => {
  const f = await fixture(t);
  const entry = f.publication.entries[0];
  const staged = await stageProjectDirectImport(f.project, f.source,
    path.join(f.project.workspacePath, '收件箱', 'source.txt'), {
      sourceType: 'collaboration_publication', intent: 'active', expectedSha256: entry.sha256,
      publicationId: f.publication.publicationId, publicationObjectId: entry.objectId,
      publicationSourceNodeId: f.publication.sourceNodeId,
      publicationMaterialId: entry.sourceMaterial.materialId,
      publicationMaterialVersion: entry.sourceMaterial.version,
    });
  assert.deepEqual(await f.scope.prepareProjectUploadIntakeStartup(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials[0].sources[0].eventId, staged.uploadId);
  assert.equal(index.materials[0].sources[0].publicationObjectId, entry.objectId);
  assert.equal(f.assetCalls[0].sourceType, 'collaboration_publication');
  assert.equal(f.assetCalls[0].role, 'project_raw_collaboration');
});

test('publication receiver maps remote asset sources to local project assets', async (t) => {
  const f = await fixture(t);
  const publicationPath = path.join(f.root, 'publication.json');
  await fs.writeFile(publicationPath, JSON.stringify(f.publication));
  const ledger = { objects: {
    publication: { objectType: 'project_publication', importedPath: publicationPath },
    'remote-raw-1': { importedPath: f.source, sha256: f.publication.entries[0].sha256 },
    'remote-knowledge-1': { importedPath: f.knowledgeSource, sha256: f.publication.entries[1].sha256 },
  } };
  const storePath = path.join(f.root, 'publication-store.json');
  const reviewPath = path.join(f.root, 'knowledge-review.json');
  Object.assign(f.scope, {
    readCollaborationState: () => ({ node: { nodeId: 'local-node' } }),
    collaborationImportLedgerPath: () => path.join(f.root, 'ledger.json'),
    collaborationProjectPublicationPath: () => storePath,
    safeReadJson: (file, fallback) => file.endsWith('ledger.json') ? ledger
      : file === publicationPath ? f.publication
        : fsSync.existsSync(file) ? JSON.parse(fsSync.readFileSync(file, 'utf8')) : fallback,
    normalizePublicationStore: (value) => ({ publications: value.publications || {}, lineages: value.lineages || {} }),
    createProjectPublication: (value) => value,
    isProjectLineageDismissed: () => false,
    validateProjectPublication: () => ({ ok: true }),
    importedProjectLocalStudentIds: () => [], readStudentsIndex: () => [],
    mergeProjectStudentScope: (project) => project,
    ensureProjectWorkspace: (project) => project,
    projectPublicationTargetRoot: (project, entry) => entry.kind === 'knowledge_snapshot'
      ? project.summaryPath : project.rawPath,
    projectPublicationRelativePath: (entry) => entry.kind === 'knowledge_snapshot'
      ? 'summary.md' : entry.relativePath,
    canonicalIsPathInside: (root, file) => path.relative(root, file).length > 0
      && !path.relative(root, file).startsWith('..'),
    sha256CollaborationFile: (file) => crypto.createHash('sha256').update(fsSync.readFileSync(file)).digest('hex'),
    repairCompletedProjectPublication: () => ({ repairedMisplacedKnowledge: 0, digestBaselineRestored: 0 }),
    readProjectKnowledgeReview: () => ({ records: [] }),
    publicationEntryPackagePath: () => '',
    publicationImportDisposition: (entry) => ({ action: 'copy', relativePath: entry.relativePath }),
    repairMisplacedProjectKnowledge: () => 0,
    sha1File: (file) => crypto.createHash('sha1').update(fsSync.readFileSync(file)).digest('hex'),
    writeJsonAtomic: (file, value) => fsSync.writeFileSync(file, JSON.stringify(value)),
    projectKnowledgeReviewPath: () => reviewPath,
    restoreProjectPublicationDigestBaseline: () => 0,
    recordPublication: (store, publication, status, details) => ({ ...store,
      publications: { ...store.publications, [publication.publicationId]: { status, ...details } } }),
    invalidateArchiveAccessCache: () => {},
  });
  bind(f.scope, 'ingestImportedProjectPublications');
  const first = await f.scope.ingestImportedProjectPublications();
  assert.equal(first.importedPublications, 1);
  assert.equal(first.importedFiles, 2);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  const localAssetId = index.materials[0].links.assets[0].assetId;
  const review = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
  assert.deepEqual(review.records[0].sourceAssets, [localAssetId]);
  assert.ok(f.currentProject().assetIds.includes(localAssetId));
  const originalEntries = f.publication.entries;
  f.publication.entries = [{ ...originalEntries[0], objectId: 'another-raw-object',
    relativePath: 'workspace/another.txt' }, ...originalEntries];
  await assert.rejects(f.scope.ingestImportedProjectPublications(), { code: 'ambiguous_remote_asset' });
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  f.publication.entries = originalEntries;
  await fs.rm(f.source);
  const second = await f.scope.ingestImportedProjectPublications();
  assert.equal(second.importedPublications, 0);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
});

test('publication receiver does not overwrite a concurrent project metadata change', async (t) => {
  const f = await fixture(t);
  const publicationPath = path.join(f.root, 'publication.json');
  await fs.writeFile(publicationPath, JSON.stringify(f.publication));
  const ledger = { objects: {
    publication: { objectType: 'project_publication', importedPath: publicationPath },
    'remote-raw-1': { importedPath: f.source, sha256: f.publication.entries[0].sha256 },
  } };
  f.publication.entries = [f.publication.entries[0]];
  Object.assign(f.scope, {
    readCollaborationState: () => ({ node: { nodeId: 'local-node' } }),
    collaborationImportLedgerPath: () => path.join(f.root, 'ledger.json'),
    collaborationProjectPublicationPath: () => path.join(f.root, 'publication-store.json'),
    safeReadJson: (file, fallback) => file.endsWith('ledger.json') ? ledger
      : file === publicationPath ? f.publication : fallback,
    normalizePublicationStore: () => ({ publications: {}, lineages: {} }),
    createProjectPublication: (value) => value,
    isProjectLineageDismissed: () => false,
    validateProjectPublication: () => ({ ok: true }),
    importedProjectLocalStudentIds: () => [], readStudentsIndex: () => [],
    mergeProjectStudentScope: (item) => item, ensureProjectWorkspace: (item) => item,
    repairCompletedProjectPublication: () => ({ repairedMisplacedKnowledge: 0, digestBaselineRestored: 0 }),
    readProjectKnowledgeReview: () => ({ records: [] }),
    publicationEntryPackagePath: () => '',
    projectKnowledgeReviewPath: () => path.join(f.root, 'knowledge-review.json'),
    writeJsonAtomic: (file, value) => fsSync.writeFileSync(file, JSON.stringify(value)),
    restoreProjectPublicationDigestBaseline: () => 0,
    recordPublication: (store) => store,
    invalidateArchiveAccessCache: () => {},
  });
  const original = f.scope.registerWorkspacePublicationRaw;
  f.scope.registerWorkspacePublicationRaw = async (...args) => {
    const result = await original(...args);
    f.setProject({ ...f.currentProject(), updatedAt: 'concurrent-change' });
    return result;
  };
  bind(f.scope, 'ingestImportedProjectPublications');
  await assert.rejects(f.scope.ingestImportedProjectPublications(), { code: 'project_conflict' });
  assert.equal(f.currentProject().updatedAt, 'concurrent-change');
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});
