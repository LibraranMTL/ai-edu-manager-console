const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeConversationImport } = require('../electron/conversation-governance.cjs');
const { AGENT_CONVERSATION_SUBMISSION_SCHEMA, normalizeAgentConversationSubmission,
  conversationSubmissionReceipt } = require('../electron/agent-conversation-submission.cjs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { withCommitLock } = require('../electron/project-materials.cjs');
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-conversation-submission-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-conversation-submission-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic project', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    managerPath: path.join(root, 'manager'), inboxRelativePath: '收件箱', studentIds: ['student-1'] };
  const student = { id: 'student-1', name: 'Synthetic student' };
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  let currentProject = project;
  let submissionStore = { submissions: {}, importedObjectVersions: {} };
  const assetCalls = [];
  const scope = {
    fs: fsSync, path, createProjectMaterialHost, createProjectUploadIntake,
    stageProjectDirectImport, normalizeConversationImport, withProjectMaterialLock: withCommitLock,
    normalizeAgentConversationSubmission, conversationSubmissionReceipt,
    AGENT_CONVERSATION_SUBMISSION_SCHEMA,
    projectUploadRecoveryIssues: [],
    sha256FileDirect: async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),
    isKnownAgentSource: () => true,
    conversationAnalysisFor: () => ({ topics: ['learning'] }),
    readJsonFile: (file, fallback) => {
      try { return JSON.parse(fsSync.readFileSync(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
    },
    writeJsonFile: (file, value) => {
      fsSync.mkdirSync(path.dirname(file), { recursive: true });
      fsSync.writeFileSync(file, JSON.stringify(value));
    },
    uniqueTargetFile: (dir, name) => {
      const first = path.join(dir, name);
      return fsSync.existsSync(first) ? path.join(dir, `copy-${name}`) : first;
    },
    upsertAssetFromFile: (file, metadata) => {
      assetCalls.push(metadata);
      const bytes = fsSync.readFileSync(file);
      return { assetId: `asset-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}`,
        sha1: crypto.createHash('sha1').update(bytes).digest('hex'), size: bytes.length,
        references: [{ spaceType: 'project', spaceId: project.id, path: file, role: metadata.role }] };
    },
    ensureProjectWorkspace: (value) => value,
    isWorkspaceMaterialProject: (value) => value?.materialStorageMode === 'workspace-v1',
    updateProjectRecord: (_id, change) => {
      currentProject = change(currentProject);
      return { project: currentProject };
    },
    projectWithNewInputs: (value) => value,
    readProjectDigestState: () => ({ status: 'pending' }),
    mergeUnique: (items) => [...new Set(items)],
    readProjects: () => [currentProject], readProjectMetadata: () => [currentProject], normalizeProject: (value) => value,
    normalizeProjectMetadata: (value) => value,
    findStudent: (id) => String(id) === student.id ? student : null,
    writeProjects: (projects) => { currentProject = projects.find((item) => item.id === project.id); },
    readAgentConversationSubmissionStore: () => structuredClone(submissionStore),
    writeAgentConversationSubmissionStore: (value) => { submissionStore = structuredClone(value); },
    collaborationImportLedgerPath: () => path.join(root, 'collaboration-ledger.json'),
    safeReadJson: (file, fallback) => {
      try { return JSON.parse(fsSync.readFileSync(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
    },
    resolveAgentConversationTarget: () => ({ status: 'resolved', student, project: currentProject }),
    organizeConversationSubmissionCandidates: () => ({ organized: 0, watching: 0, attention: 0, duplicate: 0 }),
  };
  bind(scope, 'projectConversationGovernanceDir');
  bind(scope, 'conversationImportDependencySummary');
  bind(scope, 'saveWorkspaceAgentProjectConversationImport');
  bind(scope, 'saveWorkspaceAgentProjectConversationImportUnlocked');
  bind(scope, 'saveAgentProjectConversationImport');
  bind(scope, 'conversationSubmissionContent');
  bind(scope, 'persistAgentConversationSubmission');
  bind(scope, 'ingestImportedAgentConversationSubmissions');
  bind(scope, 'prepareProjectUploadIntakeStartup');
  const content = '# Conversation\nUser: Can we test this?\nAssistant: Yes, with a verified source.\n';
  return { root, project, student, content, scope, assetCalls,
    currentProject: () => currentProject, submissionStore: () => submissionStore,
    setSubmissionStore: (value) => { submissionStore = structuredClone(value); } };
}

test('Agent project submission materializes once in workspace with original registry and old raw empty', async (t) => {
  const f = await fixture(t);
  const first = await f.scope.saveAgentProjectConversationImport(f.student, f.project, f.content, 'qclaw');
  assert.equal(first.ok, true, first.message);
  assert.ok(first.materialId);
  assert.ok(first.path.startsWith(path.join(f.project.workspacePath, '收件箱')));
  assert.equal(await fs.readFile(first.path, 'utf8'), f.content);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].adoption.state, 'accepted');
  assert.equal(index.materials[0].sources[0].type, 'conversation_submission');
  assert.equal(index.materials[0].sources[0].conversationInteractionId, first.interaction.id);
  assert.equal(index.materials[0].sources[0].conversationAssetId, first.asset.id);
  assert.equal(index.materials[0].links.assets.length, 1);
  assert.deepEqual(f.currentProject().assetIds, [index.materials[0].links.assets[0].assetId]);
  const conversationIndex = JSON.parse(await fs.readFile(path.join(f.project.managerPath,
    'agent-conversations', 'index.json'), 'utf8'));
  assert.equal(conversationIndex.imports[0].materialId, first.materialId);
  assert.equal(conversationIndex.imports[0].path, first.path);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.deepEqual(await fs.readdir(path.join(f.project.managerPath, 'agent-conversations', 'import-staging')), []);
  const again = await f.scope.saveAgentProjectConversationImport(f.student, f.project, f.content, 'qclaw');
  assert.equal(again.ok, true, again.message);
  assert.equal(again.deduplicated, true);
  assert.equal(again.path, first.path);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.deepEqual(await fs.readdir(path.join(f.project.workspacePath, '收件箱')),
    [path.basename(first.path)]);
});

test('concurrent project conversations retain both source records and index entries', async (t) => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([
    f.scope.saveAgentProjectConversationImport(f.student, f.project, f.content, 'qclaw'),
    f.scope.saveAgentProjectConversationImport(f.student, f.project,
      '# Conversation\nUser: A second question?\nAssistant: A separate verified answer.\n', 'codex'),
  ]);
  assert.equal(first.ok, true, first.message);
  assert.equal(second.ok, true, second.message);
  assert.notEqual(first.materialId, second.materialId);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 2);
  const index = JSON.parse(await fs.readFile(path.join(f.project.managerPath,
    'agent-conversations', 'index.json'), 'utf8'));
  assert.deepEqual(new Set(index.imports.map((item) => item.materialId)),
    new Set([first.materialId, second.materialId]));
  assert.equal(f.currentProject().assetIds.length, 2);
});

test('project submission receipt waits for accepted material and upgrades legacy materialization', async (t) => {
  const f = await fixture(t);
  const input = { sourceAgent: 'qclaw', sourceNodeId: 'node-1', sessionId: 'session-1',
    scopeType: 'project', scopeId: f.project.id, studentHint: f.student.id,
    targetProject: f.project.id, submittedAt: '2026-09-29T12:00:00.000Z',
    messages: [{ role: 'user', content: 'Can we test this?' },
      { role: 'assistant', content: 'Yes, with a verified source.' }] };
  const submission = normalizeAgentConversationSubmission(input);
  f.setSubmissionStore({ submissions: { [submission.idempotencyKey]: {
    status: 'stored', materializationVersion: 2,
    receipt: { studentId: f.student.id, projectId: f.project.id, status: 'stored' },
  } }, importedObjectVersions: {} });
  const result = await f.scope.persistAgentConversationSubmission(input);
  assert.equal(result.ok, true);
  assert.ok(result.receipt.materialId);
  assert.equal(result.receipt.materialId, result.imported.materialId);
  assert.equal(f.submissionStore().submissions[submission.idempotencyKey].materializationVersion, 3);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  const again = await f.scope.persistAgentConversationSubmission(input);
  assert.equal(again.deduplicated, true);
  assert.equal(again.receipt.materialId, result.receipt.materialId);
});

test('project submission rejects a reused idempotency key from another scope', async (t) => {
  const f = await fixture(t);
  const input = { sourceAgent: 'qclaw', sourceNodeId: 'node-1', sessionId: 'session-scope',
    scopeType: 'project', scopeId: f.project.id, studentHint: f.student.id,
    targetProject: f.project.id, submittedAt: '2026-09-29T12:00:00.000Z',
    messages: [{ role: 'assistant', content: 'A verified answer.' }] };
  const submission = normalizeAgentConversationSubmission(input);
  f.setSubmissionStore({ submissions: { [submission.idempotencyKey]: {
    status: 'stored', materializationVersion: 3,
    receipt: { studentId: f.student.id, projectId: 'another-project', status: 'stored' },
  } }, importedObjectVersions: {} });
  await assert.rejects(async () => f.scope.persistAgentConversationSubmission(input),
    { code: 'idempotency_scope_conflict' });
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 0);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});

test('remote collaboration conversation is materialized before import version advances', async (t) => {
  const f = await fixture(t);
  const importedPath = path.join(f.root, 'remote-conversation.json');
  const input = { sourceAgent: 'qclaw', sourceNodeId: 'remote-node', sessionId: 'remote-session',
    scopeType: 'project', scopeId: f.project.id, studentHint: f.student.id,
    targetProject: f.project.id, submittedAt: '2026-09-29T12:00:00.000Z',
    messages: [{ role: 'assistant', content: 'Verified remote conversation.' }] };
  await fs.writeFile(importedPath, JSON.stringify(input));
  await fs.writeFile(path.join(f.root, 'collaboration-ledger.json'), JSON.stringify({ objects: {
    'remote-object': { objectId: 'remote-object', objectType: 'agent_conversation_submission',
      importedPath, version: 1 },
  } }));
  const first = await f.scope.ingestImportedAgentConversationSubmissions();
  assert.deepEqual(first, { imported: 1, awaitingAttribution: 0, duplicates: 0, failed: 0 });
  assert.equal(f.submissionStore().importedObjectVersions['remote-object'], 1);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  const second = await f.scope.ingestImportedAgentConversationSubmissions();
  assert.deepEqual(second, { imported: 0, awaitingAttribution: 0, duplicates: 0, failed: 0 });
});

test('project submission retries binding interruption without writing a false conversation receipt', async (t) => {
  const f = await fixture(t);
  const original = f.scope.upsertAssetFromFile;
  let once = true;
  f.scope.upsertAssetFromFile = (file, metadata) => {
    if (once) { once = false; throw Object.assign(new Error('synthetic asset interruption'),
      { code: 'synthetic_asset_interruption' }); }
    return original(file, metadata);
  };
  const first = await f.scope.saveAgentProjectConversationImport(f.student, f.project, f.content, 'qclaw');
  assert.equal(first.ok, false);
  assert.equal(fsSync.existsSync(path.join(f.project.managerPath, 'agent-conversations', 'index.json')), false);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  const retried = await f.scope.saveAgentProjectConversationImport(f.student, f.project, f.content, 'qclaw');
  assert.equal(retried.ok, true, retried.message);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});

test('project submission rejects student unbinding during asynchronous source preparation', async (t) => {
  const f = await fixture(t);
  const original = f.scope.stageProjectDirectImport;
  f.scope.stageProjectDirectImport = async (...args) => {
    const staged = await original(...args);
    f.project.studentIds = [];
    return staged;
  };
  const result = await f.scope.saveAgentProjectConversationImport(f.student, f.project, f.content, 'qclaw');
  assert.equal(result.ok, false);
  assert.match(result.message, /范围已变化/);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 0);
  assert.equal(fsSync.existsSync(path.join(f.project.managerPath, 'agent-conversations', 'index.json')), false);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});

test('conversation submission intake recovery preserves interaction and asset origin', async (t) => {
  const f = await fixture(t);
  const normalized = normalizeConversationImport({ studentId: f.student.id, tool: 'qclaw',
    content: f.content });
  const source = path.join(f.root, 'source.md');
  await fs.writeFile(source, f.content);
  const staged = await stageProjectDirectImport(f.project, source,
    path.join(f.project.workspacePath, '收件箱', `${normalized.asset.id}.md`), {
      sourceType: 'conversation_submission', intent: 'active', studentId: f.student.id,
      conversationAssetId: normalized.asset.id, conversationInteractionId: normalized.interaction.id,
    });
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  assert.deepEqual(await f.scope.prepareProjectUploadIntakeStartup(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].eventId, staged.uploadId);
  assert.equal(index.materials[0].sources[0].conversationAssetId, normalized.asset.id);
  assert.equal(index.materials[0].sources[0].conversationInteractionId, normalized.interaction.id);
  assert.equal(f.assetCalls[0].role, 'project_raw_conversation');
  assert.equal(f.assetCalls[0].sourceType, 'conversation_submission');
});

test('legacy project Agent submission retains old raw path', async (t) => {
  const f = await fixture(t);
  f.project.materialStorageMode = 'legacy';
  const result = f.scope.saveAgentProjectConversationImport(f.student, f.project, f.content, 'qclaw');
  assert.equal(result.ok, true, result.message);
  assert.ok(result.path.startsWith(path.join(f.project.rawPath, 'Agent对话资料')));
  assert.equal(fsSync.existsSync(path.join(f.project.workspacePath, '收件箱')), false);
});

test('conversation lifecycle cannot permanently delete a registered project original', async (t) => {
  const f = await fixture(t);
  const saved = await f.scope.saveAgentProjectConversationImport(f.student, f.project, f.content, 'qclaw');
  assert.equal(saved.ok, true);
  const summary = f.scope.conversationImportDependencySummary(f.student, {
    scopeType: 'project', scopeId: f.project.id, project: f.project,
    candidatesPath: path.join(f.root, 'missing-candidates.json'),
  }, { assetId: saved.asset.id, materialId: saved.materialId });
  assert.equal(summary.canPermanentlyDelete, false);
});
