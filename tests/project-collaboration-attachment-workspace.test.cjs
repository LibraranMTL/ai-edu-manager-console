const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-collaboration-attachment-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-collaboration-attachment-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const student = { id: 'student-1', name: 'Synthetic student', rawPath: path.join(root, 'student-raw') };
  const project = { id: 'project-1', name: 'Synthetic project', status: 'active',
    materialStorageMode: 'workspace-v1', workspacePath: path.join(root, 'workspace'),
    rawPath: path.join(root, 'old-raw'), managerPath: path.join(root, 'manager'),
    inboxRelativePath: '收件箱', studentIds: [student.id], assetIds: [] };
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  const source = path.join(root, 'remote-attachment.txt');
  await fs.writeFile(source, 'synthetic remote attachment');
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
  const task = { taskId: 'task-1', studentId: student.id, targetNodeId: 'local-node',
    attachmentObjectIds: ['remote-object-1'] };
  const ledger = { objects: { 'remote-object-1': { importedPath: source, sha256 } } };
  let currentProject = project;
  const assetCalls = [];
  const decisionFile = path.join(root, 'decisions.json');
  const scope = {
    fs: fsSync, path, crypto, projectUploadRecoveryIssues: [],
    createProjectMaterialHost, createProjectUploadIntake, stageProjectDirectImport,
    withProjectMaterialLock: withCommitLock,
    readProjects: () => [currentProject], normalizeProject: (value) => value,
    normalizeProjectMetadata: (value) => value,
    isWorkspaceMaterialProject: (value) => value.materialStorageMode === 'workspace-v1',
    ensureProjectWorkspace: (value) => value,
    findStudentByKey: () => student,
    findStudent: (id) => id === student.id ? student : null,
    readCollaborationState: () => ({ node: { nodeId: 'local-node' } }),
    readCollaborationTaskStore: () => ({ tasks: [task] }),
    collaborationImportLedgerPath: () => path.join(root, 'ledger.json'),
    collaborationMaterialDecisionPath: () => decisionFile,
    safeReadJson: (file, fallback) => file.endsWith('ledger.json') ? ledger
      : fsSync.existsSync(file) ? JSON.parse(fsSync.readFileSync(file, 'utf8')) : fallback,
    writeJsonAtomic: (file, value) => fsSync.writeFileSync(file, JSON.stringify(value)),
    updateProjectRecord: (_id, mutate) => { currentProject = mutate(currentProject); },
    writeProjects: (projects) => { currentProject = projects.find((item) => item.id === project.id); },
    projectWithNewInputs: (value) => value,
    readProjectDigestState: () => ({ status: 'pending' }),
    mergeUnique: (values) => [...new Set(values)],
    uniqueTargetFile: (dir, name) => fsSync.existsSync(path.join(dir, name))
      ? path.join(dir, `copy-${name}`) : path.join(dir, name),
    upsertAssetFromFile: (file, metadata) => {
      assetCalls.push(metadata);
      const bytes = fsSync.readFileSync(file);
      return { assetId: `asset-${metadata.referenceId}`,
        sha1: crypto.createHash('sha1').update(bytes).digest('hex'), size: bytes.length,
        references: [{ spaceType: 'project',
        spaceId: project.id, path: file, role: metadata.role }] };
    },
  };
  bind(scope, 'adoptWorkspaceCollaborationAttachment');
  bind(scope, 'resolveCollaborationTaskAttachments');
  bind(scope, 'prepareProjectUploadIntakeStartup');
  return { root, project, student, task, ledger, source, decisionFile, scope, assetCalls,
    currentProject: () => currentProject, setProject: (value) => { currentProject = value; } };
}

test('project adoption registers collaboration attachment in unified workspace only', async (t) => {
  const f = await fixture(t);
  const first = JSON.parse(await f.scope.resolveCollaborationTaskAttachments(f.task.taskId,
    'adopt_project', f.project.id));
  assert.equal(first.ok, true, first.message);
  assert.equal(first.adoptedMaterialIds.length, 1);
  assert.equal(first.adoptedAssetIds.length, 1);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.equal(path.dirname(first.adoptedPaths[0]), path.join(f.project.workspacePath, '收件箱'));
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].adoption.state, 'accepted');
  assert.equal(index.materials[0].sources[0].collaborationTaskId, f.task.taskId);
  assert.equal(index.materials[0].sources[0].collaborationAttachmentObjectId, 'remote-object-1');
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.deepEqual(f.currentProject().assetIds, first.adoptedAssetIds);
  const second = JSON.parse(await f.scope.resolveCollaborationTaskAttachments(f.task.taskId,
    'adopt_project', f.project.id));
  assert.equal(second.ok, true, second.message);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.adoptedMaterialIds, first.adoptedMaterialIds);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.equal(JSON.parse(await fs.readFile(f.decisionFile, 'utf8')).decisions.length, 1);
});

test('attachment source hash mismatch fails before material journal is prepared', async (t) => {
  const f = await fixture(t);
  f.ledger.objects['remote-object-1'].sha256 = '0'.repeat(64);
  const result = JSON.parse(await f.scope.resolveCollaborationTaskAttachments(f.task.taskId,
    'adopt_project', f.project.id));
  assert.equal(result.ok, false);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.equal(fsSync.existsSync(f.decisionFile), false);
});

test('incomplete attachment set cannot be acknowledged as fully adopted', async (t) => {
  const f = await fixture(t);
  f.task.attachmentObjectIds.push('not-delivered');
  const result = JSON.parse(await f.scope.resolveCollaborationTaskAttachments(f.task.taskId,
    'adopt_project', f.project.id));
  assert.equal(result.ok, false);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.equal(fsSync.existsSync(f.decisionFile), false);
});

test('interrupted asset binding leaves recoverable intake and retry records one material', async (t) => {
  const f = await fixture(t);
  const original = f.scope.upsertAssetFromFile;
  let fail = true;
  f.scope.upsertAssetFromFile = (...args) => {
    if (fail) { fail = false; throw new Error('synthetic asset interruption'); }
    return original(...args);
  };
  const failed = JSON.parse(await f.scope.resolveCollaborationTaskAttachments(f.task.taskId,
    'adopt_project', f.project.id));
  assert.equal(failed.ok, false);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  assert.equal(fsSync.existsSync(f.decisionFile), false);
  const retried = JSON.parse(await f.scope.resolveCollaborationTaskAttachments(f.task.taskId,
    'adopt_project', f.project.id));
  assert.equal(retried.ok, true, retried.message);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
});

test('student unbinding during asset work cannot record a successful adoption decision', async (t) => {
  const f = await fixture(t);
  const original = f.scope.upsertAssetFromFile;
  f.scope.upsertAssetFromFile = (...args) => {
    const asset = original(...args);
    f.setProject({ ...f.currentProject(), studentIds: [] });
    return asset;
  };
  const result = JSON.parse(await f.scope.resolveCollaborationTaskAttachments(f.task.taskId,
    'adopt_project', f.project.id));
  assert.equal(result.ok, false);
  assert.equal(fsSync.existsSync(f.decisionFile), false);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  assert.deepEqual(f.currentProject().assetIds, []);
});

test('startup recovery keeps collaboration task and object source identities', async (t) => {
  const f = await fixture(t);
  const staged = await stageProjectDirectImport(f.project, f.source,
    path.join(f.project.workspacePath, '收件箱', 'remote-attachment.txt'), {
      sourceType: 'collaboration_attachment', intent: 'active', expectedSha256: f.ledger.objects['remote-object-1'].sha256,
      studentId: f.student.id, collaborationTaskId: f.task.taskId,
      collaborationAttachmentObjectId: 'remote-object-1',
    });
  assert.ok(staged.entry);
  assert.deepEqual(await f.scope.prepareProjectUploadIntakeStartup(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials[0].sources[0].collaborationTaskId, f.task.taskId);
  assert.equal(index.materials[0].sources[0].collaborationAttachmentObjectId, 'remote-object-1');
  assert.equal(f.assetCalls[0].sourceType, 'collaboration_attachment');
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
});
