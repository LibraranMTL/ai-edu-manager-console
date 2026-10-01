'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createService, MAX_DOCUMENT_BYTES } = require('./service.cjs');
const { startBackupScheduler } = require('./backup-scheduler.cjs');
const { receiveDocument } = require('./document-stream.cjs');
const { diskStatus } = require('./maintenance.cjs');

const MAX_JSON_BYTES = 3 * 1024 * 1024;
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
  const service = createService(options);
  let backupScheduler;
  try {
    if (options.backupRoot) backupScheduler = startBackupScheduler({
      dataDir: options.dataDir, backupRoot: options.backupRoot,
      intervalMs: options.backupIntervalMs,
      auditRoot: options.auditRoot, auditKey: options.auditKey,
      prune: options.pruneBackups === true, keep: options.backupKeep, days: options.backupDays,
    });
  } catch (error) { service.close(); throw error; }
  const pairingRates = new Map();
  const adminLoginRates = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      const token = bearer(req);
      service.verifyViewerProof(token, req.method, req.url, req.headers);
      req.verifyBody = bytes => service.verifyBody(token, bytes, req.headers);
      if (['GET', 'DELETE'].includes(req.method)) req.verifyBody(Buffer.alloc(0));
      if (req.method === 'GET' && route === '/health') return json(res, 200, { ok: true, service: 'edu-cloud-documents', version: '1.0.0' });
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
        return json(res, 200, service.redeemSourceEnrollment(body.enrollmentCode, token, body.publicKey));
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
        return json(res, 200, service.approvePairing(token, body.pairingCode, body.cloudStudentIds));
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
      if (req.method === 'GET' && route === '/v1/students') {
        return json(res, 200, { students: service.listStudents(token) });
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
  return { server, service, close: async () => {
    await new Promise(resolve => server.close(resolve));
    await backupScheduler?.stop();
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
  if (!dataDir || !adminToken) throw new Error('Set CLOUD_REPORT_DATA_DIR and CLOUD_REPORT_ADMIN_TOKEN');
  if (host !== '127.0.0.1' && host !== '::1' && process.env.CLOUD_REPORT_BEHIND_HTTPS_PROXY !== '1') {
    throw new Error('Non-local binding requires CLOUD_REPORT_BEHIND_HTTPS_PROXY=1 and a real TLS reverse proxy');
  }
  const app = createHttpServer({ dataDir, adminToken, maxStudentBytes, backupRoot, backupIntervalMs,
    auditRoot: process.env.CLOUD_REPORT_AUDIT_ROOT, auditKey: process.env.CLOUD_REPORT_AUDIT_KEY,
    pruneBackups: process.env.CLOUD_REPORT_PRUNE_BACKUPS === '1',
    backupKeep: Number(process.env.CLOUD_REPORT_BACKUP_KEEP || 7), backupDays: Number(process.env.CLOUD_REPORT_BACKUP_DAYS || 30) });
  app.server.listen(port, host, () => process.stdout.write(`Cloud report service listening on ${host}:${port}\n`));
  let stopping = false;
  const shutdown = () => { if (!stopping) { stopping = true; void app.close().then(() => process.exit(0)); } };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

module.exports = { createHttpServer };
