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

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const begin = main.slice(start - 6, start) === 'async ' ? start - 6 : start;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(begin, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-conversation-delivery-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-conversation-delivery-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic project', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    managerPath: path.join(root, 'manager'), inboxRelativePath: '收件箱', studentIds: ['student-1'] };
  const student = { id: 'student-1', name: 'Synthetic student', rawPath: path.join(root, 'student-raw') };
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  await fs.mkdir(student.rawPath);
  const source = path.join(root, 'conversation.md');
  const bytes = Buffer.from('# Conversation\nUser: What did I learn?\nAssistant: A useful answer.\n');
  await fs.writeFile(source, bytes);
  const conversationAsset = { id: 'conversation-asset-1', storedPath: source,
    contentHash: crypto.createHash('sha256').update(bytes).digest('hex'), interactionId: 'interaction-1' };
  let currentProject = project;
  let deliveries = { deliveries: [] };
  const assetCalls = [];
  const scope = {
    fs: fsSync, path, createProjectMaterialHost, createProjectUploadIntake, stageProjectDirectImport,
    projectUploadRecoveryIssues: [],
    sha256FileDirect: async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),
    sha256Text: (value) => crypto.createHash('sha256').update(value).digest('hex'),
    canonicalIsPathInside: (base, child) => {
      const relative = path.relative(base, child);
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative));
    },
    uniqueTargetFile: (dir, name) => {
      const initial = path.join(dir, name);
      return fsSync.existsSync(initial) ? path.join(dir, `copy-${name}`) : initial;
    },
    upsertAssetFromFile: (file, metadata) => {
      assetCalls.push(metadata);
      const fileBytes = fsSync.readFileSync(file);
      return { assetId: `asset-${crypto.createHash('sha1').update(fileBytes).digest('hex').slice(0, 12)}`,
        sha1: crypto.createHash('sha1').update(fileBytes).digest('hex'), size: fileBytes.length,
        references: [{ spaceType: 'project', spaceId: project.id, path: file, role: metadata.role }] };
    },
    readProjects: () => [currentProject], readProjectMetadata: () => [currentProject], normalizeProject: (value) => value,
    normalizeProjectMetadata: (value) => value, ensureProjectWorkspace: (value) => value,
    isWorkspaceMaterialProject: (value) => value?.materialStorageMode === 'workspace-v1',
    findStudentByKey: (id) => id === student.id ? student : null,
    findStudent: (id) => id === student.id ? student : null,
    parseJsonObject: JSON.parse, getRawDir: () => student.rawPath,
    readConversationDeliveries: () => deliveries,
    writeConversationDeliveries: (_student, value) => { deliveries = structuredClone(value); },
    resolveConversationInboxAsset: () => ({ asset: conversationAsset, sourceScopeType: 'student',
      sourceScopeId: student.id, sourceScopeName: student.name }),
    stableGovernanceId: (...parts) => `delivery-${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`,
    updateProjectRecord: (_id, change) => {
      currentProject = change(currentProject);
      return { project: currentProject, projects: [currentProject] };
    },
    writeProjects: (projects) => { currentProject = projects.find((item) => item.id === project.id); },
    projectWithNewInputs: (value) => value,
    readProjectDigestState: () => ({ status: 'pending' }),
    mergeUnique: (items) => [...new Set(items)],
  };
  bind(scope, 'registerWorkspaceConversationDelivery');
  bind(scope, 'deliverConversationMaterials');
  bind(scope, 'prepareProjectUploadIntakeStartup');
  return { root, project, student, source, conversationAsset, scope,
    deliveries: () => deliveries, currentProject: () => currentProject, assetCalls };
}

function request(f) {
  return JSON.stringify({ targetType: 'project', targetId: f.project.id,
    sources: [{ sourceScopeType: 'student', sourceScopeId: f.student.id,
      assetId: f.conversationAsset.id }] });
}

test('project conversation delivery saves one accepted original in workspace and returns stable receipt', async (t) => {
  const f = await fixture(t);
  const result = JSON.parse(await f.scope.deliverConversationMaterials(f.student.id, request(f)));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.delivered, 1);
  assert.match(result.message, /工作空间收件箱/);
  const receipt = result.results[0];
  assert.ok(receipt.materialId);
  assert.ok(f.scope.canonicalIsPathInside(f.project.workspacePath, receipt.path));
  assert.equal(await fs.readFile(receipt.path, 'utf8'), await fs.readFile(f.source, 'utf8'));
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  const host = createProjectMaterialHost(f.project);
  const index = await host.store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].adoption.state, 'accepted');
  assert.equal(index.materials[0].sources[0].type, 'conversation_delivery');
  assert.equal(index.materials[0].sources[0].conversationDeliveryId, receipt.id);
  assert.equal(index.materials[0].sources[0].conversationAssetId, f.conversationAsset.id);
  assert.equal(index.materials[0].links.assets[0].assetId, receipt.registeredAssetId);
  assert.deepEqual(f.currentProject().assetIds, [receipt.registeredAssetId]);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  const again = JSON.parse(await f.scope.deliverConversationMaterials(f.student.id, request(f)));
  assert.equal(again.ok, true);
  assert.equal(again.deduplicated, 1);
  assert.equal((await host.store.read()).materials.length, 1);
  assert.deepEqual(await fs.readdir(path.join(f.project.workspacePath, '收件箱')),
    [path.basename(receipt.path)]);
});

test('workspace conversation source is registered in place without a second copy', async (t) => {
  const f = await fixture(t);
  const original = path.join(f.project.workspacePath, '参考资料', 'conversation.md');
  await fs.mkdir(path.dirname(original), { recursive: true });
  await fs.copyFile(f.source, original);
  f.conversationAsset.storedPath = original;
  const result = JSON.parse(await f.scope.deliverConversationMaterials(f.student.id, request(f)));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.results[0].path, original);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials[0].location.relativePath,
    '参考资料/conversation.md');
  assert.equal(fsSync.existsSync(path.join(f.project.workspacePath, '收件箱')), false);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});

test('conversation delivery resumes a written intake after binding interruption', async (t) => {
  const f = await fixture(t);
  const original = f.scope.upsertAssetFromFile;
  let once = true;
  f.scope.upsertAssetFromFile = (file, metadata) => {
    if (once) { once = false; throw Object.assign(new Error('synthetic failure'), { code: 'synthetic_failure' }); }
    return original(file, metadata);
  };
  const failed = JSON.parse(await f.scope.deliverConversationMaterials(f.student.id, request(f)));
  assert.equal(failed.ok, false);
  assert.equal(f.deliveries().deliveries.length, 0);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  const retried = JSON.parse(await f.scope.deliverConversationMaterials(f.student.id, request(f)));
  assert.equal(retried.ok, true, retried.message);
  assert.equal(f.deliveries().deliveries.length, 1);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
});

test('retry clears a journal left after accepted material and asset binding', async (t) => {
  const f = await fixture(t);
  const originalStage = f.scope.stageProjectDirectImport;
  let once = true;
  f.scope.stageProjectDirectImport = async (...args) => {
    const staged = await originalStage(...args);
    if (once) {
      once = false;
      staged.intake.complete = async () => { throw Object.assign(new Error('synthetic journal interruption'),
        { code: 'synthetic_journal_interruption' }); };
    }
    return staged;
  };
  const interrupted = JSON.parse(await f.scope.deliverConversationMaterials(f.student.id, request(f)));
  assert.equal(interrupted.ok, false);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials[0].links.assets.length, 1);
  const retried = JSON.parse(await f.scope.deliverConversationMaterials(f.student.id, request(f)));
  assert.equal(retried.ok, true, retried.message);
  assert.equal(retried.deduplicated, 1);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.equal(f.deliveries().deliveries.length, 1);
});

test('legacy project delivery keeps its existing original-library path', async (t) => {
  const f = await fixture(t);
  f.project.materialStorageMode = 'legacy';
  const result = JSON.parse(await f.scope.deliverConversationMaterials(f.student.id, request(f)));
  assert.equal(result.ok, true, result.message);
  assert.ok(f.scope.canonicalIsPathInside(f.project.rawPath, result.results[0].path));
  assert.equal(fsSync.existsSync(path.join(f.project.workspacePath, '收件箱')), false);
});

test('startup recovery preserves conversation delivery identity before UI receipt retry', async (t) => {
  const f = await fixture(t);
  const staged = await stageProjectDirectImport(f.project, f.source,
    path.join(f.project.workspacePath, '收件箱', 'conversation.md'), {
      sourceType: 'conversation_delivery', intent: 'active', studentId: f.student.id,
      conversationDeliveryId: 'delivery-recover-1', conversationAssetId: f.conversationAsset.id,
    });
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  assert.deepEqual(await f.scope.prepareProjectUploadIntakeStartup(), []);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].eventId, staged.uploadId);
  assert.equal(index.materials[0].sources[0].conversationDeliveryId, 'delivery-recover-1');
  assert.equal(index.materials[0].sources[0].conversationAssetId, f.conversationAsset.id);
  assert.equal(f.assetCalls[0].role, 'project_raw_conversation');
  assert.equal(f.assetCalls[0].sourceType, 'conversation_delivery');
});
