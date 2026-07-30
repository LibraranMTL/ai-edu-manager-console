const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeDirectEndpoint,
  routeDirectEndpoints,
  sendDirectCollaborationPackage,
  sha256,
  signDirectRequest,
  verifyDirectRequest,
} = require('../electron/collaboration-lan-direct.cjs');

test('LAN direct signatures authenticate method, path and content digest', () => {
  const headers = signDirectRequest({
    secret: 'shared-test-secret',
    bindingId: 'binding-a',
    nodeId: 'node-a',
    method: 'PUT',
    pathname: '/api/collaboration/direct/packages/m1/files/0',
    contentSha256: sha256('payload'),
    timestamp: '1784912400000',
    nonce: 'nonce-1',
  });
  const verified = verifyDirectRequest({
    secret: 'shared-test-secret',
    method: 'PUT',
    pathname: '/api/collaboration/direct/packages/m1/files/0',
    headers,
    now: 1784912400000,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.bindingId, 'binding-a');
  assert.equal(verified.nodeId, 'node-a');
  assert.equal(verifyDirectRequest({
    secret: 'wrong-secret',
    method: 'PUT',
    pathname: '/api/collaboration/direct/packages/m1/files/0',
    headers,
    now: 1784912400000,
  }).ok, false);
});

test('LAN direct endpoint normalization accepts HTTP only', () => {
  assert.equal(normalizeDirectEndpoint('http://192.168.1.2:18777/path?q=1'), 'http://192.168.1.2:18777');
  assert.equal(normalizeDirectEndpoint('file:///tmp/test'), '');
  assert.equal(normalizeDirectEndpoint('not-a-url'), '');
});

test('direct endpoint routing always prefers LAN before Tailscale', () => {
  assert.deepEqual(routeDirectEndpoints([
    'http://100.88.1.2:18777',
    'http://192.168.1.20:18777',
    'http://10.0.0.8:18777',
    'http://100.88.1.2:18777',
  ]), [
    'http://192.168.1.20:18777',
    'http://10.0.0.8:18777',
    'http://100.88.1.2:18777',
  ]);
});

test('LAN direct client sends manifest, streams files and commits', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-direct-'));
  context.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const packageRoot = path.join(tempRoot, 'manifest-1');
  fs.mkdirSync(path.join(packageRoot, 'content', 'tasks'), { recursive: true });
  const content = Buffer.from('direct collaboration payload', 'utf8');
  fs.writeFileSync(path.join(packageRoot, 'content', 'tasks', 'task.json'), content);
  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify({
    manifestId: 'manifest-1',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    files: [{
      relativePath: 'tasks/task.json',
      size: content.length,
      sha256: sha256(content),
    }],
  }));

  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.url.endsWith('/commit') ? { ok: true, receipt: { status: 'imported' } } : { ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const port = server.address().port;

  const result = await sendDirectCollaborationPackage({
    packageRoot,
    baseUrl: `http://127.0.0.1:${port}`,
    auth: { bindingId: 'binding-a', nodeId: 'node-a', secret: 'shared-test-secret' },
  });
  assert.equal(result.receipt.status, 'imported');
  assert.deepEqual(requests.map((item) => `${item.method} ${item.url}`), [
    'POST /api/collaboration/direct/packages',
    'PUT /api/collaboration/direct/packages/manifest-1/files/0',
    'POST /api/collaboration/direct/packages/manifest-1/commit',
  ]);
  assert.deepEqual(requests[1].body, content);
  assert.equal(requests.every((item) => item.headers['x-edu-signature']), true);
});

test('direct client resumes from receiver offset and uploads only missing bytes', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-direct-resume-'));
  context.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const packageRoot = path.join(tempRoot, 'manifest-resume');
  fs.mkdirSync(path.join(packageRoot, 'content'), { recursive: true });
  const content = Buffer.from('0123456789', 'utf8');
  fs.writeFileSync(path.join(packageRoot, 'content', 'resume.bin'), content);
  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify({
    manifestId: 'manifest-resume',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    files: [{ relativePath: 'resume.bin', size: content.length, sha256: sha256(content) }],
  }));

  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: request.method, url: request.url, body });
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.url === '/api/collaboration/direct/packages') {
        response.end(JSON.stringify({
          ok: true,
          supportsResume: true,
          maxChunkBytes: 1024 * 1024,
          files: [{ index: 0, receivedBytes: 4, size: 10 }],
        }));
        return;
      }
      if (request.url.includes('/chunks/4')) {
        response.end(JSON.stringify({ ok: true, receivedBytes: 10, complete: true }));
        return;
      }
      response.end(JSON.stringify({ ok: true, receipt: { status: 'imported' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const port = server.address().port;

  const progress = [];
  const result = await sendDirectCollaborationPackage({
    packageRoot,
    baseUrl: `http://127.0.0.1:${port}`,
    auth: { bindingId: 'binding-a', nodeId: 'node-a', secret: 'shared-test-secret' },
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.receipt.status, 'imported');
  assert.deepEqual(requests.map((item) => `${item.method} ${item.url}`), [
    'POST /api/collaboration/direct/packages',
    'PUT /api/collaboration/direct/packages/manifest-resume/files/0/chunks/4',
    'POST /api/collaboration/direct/packages/manifest-resume/commit',
  ]);
  assert.deepEqual(requests[1].body, content.subarray(4));
  assert.equal(progress.at(-1).transferredBytes, content.length);
});

test('direct client recovers a multi-chunk file after an interrupted request', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-direct-interrupt-'));
  context.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const packageRoot = path.join(tempRoot, 'manifest-interrupt');
  fs.mkdirSync(path.join(packageRoot, 'content'), { recursive: true });
  const content = Buffer.alloc(700 * 1024, 0x5a);
  fs.writeFileSync(path.join(packageRoot, 'content', 'large.bin'), content);
  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify({
    manifestId: 'manifest-interrupt',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    files: [{ relativePath: 'large.bin', size: content.length, sha256: sha256(content) }],
  }));

  let received = Buffer.alloc(0);
  let initCount = 0;
  let interrupted = false;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      response.setHeader('content-type', 'application/json');
      if (request.url === '/api/collaboration/direct/packages') {
        initCount += 1;
        response.end(JSON.stringify({
          ok: true,
          supportsResume: true,
          maxChunkBytes: 256 * 1024,
          files: [{ index: 0, receivedBytes: received.length, size: content.length }],
        }));
        return;
      }
      const chunk = request.url.match(/\/chunks\/(\d+)$/);
      if (chunk) {
        const offset = Number(chunk[1]);
        if (!interrupted && offset > 0) {
          interrupted = true;
          request.socket.destroy();
          return;
        }
        assert.equal(offset, received.length);
        received = Buffer.concat([received, body]);
        response.end(JSON.stringify({ ok: true, receivedBytes: received.length, complete: received.length === content.length }));
        return;
      }
      response.end(JSON.stringify({ ok: true, receipt: { status: 'imported' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const options = {
    packageRoot,
    baseUrl: `http://127.0.0.1:${port}`,
    chunkBytes: 256 * 1024,
    auth: { bindingId: 'binding-a', nodeId: 'node-a', secret: 'shared-test-secret' },
  };

  await assert.rejects(sendDirectCollaborationPackage(options));
  const result = await sendDirectCollaborationPackage(options);
  assert.equal(result.receipt.status, 'imported');
  assert.equal(initCount, 2);
  assert.deepEqual(received, content);
});
