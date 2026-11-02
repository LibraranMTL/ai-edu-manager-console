'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createService, MAX_DOCUMENT_BYTES } = require('./service.cjs');
const { startBackupScheduler } = require('./backup-scheduler.cjs');
const { receiveDocument } = require('./document-stream.cjs');
const { diskStatus } = require('./maintenance.cjs');
const { createRemoteMcpHandler } = require('./remote-mcp.cjs');
const { startMaterialIndexer } = require('./material-indexer.cjs');

// A C5 result can contain up to 2 MiB of bounded, base64-encoded attachments
// plus the Markdown body and envelope. Four MiB keeps the public request
// bounded while allowing the documented attachment contract to fit.
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const WEB_ROOT = path.join(__dirname, 'web-dist');

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        const error = new Error('请求过大');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { const bytes = Buffer.concat(chunks); req.verifyBody?.(bytes); resolve(JSON.parse(bytes.toString('utf8'))); }
      catch (cause) { const error = cause.status ? cause : Object.assign(new Error('JSON 格式无效'), { status: 400 }); reject(error); }
    });
    req.on('error', reject);
  });
}

function readBytes(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('请求过大'); error.status = 413;
        reject(error); req.destroy(); return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readFormOrJson(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json') return readJson(req);
  if (type !== 'application/x-www-form-urlencoded') {
    const error = new Error('OAuth请求类型无效'); error.status = 415; throw error;
  }
  const bytes = await readBytes(req, 64 * 1024);
  return Object.fromEntries(new URLSearchParams(bytes.toString('utf8')));
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function bearer(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{24,256})$/);
  return match ? match[1] : '';
}

function createHttpServer(options) {
  const gateway = options.modelGateway;
  if (gateway && (typeof gateway.issue !== 'function' || typeof gateway.generate !== 'function' || typeof gateway.close !== 'function')) {
    throw new Error('Model gateway requires an explicitly configured authenticated adapter');
  }
  const service = createService(options);
  const handleRemoteMcp = createRemoteMcpHandler(service);
  let backupScheduler, materialIndexer;
  try {
    if (options.backupRoot) backupScheduler = startBackupScheduler({
      dataDir: options.dataDir, backupRoot: options.backupRoot,
      intervalMs: options.backupIntervalMs,
      auditRoot: options.auditRoot, auditKey: options.auditKey,
      prune: options.pruneBackups === true, keep: options.backupKeep, days: options.backupDays,
    });
    materialIndexer = options.materialIndexer === false ? null : startMaterialIndexer({ service,
      pollMs: options.materialIndexPollMs, timeoutMs: options.materialIndexTimeoutMs,
      ocrCommand: options.materialOcrCommand, ocrArgs: options.materialOcrArgs });
  } catch (error) { service.close(); throw error; }
  const pairingRates = new Map();
  const adminLoginRates = new Map();
  const gatewayIssueRates = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      const token = bearer(req);
      if (req.method === 'GET' && ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'].includes(route)) {
        return json(res, 200, service.oauthAuthorizationServerMetadata());
      }
      if (req.method === 'GET' && (route === '/.well-known/oauth-protected-resource' || route === '/.well-known/oauth-protected-resource/edu-cloud/mcp')) {
        return json(res, 200, service.oauthProtectedResourceMetadata());
      }
      if (req.method === 'POST' && route === '/oauth/token') {
        return json(res, 200, service.exchangeOAuthCode(await readFormOrJson(req)));
      }
      if (req.method === 'POST' && route === '/oauth/revoke') {
        return json(res, 200, service.revokeOAuthToken(await readFormOrJson(req)));
      }
      if (req.method === 'POST' && route.startsWith('/model-gateway/')) {
        if (!gateway) return json(res, 404, { error: '模型网关尚未配置' });
        if (route === '/model-gateway/session') {
          const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
          for (const [key, entry] of gatewayIssueRates) if (entry.until <= now) gatewayIssueRates.delete(key);
          if (!gatewayIssueRates.has(ip) && gatewayIssueRates.size >= 2048) return json(res, 429, { error: '会话请求繁忙' });
          const current = gatewayIssueRates.get(ip) || { until: now + 60000, count: 0 };
          gatewayIssueRates.set(ip, current);
          if (++current.count > 30) return json(res, 429, { error: '会话签发过于频繁' });
          return json(res, 201, await gateway.issue(await readJson(req)));
        }
        if (route === '/model-gateway/generate') {
          const body = await readJson(req);
          if (!token || token !== body.token) return json(res, 401, { error: '网关凭据不一致' });
          return json(res, 200, await gateway.generate(body));
        }
        return json(res, 404, { error: '模型网关接口不存在' });
      }
      service.verifyViewerProof(token, req.method, req.url, req.headers);
      req.verifyBody = bytes => service.verifyBody(token, bytes, req.headers);
      if (['GET', 'DELETE'].includes(req.method)) req.verifyBody(Buffer.alloc(0));
      if (req.method === 'GET' && route === '/health') return json(res, 200, { ok: true, service: 'edu-cloud-documents', version: '2.2.0-candidate.2', contracts: [1, 2], schema: service.schemaStatus(),
        materialIndex: materialIndexer?.status() || { enabled: false }, capabilities: ['profile-sync', 'material-sync', 'remote-agent-mcp', 'cloud-inbox', 'student-archive',
          'viewer-student-relinquish', 'current-revision-index', 'async-pdf-docx-extraction', 'oauth-pkce'] });
      if (req.method === 'POST' && route === '/oauth/clients') {
        return json(res, 201, service.registerOAuthClient(token, await readJson(req)));
      }
      if (req.method === 'POST' && route === '/oauth/authorize') {
        return json(res, 201, service.authorizeOAuth(token, await readJson(req)));
      }
      if (req.method === 'POST' && route === '/v1/admin/sessions') {
        const ip = req.socket.remoteAddress || 'unknown';
        const previous = adminLoginRates.get(ip);
        const current = previous && previous.until > Date.now() ? previous : { until: Date.now() + 60000, count: 0 };
        if (++current.count > 5) { adminLoginRates.set(ip, current); return json(res, 429, { error: '登录过于频繁，请稍后重试' }); }
        if (adminLoginRates.size > 2048) {
          for (const [key, entry] of adminLoginRates) if (entry.until <= Date.now()) adminLoginRates.delete(key);
        }
        adminLoginRates.set(ip, current);
        const body = await readJson(req);
        return json(res, 201, service.loginAdmin(body.credential));
      }
      if (req.method === 'DELETE' && route === '/v1/admin/sessions/current') {
        return json(res, 200, service.logoutAdmin(token));
      }
      if (req.method === 'POST' && route === '/v1/admin/credential') {
        const body = await readJson(req);
        return json(res, 200, service.rotateAdmin(token, body.oldCredential, body.newCredential));
      }
      if (req.method === 'POST' && route === '/v1/devices/credential') {
        const body = await readJson(req);
        return json(res, 200, service.rotateDevice(token, body.nextToken));
      }
      if (req.method === 'POST' && route === '/v1/devices/revoke') {
        const body = await readJson(req);
        return json(res, 200, service.revokeDevice(token, body.deviceId));
      }
      if (req.method === 'GET' && route === '/v1/audit-events') {
        return json(res, 200, service.listAudit(token, url.searchParams.get('cursor') || '', url.searchParams.get('studentId') || ''));
      }
      if (req.method === 'GET' && route === '/v1/operations') {
        service.listAudit(token); // Same administrator gate; no student or document data is returned.
        return json(res, 200, { storage: await diskStatus(options.dataDir), backup: backupScheduler?.status() || { enabled: false },
          retention: { automaticDeletion: options.pruneBackups === true, keep: options.backupKeep || 7, days: options.backupDays || 30 } });
      }
      if (req.method === 'GET' && route === '/v2/admin/task-status') {
        return json(res, 200, service.listRemoteOperations(token, url.searchParams.get('studentId') || ''));
      }
      if (req.method === 'POST' && route === '/v1/students') {
        const body = await readJson(req);
        return json(res, 201, service.createStudent(token, body.displayName));
      }
      if (req.method === 'POST' && route === '/v1/devices/source') {
        const body = req.headers['content-length'] === '0' ? {} : await readJson(req);
        return json(res, 201, service.registerSource(token, body.publicKey));
      }
      if (req.method === 'POST' && route === '/v1/grants/write') {
        const body = await readJson(req);
        return json(res, 200, service.allowWrite(token, body.deviceId, body.cloudStudentId));
      }
      if (req.method === 'POST' && route === '/v1/source-enrollments') {
        const body = await readJson(req);
        return json(res, 201, service.createSourceEnrollment(token, body.cloudStudentId));
      }
      if (req.method === 'POST' && route === '/v1/source-enrollments/redeem') {
        const ip = req.socket.remoteAddress || 'unknown';
        const key = `enroll:${ip}`;
        const entry = pairingRates.get(key);
        const recent = entry && entry.until > Date.now() ? entry : { until: Date.now() + 60000, count: 0 };
        if (++recent.count > 8) { pairingRates.set(key, recent); return json(res, 429, { error: '请稍后重试' }); }
        pairingRates.set(key, recent);
        const body = await readJson(req);
        return json(res, 200, service.redeemSourceEnrollment(body.enrollmentCode, token, body.publicKey, body));
      }
      if (req.method === 'POST' && route === '/v2/source-auto-enroll') {
        const ip = req.socket.remoteAddress || 'unknown';
        const key = `auto-enroll:${ip}`;
        const entry = pairingRates.get(key);
        const recent = entry && entry.until > Date.now() ? entry : { until: Date.now() + 60000, count: 0 };
        if (++recent.count > 8) { pairingRates.set(key, recent); return json(res, 429, { error: '请稍后重试' }); }
        pairingRates.set(key, recent);
        return json(res, 200, service.autoEnrollSource(await readJson(req), token));
      }
      if (req.method === 'POST' && route === '/v1/pairings') {
        const ip = req.socket.remoteAddress || 'unknown';
        const entry = pairingRates.get(ip);
        const recent = entry && entry.until > Date.now() ? entry : { until: Date.now() + 60000, count: 0 };
        if (++recent.count > 5) { pairingRates.set(ip, recent); return json(res, 429, { error: '请稍后重试' }); }
        pairingRates.set(ip, recent);
        const body = await readJson(req);
        return json(res, 201, service.createPairing(token, body.publicKey));
      }
      if (req.method === 'POST' && route === '/v1/pairings/approve') {
        const ip = req.socket.remoteAddress || 'unknown';
        const key = `approve:${ip}`;
        const entry = pairingRates.get(key);
        const recent = entry && entry.until > Date.now() ? entry : { until: Date.now() + 60000, count: 0 };
        if (++recent.count > 10) { pairingRates.set(key, recent); return json(res, 429, { error: '配对确认过于频繁，请稍后重试' }); }
        pairingRates.set(key, recent);
        const body = await readJson(req);
        return json(res, 200, service.approvePairing(token, body.pairingCode, body.cloudStudentIds, body));
      }
      if (req.method === 'POST' && route === '/v1/grants/revoke') {
        const body = await readJson(req);
        return json(res, 200, service.revoke(token, body.deviceId, body.cloudStudentId, body.scope));
      }
      const grantsMatch = route.match(/^\/v1\/students\/([a-zA-Z0-9_-]{8,96})\/grants$/);
      if (req.method === 'GET' && grantsMatch) {
        return json(res, 200, { grants: service.listGrants(token, grantsMatch[1]) });
      }
      if (req.method === 'POST' && route === '/v1/grants/write-state') {
        const body = await readJson(req);
        return json(res, 200, service.setOwnWrite(token, body.cloudStudentId, body.enabled));
      }
      if (req.method === 'POST' && route === '/v2/source-upload-scope') {
        return json(res, 200, service.setOwnUploadScope(token, await readJson(req)));
      }
      if (req.method === 'POST' && route === '/v2/source-health-scope') {
        return json(res, 200, service.setOwnHealthScope(token, await readJson(req)));
      }
      if (req.method === 'GET' && route === '/v1/students') {
        return json(res, 200, { students: service.listStudents(token, { includeArchived: url.searchParams.get('includeArchived') === '1' }) });
      }
      const studentRemovalPreviewMatch = route.match(/^\/v1\/students\/([a-zA-Z0-9_-]{8,96})\/removal-preview$/);
      if (req.method === 'GET' && studentRemovalPreviewMatch) {
        return json(res, 200, service.studentRemovalPreview(token, studentRemovalPreviewMatch[1]));
      }
      const studentRestoreMatch = route.match(/^\/v1\/students\/([a-zA-Z0-9_-]{8,96})\/restore$/);
      if (req.method === 'POST' && studentRestoreMatch) {
        return json(res, 200, service.restoreStudent(token, studentRestoreMatch[1]));
      }
      const studentArchiveMatch = route.match(/^\/v1\/students\/([a-zA-Z0-9_-]{8,96})$/);
      if (req.method === 'DELETE' && studentArchiveMatch) {
        return json(res, 200, service.archiveStudent(token, studentArchiveMatch[1], url.searchParams.get('reason') || '管理员在云端文档页面停用'));
      }
      const viewerStudentMatch = route.match(/^\/v1\/viewer\/students\/([a-zA-Z0-9_-]{8,96})$/);
      if (req.method === 'DELETE' && viewerStudentMatch) {
        return json(res, 200, service.relinquishViewerStudent(token, viewerStudentMatch[1]));
      }
      if (req.method === 'POST' && route === '/v2/grants') {
        return json(res, 201, service.issueV2Grant(token, await readJson(req)));
      }
      if (req.method === 'POST' && route === '/v2/grants/revoke') {
        return json(res, 200, service.revokeV2Grant(token, await readJson(req)));
      }
      const v2GrantListMatch = route.match(/^\/v2\/students\/([a-zA-Z0-9_-]{8,96})\/grants$/);
      if (req.method === 'GET' && v2GrantListMatch) {
        return json(res, 200, { grants: service.listV2Grants(token, v2GrantListMatch[1]) });
      }
      const profileMatch = route.match(/^\/v2\/students\/([a-zA-Z0-9_-]{8,96})\/profile$/);
      const profileStatusMatch = route.match(/^\/v2\/students\/([a-zA-Z0-9_-]{8,96})\/profile-status$/);
      if (profileStatusMatch && req.method === 'GET') {
        return json(res, 200, service.getStudentProfileStatus(token, profileStatusMatch[1]));
      }
      if (profileMatch && req.method === 'POST') {
        return json(res, 201, service.uploadStudentProfile(token, profileMatch[1], await readJson(req)));
      }
      if (profileMatch && req.method === 'GET') {
        return json(res, 200, service.getStudentProfile(token, profileMatch[1]));
      }
      const bindingMatch = route.match(/^\/v2\/students\/([a-zA-Z0-9_-]{8,96})\/binding-receipts$/);
      if (bindingMatch && req.method === 'POST') {
        return json(res, 201, service.recordBinding(token, bindingMatch[1], await readJson(req)));
      }
      if (req.method === 'POST' && route === '/v2/transfer-receipts') {
        return json(res, 201, service.recordTransferReceipt(token, await readJson(req)));
      }
      const changeMatch = route.match(/^\/v2\/students\/([a-zA-Z0-9_-]{8,96})\/changes$/);
      if (changeMatch && req.method === 'GET') {
        return json(res, 200, service.listSyncEvents(token, changeMatch[1], url.searchParams.get('cursor') || ''));
      }
      const materialListMatch = route.match(/^\/v2\/students\/([a-zA-Z0-9_-]{8,96})\/materials$/);
      if (materialListMatch && req.method === 'GET') {
        return json(res, 200, service.listV2Materials(token, materialListMatch[1], {
          category: url.searchParams.get('category') || '', history: url.searchParams.get('history') === '1',
          cursor: url.searchParams.get('cursor') || '',
        }));
      }
      if (materialListMatch && req.method === 'POST') {
        const prepared = service.prepareV2Material(token, materialListMatch[1], {
          category: String(req.headers['x-material-category'] || ''), materialId: String(req.headers['x-material-id'] || ''),
          idempotencyKey: String(req.headers['x-idempotency-key'] || ''),
          projectId: String(req.headers['x-project-id'] || ''), scopeFingerprint: String(req.headers['x-scope-fingerprint'] || ''),
          displayName: decodeURIComponent(String(req.headers['x-document-name'] || '')),
          contentType: String(req.headers['content-type'] || '').split(';')[0],
        });
        return json(res, 201, await receiveDocument(req, prepared, MAX_DOCUMENT_BYTES,
          hash => service.verifyBodyHash(token, hash, req.headers)));
      }
      const materialContentMatch = route.match(/^\/v2\/material-revisions\/(material_rev_[a-f0-9]{48})\/content$/);
      const materialIndexMatch = route.match(/^\/v2\/material-revisions\/(material_rev_[a-f0-9]{48})\/index-status$/);
      if (materialIndexMatch && req.method === 'GET') {
        return json(res, 200, service.getV2MaterialIndexStatus(token, materialIndexMatch[1]));
      }
      if (materialContentMatch && req.method === 'GET') {
        const item = service.getV2Material(token, materialContentMatch[1]);
        res.writeHead(200, {
          'content-type': item.contentType === 'text/markdown' ? 'text/markdown; charset=utf-8' : item.contentType,
          'content-length': item.content.length, 'x-content-sha256': item.contentSha256,
          'x-cloud-student-id': item.cloudStudentId, 'x-material-category': item.category,
          'x-material-id': item.materialId, 'x-revision-id': item.revisionId,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        });
        return res.end(item.content);
      }
      const healthListMatch = route.match(/^\/v2\/students\/([a-zA-Z0-9_-]{8,96})\/health-records$/);
      if (healthListMatch && req.method === 'GET') {
        return json(res, 200, service.listHealthRecords(token, healthListMatch[1], url.searchParams.get('cursor') || ''));
      }
      if (healthListMatch && req.method === 'POST') {
        const prepared = service.prepareHealthRecord(token, healthListMatch[1], {
          healthRecordId: String(req.headers['x-health-record-id'] || ''),
          idempotencyKey: String(req.headers['x-idempotency-key'] || ''),
          displayName: decodeURIComponent(String(req.headers['x-document-name'] || '')),
          contentType: String(req.headers['content-type'] || '').split(';')[0],
        });
        return json(res, 201, await receiveDocument(req, prepared, MAX_DOCUMENT_BYTES,
          hash => service.verifyBodyHash(token, hash, req.headers)));
      }
      const healthContentMatch = route.match(/^\/v2\/health-record-revisions\/(health_rev_[a-f0-9]{48})\/content$/);
      if (healthContentMatch && req.method === 'GET') {
        const item = service.getHealthRecord(token, healthContentMatch[1]);
        res.writeHead(200, {
          'content-type': item.contentType === 'text/markdown' ? 'text/markdown; charset=utf-8' : item.contentType,
          'content-length': item.content.length, 'x-content-sha256': item.contentSha256,
          'x-cloud-student-id': item.cloudStudentId, 'x-health-record-id': item.healthRecordId,
          'x-revision-id': item.revisionId, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        });
        return res.end(item.content);
      }
      if (req.method === 'POST' && route === '/v2/agent-sessions') {
        return json(res, 201, service.issueRemoteAgentSession(token, await readJson(req)));
      }
      if (req.method === 'POST' && route === '/v2/agent-sessions/revoke') {
        const body = await readJson(req);
        return json(res, 200, service.revokeRemoteAgentSession(token, body.sessionId));
      }
      const agentSessionStatusMatch = route.match(/^\/v2\/agent-sessions\/(agent_session_[a-f0-9]{32})$/);
      if (agentSessionStatusMatch && req.method === 'GET') {
        return json(res, 200, service.remoteAgentStatusForHost(token, agentSessionStatusMatch[1]));
      }
      if (req.method === 'POST' && route === '/v2/agent/task/acknowledge') {
        return json(res, 200, service.remoteAgentAcknowledge(token));
      }
      if (req.method === 'POST' && (route === '/v2/mcp' || route === '/mcp')) {
        const response = handleRemoteMcp(token, await readJson(req));
        if (response === null) { res.writeHead(204, { 'cache-control': 'no-store' }); return res.end(); }
        return json(res, 200, response);
      }
      if (req.method === 'GET' && route === '/v2/agent/materials') {
        return json(res, 200, service.listRemoteAgentMaterials(token, {
          category: url.searchParams.get('category') || '', cursor: url.searchParams.get('cursor') || '',
        }));
      }
      const agentMaterialContentMatch = route.match(/^\/v2\/agent\/material-revisions\/(material_rev_[a-f0-9]{48})\/content$/);
      if (agentMaterialContentMatch && req.method === 'GET') {
        const item = service.getRemoteAgentMaterial(token, agentMaterialContentMatch[1]);
        res.writeHead(200, {
          'content-type': item.contentType === 'text/markdown' ? 'text/markdown; charset=utf-8' : item.contentType,
          'content-length': item.content.length, 'x-content-sha256': item.contentSha256,
          'x-cloud-student-id': item.cloudStudentId, 'x-material-category': item.category,
          'x-material-id': item.materialId, 'x-revision-id': item.revisionId,
          'x-project-id': item.projectId, 'x-scope-fingerprint': item.scopeFingerprint,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        });
        return res.end(item.content);
      }
      if (req.method === 'POST' && route === '/v2/inbox/submissions') {
        return json(res, 201, service.submitInboxResult(token, await readJson(req)));
      }
      if (req.method === 'GET' && route === '/v2/inbox') {
        return json(res, 200, service.listInbox(token, url.searchParams.get('cursor') || ''));
      }
      const inboxLeaseMatch = route.match(/^\/v2\/inbox\/(submission_[a-f0-9]{32})\/lease$/);
      if (inboxLeaseMatch && req.method === 'POST') {
        return json(res, 200, service.leaseInboxSubmission(token, inboxLeaseMatch[1]));
      }
      const inboxAttachmentMatch = route.match(/^\/v2\/inbox\/(submission_[a-f0-9]{32})\/attachments\/(attachment_[a-f0-9]{32})$/);
      if (inboxAttachmentMatch && req.method === 'GET') {
        const item = service.getInboxAttachment(token, inboxAttachmentMatch[1], inboxAttachmentMatch[2],
          String(req.headers['x-inbox-lease-id'] || ''));
        res.writeHead(200, { 'content-type': item.contentType, 'content-length': item.content.length,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.displayName)}`,
          'x-content-sha256': item.contentSha256, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(item.content);
      }
      const inboxSettleMatch = route.match(/^\/v2\/inbox\/(submission_[a-f0-9]{32})\/settle$/);
      if (inboxSettleMatch && req.method === 'POST') {
        return json(res, 200, service.settleInboxSubmission(token, inboxSettleMatch[1], await readJson(req)));
      }
      const storageMatch = route.match(/^\/v1\/students\/([a-zA-Z0-9_-]{8,96})\/storage$/);
      if (req.method === 'GET' && storageMatch) {
        return json(res, 200, service.studentStorage(token, storageMatch[1]));
      }
      if (req.method === 'POST' && route === '/v1/reports') {
        const body = await readJson(req);
        return json(res, 201, service.uploadReport(token, body));
      }
      if (req.method === 'POST' && route === '/v1/reports/check') {
        const body = await readJson(req);
        return json(res, 200, service.checkSourceReports(token, body));
      }
      const listMatch = route.match(/^\/v1\/students\/([a-zA-Z0-9_-]{8,96})\/reports$/);
      if (req.method === 'GET' && listMatch) {
        return json(res, 200, service.listReports(token, listMatch[1], url.searchParams.get('cursor') || ''));
      }
      const contentMatch = route.match(/^\/v1\/reports\/(rev_[a-f0-9]{48})\/content$/);
      const withdrawMatch = route.match(/^\/v1\/reports\/(rev_[a-f0-9]{48})$/);
      if (req.method === 'DELETE' && withdrawMatch) return json(res, 200, service.deleteReport(token, withdrawMatch[1]));
      if (req.method === 'GET' && contentMatch) {
        const item = service.getReport(token, contentMatch[1]);
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-length': item.content.length,
          'content-disposition': `attachment; filename="report.md"`,
          'x-content-sha256': item.contentSha256,
          'x-cloud-student-id': item.cloudStudentId,
          'x-report-type': item.reportType,
          'x-origin-device-id': item.originDeviceId,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        return res.end(item.content);
      }
      const documentListMatch = route.match(/^\/v1\/students\/([a-zA-Z0-9_-]{8,96})\/documents$/);
      if (documentListMatch && req.method === 'GET') {
        const rows = service.listDocuments(token, documentListMatch[1], url.searchParams.get('trash') === '1', url.searchParams.get('cursor') || '');
        const documents = rows.slice(0, 100);
        const last = documents.at(-1);
        return json(res, 200, { documents, nextCursor: rows.length > 100 ? `${last.createdAt}:${last.documentId}` : '' });
      }
      if (documentListMatch && req.method === 'POST') {
        const name = decodeURIComponent(String(req.headers['x-document-name'] || ''));
        const prepared = service.prepareDocument(token, documentListMatch[1], name, String(req.headers['content-type'] || '').split(';')[0]);
        return json(res, 201, await receiveDocument(req, prepared, MAX_DOCUMENT_BYTES, hash => service.verifyBodyHash(token, hash, req.headers)));
      }
      const documentMatch = route.match(/^\/v1\/documents\/(doc_[a-f0-9]{32})$/);
      if (documentMatch && req.method === 'PATCH') {
        return json(res, 200, service.updateDocument(token, documentMatch[1], await readJson(req)));
      }
      const documentContentMatch = route.match(/^\/v1\/documents\/(doc_[a-f0-9]{32})\/content$/);
      if (documentContentMatch && req.method === 'GET') {
        const item = service.getDocument(token, documentContentMatch[1]);
        res.writeHead(200, {
          'content-type': item.contentType === 'text/markdown' ? 'text/markdown; charset=utf-8' : item.contentType,
          'content-length': item.content.length,
          'content-disposition': 'attachment; filename="document"',
          'x-content-sha256': item.contentSha256,
          'x-cloud-student-id': item.cloudStudentId,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        return res.end(item.content);
      }
      if (req.method === 'GET' && (route === '/' || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(route))) {
        const filename = route === '/' ? 'index.html' : route.slice(1);
        const target = path.resolve(WEB_ROOT, filename);
        if (!target.startsWith(WEB_ROOT + path.sep) && target !== path.join(WEB_ROOT, 'index.html')) {
          return json(res, 404, { error: '页面不存在' });
        }
        let content;
        try { content = fs.readFileSync(target); }
        catch { return json(res, 404, { error: '管理网页尚未构建' }); }
        const type = target.endsWith('.html') ? 'text/html; charset=utf-8'
          : target.endsWith('.css') ? 'text/css; charset=utf-8'
            : target.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
        res.writeHead(200, {
          'content-type': type,
          'content-length': content.length,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          'cache-control': target.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
        });
        return res.end(content);
      }
      return json(res, 404, { error: '接口不存在' });
    } catch (error) {
      try { service.recordDenied(bearer(req), error.status); } catch { /* Preserve the original failure. */ }
      if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : '服务内部错误' });
    }
  });
  return { server, service, materialIndexer, close: async () => {
    await new Promise(resolve => server.close(resolve));
    await backupScheduler?.stop();
    await materialIndexer?.stop();
    await gateway?.close();
    service.close();
  } };
}

if (require.main === module) {
  const dataDir = process.env.CLOUD_REPORT_DATA_DIR;
  const adminToken = process.env.CLOUD_REPORT_ADMIN_TOKEN;
  const maxStudentBytes = process.env.CLOUD_REPORT_MAX_STUDENT_BYTES === undefined
    ? undefined : Number(process.env.CLOUD_REPORT_MAX_STUDENT_BYTES);
  const backupRoot = process.env.CLOUD_REPORT_BACKUP_ROOT;
  const backupIntervalMs = process.env.CLOUD_REPORT_BACKUP_INTERVAL_HOURS === undefined
    ? undefined : Number(process.env.CLOUD_REPORT_BACKUP_INTERVAL_HOURS) * 60 * 60 * 1000;
  const host = process.env.CLOUD_REPORT_HOST || '127.0.0.1';
  const port = Number(process.env.CLOUD_REPORT_PORT || 8755);
  const publicOrigin = process.env.CLOUD_REPORT_PUBLIC_ORIGIN || 'https://www.greatbg.com/edu-cloud';
  const licenseTrustPath = process.env.CLOUD_REPORT_LICENSE_TRUST_PATH || path.join(__dirname, 'trusted-license-issuers.json');
  if (!dataDir || !adminToken) throw new Error('Set CLOUD_REPORT_DATA_DIR and CLOUD_REPORT_ADMIN_TOKEN');
  if (host !== '127.0.0.1' && host !== '::1' && process.env.CLOUD_REPORT_BEHIND_HTTPS_PROXY !== '1') {
    throw new Error('Non-local binding requires CLOUD_REPORT_BEHIND_HTTPS_PROXY=1 and a real TLS reverse proxy');
  }
  const gateway = require('./model-gateway-runtime.cjs').fromEnvironment(process.env, dataDir);
  const trustedLicenseIssuers = JSON.parse(fs.readFileSync(licenseTrustPath, 'utf8'));
  const materialOcrArgs = process.env.CLOUD_MATERIAL_OCR_ARGS_JSON ? JSON.parse(process.env.CLOUD_MATERIAL_OCR_ARGS_JSON) : [];
  const app = createHttpServer({ dataDir, adminToken, maxStudentBytes, backupRoot, backupIntervalMs, modelGateway: gateway, publicOrigin, trustedLicenseIssuers,
    materialOcrCommand: process.env.CLOUD_MATERIAL_OCR_COMMAND || '', materialOcrArgs,
    auditRoot: process.env.CLOUD_REPORT_AUDIT_ROOT, auditKey: process.env.CLOUD_REPORT_AUDIT_KEY,
    pruneBackups: process.env.CLOUD_REPORT_PRUNE_BACKUPS === '1',
    backupKeep: Number(process.env.CLOUD_REPORT_BACKUP_KEEP || 7), backupDays: Number(process.env.CLOUD_REPORT_BACKUP_DAYS || 30) });
  app.server.listen(port, host, () => process.stdout.write(`Cloud report service listening on ${host}:${port}\n`));
  let stopping = false;
  const shutdown = () => { if (!stopping) { stopping = true; void app.close().then(() => process.exit(0)); } };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

module.exports = { createHttpServer };
