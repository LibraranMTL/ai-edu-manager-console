'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { createService } = require('./service.cjs');
const { createHttpServer } = require('./http.cjs');
const { startMaterialIndexer } = require('./material-indexer.cjs');

const ADMIN = 'cloud-c4-test-admin-token-keep-private-123456';
const JSZip = createRequire(require.resolve('exceljs'))('jszip');

async function docx(text) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function pdf(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

function scannedPdf() {
  return pdf('').subarray(0);
}

function setup(root) {
  let clock = 1_800_000_000_000;
  const service = createService({ dataDir: root, adminToken: ADMIN, allowLegacyTestCredentials: true, now: () => ++clock,
    publicOrigin: 'https://www.greatbg.com/edu-cloud' });
  const student = service.createStudent(ADMIN, 'C4合成学生');
  const source = service.registerSource(ADMIN);
  const viewer = service.createPairing('', crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }).publicKey);
  service.allowWrite(ADMIN, source.deviceId, student.id);
  for (const category of ['learning_material']) {
    service.issueV2Grant(ADMIN, { deviceId: source.deviceId, cloudStudentId: student.id, scope: 'material.write', category });
    service.issueV2Grant(ADMIN, { deviceId: viewer.deviceId, cloudStudentId: student.id, scope: 'material.read', category });
  }
  return { service, student, source, viewer };
}

function upload(service, source, student, bytes, metadata) {
  const prepared = service.prepareV2Material(source.deviceToken, student.id, metadata);
  fs.writeFileSync(prepared.tempPath, bytes);
  return prepared.commit({ sha: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, head: bytes.subarray(0, 16) });
}

test('C4 indexes PDF/DOCX asynchronously and exposes only the explicit current revision', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-cloud-c4-index-'));
  const { service, student, source, viewer } = setup(root);
  const indexer = startMaterialIndexer({ service, pollMs: 60000, timeoutMs: 30000 });
  try {
    const oldBytes = await docx('old revision should disappear from current search');
    const old = upload(service, source, student, oldBytes, { category: 'learning_material', materialId: 'material:c4:docx',
      idempotencyKey: 'material:c4:docx:v1', displayName: '旧版.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', projectId: '', scopeFingerprint: '' });
    assert.equal((await indexer.drainUntilIdle()).summary.ready, 1);
    const nextBytes = await docx('newest revision searchable phrase');
    const current = upload(service, source, student, nextBytes, { category: 'learning_material', materialId: 'material:c4:docx',
      idempotencyKey: 'material:c4:docx:v2', displayName: '新版.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', projectId: '', scopeFingerprint: '' });
    const pdfBytes = pdf('Current PDF searchable phrase');
    const pdfRevision = upload(service, source, student, pdfBytes, { category: 'learning_material', materialId: 'material:c4:pdf',
      idempotencyKey: 'material:c4:pdf:v1', displayName: '检索资料.pdf', contentType: 'application/pdf', projectId: '', scopeFingerprint: '' });
    const drained = await indexer.drainUntilIdle();
    assert.equal(drained.summary.ready, 2);
    assert.equal(drained.summary.superseded, 1);
    assert.equal(service.listV2Materials(viewer.deviceToken, student.id).materials.length, 2);
    assert.equal(service.listV2Materials(viewer.deviceToken, student.id, { history: true }).materials.length, 3);
    assert.equal(service.getV2MaterialIndexStatus(viewer.deviceToken, current.revisionId).status, 'ready');
    assert.equal(service.getV2MaterialIndexStatus(viewer.deviceToken, pdfRevision.revisionId).status, 'ready');

    const session = service.issueRemoteAgentSession(viewer.deviceToken, { provider: 'codex', cloudStudentId: student.id,
      taskId: 'task:c4:index:001', executionId: 'execution:c4:index:001', taskType: 'knowledge_search.v1',
      idempotencyKey: 'execution:c4:index:001', materialCategories: ['learning_material'] });
    assert.throws(() => service.getRemoteAgentMaterial(session.sessionToken, old.revisionId), /不在授权范围/);
    assert.deepEqual(service.searchRemoteAgentMaterials(session.sessionToken, { query: 'newest' }).materials.map(item => item.revisionId), [current.revisionId]);
    assert.deepEqual(service.searchRemoteAgentMaterials(session.sessionToken, { query: 'PDF' }).materials.map(item => item.revisionId), [pdfRevision.revisionId]);
    assert.equal(service.db.prepare('SELECT COUNT(*) AS count FROM material_search_fts WHERE revision_id=?').get(old.revisionId).count, 0);
  } finally { await indexer.stop(); service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('C4 routes a PDF without embedded text through the configured isolated OCR adapter', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-cloud-c4-ocr-'));
  const { service, student, source, viewer } = setup(root);
  const ocrCommand = process.platform === 'win32' ? process.env.ComSpec : '/bin/sh';
  const ocrArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'echo OCR adapter searchable text']
    : ['-c', "printf 'OCR adapter searchable text'"];
  const completeMaterialIndexJob = service.completeMaterialIndexJob;
  let indexer, runningDuringCommit = false;
  service.completeMaterialIndexJob = (...args) => {
    runningDuringCommit = indexer.status().running;
    return completeMaterialIndexJob(...args);
  };
  indexer = startMaterialIndexer({ service, pollMs: 60000, timeoutMs: 30000,
    ocrCommand, ocrArgs });
  try {
    const revision = upload(service, source, student, scannedPdf(), { category: 'learning_material',
      materialId: 'material:c4:scan', idempotencyKey: 'material:c4:scan:v1', displayName: '扫描资料.pdf',
      contentType: 'application/pdf', projectId: '', scopeFingerprint: '' });
    const drained = await indexer.drainUntilIdle();
    assert.equal(drained.summary.ready, 1, JSON.stringify(drained));
    assert.equal(runningDuringCommit, true);
    assert.equal(service.getV2MaterialIndexStatus(viewer.deviceToken, revision.revisionId).extractionStatus, 'ocr_complete');
    const session = service.issueRemoteAgentSession(viewer.deviceToken, { provider: 'codex', cloudStudentId: student.id,
      taskId: 'task:ocr:001', executionId: 'execution:ocr:001', taskType: 'knowledge_search.v1',
      idempotencyKey: 'execution:ocr:001', materialCategories: ['learning_material'] });
    assert.deepEqual(service.searchRemoteAgentMaterials(session.sessionToken, { query: 'adapter' }).materials.map(item => item.revisionId), [revision.revisionId]);
  } finally { await indexer.stop(); service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('OAuth authorization code is one-time, bound to exact redirect, and requires S256 PKCE', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-cloud-oauth-pkce-'));
  const { service, student, viewer } = setup(root);
  try {
    const session = service.issueRemoteAgentSession(viewer.deviceToken, { provider: 'workbuddy', cloudStudentId: student.id,
      taskId: 'task:oauth:001', executionId: 'execution:oauth:001', taskType: 'cloud_read.v1',
      idempotencyKey: 'execution:oauth:001', materialCategories: ['learning_material'] });
    const client = service.registerOAuthClient(viewer.deviceToken, { clientName: '异地Agent候选宿主',
      redirectUris: ['http://127.0.0.1:43127/callback'] });
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authorization = service.authorizeOAuth(viewer.deviceToken, { clientId: client.clientId, sessionId: session.sessionId,
      redirectUri: client.redirectUris[0], codeChallenge: challenge, codeChallengeMethod: 'S256', state: 'opaque-state' });
    assert.match(authorization.redirectTo, /code=/);
    const wrongVerifier = `${verifier.slice(0, -1)}${verifier.endsWith('x') ? 'y' : 'x'}`;
    assert.throws(() => service.exchangeOAuthCode({ grantType: 'authorization_code', code: authorization.authorizationCode,
      clientId: client.clientId, redirectUri: client.redirectUris[0], codeVerifier: wrongVerifier }), /授权码无效/);
    const token = service.exchangeOAuthCode({ grantType: 'authorization_code', code: authorization.authorizationCode,
      clientId: client.clientId, redirectUri: client.redirectUris[0], codeVerifier: verifier });
    assert.equal(token.token_type, 'Bearer');
    assert.equal(service.remoteAgentAcknowledge(token.access_token).sessionId, session.sessionId);
    assert.throws(() => service.exchangeOAuthCode({ grantType: 'authorization_code', code: authorization.authorizationCode,
      clientId: client.clientId, redirectUri: client.redirectUris[0], codeVerifier: verifier }), /授权码无效|已使用/);
    assert.equal(service.oauthAuthorizationServerMetadata().code_challenge_methods_supported[0], 'S256');
    service.revokeOAuthToken({ token: token.access_token });
    assert.throws(() => service.remoteAgentAcknowledge(token.access_token), /无效或已过期/);
  } finally { service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('OAuth discovery, token exchange and MCP bearer access work through the public HTTP contract', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-cloud-oauth-http-'));
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const publicOrigin = 'https://cloud.example.test/edu-cloud';
  const app = createHttpServer({ dataDir: root, adminToken: ADMIN, allowLegacyTestCredentials: true,
    publicOrigin, materialIndexer: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const student = app.service.createStudent(ADMIN, 'OAuth协议测试学生');
    const viewer = app.service.createPairing('', keys.publicKey);
    app.service.issueV2Grant(ADMIN, { deviceId: viewer.deviceId, cloudStudentId: student.id,
      scope: 'material.read', category: 'learning_material' });
    const session = app.service.issueRemoteAgentSession(viewer.deviceToken, { provider: 'codex', cloudStudentId: student.id,
      taskId: 'task:oauth:http:001', executionId: 'execution:oauth:http:001', taskType: 'cloud_read.v1',
      idempotencyKey: 'execution:oauth:http:001', materialCategories: ['learning_material'] });
    const signedPost = async (route, body) => {
      const timestamp = String(Date.now()); const nonce = crypto.randomBytes(18).toString('base64url');
      const signature = crypto.sign('sha256', Buffer.from(`POST\n${route}\n${timestamp}\n${nonce}`), keys.privateKey).toString('base64url');
      return fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${viewer.deviceToken}`,
        'content-type': 'application/json', 'x-cloud-device-id': viewer.deviceId, 'x-cloud-timestamp': timestamp,
        'x-cloud-nonce': nonce, 'x-cloud-signature': signature }, body: JSON.stringify(body) });
    };
    const metadata = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(metadata.issuer, publicOrigin);
    assert.equal(metadata.token_endpoint, `${publicOrigin}/oauth/token`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
    const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource/edu-cloud/mcp`)).json();
    assert.equal(resource.resource, `${publicOrigin}/mcp`);

    const registeredResponse = await signedPost('/oauth/clients', { clientName: '候选异地宿主',
      redirectUris: ['http://127.0.0.1:43128/callback'] });
    assert.equal(registeredResponse.status, 201);
    const registered = await registeredResponse.json();
    const verifier = 'A'.repeat(64);
    const codeChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authorizedResponse = await signedPost('/oauth/authorize', { clientId: registered.clientId,
      sessionId: session.sessionId, redirectUri: registered.redirectUris[0], codeChallenge,
      codeChallengeMethod: 'S256', state: 'http-contract-state' });
    assert.equal(authorizedResponse.status, 201);
    const authorization = await authorizedResponse.json();
    const tokenResponse = await fetch(`${base}/oauth/token`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: authorization.authorizationCode,
        client_id: registered.clientId, redirect_uri: registered.redirectUris[0], code_verifier: verifier }) });
    assert.equal(tokenResponse.status, 200);
    const access = await tokenResponse.json();
    const mcpResponse = await fetch(`${base}/mcp`, { method: 'POST', headers: {
      authorization: `Bearer ${access.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    assert.equal(mcpResponse.status, 200);
    const mcp = await mcpResponse.json();
    assert.ok(mcp.result.tools.some(tool => tool.name === 'cloud_material_search'));
    const revoke = await fetch(`${base}/oauth/revoke`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: access.access_token }) });
    assert.equal(revoke.status, 200);
    const denied = await fetch(`${base}/mcp`, { method: 'POST', headers: {
      authorization: `Bearer ${access.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    const deniedBody = await denied.json();
    assert.equal(denied.status, 200);
    assert.equal(deniedBody.error.code, -32001);
  } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
