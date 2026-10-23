const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createProjectMaterialHost, isWorkspaceMaterialProject,
  projectMaterialDigestProjection, readProjectMaterialIndexSync } = require('../electron/project-material-host.cjs');
const { expectedContentSha256, hashRequestBody, streamRequestToFile } = require('../electron/streaming-upload.cjs');
const { createProjectUploadIntake } = require('../electron/project-upload-intake.cjs');
const { queryUploadReceipt } = require('../electron/upload-receipt-query.cjs');
const { publicUploadReceiptFile } = require('../electron/project-material-http.cjs');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const functionStart = main.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0);
  const start = main.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', functionStart) + 2)}); }`)(scope);
}

test('actual project upload writes a new-mode original to the inbox and returns the registered material identity', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-inbox-upload-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-inbox-upload-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic', status: 'active', studentIds: ['student-1'],
    materialStorageMode: 'workspace-v1', inboxRelativePath: '收件箱',
    workspacePath: path.join(root, 'workspace'), managerPath: path.join(root, '.edu-manager'),
    rawPath: path.join(root, 'legacy') };
  for (const dir of [project.workspacePath, project.rawPath]) fs.mkdirSync(dir, { recursive: true });
  let projects = [project];
  const assets = [];
  const replies = [];
  let failNextRegistration = false;
  const scope = { fs, path, crypto, MAX_UPLOAD_BYTES: 1024 * 1024, todayUploadCount: 0,
    projectUploadRecoveryIssues: [], activeProjectUploadIds: new Set(),
    isWorkspaceMaterialProject, readProjectMaterialIndexSync, queryUploadReceipt,
    publicUploadReceiptFile,
    getHostIdentity: () => ({ hostId: 'host-1' }), createProjectMaterialHost: (value) => {
      const host = createProjectMaterialHost(value);
      return { ...host, registerTerminalUpload: async (...args) => {
        if (failNextRegistration) { failNextRegistration = false; throw new Error('injected registry outage'); }
        return host.registerTerminalUpload(...args);
      } };
    }, createProjectUploadIntake,
    expectedContentSha256, hashRequestBody, streamRequestToFile,
    assertDeclaredUploadFingerprint: (actual, declared) => {
      if (declared && actual.sha256 !== declared) throw new Error('SHA-256 mismatch');
    },
    requireAuth: (request) => { request.authContext = { type: 'device', deviceId: 'device-1' }; return true; },
    requireMatchingUploadGeneration: () => true,
    readProjects: () => projects, readProjectMetadata: () => projects, writeProjects: (next) => { projects = next; },
    normalizeProject: (value) => value, normalizeProjectMetadata: (value) => value, projectAllowed: () => true,
    findStudent: () => ({ id: 'student-1', name: 'Student' }), isStudentAllowed: () => true,
    courseUploadAttribution: () => ({}), remoteCaptureAttribution: () => null,
    ensureProjectWorkspace: (value) => value, assertUploadFileAllowed: () => {},
    assetStore: () => ({ queryDetails: ({ referenceId = '', referenceSpaceId = '' } = {}) => assets.filter((asset) =>
      (asset.references || []).some((reference) => (!referenceId || reference.id === referenceId)
        && (!referenceSpaceId || reference.spaceId === referenceSpaceId))) }),
    uniqueTargetFile: (directory, filename) => {
      const target = path.join(directory, filename);
      return fs.existsSync(target) ? path.join(directory, `${path.parse(filename).name} (1)${path.extname(filename)}`) : target;
    },
    upsertAssetFromFile: (file, context) => {
      const bytes = fs.readFileSync(file);
      const asset = { assetId: `asset-${assets.length + 1}`, filename: path.basename(file), size: bytes.length,
        sha1: crypto.createHash('sha1').update(bytes).digest('hex'), references: [{ id: context.referenceId,
          spaceType: 'project', spaceId: context.projectId, studentId: context.studentId,
          deviceId: context.deviceId, path: file }] };
      assets.push(asset); return asset;
    },
    readProjectDigestState: (value) => projectMaterialDigestProjection(value, readProjectMaterialIndexSync(value)),
    writeProjectDigestState: () => { throw new Error('legacy digest ledger must not be used'); },
    mergeUnique: (values) => [...new Set(values)], projectWithNewInputs: (value) => value,
    resetUploadCounterIfNeeded: () => {}, appendHostTimeline: () => {}, notify: () => {},
    getHostServiceStatus: () => ({}), hostDataGenerationId: () => 'generation-1',
    sendJson: (_response, status, body) => replies.push({ status, body }),
  };
  bind(scope, 'handleProjectMaterialUpload');
  const bytes = Buffer.from('new project original');
  const request = Object.assign(Readable.from([bytes]), { headers: {
    'content-type': 'application/octet-stream', 'content-length': String(bytes.length),
    'x-edu-content-sha256': crypto.createHash('sha256').update(bytes).digest('hex'),
  } });
  const url = new URL('http://localhost/api/projects/project-1/materials?studentId=student-1&filename=source.txt&uploadId=request-1');
  await scope.handleProjectMaterialUpload(request, {}, project.id, url);
  const reply = replies.pop();
  assert.equal(reply.status, 200, reply.body?.message);
  assert.equal(reply.body.files[0].materialVersion, 1);
  assert.match(reply.body.files[0].materialId, /^material-/);
  assert.equal('path' in reply.body.files[0], false);
  assert.equal(fs.existsSync(path.join(project.rawPath, 'source.txt')), false);
  assert.equal(fs.readFileSync(path.join(project.workspacePath, '收件箱', 'source.txt'), 'utf8'), bytes.toString());
  const material = readProjectMaterialIndexSync(project).materials[0];
  assert.equal(material.materialId, reply.body.files[0].materialId);
  assert.equal(material.adoption.state, 'accepted');
  assert.equal(material.links.assets[0].assetId, 'asset-1');
  assert.equal(projects[0].digestState.pendingCount, 1);
  bind(scope, 'handleUploadReceiptQuery');
  scope.handleUploadReceiptQuery({ headers: {} }, {}, new URL('http://localhost/api/uploads/receipt?targetType=project&targetId=project-1&studentId=student-1&uploadId=request-1'));
  const receipt = replies.pop();
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.status, 'received_verified');
  assert.equal(receipt.body.receipt.materialId, material.materialId);
  const activeKey = JSON.stringify([project.id, 'student-1', 'device-1', 'request-1']);
  scope.activeProjectUploadIds.add(activeKey);
  await scope.handleProjectMaterialUpload(Object.assign(Readable.from([bytes]), { headers: {
    'content-type': 'application/octet-stream', 'content-length': String(bytes.length),
  } }), {}, project.id, url);
  assert.equal(replies.pop().body.code, 'upload_in_progress');
  scope.activeProjectUploadIds.delete(activeKey);

  failNextRegistration = true;
  const retryBytes = Buffer.from('saved before registry outage');
  const retryUrl = new URL('http://localhost/api/projects/project-1/materials?studentId=student-1&filename=retry.txt&uploadId=request-2');
  const retryRequest = () => Object.assign(Readable.from([retryBytes]), { headers: {
    'content-type': 'application/octet-stream', 'content-length': String(retryBytes.length),
  } });
  await scope.handleProjectMaterialUpload(retryRequest(), {}, project.id, retryUrl);
  assert.equal(replies.pop().status, 400);
  assert.equal(fs.existsSync(path.join(project.workspacePath, '收件箱', 'retry.txt')), true);
  assert.equal(assets.length, 1);
  assert.equal(scope.projectUploadRecoveryIssues.length, 1);
  await scope.handleProjectMaterialUpload(retryRequest(), {}, project.id, retryUrl);
  const retried = replies.pop();
  assert.equal(retried.status, 200, retried.body?.message);
  assert.equal(retried.body.files[0].filename, 'retry.txt');
  assert.equal(fs.existsSync(path.join(project.workspacePath, '收件箱', 'retry (1).txt')), false);
  assert.equal(assets.length, 2);
  assert.equal(readProjectMaterialIndexSync(project).materials.length, 2);
  assert.deepEqual(await createProjectUploadIntake(project).pending(), []);
  assert.deepEqual(scope.projectUploadRecoveryIssues, []);

  const intake = createProjectUploadIntake(project);
  const startupTarget = path.join(project.workspacePath, '收件箱', 'startup.txt');
  const startupBytes = Buffer.from('landed before process exit');
  await intake.prepare({ uploadId: 'request-3', studentId: 'student-1', deviceId: 'device-1',
    targetPath: startupTarget, expectedSha256: crypto.createHash('sha256').update(startupBytes).digest('hex') });
  fs.writeFileSync(startupTarget, startupBytes);
  bind(scope, 'prepareProjectUploadIntakeStartup');
  assert.deepEqual(await scope.prepareProjectUploadIntakeStartup(), []);
  assert.equal(readProjectMaterialIndexSync(project).materials.length, 3);
  assert.equal(assets.length, 3);
  assert.deepEqual(await intake.pending(), []);
});
