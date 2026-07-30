const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const LAN_DIRECT_TRANSPORT_ID = 'lan_direct';
const DIRECT_PROTOCOL_VERSION = '1.1';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const MIN_CHUNK_BYTES = 256 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalRequest(input = {}) {
  return [
    String(input.method || 'GET').toUpperCase(),
    String(input.pathname || '/'),
    String(input.bindingId || ''),
    String(input.nodeId || ''),
    String(input.timestamp || ''),
    String(input.nonce || ''),
    String(input.contentSha256 || sha256('')),
  ].join('\n');
}

function signDirectRequest(input = {}) {
  const secret = String(input.secret || '');
  if (!secret) throw new Error('知识协作直传缺少共享密钥。');
  const timestamp = String(input.timestamp || Date.now());
  const nonce = String(input.nonce || crypto.randomBytes(12).toString('hex'));
  const contentSha256 = String(input.contentSha256 || sha256(''));
  const signature = crypto.createHmac('sha256', secret)
    .update(canonicalRequest({ ...input, timestamp, nonce, contentSha256 }))
    .digest('hex');
  return {
    'x-edu-binding-id': String(input.bindingId || ''),
    'x-edu-node-id': String(input.nodeId || ''),
    'x-edu-timestamp': timestamp,
    'x-edu-nonce': nonce,
    'x-edu-content-sha256': contentSha256,
    'x-edu-signature': signature,
  };
}

function verifyDirectRequest(input = {}) {
  const headers = input.headers || {};
  const timestamp = Number(headers['x-edu-timestamp']);
  if (!Number.isFinite(timestamp) || Math.abs(Number(input.now || Date.now()) - timestamp) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, code: 'TIMESTAMP_INVALID', message: '直传请求时间已失效。' };
  }
  const nonce = String(headers['x-edu-nonce'] || '');
  if (!nonce) return { ok: false, code: 'NONCE_MISSING', message: '直传请求缺少随机数。' };
  const expected = signDirectRequest({
    secret: input.secret,
    bindingId: headers['x-edu-binding-id'],
    nodeId: headers['x-edu-node-id'],
    method: input.method,
    pathname: input.pathname,
    timestamp: String(timestamp),
    nonce,
    contentSha256: headers['x-edu-content-sha256'],
  })['x-edu-signature'];
  const actual = String(headers['x-edu-signature'] || '');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    return { ok: false, code: 'SIGNATURE_INVALID', message: '直传请求签名无效。' };
  }
  return {
    ok: true,
    bindingId: String(headers['x-edu-binding-id'] || ''),
    nodeId: String(headers['x-edu-node-id'] || ''),
    nonce,
    contentSha256: String(headers['x-edu-content-sha256'] || ''),
  };
}

function normalizeDirectEndpoint(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function directTransferError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requestBuffer(urlValue, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, options, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          response.destroy(new Error('直传响应过大。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = {};
        try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(payload.message || `直传请求失败（${response.statusCode}）。`));
          return;
        }
        resolve(payload);
      });
    });
    request.on('error', reject);
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs || 30_000));
    request.setTimeout(timeoutMs, () => request.destroy(directTransferError('DIRECT_TIMEOUT', '直传请求超时。')));
    if (body && typeof body.pipe === 'function') body.pipe(request);
    else {
      if (body) request.write(body);
      request.end();
    }
  });
}

function signedHeaders(auth, method, pathname, contentSha256, extras = {}) {
  return {
    ...extras,
    ...signDirectRequest({
      secret: auth.secret,
      bindingId: auth.bindingId,
      nodeId: auth.nodeId,
      method,
      pathname,
      contentSha256,
    }),
  };
}

function isTailscaleEndpoint(value) {
  try {
    const hostname = new URL(String(value || '')).hostname.replace(/^\[|\]$/g, '');
    const parts = hostname.split('.').map(Number);
    return parts.length === 4 && parts.every(Number.isFinite) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  } catch {
    return false;
  }
}

function routeDirectEndpoints(values = []) {
  const normalized = [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeDirectEndpoint)
    .filter(Boolean))];
  return normalized
    .map((endpoint, index) => ({ endpoint, index, rank: isTailscaleEndpoint(endpoint) ? 1 : 0 }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((item) => item.endpoint);
}

function normalizeChunkBytes(value) {
  return Math.min(MAX_CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, Number(value || DEFAULT_CHUNK_BYTES)));
}

function assertTransferActive(options) {
  if (typeof options.isCancelled === 'function' && options.isCancelled()) {
    throw directTransferError('DIRECT_CANCELLED', '直传任务已暂停或取消。');
  }
}

async function sendDirectCollaborationPackage(options = {}) {
  const baseUrl = normalizeDirectEndpoint(options.baseUrl);
  const packageRoot = path.resolve(String(options.packageRoot || ''));
  if (!baseUrl || !fs.existsSync(packageRoot)) throw new Error('直传地址或协作包无效。');
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'manifest.json'), 'utf8'));
  const auth = options.auth || {};
  const initPath = '/api/collaboration/direct/packages';
  assertTransferActive(options);
  const initBody = Buffer.from(JSON.stringify({ manifest, protocolVersion: DIRECT_PROTOCOL_VERSION }), 'utf8');
  const initialized = await requestBuffer(`${baseUrl}${initPath}`, {
    method: 'POST',
    headers: signedHeaders(auth, 'POST', initPath, sha256(initBody), {
      'content-type': 'application/json; charset=utf-8',
      'content-length': initBody.length,
    }),
    timeoutMs: options.timeoutMs,
  }, initBody);

  if (initialized?.duplicate) return initialized;
  const resumable = initialized?.supportsResume === true && Array.isArray(initialized?.files);
  const remoteFiles = new Map((initialized?.files || []).map((file) => [Number(file.index), file]));
  const chunkBytes = normalizeChunkBytes(Math.min(
    Number(options.chunkBytes || DEFAULT_CHUNK_BYTES),
    Number(initialized?.maxChunkBytes || MAX_CHUNK_BYTES),
  ));
  const totalBytes = manifest.files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  let transferredBytes = 0;
  for (let index = 0; index < manifest.files.length; index += 1) {
    assertTransferActive(options);
    const file = manifest.files[index];
    const sourcePath = path.join(packageRoot, 'content', file.relativePath);
    const remote = remoteFiles.get(index);
    let offset = resumable ? Math.min(Number(remote?.receivedBytes || 0), Number(file.size || 0)) : 0;
    transferredBytes += offset;
    if (resumable) {
      while (offset < Number(file.size)) {
        assertTransferActive(options);
        const length = Math.min(chunkBytes, Number(file.size) - offset);
        const handle = fs.openSync(sourcePath, 'r');
        let body;
        try {
          body = Buffer.allocUnsafe(length);
          const bytesRead = fs.readSync(handle, body, 0, length, offset);
          if (bytesRead !== length) throw new Error(`读取协作文件分块不完整：${file.relativePath}`);
        } finally {
          fs.closeSync(handle);
        }
        const pathname = `/api/collaboration/direct/packages/${encodeURIComponent(manifest.manifestId)}/files/${index}/chunks/${offset}`;
        const result = await requestBuffer(`${baseUrl}${pathname}`, {
          method: 'PUT',
          headers: signedHeaders(auth, 'PUT', pathname, sha256(body), {
            'content-type': 'application/octet-stream',
            'content-length': body.length,
            'x-edu-file-sha256': file.sha256,
          }),
          timeoutMs: options.timeoutMs,
        }, body);
        const nextOffset = Number(result?.receivedBytes || offset + body.length);
        if (nextOffset <= offset || nextOffset > Number(file.size)) throw new Error('接收端返回的断点位置无效。');
        transferredBytes += nextOffset - offset;
        offset = nextOffset;
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            manifestId: manifest.manifestId,
            fileIndex: index,
            fileCount: manifest.files.length,
            relativePath: file.relativePath,
            fileBytes: offset,
            fileSize: Number(file.size),
            transferredBytes,
            totalBytes,
          });
        }
      }
    } else {
      const pathname = `/api/collaboration/direct/packages/${encodeURIComponent(manifest.manifestId)}/files/${index}`;
      await requestBuffer(`${baseUrl}${pathname}`, {
        method: 'PUT',
        headers: signedHeaders(auth, 'PUT', pathname, file.sha256, {
          'content-type': 'application/octet-stream',
          'content-length': file.size,
        }),
        timeoutMs: options.timeoutMs,
      }, fs.createReadStream(sourcePath));
      transferredBytes += Number(file.size || 0);
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          manifestId: manifest.manifestId,
          fileIndex: index,
          fileCount: manifest.files.length,
          relativePath: file.relativePath,
          fileBytes: Number(file.size),
          fileSize: Number(file.size),
          transferredBytes,
          totalBytes,
        });
      }
    }
  }

  assertTransferActive(options);
  const commitPath = `/api/collaboration/direct/packages/${encodeURIComponent(manifest.manifestId)}/commit`;
  const commitBody = Buffer.from(JSON.stringify({ manifestId: manifest.manifestId }), 'utf8');
  return requestBuffer(`${baseUrl}${commitPath}`, {
    method: 'POST',
    headers: signedHeaders(auth, 'POST', commitPath, sha256(commitBody), {
      'content-type': 'application/json; charset=utf-8',
      'content-length': commitBody.length,
    }),
    timeoutMs: options.timeoutMs,
  }, commitBody);
}

module.exports = {
  DEFAULT_CHUNK_BYTES,
  DIRECT_PROTOCOL_VERSION,
  LAN_DIRECT_TRANSPORT_ID,
  MAX_CHUNK_BYTES,
  MAX_CLOCK_SKEW_MS,
  MIN_CHUNK_BYTES,
  isTailscaleEndpoint,
  normalizeDirectEndpoint,
  routeDirectEndpoints,
  sendDirectCollaborationPackage,
  sha256,
  signDirectRequest,
  verifyDirectRequest,
};
