'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');

const PROVIDERS = { codex: 'Codex', workbuddy: 'WorkBuddy' };
const ENABLE = 'education_focus_request_enable';
const STATUS = 'education_focus_get_status';
const ID = /^[a-f0-9-]{36}$/;
const RECEIPT_TTL = 300_000;
const STARTUP_TIMEOUT = 30_000;

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function write(file, value) {
  const pending = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(pending, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    fs.renameSync(pending, file);
  } finally { fs.rmSync(pending, { force: true }); }
}

function failure(code, message) {
  return { ok: false, code, message };
}

function createFocusServer({ root, role, executable, installed, snapshot, activate }) {
  const endpointFile = path.join(root, 'agent-endpoint.json');
  const channel = randomUUID();
  const receipts = new Map();
  let pending;
  let server;
  const grantFile = provider => path.join(root, 'agent-access-' + provider + '.json');
  const grantFor = provider => read(grantFile(provider));
  const allowed = (provider, token) => Boolean(installed() && token && grantFor(provider)?.token === token);
  const access = () => Object.fromEntries(Object.keys(PROVIDERS).map(provider => [provider, Boolean(grantFor(provider)?.token)]));

  function setAccess(provider, enabled) {
    if (!Object.hasOwn(PROVIDERS, provider)) throw Error('不支持的 Agent。');
    if (enabled && !installed()) throw Error('请使用 Windows 安装版配置 Agent 专注模式。');
    if (enabled) {
      if (!grantFor(provider)?.token) write(grantFile(provider), { role, provider, executable, token: randomBytes(32).toString('hex') });
    } else {
      fs.rmSync(grantFile(provider), { force: true });
      if (pending?.provider === provider) pending.controller.abort();
      for (const [id, record] of receipts) if (record.provider === provider) receipts.delete(id);
    }
  }

  function result(record) {
    return { ok: !['failed', 'cancelled', 'timed_out'].includes(record.state), client: role, requestId: record.id,
      state: record.state, ...(record.message && { message: record.message }), ...snapshot() };
  }

  function request(provider, token) {
    for (const [id, record] of receipts) if (record.expires < Date.now() && record !== pending) receipts.delete(id);
    if (pending) {
      return pending.provider === provider && pending.token === token ? result(pending)
        : failure('FOCUS_BUSY', '本端已有开启请求等待确认。');
    }
    const record = { id: randomUUID(), provider, token, controller: new AbortController(), expires: Date.now() + RECEIPT_TTL,
      state: snapshot().mode === 'enabled' ? 'already_enabled' : 'awaiting_confirmation' };
    for (const [id, existing] of receipts) if (existing.provider === provider) receipts.delete(id);
    receipts.set(record.id, record);
    if (record.state === 'already_enabled') return result(record);
    pending = record;
    void Promise.resolve().then(() => activate({
      provider, signal: record.controller.signal, permitted: () => allowed(provider, token),
      onConfirmed: () => { record.state = 'applying'; },
    })).then(outcome => {
      record.state = outcome.state;
      record.message = outcome.message;
    }, () => {
      record.state = 'failed';
      record.message = '未能开启专注模式，请在教育管家中检查应用管控组件。';
    }).finally(() => { pending = undefined; });
    return result(record);
  }

  async function start() {
    if (server || !installed()) return;
    server = http.createServer((req, res) => {
      const reply = data => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
      };
      const [, prefix, key, provider, action, id, extra] = (req.url || '').split('/');
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      if (req.method !== 'POST' || prefix !== 'focus' || key !== channel || !Object.hasOwn(PROVIDERS, provider) ||
          req.socket.remoteAddress !== '127.0.0.1' || extra !== undefined || !allowed(provider, token)) {
        res.writeHead(403).end();
        return;
      }
      try {
        if (action === 'enable' && id === undefined) return reply(request(provider, token));
        if (action === 'status' && id === undefined) return reply({ ok: true, client: role, ...snapshot() });
        if (action === 'status' && ID.test(id || '')) {
          const record = receipts.get(id);
          if (record?.provider === provider && record.token === token && record.expires >= Date.now()) return reply(result(record));
          return reply(failure('FOCUS_REQUEST_EXPIRED', '开启请求已失效。请查询本端当前状态。'));
        }
        return reply(failure('INVALID_FOCUS_REQUEST', '无效的专注模式请求。'));
      } catch {
        reply(failure('FOCUS_UNAVAILABLE', '教育管家暂时无法读取本端专注模式。'));
      }
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      server.unref();
      write(endpointFile, { port: server.address().port, channel, pid: process.pid, role });
    } catch (error) {
      server.close();
      server = undefined;
      throw error;
    }
  }

  function stop() {
    if (!server) return;
    pending?.controller.abort();
    server.close();
    server = undefined;
    if (read(endpointFile)?.channel === channel) fs.rmSync(endpointFile, { force: true });
  }

  return { access, setAccess, grantFile, start, stop };
}

function startInstalledApp(executable, userData) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--user-data-dir=' + userData], {
      detached: true, stdio: 'ignore', windowsHide: false, env, cwd: path.dirname(executable),
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function createFocusClient(config, { launch = startInstalledApp, startupTimeout = STARTUP_TIMEOUT, pollInterval = 300 } = {}) {
  const { root, role, provider } = config || {};
  const supported = typeof root === 'string' && path.isAbsolute(root) && ['host', 'student'].includes(role) && Object.hasOwn(PROVIDERS, provider);
  const grant = () => supported ? read(path.join(root, 'agent-access-' + provider + '.json')) : null;
  const target = role === 'host' ? 'Windows 主机端' : 'Windows 学生端';
  let starting;
  function tools() {
    if (!grant()?.token) return [];
    return [
      { name: ENABLE, description: '向本机' + target + '请求开启专注模式。两端都可用且用户未指定目标时先询问。请让用户在教育管家输入密码，然后用返回的请求编号查询。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: STATUS, description: '查询本机' + target + '专注模式或开启请求。等待确认时请提示用户在教育管家操作，稍后再查。', inputSchema: { type: 'object', properties: { requestId: { type: 'string', maxLength: 36 } }, additionalProperties: false } },
    ];
  }

  async function send(action, token, requestId) {
    const endpoint = read(path.join(root, 'agent-endpoint.json'));
    if (endpoint?.role !== role || !ID.test(endpoint?.channel || '') ||
        !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 ||
        !Number.isInteger(endpoint.pid) || endpoint.pid < 1) return null;
    try { process.kill(endpoint.pid, 0); } catch { return null; }
    try {
      const url = 'http://127.0.0.1:' + endpoint.port + '/focus/' + endpoint.channel + '/' + provider + '/' + action +
        (requestId ? '/' + requestId : '');
      const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(2500), headers: { Authorization: 'Bearer ' + token } });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  }

  async function call(name, args = {}) {
    const status = name === STATUS;
    if ((!status && name !== ENABLE) || !args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some(key => !status || key !== 'requestId') ||
        (Object.hasOwn(args, 'requestId') && (typeof args.requestId !== 'string' || !ID.test(args.requestId)))) {
      return failure('INVALID_FOCUS_REQUEST', '只可请求开启或查询本端专注模式。');
    }
    const entry = grant();
    if (!entry?.token || entry.role !== role || entry.provider !== provider) return failure('FOCUS_NOT_AUTHORIZED', '请在本端教育管家中授权该 Agent。');
    const action = status ? 'status' : 'enable';
    const available = await send('status', entry.token, args.requestId);
    if (available) {
      if (status) return available;
      return await send(action, entry.token) || failure('FOCUS_UNAVAILABLE', '开启请求未收到回执，请先查询当前状态。');
    }
    if (status) return failure('FOCUS_NOT_RUNNING', '本端教育管家尚未就绪。');
    if (typeof entry.executable !== 'string' || !path.isAbsolute(entry.executable) ||
        path.extname(entry.executable).toLowerCase() !== '.exe' || !fs.existsSync(entry.executable)) {
      return failure('FOCUS_INSTALLATION_MISSING', '找不到已授权的教育管家安装版，请打开新版重新授权。');
    }
    if (!starting) starting = (async () => {
      await launch(entry.executable, path.dirname(root));
      const expires = Date.now() + startupTimeout;
      do {
        if (grant()?.token !== entry.token) return false;
        if (await send('status', entry.token)) return true;
        await wait(pollInterval);
      } while (Date.now() < expires);
      return false;
    })().finally(() => { starting = undefined; });
    try {
      if (!await starting) return failure('FOCUS_START_TIMEOUT', '教育管家未在规定时间内就绪，请打开并核对授权后重试。');
    } catch {
      return failure('FOCUS_LAUNCH_FAILED', '无法打开已授权的教育管家，请手动打开检查安装。');
    }
    if (grant()?.token !== entry.token) return failure('FOCUS_NOT_AUTHORIZED', '本机授权已变更。');
    return await send(action, entry.token) || failure('FOCUS_UNAVAILABLE', '开启请求未收到回执，请先查询当前状态。');
  }
  return { tools, call };
}

function toolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: value.ok === false };
}

module.exports = { PROVIDERS, ENABLE, STATUS, createFocusServer, createFocusClient, toolResult };
