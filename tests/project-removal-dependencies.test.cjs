const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lifecycle = require('../electron/project-record-lifecycle.cjs');

const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const code = source.slice(start, source.indexOf('\n}', start) + 2);
  scope[name] = Function('scope', `with (scope) { return (${code}); }`)(scope);
}
function fixture(t, { external = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-removal-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-removal-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const projectBase = path.join(root, 'Projects');
  const projectRootPath = external ? path.join(root, 'external-project') : path.join(projectBase, 'synthetic-project');
  const managerPath = path.join(projectRootPath, '.edu-manager');
  const workspacePath = path.join(projectRootPath, 'Workspace');
  const knowledgeRootPath = path.join(projectRootPath, 'Knowledge');
  fs.mkdirSync(managerPath, { recursive: true });
  fs.mkdirSync(workspacePath); fs.mkdirSync(knowledgeRootPath);
  fs.writeFileSync(path.join(workspacePath, 'original.md'), 'synthetic original');
  const project = { id: 'project-1', name: 'Synthetic', managerPath, projectRootPath,
    workspacePath, knowledgeRootPath, rawPath: path.join(knowledgeRootPath, 'Legacy'), projectLineageId: 'lineage-1' };
  const tasksFile = path.join(root, 'tasks.json');
  const projectsFile = path.join(root, 'projects.json');
  const removedRegistryFile = path.join(root, 'removed-projects.json');
  const collaborationFile = path.join(root, 'collaboration.json');
  fs.writeFileSync(tasksFile, JSON.stringify({ tasks: [] }));
  fs.writeFileSync(projectsFile, JSON.stringify({ version: 1, projects: [project] }));
  fs.writeFileSync(collaborationFile, JSON.stringify({ lineages: [] }));
  let activeOperations = 1;
  const scope = { fs, path, process, app: { getPath: () => root, quit: () => {} },
    dialog: { showErrorBox: () => {} }, projectArchiveStartupReady: true,
    projectDigestLookupCache: { mtimeMs: -1, size: -1, projects: [] },
    prepareProjectRecordOperation: lifecycle.prepareProjectRecordOperation,
    applyProjectRecordOperation: lifecycle.applyProjectRecordOperation,
    recoverProjectRecordOperations: lifecycle.recoverProjectRecordOperations,
    projectRecordJson: (value) => `${JSON.stringify(value, null, 2)}\n`,
    projectArchiveRuntime: { status: () => ({ ready: true, activeOperations }), assertFile: () => {} },
    readProjects: () => JSON.parse(fs.readFileSync(projectsFile, 'utf8')).projects, normalizeProject: (value) => value,
    projectsPath: () => projectsFile, removedProjectRegistryPath: () => removedRegistryFile,
    changedGrowthProjectStudentIds: () => [], markGrowthStudentsDirty: () => {},
    taskStorePath: () => tasksFile, safeReadJson: (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } },
    taskChildProcesses: new Map(), taskSchedulerRunning: false, digestWorkflowRunning: false,
    collaborationDirectDeliveryRunning: false, isWorkspaceMaterialProject: () => true,
    readProjectMaterialIndexSync: () => ({ materials: [{ processing: { state: 'completed' } }],
      evidenceBindings: [{ bindingId: 'binding-1' }], knowledge: [{ knowledgeId: 'knowledge-1' }] }),
    collaborationProjectPublicationPath: () => collaborationFile,
    dismissProjectLineage: (store) => ({ ...store, dismissed: true }), restoreProjectLineage: (store) => ({ ...store, dismissed: false }),
    writeJsonAtomic: (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); },
    appendHostTimeline: () => {}, projectsBaseDir: () => projectBase, timestampForFilename: () => 'synthetic-time' };
  for (const name of ['readRemovedProjectRegistry', 'reconcileProjectRecordOperation', 'commitProjectRecordOperation',
    'previewLearningProjectRemoval', 'deleteLearningProject', 'findRemovedProjectSnapshots', 'restoreRemovedProject']) bind(scope, name);
  return { root, project, tasksFile, projectBase, removedRegistryFile, scope, getProjects: () => scope.readProjects(),
    setActiveOperations: (count) => { activeOperations = count; } };
}

test('project removal blocks queued work and unclosed journals, then preserves files and evidence counts', (t) => {
  const fx = fixture(t);
  fs.writeFileSync(fx.tasksFile, JSON.stringify({ tasks: [{ id: 'task-1', sourceType: 'project', sourceId: fx.project.id, status: 'queued' }] }));
  let preview = JSON.parse(fx.scope.previewLearningProjectRemoval(fx.project.id));
  assert.equal(preview.canRemove, false);
  assert.equal(preview.dependencies.unsettledTaskCount, 1);
  assert.equal(JSON.parse(fx.scope.deleteLearningProject(fx.project.id)).ok, false);
  assert.equal(fx.getProjects().length, 1);
  fs.writeFileSync(fx.tasksFile, JSON.stringify({ tasks: [{ id: 'task-1', sourceType: 'project', sourceId: fx.project.id, status: 'cancelled' }] }));
  const journalDir = path.join(fx.project.managerPath, 'project-materials', 'archive-transactions', 'archive-tx-synthetic');
  fs.mkdirSync(journalDir, { recursive: true });
  fs.writeFileSync(path.join(journalDir, 'journal.json'), JSON.stringify({ state: 'prepared' }));
  assert.equal(JSON.parse(fx.scope.deleteLearningProject(fx.project.id)).ok, false);
  fs.writeFileSync(path.join(journalDir, 'journal.json'), JSON.stringify({ state: 'committed' }));
  preview = JSON.parse(fx.scope.previewLearningProjectRemoval(fx.project.id));
  assert.equal(preview.canRemove, true);
  assert.deepEqual(preview.dependencies, { taskCount: 1, unsettledTaskCount: 0, registryCountsAvailable: true,
    materialCount: 1, fixedEvidenceCount: 1, knowledgeCount: 1 });
  const deleted = JSON.parse(fx.scope.deleteLearningProject(fx.project.id));
  assert.equal(deleted.ok, true);
  assert.equal(fx.getProjects().length, 0);
  assert.equal(fs.readFileSync(path.join(fx.project.workspacePath, 'original.md'), 'utf8'), 'synthetic original');
  assert.equal(JSON.parse(fs.readFileSync(deleted.deletedProject.snapshotPath, 'utf8')).dependencies.fixedEvidenceCount, 1);
});

test('removal refuses unknown live activity and restoration accepts only enumerated snapshots', (t) => {
  const fx = fixture(t);
  fx.setActiveOperations(2);
  assert.equal(JSON.parse(fx.scope.previewLearningProjectRemoval(fx.project.id)).canRemove, false);
  fx.setActiveOperations(1);
  const deleted = JSON.parse(fx.scope.deleteLearningProject(fx.project.id));
  assert.equal(deleted.ok, true);
  const forged = path.join(`${fx.projectBase}-outside`, 'synthetic-project', '.edu-manager', '项目记录已移除.json');
  fs.mkdirSync(path.dirname(forged), { recursive: true });
  fs.writeFileSync(forged, fs.readFileSync(deleted.deletedProject.snapshotPath));
  assert.equal(JSON.parse(fx.scope.restoreRemovedProject(forged)).ok, false);
  assert.equal(fx.getProjects().length, 0);
  assert.equal(JSON.parse(fx.scope.restoreRemovedProject(deleted.deletedProject.snapshotPath)).ok, true);
  assert.equal(fx.getProjects().length, 1);
});

test('external project removal remains discoverable and restorable through the durable registry', (t) => {
  const fx = fixture(t, { external: true });
  const deleted = JSON.parse(fx.scope.deleteLearningProject(fx.project.id));
  assert.equal(deleted.ok, true);
  assert.equal(fs.existsSync(fx.projectBase), false);
  assert.equal(JSON.parse(fs.readFileSync(fx.removedRegistryFile)).entries[0].snapshotPath, deleted.deletedProject.snapshotPath);
  const removed = fx.scope.findRemovedProjectSnapshots();
  assert.equal(removed.length, 1);
  assert.equal(removed[0].project.id, fx.project.id);
  assert.equal(JSON.parse(fx.scope.restoreRemovedProject(deleted.deletedProject.snapshotPath)).ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(fx.removedRegistryFile)).entries, []);
  assert.equal(fx.getProjects().length, 1);
  assert.equal(fs.readFileSync(path.join(fx.project.workspacePath, 'original.md'), 'utf8'), 'synthetic original');
});

test('a registered external snapshot may not silently disappear or change identity', (t) => {
  const fx = fixture(t, { external: true });
  const deleted = JSON.parse(fx.scope.deleteLearningProject(fx.project.id));
  assert.equal(deleted.ok, true);
  fs.writeFileSync(deleted.deletedProject.snapshotPath, JSON.stringify({ project: { id: 'other', managerPath: fx.project.managerPath } }));
  assert.throws(() => fx.scope.findRemovedProjectSnapshots(), /身份不一致/);
});
