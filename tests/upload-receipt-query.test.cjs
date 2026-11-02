const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { queryUploadReceipt, verifiedSource } = require('../electron/upload-receipt-query.cjs');
const { expectedContentSha256, hashRequestBody, streamRequestToFile } = require('../electron/streaming-upload.cjs');
const { publicStudentUploadReceiptFile, studentUploadAssetId,
  studentUploadFailure } = require('../electron/student-upload-receipt.cjs');

const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0);
  const start = source.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  scope[name] = Function('scope', `with (scope) { return (${source.slice(start, source.indexOf('\n}', functionStart) + 2)}); }`)(scope);
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-upload-receipt-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-upload-receipt-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'original.txt');
  const bytes = Buffer.from('synthetic original');
  fs.writeFileSync(file, bytes);
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const studentRecord = { studentId: 's1', deviceId: 'd1', uploadId: 'request-1', filename: 'original.txt', path: file,
    size: bytes.length, sha1, contentSha256: sha256, uploadedAt: '2026-09-29T00:00:00Z' };
  const asset = { assetId: 'asset-1', filename: 'original.txt', size: bytes.length, sha1,
    references: [{ id: 'request-1', spaceType: 'project', spaceId: 'p1', studentId: 's1', deviceId: 'd1', path: file,
      contentSha256: sha256, linkedAt: '2026-09-29T00:00:00Z' }] };
  return { file, studentRecord, asset };
}

test('scoped student and project receipts verify bytes without exposing host paths', (t) => {
  const f = fixture(t);
  for (const input of [
    { targetType: 'student', targetId: 's1', records: [f.studentRecord] },
    { targetType: 'project', targetId: 'p1', studentId: 's1', assets: [f.asset] },
  ]) {
    const result = queryUploadReceipt({ ...input, uploadId: 'request-1', deviceId: 'd1' });
    assert.equal(result.status, 'received_verified');
    assert.equal(result.receipt.sha1, f.studentRecord.sha1);
    assert.equal(result.receipt.sha256, f.studentRecord.contentSha256);
    assert.equal(JSON.stringify(result).includes(f.file), false);
    assert.equal(queryUploadReceipt({ ...input, uploadId: 'request-1', deviceId: 'other' }).status, 'not_found');
  }
  assert.equal(queryUploadReceipt({ targetType: 'project', targetId: 'p1', studentId: 'other',
    uploadId: 'request-1', deviceId: 'd1', assets: [f.asset] }).status, 'not_found');
  assert.equal(queryUploadReceipt({ targetType: 'project', targetId: 'p1', uploadId: 'request-1',
    deviceId: 'd1', assets: [f.asset] }).status, 'scope_unverifiable');
});

test('missing or changed source never becomes a verified receipt', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.file, 'synthetic changed!');
  assert.equal(queryUploadReceipt({ targetType: 'student', targetId: 's1', uploadId: 'request-1',
    deviceId: 'd1', records: [f.studentRecord] }).status, 'received_unavailable');
  assert.equal(queryUploadReceipt({ targetType: 'project', targetId: 'p1', studentId: 's1', uploadId: 'request-1',
    deviceId: 'd1', assets: [f.asset] }).status, 'received_unavailable');
  assert.equal(queryUploadReceipt({ targetType: 'student', targetId: 's1', uploadId: 'missing',
    deviceId: 'd1', records: [f.studentRecord] }).status, 'not_found');
  assert.equal(queryUploadReceipt({ targetType: 'student', targetId: 's1', studentId: 's1', uploadId: 'missing',
    deviceId: 'd1', records: [f.studentRecord] }).studentId, 's1');
});

test('new-mode project receipt requires a matching material event and asset binding', (t) => {
  const f = fixture(t);
  const base = { targetType: 'project', targetId: 'p1', studentId: 's1', uploadId: 'request-1',
    deviceId: 'd1', assets: [f.asset] };
  assert.equal(queryUploadReceipt({ ...base, materials: [] }).status, 'received_unavailable');
  const material = { projectId: 'p1', materialId: 'material-1', version: 1,
    sha256: f.studentRecord.contentSha256,
    sources: [{ eventId: 'request-1', studentId: 's1', deviceId: 'd1' }],
    links: { assets: [{ assetId: 'asset-1', version: 1, sha256: f.studentRecord.contentSha256 }] } };
  const verified = queryUploadReceipt({ ...base, materials: [material] });
  assert.equal(verified.status, 'received_verified');
  assert.equal(verified.receiptId, 'request-1');
  assert.equal(verified.clientRequestId, 'request-1');
  assert.equal(verified.receipt.materialId, 'material-1');
  assert.equal(verified.receipt.materialVersion, 1);
  assert.equal(queryUploadReceipt({ ...base, materials: [{ ...material, links: { assets: [] } }] }).status,
    'received_unavailable');
});

test('receipt with a conflicting recorded SHA-256 does not verify unchanged bytes', (t) => {
  const f = fixture(t);
  f.studentRecord.contentSha256 = '0'.repeat(64);
  assert.equal(queryUploadReceipt({ targetType: 'student', targetId: 's1', uploadId: 'request-1',
    deviceId: 'd1', records: [f.studentRecord] }).status, 'received_unavailable');
});

test('host receipt endpoint enforces project and student authorization before revealing a scoped result', (t) => {
  const f = fixture(t); const replies = [];
  const scope = { queryUploadReceipt, getHostIdentity: () => ({ hostId: 'host-1' }), hostDataGenerationId: () => 'generation-1',
    requireAuth: (request) => { request.authContext = { type: 'device', deviceId: 'd1' }; return true; },
    isStudentAllowed: (_request, studentId) => studentId === 's1',
    findStudent: (studentId) => ['s1', 's2'].includes(studentId) ? { id: studentId } : null,
    readProjects: () => [{ id: 'p1', status: 'active', studentIds: ['s1'] }],
    getProjectMetadata: (id) => id === 'p1' ? { id: 'p1', status: 'active', studentIds: ['s1'] } : null,
    normalizeProject: (value) => value, normalizeProjectMetadata: (value) => value,
    isWorkspaceMaterialProject: () => false, projectAllowed: () => true,
    readUploadRecords: () => [f.studentRecord], assetStore: () => ({ queryDetails: () => [f.asset] }),
    sendJson: (_response, status, body) => replies.push({ status, body }) };
  bind(scope, 'handleUploadReceiptQuery');
  const url = (targetType, targetId, studentId = 's1') => new URL(`http://localhost/api/uploads/receipt?targetType=${targetType}&targetId=${targetId}&studentId=${studentId}&uploadId=request-1`);
  scope.handleUploadReceiptQuery({}, {}, url('project', 'p1'));
  assert.equal(replies.pop().body.status, 'received_verified');
  scope.handleUploadReceiptQuery({}, {}, url('project', 'p1', 's2'));
  assert.equal(replies.pop().status, 403);
  scope.handleUploadReceiptQuery({}, {}, url('student', 's2'));
  assert.equal(replies.pop().status, 403);
  scope.handleUploadReceiptQuery({}, {}, url('student', 's3'));
  assert.equal(replies.pop().body.code, 'student_unavailable');
  scope.readProjects = () => [];
  scope.getProjectMetadata = () => null;
  scope.handleUploadReceiptQuery({}, {}, url('project', 'p1'));
  assert.equal(replies.pop().body.code, 'project_unavailable');
});

test('actual student upload retry accepts matching bytes and rejects a changed body under the same request ID', async (t) => {
  const f = fixture(t); const replies = [];
  const scope = { fs, path, crypto, MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
    expectedContentSha256, hashRequestBody, verifiedSource,
    publicStudentUploadReceiptFile, studentUploadAssetId, studentUploadFailure,
    assertDeclaredUploadFingerprint: (actual, declared) => { if (declared && actual.sha256 !== declared) throw new Error('SHA-256 mismatch'); },
    requireStudentAccess: (request) => { request.authContext = { deviceId: 'd1' }; return true; },
    requireMatchingUploadGeneration: () => true,
    findStudent: () => ({ id: 's1', name: 'Synthetic', rawPath: path.dirname(f.file) }),
    courseUploadAttribution: () => ({}), remoteCaptureAttribution: () => null,
    readUploadRecords: () => [f.studentRecord], assetStore: () => ({
      queryDetails: () => [f.asset], findByFingerprint: () => f.asset,
    }), countFiles: () => 1,
    getHostIdentity: () => ({ hostId: 'host-1' }),
    hostDataGenerationId: () => 'generation-1', todayUploadCount: 1,
    sendJson: (_response, status, body) => replies.push({ status, body }) };
  for (const name of ['fingerprintDuplicateRequest', 'sha256FileDirect', 'handleMaterialUpload']) bind(scope, name);
  const url = new URL('http://localhost/api/students/s1/materials?filename=original.txt&uploadId=request-1');
  const request = (text) => Object.assign(Readable.from([Buffer.from(text)]),
    { headers: { 'content-type': 'application/octet-stream', 'content-length': String(Buffer.byteLength(text)) } });
  await scope.handleMaterialUpload(request('synthetic original'), {}, 's1', url);
  const duplicate = replies.pop();
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.studentId, 's1');
  assert.equal(duplicate.body.hostId, 'host-1');
  assert.equal(duplicate.body.dataGeneration, 'generation-1');
  assert.equal(duplicate.body.receiptStatus, 'received_verified');
  assert.equal(duplicate.body.files[0].uploadId, 'request-1');
  assert.equal(duplicate.body.files[0].clientRequestId, 'request-1');
  assert.equal(duplicate.body.files[0].receiptId, 'request-1');
  assert.equal(duplicate.body.files[0].size, Buffer.byteLength('synthetic original'));
  assert.equal(duplicate.body.files[0].sha1, f.studentRecord.sha1);
  assert.equal(duplicate.body.files[0].sha256, f.studentRecord.contentSha256);
  assert.equal(duplicate.body.files[0].assetId, 'asset-1');
  assert.equal(Object.hasOwn(duplicate.body, 'path'), false);
  assert.equal(Object.hasOwn(duplicate.body.files[0], 'path'), false);
  assert.equal(JSON.stringify(duplicate.body).includes(f.file), false);
  await scope.handleMaterialUpload(request('synthetic changed!'), {}, 's1', url);
  const conflict = replies.pop();
  assert.equal(conflict.body.code, 'upload_id_content_conflict');
  assert.equal(JSON.stringify(conflict.body).includes(f.file), false);
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'synthetic original');
});

test('actual first student upload returns a verifiable path-free host receipt', async (t) => {
  const f = fixture(t); const replies = [];
  const target = path.join(path.dirname(f.file), 'new.txt');
  let recorded = [];
  const scope = { fs, path, crypto, MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
    expectedContentSha256, streamRequestToFile,
    publicStudentUploadReceiptFile, studentUploadAssetId, studentUploadFailure,
    requireStudentAccess: (request) => { request.authContext = { deviceId: 'd1', deviceName: 'Synthetic tablet' }; return true; },
    requireMatchingUploadGeneration: () => true,
    findStudent: () => ({ id: 's1', name: 'Synthetic', rawPath: path.dirname(f.file) }),
    courseUploadAttribution: () => ({}), remoteCaptureAttribution: () => null,
    readUploadRecords: () => [], assertUploadFileAllowed: () => {}, uniqueTargetFile: () => target,
    addUploadRecords: (records) => { recorded = records; },
    assetStore: () => ({ findByFingerprint: () => recorded.length ? ({
      assetId: 'asset-new', sha1: recorded[0].sha1, ownerStudentId: 's1', linkedStudents: ['s1'],
      references: [{ id: recorded[0].id, studentId: 's1', contentSha256: recorded[0].contentSha256 }],
    }) : null }),
    resetUploadCounterIfNeeded: () => {}, todayUploadCount: 2, countFiles: () => 2,
    getHostIdentity: () => ({ hostId: 'host-1' }), hostDataGenerationId: () => 'generation-1',
    notify: () => {}, getHostServiceStatus: () => '{}',
    console: { error: () => {} }, sendJson: (_response, status, body) => replies.push({ status, body }) };
  bind(scope, 'handleMaterialUpload');
  const content = 'new synthetic content';
  const request = Object.assign(Readable.from([Buffer.from(content)]),
    { headers: { 'content-type': 'application/octet-stream', 'content-length': String(Buffer.byteLength(content)) } });
  await scope.handleMaterialUpload(request, {}, 's1',
    new URL('http://localhost/api/students/s1/materials?filename=new.txt&uploadId=request-new'));
  const accepted = replies.pop();
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.hostId, 'host-1');
  assert.equal(accepted.body.studentId, 's1');
  assert.equal(accepted.body.dataGeneration, 'generation-1');
  assert.equal(accepted.body.receiptStatus, 'received_verified');
  assert.equal(accepted.body.files.length, 1);
  assert.deepEqual({
    uploadId: accepted.body.files[0].uploadId,
    clientRequestId: accepted.body.files[0].clientRequestId,
    receiptId: accepted.body.files[0].receiptId,
    assetId: accepted.body.files[0].assetId,
  }, { uploadId: 'request-new', clientRequestId: 'request-new', receiptId: 'request-new', assetId: 'asset-new' });
  assert.equal(accepted.body.files[0].size, Buffer.byteLength(content));
  assert.match(accepted.body.files[0].sha1, /^[a-f0-9]{40}$/);
  assert.match(accepted.body.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(accepted.body, 'path'), false);
  assert.equal(Object.hasOwn(accepted.body.files[0], 'path'), false);
  assert.equal(JSON.stringify(accepted.body).includes(path.dirname(f.file)), false);
  assert.equal(fs.readFileSync(target, 'utf8'), content);
});

test('actual student upload maps filesystem failures to a stable path-free response', async (t) => {
  const f = fixture(t); const replies = [];
  const leakedPath = path.join(path.dirname(f.file), 'private', 'new.txt');
  const scope = { fs, path, crypto, MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
    expectedContentSha256, studentUploadFailure,
    requireStudentAccess: (request) => { request.authContext = { deviceId: 'd1' }; return true; },
    requireMatchingUploadGeneration: () => true,
    findStudent: () => ({ id: 's1', name: 'Synthetic', rawPath: path.dirname(f.file) }),
    courseUploadAttribution: () => ({}), remoteCaptureAttribution: () => null,
    readUploadRecords: () => [], assertUploadFileAllowed: () => {}, uniqueTargetFile: () => leakedPath,
    streamRequestToFile: async () => { throw Object.assign(new Error(`access denied: ${leakedPath}`), { code: 'EACCES', path: leakedPath }); },
    console: { error: () => {} }, sendJson: (_response, status, body) => replies.push({ status, body }) };
  bind(scope, 'handleMaterialUpload');
  const request = Object.assign(Readable.from([Buffer.from('private content')]),
    { headers: { 'content-type': 'application/octet-stream', 'content-length': '15' } });
  await scope.handleMaterialUpload(request, {}, 's1',
    new URL('http://localhost/api/students/s1/materials?filename=new.txt&uploadId=request-error'));
  const failure = replies.pop();
  assert.equal(failure.status, 503);
  assert.equal(failure.body.code, 'student_upload_storage_unavailable');
  assert.equal(JSON.stringify(failure.body).includes(leakedPath), false);
  assert.equal(Object.hasOwn(failure.body, 'path'), false);
});

test('actual project upload retry refuses changed bytes before creating another asset', async (t) => {
  const f = fixture(t); const replies = [];
  const scope = { fs, path, crypto, MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
    expectedContentSha256, hashRequestBody, verifiedSource,
    assertDeclaredUploadFingerprint: (actual, declared) => { if (declared && actual.sha256 !== declared) throw new Error('SHA-256 mismatch'); },
    requireAuth: (request) => { request.authContext = { type: 'device', deviceId: 'd1' }; return true; },
    requireMatchingUploadGeneration: () => true,
    readProjects: () => [{ id: 'p1', name: 'Synthetic', rawPath: path.dirname(f.file), studentIds: ['s1'] }],
    getProjectMetadata: (id) => id === 'p1'
      ? { id: 'p1', name: 'Synthetic', rawPath: path.dirname(f.file), studentIds: ['s1'] } : null,
    normalizeProject: (value) => value, normalizeProjectMetadata: (value) => value, projectAllowed: () => true,
    findStudent: () => ({ id: 's1' }), isStudentAllowed: () => true,
    courseUploadAttribution: () => ({}), remoteCaptureAttribution: () => null,
    ensureProjectWorkspace: (value) => value, isWorkspaceMaterialProject: () => false,
    activeProjectUploadIds: new Set(), assertUploadFileAllowed: () => {},
    assetStore: () => ({ queryDetails: () => [f.asset] }),
    sendJson: (_response, status, body) => replies.push({ status, body }) };
  for (const name of ['sha256FileDirect', 'handleProjectMaterialUpload']) bind(scope, name);
  const changed = 'synthetic changed!';
  const request = Object.assign(Readable.from([Buffer.from(changed)]),
    { headers: { 'content-type': 'application/octet-stream', 'content-length': String(Buffer.byteLength(changed)) } });
  await scope.handleProjectMaterialUpload(request, {}, 'p1', new URL('http://localhost/api/projects/p1/materials?filename=original.txt&studentId=s1&uploadId=request-1'));
  const rejected = replies.pop();
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'upload_id_content_conflict');
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'synthetic original');
});

test('actual first student upload rejects a false SHA-256 without publishing a file or receipt', async (t) => {
  const f = fixture(t); const replies = [];
  const target = path.join(path.dirname(f.file), 'new.txt');
  const scope = { fs, path, crypto, MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
    expectedContentSha256, streamRequestToFile, studentUploadFailure,
    requireStudentAccess: (request) => { request.authContext = { deviceId: 'd1' }; return true; },
    requireMatchingUploadGeneration: () => true,
    findStudent: () => ({ id: 's1', name: 'Synthetic', rawPath: path.dirname(f.file) }),
    courseUploadAttribution: () => ({}), remoteCaptureAttribution: () => null,
    readUploadRecords: () => [], assertUploadFileAllowed: () => {}, uniqueTargetFile: () => target,
    addUploadRecords: () => { throw new Error('receipt must not be written'); }, console: { error: () => {} },
    sendJson: (_response, status, body) => replies.push({ status, body }) };
  bind(scope, 'handleMaterialUpload');
  const content = 'new synthetic content';
  const request = Object.assign(Readable.from([Buffer.from(content)]),
    { headers: { 'content-type': 'application/octet-stream', 'content-length': String(Buffer.byteLength(content)),
      'x-edu-content-sha256': '0'.repeat(64) } });
  await scope.handleMaterialUpload(request, {}, 's1', new URL('http://localhost/api/students/s1/materials?filename=new.txt&uploadId=request-new'));
  assert.equal(replies.pop().status, 400);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)).sort(), ['original.txt']);
});
