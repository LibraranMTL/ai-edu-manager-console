const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  canReadProjectMaterials, materialVisibleToViewer, projectMaterialCapabilities,
  projectMaterialAccessPolicy, publicRemoteProject, publicUploadReceiptFile, listProjectMaterialsForViewer,
} = require('../electron/project-material-http.cjs');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const { categoryDefinitions: projectMaterialCategoryDefinitions } = require('../electron/project-material-classification.cjs');
const { evidenceRevision } = require('../electron/project-material-evidence.cjs');
const { identifier } = require('../electron/project-material-contract.cjs');
function bind(scope, name) {
  const functionStart = main.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0, name);
  const start = main.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6 : functionStart;
  return Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

const record = (id, title, studentId) => ({
  materialId: id, projectId: 'project-1', version: 2, recordRevision: 4,
  location: { kind: 'workspace', rootId: 'workspace', relativePath: `收件箱/${title}` },
  size: 12, updatedAt: '2026-09-29T00:00:00Z', availability: 'available',
  adoption: { state: 'accepted' }, organizationState: 'classified',
  classification: { categoryId: 'reference', tags: ['tag-1'] },
  processing: { state: 'pending' },
  sources: [{ eventId: `${id}-event`, type: 'terminal_upload', studentId,
    hostSourcePath: 'D:\\private\\student.txt' }],
  versions: [{ version: 2, snapshot: 'project-materials/snapshots/private' }],
});

test('project material API scopes student metadata and never projects host paths', () => {
  const index = { projectId: 'project-1', revision: 9, categories: [{ categoryId: 'reference', name: '参考资料', directoryRelativePath: 'secret' }],
    materials: [record('own', '本人.txt', 'student-1'), record('other', '其他.txt', 'student-2'), record('shared', '共用.txt', '')] };
  const student = { type: 'student_session', studentId: 'student-1', allowedStudentIds: ['student-1'] };
  const page = listProjectMaterialsForViewer(index, student, { offset: 0, limit: 10 });
  assert.deepEqual(page.items.map((item) => item.materialId), ['own', 'shared']);
  assert.equal(page.total, 2);
  assert.equal(materialVisibleToViewer(index.materials[1], student), false);
  assert.equal(JSON.stringify(page).includes('D:\\private'), false);
  assert.equal(JSON.stringify(page).includes('snapshots/private'), false);
  assert.equal(JSON.stringify(page).includes('directoryRelativePath'), false);
  assert.equal(listProjectMaterialsForViewer(index, { type: 'device', deviceRole: 'teacher' }).total, 3);
  assert.equal(canReadProjectMaterials({ type: 'device', terminalMode: 'shared', deviceRole: 'student' }), false);
  assert.equal(canReadProjectMaterials({ type: 'agent_grant' }), false);
});

test('pagination and capabilities keep legacy upload compatibility but close unsupported writes', () => {
  const index = { projectId: 'project-1', revision: 1, categories: [], materials: [record('one', 'A.txt', '')] };
  assert.throws(() => listProjectMaterialsForViewer(index, { type: 'admin' }, { offset: -1 }), { code: 'invalid_pagination' });
  assert.throws(() => listProjectMaterialsForViewer(index, { type: 'admin' }, { limit: 101 }), { code: 'invalid_pagination' });
  assert.throws(() => listProjectMaterialsForViewer(index, { type: 'admin' }, { search: 'a'.repeat(121) }), { code: 'invalid_search' });
  const legacy = projectMaterialCapabilities({ id: 'project-1', status: 'active' }, { type: 'student_session' }, 100);
  assert.equal(legacy.operations.upload, true);
  assert.equal(legacy.operations.list, false);
  const sealed = projectMaterialCapabilities({ id: 'project-1', status: 'sealed', materialStorageMode: 'workspace-v1' }, { type: 'admin' }, 100);
  assert.equal(sealed.operations.upload, false);
  assert.equal(sealed.operations.list, true);
  const student = projectMaterialCapabilities({ id: 'project-1', status: 'active', materialStorageMode: 'workspace-v1' },
    { type: 'student_session', studentId: 's1' }, 100);
  assert.equal(student.operations.classificationSuggest, true);
  assert.equal(student.operations.classificationWrite, false);
  assert.equal(student.operations.originalDownload, true);
  assert.equal(student.operations.knowledgeRead, true);
  assert.equal(student.operations.evidenceRead, true);
  assert.equal(student.operations.organizationRead, true);
  assert.equal(student.operations.organizationRun, false);
  assert.equal(student.operations.organizationRetry, false);
  const teacher = { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-1' };
  assert.equal(projectMaterialCapabilities({ id: 'project-1', status: 'active', materialStorageMode: 'workspace-v1' }, teacher, 100)
    .operations.classificationWrite, false);
  const grantedProject = { id: 'project-1', status: 'active', materialStorageMode: 'workspace-v1',
    materialAccess: { managerDeviceIds: ['teacher-1'] } };
  assert.equal(projectMaterialAccessPolicy(grantedProject, teacher).formalManager, true);
  assert.equal(projectMaterialCapabilities(grantedProject, teacher, 100).operations.classificationWrite, true);
  assert.equal(projectMaterialCapabilities(grantedProject, teacher, 100).operations.adoptionWrite, true);
  assert.equal(projectMaterialCapabilities(grantedProject, teacher, 100).operations.evidenceConfirm, true);
  assert.equal(projectMaterialCapabilities(grantedProject, teacher, 100).operations.organizationRun, true);
  assert.equal(projectMaterialCapabilities(grantedProject, teacher, 100).operations.organizationRetry, true);
  const migrating = { ...grantedProject, materialMigrationState: 'running' };
  assert.equal(projectMaterialAccessPolicy(migrating, teacher).writable, false);
  assert.equal(projectMaterialCapabilities(migrating, teacher, 100).operations.upload, false);
  assert.equal(projectMaterialCapabilities(migrating, teacher, 100).operations.classificationWrite, false);
  assert.equal(projectMaterialCapabilities(migrating, teacher, 100).operations.migrationRead, true);
  const projected = publicRemoteProject({ id: 'p1', name: '项目', studentIds: ['s1', 's2'],
    workspacePath: 'D:\\private\\workspace', rawPath: 'D:\\private\\raw', managerPath: 'D:\\private\\manager',
    materialStorageMode: 'workspace-v1' }, { type: 'student_session', allowedStudentIds: ['s1'] }, 100);
  assert.deepEqual(Object.keys(projected).sort(), ['id', 'materialCapabilities', 'materialMigrationState', 'materialRegistryVersion',
    'materialStorageMode', 'name', 'status', 'studentIds']);
  assert.equal(projected.materialMigrationState, 'not_started');
  assert.equal(JSON.stringify(projected).includes('D:\\private'), false);
  assert.deepEqual(projected.studentIds, ['s1']);
  const receipt = publicUploadReceiptFile({ filename: 'a.txt', path: 'D:\\private\\a.txt', size: 1,
    uploadId: 'request-1', materialId: 'material-1', materialVersion: 1 });
  assert.equal(receipt.receiptStatus, 'received_verified');
  assert.equal(receipt.receiptId, 'request-1');
  assert.equal(receipt.clientRequestId, 'request-1');
  assert.equal('path' in receipt, false);
});

test('host HTTP handlers enforce project authorization, mode and safe list projection', () => {
  const project = { id: 'project-1', name: '合成项目', status: 'active', materialStorageMode: 'workspace-v1',
    studentIds: ['student-1'], workspacePath: 'D:\\private\\project', workspaceFolders: ['参考资料'] };
  const index = { projectId: project.id, revision: 1, categories: [], materials: [record('own', '本人.txt', 'student-1')] };
  let registryReads = 0;
  const replies = [];
  const scope = {
    readProjects: () => [project], readProjectMetadata: () => [project], normalizeProject: (item) => item, normalizeProjectMetadata: (item) => item,
    readProjectMaterialIndexSync: () => { registryReads++; return index; },
    requireAuth: (request) => Boolean(request.authContext),
    projectAllowed: (request) => request.authContext.allowedStudentIds?.includes('student-1'),
    canReadProjectMaterials, materialVisibleToViewer,
    publicMaterial: require('../electron/project-material-http.cjs').publicMaterial,
    projectMaterialCapabilities, publicRemoteProject, listProjectMaterialsForViewer,
    projectMaterialCategoryDefinitions,
    isWorkspaceMaterialProject: (item) => item.materialStorageMode === 'workspace-v1',
    getHostIdentity: () => ({ hostId: 'host-1' }), hostDataGenerationId: () => 'generation-1',
    MAX_UPLOAD_BYTES: 100, sendJson: (_response, status, payload) => replies.push({ status, payload }),
  };
  scope.authorizedProjectMaterialRead = bind(scope, 'authorizedProjectMaterialRead');
  const projects = bind(scope, 'handleProjects');
  const capabilities = bind(scope, 'handleProjectMaterialCapabilities');
  const list = bind(scope, 'handleProjectMaterialList');
  const detail = bind(scope, 'handleProjectMaterialDetail');
  const request = { authContext: { type: 'student_session', allowedStudentIds: ['student-1'] } };
  projects(request, {});
  assert.equal(replies.at(-1).payload.projectMaterialProtocolVersion, 1);
  assert.equal(JSON.stringify(replies.at(-1).payload).includes('D:\\private'), false);
  capabilities(request, {}, 'project-1');
  assert.equal(replies.at(-1).status, 200);
  assert.equal(registryReads, 0, 'capability lookup must not scan or read the registry');
  list(request, {}, 'project-1', new URL('http://localhost/?limit=10'));
  assert.equal(replies.at(-1).payload.items[0].materialId, 'own');
  detail(request, {}, 'project-1', 'own');
  assert.equal(replies.at(-1).payload.material.materialId, 'own');
  assert.equal(JSON.stringify(replies).includes('D:\\private'), false);
  const denied = { authContext: { type: 'student_session', allowedStudentIds: ['student-2'] } };
  const readsBeforeDenial = registryReads;
  list(denied, {}, 'project-1', new URL('http://localhost/'));
  assert.equal(replies.at(-1).status, 403);
  assert.equal(registryReads, readsBeforeDenial);
  assert.match(main, /request\.method === 'GET' && projectMaterialMatch/);
  assert.match(main, /handleProjectMaterialCapabilities\(request, response/);
  assert.match(main, /handleProjectClassificationSuggestions\(request, response/);
  assert.match(main, /handleProjectClassificationBatch\(request, response/);
  assert.match(main, /handleProjectClassificationUndo\(request, response/);
  assert.match(main, /handleProjectMaterialRemoteView\(request, response/);
  assert.match(main, /handleProjectClassificationSuggestionList\(request, response/);
  assert.match(main, /handleProjectMaterialVersionDownload\(request, response/);
  assert.match(main, /handleProjectAdoptionBatch\(request, response/);
  assert.match(main, /handleProjectEvidenceConfirmationPreview\(request, response/);
  assert.match(main, /handleProjectEvidenceConfirmation\(request, response/);
  assert.match(main, /handleProjectOrganizationStatus\(request, response/);
  assert.match(main, /handleProjectOrganizationRun\(request, response/);
  assert.match(main, /handleProjectOrganizationRetry\(request, response/);
});

test('remote adoption batch requires a granted manager and reports compatibility work', async () => {
  const project = { id: 'project-1', status: 'active', materialStorageMode: 'workspace-v1',
    materialAccess: { managerDeviceIds: ['teacher-granted'] } };
  const replies = [];
  const compatibility = [];
  const store = { decideAdoption: async () => ({ revision: 8, result: [{ materialId: 'm1',
    ok: true, state: 'accepted', recordRevision: 3 }] }) };
  const scope = {
    authorizedProjectMaterialRead: () => project,
    isWorkspaceMaterialProject: (item) => item.materialStorageMode === 'workspace-v1',
    projectMaterialAccessPolicy,
    parseJsonBody: async (request) => request.body,
    createProjectMaterialHost: () => ({ store }),
    projectMaterialActorId: (auth) => `device:${auth.deviceId}`,
    projectMaterialAssetCompatibility: () => ({ syncAccepted: async (materialId) => compatibility.push(materialId) }),
    updateProjectRecord: () => {}, projectWithNewInputs: (item) => item,
    getHostIdentity: () => ({ hostId: 'host-1' }), hostDataGenerationId: () => 'generation-1',
    sendJson: (_response, status, payload) => replies.push({ status, payload }),
    sendProjectAdoptionError: (_response, error) => { throw error; },
  };
  const handler = bind(scope, 'handleProjectAdoptionBatch');
  await handler({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'other' },
    body: { items: [] } }, {}, project.id);
  assert.equal(replies.at(-1).status, 403);
  await handler({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-granted' },
    body: { idempotencyKey: 'adopt-1', reason: '审核通过', items: [{ materialId: 'm1' }] } }, {}, project.id);
  assert.equal(replies.at(-1).status, 200);
  assert.equal(replies.at(-1).payload.registryRevision, 8);
  assert.deepEqual(compatibility, ['m1']);
});

test('remote evidence confirmation preview returns fixed logical identities and exact replay is read-only', async () => {
  const evidence = { studentId: 's1', ability: '研究', observation: '独立完成实验', status: 'draft',
    confidence: 'medium', sourcePaths: ['D:\\private\\source.txt'] };
  const project = { id: 'project-1', status: 'active', materialStorageMode: 'workspace-v1',
    studentIds: ['s1'], studentEvidence: [evidence], materialAccess: { managerDeviceIds: ['teacher-1'] } };
  const replies = [];
  let readCount = 0;
  const service = {
    prepare: async () => ({ bindingId: 'binding-1', materials: [{ materialId: 'm1', version: 2,
      sha256: 'a'.repeat(64) }], knowledge: [{ relativePath: '概念库/主题.md', sha256: 'b'.repeat(64) }] }),
    readBinding: async () => { readCount++; },
  };
  const scope = {
    authorizedProjectMaterialRead: () => project,
    remoteEvidenceAuthority: () => project,
    remoteEvidenceRecord: (value) => value.studentEvidence[0],
    parseJsonBody: async (request) => request.body,
    evidenceRevision, createProjectEvidenceService: () => service, identifier,
    path, sendJson: (_response, status, payload) => replies.push({ status, payload }),
    sendProjectEvidenceError: (_response, error) => { throw error; },
  };
  const preview = bind(scope, 'handleProjectEvidenceConfirmationPreview');
  await preview({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-1' },
    body: { expectedEvidenceRevision: evidenceRevision(evidence) } }, {}, project.id, 's1');
  assert.equal(replies.at(-1).status, 200);
  assert.equal(replies.at(-1).payload.bindingId, 'binding-1');
  assert.equal(JSON.stringify(replies.at(-1).payload).includes('D:\\private'), false);
  assert.deepEqual(replies.at(-1).payload.sources.map((item) => item.kind), ['material', 'knowledge']);

  project.studentEvidence[0] = { ...evidence, status: 'verified', sourceBinding: { bindingId: 'binding-1' } };
  const confirm = bind(scope, 'handleProjectEvidenceConfirmation');
  await confirm({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-1' }, body: {
    bindingId: 'binding-1', idempotencyKey: 'confirm-1', expectedEvidenceRevision: evidenceRevision(evidence),
  } }, {}, project.id, 's1');
  assert.equal(replies.at(-1).payload.alreadyConfirmed, true);
  assert.equal(readCount, 1);
});

test('classification handlers keep suggestions separate and require an explicit formal manager grant', async () => {
  const project = { id: 'project-1', status: 'active', materialStorageMode: 'workspace-v1',
    materialAccess: { managerDeviceIds: ['teacher-granted'] } };
  const index = { materials: [record('m1', '本人.txt', 's1'), record('m2', '其他.txt', 's2')] };
  const replies = [];
  const calls = [];
  const service = {
    ensureWorkspaceCategories: async () => calls.push('categories'),
    recordSuggestions: async (items, options) => ({ projectId: project.id, items, actorId: options.actorId }),
    applyBatch: async (items, options) => ({ projectId: project.id, items, actorId: options.actorId }),
    undo: async (operationId, options) => ({ projectId: project.id, operationId, actorId: options.actorId }),
  };
  const scope = {
    authorizedProjectMaterialRead: (request) => { request.authContext ||= {}; return project; },
    isWorkspaceMaterialProject: (item) => item.materialStorageMode === 'workspace-v1',
    projectMaterialAccessPolicy,
    parseJsonBody: async (request) => request.body,
    readProjectMaterialIndexSync: () => index,
    materialVisibleToViewer,
    projectClassificationService: () => service,
    projectMaterialActorId: (auth) => auth.type === 'admin' ? 'host-admin'
      : auth.type === 'student_session' ? `student-session:${auth.studentId}` : `device:${auth.deviceId}`,
    getHostIdentity: () => ({ hostId: 'host-1' }), hostDataGenerationId: () => 'generation-1',
    sendJson: (_response, status, payload) => replies.push({ status, payload }),
    sendProjectClassificationError: (_response, error) => { throw error; },
  };
  const suggest = bind(scope, 'handleProjectClassificationSuggestions');
  const apply = bind(scope, 'handleProjectClassificationBatch');
  const undo = bind(scope, 'handleProjectClassificationUndo');
  await suggest({ authContext: { type: 'student_session', studentId: 's1', allowedStudentIds: ['s1'] },
    body: { items: [{ materialId: 'm1' }], idempotencyKey: 'suggest-1' } }, {}, project.id);
  assert.equal(replies.at(-1).status, 200);
  assert.equal(replies.at(-1).payload.actorId, 'student-session:s1');
  await suggest({ authContext: { type: 'student_session', studentId: 's1', allowedStudentIds: ['s1'] },
    body: { items: [{ materialId: 'm2' }], idempotencyKey: 'suggest-hidden' } }, {}, project.id);
  assert.equal(replies.at(-1).status, 404);
  assert.equal(replies.at(-1).payload.code, 'material_missing');
  await apply({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-ungranted' },
    body: { items: [], idempotencyKey: 'apply-denied' } }, {}, project.id);
  assert.equal(replies.at(-1).status, 403);
  await apply({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-granted' },
    body: { items: [{ materialId: 'm1' }], idempotencyKey: 'apply-1' } }, {}, project.id);
  assert.equal(replies.at(-1).status, 200);
  assert.equal(replies.at(-1).payload.actorId, 'device:teacher-granted');
  await undo({ authContext: { type: 'admin' }, body: { idempotencyKey: 'undo-1' } }, {}, project.id, 'operation-1');
  assert.equal(replies.at(-1).payload.actorId, 'host-admin');
  assert.deepEqual(calls, ['categories', 'categories']);
});

test('organization status is scoped and remote run or retry requires an explicit manager grant', async () => {
  const project = { id: 'project-1', status: 'active', materialStorageMode: 'workspace-v1',
    materialAccess: { managerDeviceIds: ['teacher-granted'] } };
  const index = { materials: [record('m1', '本人.txt', 's1'), record('m2', '其他.txt', 's2')] };
  const replies = [];
  const calls = [];
  const organization = {
    status: async ({ visibleMaterialIds }) => ({ operations: [{ operationId: 'op-1',
      items: [...visibleMaterialIds].map((materialId) => ({ materialId })) }] }),
    retry: async (operationId, body, options) => {
      calls.push({ kind: 'retry', operationId, body, options });
      return { ok: true, operation: { operationId } };
    },
  };
  const scope = {
    authorizedProjectMaterialRead: () => project,
    isWorkspaceMaterialProject: (item) => item.materialStorageMode === 'workspace-v1',
    projectMaterialAccessPolicy, readProjectMaterialIndexSync: () => index,
    materialVisibleToViewer, projectMaterialOrganizationService: () => organization,
    parseJsonBody: async (request) => request.body,
    projectMaterialActorId: (auth) => `device:${auth.deviceId}`,
    runProjectMaterialOrganization: async (projectId, body, options) => {
      calls.push({ kind: 'run', projectId, body, options });
      return { ok: true, operation: { operationId: 'op-run' } };
    },
    updateProjectMaterialOrganizationRunState: () => {},
    getHostIdentity: () => ({ hostId: 'host-1' }), hostDataGenerationId: () => 'generation-1',
    sendJson: (_response, status, payload) => replies.push({ status, payload }),
    sendProjectOrganizationError: (_response, error) => { throw error; },
  };
  const status = bind(scope, 'handleProjectOrganizationStatus');
  const run = bind(scope, 'handleProjectOrganizationRun');
  const retry = bind(scope, 'handleProjectOrganizationRetry');
  await status({ authContext: { type: 'student_session', studentId: 's1', allowedStudentIds: ['s1'] } }, {}, project.id);
  assert.deepEqual(replies.at(-1).payload.operations[0].items, [{ materialId: 'm1' }]);
  await run({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-other' },
    body: { idempotencyKey: 'run-denied' } }, {}, project.id);
  assert.equal(replies.at(-1).status, 403);
  await run({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-granted' },
    body: { idempotencyKey: 'run-1', trigger: 'manual' } }, {}, project.id);
  assert.equal(replies.at(-1).status, 200);
  await retry({ authContext: { type: 'device', deviceRole: 'teacher', deviceId: 'teacher-granted' },
    body: { idempotencyKey: 'retry-1', materialIds: ['m1'] } }, {}, project.id, 'op-1');
  assert.equal(replies.at(-1).status, 200);
  assert.deepEqual(calls.map((item) => item.kind), ['run', 'retry']);
  assert.equal(calls[0].options.actorId, 'device:teacher-granted');
});
