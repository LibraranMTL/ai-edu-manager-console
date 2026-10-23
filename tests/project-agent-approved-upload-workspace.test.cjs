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
const { withCommitLock, safePath } = require('../electron/project-materials.cjs');

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const begin = main.slice(start - 6, start) === 'async ' ? start - 6 : start;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(begin, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-agent-approved-upload-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-agent-approved-upload-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic project', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    managerPath: path.join(root, 'manager'), inboxRelativePath: '收件箱', studentIds: ['student-1'] };
  const student = { id: 'student-1', name: 'Synthetic student' };
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  const assetCalls = [];
  let currentProject = project;
  const scope = {
    fs: fsSync, path, crypto, projectUploadRecoveryIssues: [],
    createProjectMaterialHost, createProjectUploadIntake, stageProjectDirectImport,
    withProjectMaterialLock: withCommitLock, safeProjectMaterialPath: safePath,
    sha256FileDirect: async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),
    uniqueTargetFile: (dir, name) => {
      const candidate = path.join(dir, name);
      return fsSync.existsSync(candidate) ? path.join(dir, `copy-${name}`) : candidate;
    },
    upsertAssetFromFile: (file, metadata) => {
      assetCalls.push(metadata);
      const bytes = fsSync.readFileSync(file);
      return { assetId: `asset-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}`,
        sha1: crypto.createHash('sha1').update(bytes).digest('hex'), size: bytes.length,
        references: [{ spaceType: 'project', spaceId: project.id, path: file, role: metadata.role }] };
    },
    readProjects: () => [currentProject], readProjectMetadata: () => [currentProject], normalizeProject: (value) => value,
    normalizeProjectMetadata: (value) => value,
    isWorkspaceMaterialProject: (value) => value?.materialStorageMode === 'workspace-v1',
    findStudent: (id) => String(id) === student.id ? student : null,
    updateProjectRecord: (_id, change) => { currentProject = change(currentProject); return { project: currentProject }; },
    projectWithNewInputs: (value) => value,
    readProjectDigestState: () => ({ status: 'pending' }),
    mergeUnique: (items) => [...new Set(items)],
    writeProjects: (projects) => { currentProject = projects.find((item) => item.id === project.id); },
    writeProjectDigestState: () => ({ status: 'pending' }),
    assertUploadFileAllowed: () => {},
  };
  bind(scope, 'registerWorkspaceAgentApprovedUpload');
  bind(scope, 'applyAgentWriteIntent');
  bind(scope, 'prepareProjectUploadIntakeStartup');
  return { root, project, student, scope, assetCalls,
    setProject: (value) => { currentProject = value; }, currentProject: () => currentProject };
}

const intent = { id: 'approved-intent-1', studentId: 'student-1', projectId: 'project-1' };
const bytes = Buffer.from('A verified project source document.');
const hash = crypto.createHash('sha256').update(bytes).digest('hex');

test('approved Agent upload keeps one workspace original and stable material ID', async (t) => {
  const f = await fixture(t);
  const input = { ...intent, name: 'material.upload', input: { filename: 'source.txt',
    contentBase64: bytes.toString('base64') } };
  const first = await f.scope.applyAgentWriteIntent(input);
  const second = await f.scope.applyAgentWriteIntent(input);
  assert.equal(second.materialId, first.materialId);
  assert.equal(second.assetId, first.assetId);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.equal((await fs.readdir(path.join(f.project.workspacePath, '收件箱'))).length, 1);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].type, 'agent_approved_upload');
  assert.equal(index.materials[0].sources[0].agentIntentId, intent.id);
  assert.equal(index.materials[0].adoption.state, 'accepted');
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.ok(f.currentProject().assetIds.includes(first.assetId));
  await assert.rejects(f.scope.registerWorkspaceAgentApprovedUpload(f.project, f.student, intent,
    Buffer.from('Changed bytes'), 'source.txt', crypto.createHash('sha256').update('Changed bytes').digest('hex')),
  { code: 'upload_id_content_conflict' });
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.equal((await f.scope.applyAgentWriteIntent(input)).materialId, first.materialId);
});

test('approved Agent upload retries a binding interruption without duplicate original', async (t) => {
  const f = await fixture(t);
  const original = f.scope.upsertAssetFromFile;
  let interrupt = true;
  f.scope.upsertAssetFromFile = (...args) => {
    if (interrupt) { interrupt = false; throw Object.assign(new Error('synthetic interruption'), { code: 'synthetic_interrupt' }); }
    return original(...args);
  };
  await assert.rejects(f.scope.registerWorkspaceAgentApprovedUpload(f.project, f.student, intent,
    bytes, 'source.txt', hash), { code: 'synthetic_interrupt' });
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  const result = await f.scope.registerWorkspaceAgentApprovedUpload(f.project, f.student, intent,
    bytes, 'source.txt', hash);
  assert.ok(result.materialId);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});

test('approved Agent upload refuses student unbinding after asynchronous staging', async (t) => {
  const f = await fixture(t);
  const original = f.scope.stageProjectDirectImport;
  f.scope.stageProjectDirectImport = async (...args) => {
    const staged = await original(...args);
    f.setProject({ ...f.currentProject(), studentIds: [] });
    return staged;
  };
  await assert.rejects(f.scope.registerWorkspaceAgentApprovedUpload(f.project, f.student, intent,
    bytes, 'source.txt', hash), { code: 'scope_changed' });
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 0);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
});

test('approved Agent upload startup recovery retains intent and original identity', async (t) => {
  const f = await fixture(t);
  const source = path.join(f.root, 'source.txt');
  await fs.writeFile(source, bytes);
  const staged = await stageProjectDirectImport(f.project, source,
    path.join(f.project.workspacePath, '收件箱', 'source.txt'), {
      sourceType: 'agent_approved_upload', intent: 'active', studentId: f.student.id,
      agentIntentId: intent.id,
    });
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  assert.deepEqual(await f.scope.prepareProjectUploadIntakeStartup(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].eventId, staged.uploadId);
  assert.equal(index.materials[0].sources[0].agentIntentId, intent.id);
  assert.equal(f.assetCalls[0].sourceType, 'agent_approved_upload');
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
});

test('legacy project Agent upload retains its original directory', async (t) => {
  const f = await fixture(t);
  f.setProject({ ...f.project, materialStorageMode: 'legacy', assetIds: [] });
  const result = await f.scope.applyAgentWriteIntent({ ...intent, name: 'material.upload',
    input: { filename: 'source.txt', contentBase64: bytes.toString('base64') } });
  assert.equal(result.status, 'registered');
  assert.equal((await fs.readdir(f.project.rawPath)).length, 1);
  assert.equal(fsSync.existsSync(path.join(f.project.workspacePath, '收件箱')), false);
});
