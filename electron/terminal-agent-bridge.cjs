'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

function createTerminalAgentBridge(options) {
  const root = path.resolve(options.root);
  const credentialFile = path.join(root, 'credential.txt');
  const descriptorFile = path.join(root, 'connection.json');
  let server = null;
  let token = '';
  let state = { enabled: false, port: 0, startedAt: '', queryCount: 0, lastQueryAt: '', lastError: '' };

  async function stop() {
    const current = server; server = null;
    if (current) await new Promise(resolve => current.close(resolve));
    token = '';
    state = { ...state, enabled: false, port: 0 };
    try { fs.unlinkSync(credentialFile); } catch {}
    try { fs.unlinkSync(descriptorFile); } catch {}
    return snapshot();
  }

  async function start(scope) {
    await stop();
    token = `student_bridge_${crypto.randomBytes(32).toString('hex')}`;
    server = http.createServer(async (request, response) => {
      const reply = (status, payload) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(payload)); };
      if (request.socket.remoteAddress && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return reply(403, { ok: false, code: 'LOOPBACK_ONLY' });
      if (request.method !== 'POST' || request.url !== '/invoke') return reply(404, { ok: false, code: 'NOT_FOUND' });
      if (request.headers.authorization !== `Bearer ${token}`) return reply(401, { ok: false, code: 'AUTH_REQUIRED' });
      const chunks = []; let bytes = 0;
      request.on('data', chunk => { bytes += chunk.length; if (bytes > 256 * 1024) request.destroy(); else chunks.push(chunk); });
      request.on('end', async () => {
        try {
          const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const result = await options.invoke(input, scope);
          state.queryCount += 1; state.lastQueryAt = new Date().toISOString(); state.lastError = '';
          reply(200, result);
        } catch (error) {
          state.lastError = String(error.message || error).slice(0, 240);
          reply(400, { ok: false, code: error.code || 'QUERY_FAILED', message: state.lastError });
        }
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    writePrivate(credentialFile, token);
    writePrivate(descriptorFile, JSON.stringify({ schema: 'edu-manager.windows-student-agent-bridge.v1', endpoint: `http://127.0.0.1:${port}/invoke`, credentialFile, studentId: scope.studentId, deviceId: scope.deviceId, hostId: scope.hostId, dataGeneration: scope.dataGeneration, expiresWithTerminal: true }, null, 2));
    state = { enabled: true, port, startedAt: new Date().toISOString(), queryCount: 0, lastQueryAt: '', lastError: '' };
    return snapshot();
  }

  function snapshot() { return { ...state, descriptorFile, credentialFile: state.enabled ? credentialFile : '', studentId: options.currentScope()?.studentId || '' }; }
  return { start, stop, snapshot };
}

module.exports = { createTerminalAgentBridge };
