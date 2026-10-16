'use strict';
const crypto = require('node:crypto');
const net = require('node:net');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function allocatePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function isOfficialLoginUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password
    && !url.port && url.hostname === 'www.workbuddy.cn' && url.pathname === '/login'; } catch { return false; }
}
// Official CLI REST login. No TTY emulation, credential scraping or public listener.
async function startWorkBuddyLogin({ invocation, spawn, openUrl, update, fetchImpl = global.fetch, portProvider = allocatePort, timeoutMs = 300000 }) {
  const port = await portProvider(), password = crypto.randomBytes(32).toString('hex');
  const env = { ...invocation.env, SERVER__HOST: '127.0.0.1', SERVER__PORT: String(port),
    CODEBUDDY_GATEWAY_AUTH: 'password', CODEBUDDY_GATEWAY_PASSWORD: password };
  const args = [...invocation.args, '--serve', '--host', '127.0.0.1', '--port', String(port), '--auth', 'password'];
  let child, ended = false, stopping = false;
  const finish = (state, message) => { if (ended) return; ended = true; update(state, message); stopping = true; try { child?.kill(); } catch {} };
  try { child = spawn(invocation.executable, args, { cwd: invocation.cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { finish('failed', '官方登录服务启动失败，请重新授权'); return; }
  // Drain without retaining vendor logs, which may contain session URLs.
  child.stdout?.resume?.(); child.stderr?.resume?.(); child.stdin?.end();
  child.once('error', () => finish('failed', '官方登录服务启动失败，请重新授权'));
  child.once('close', () => { if (!stopping) finish('failed', '官方登录服务已退出，尚未确认授权，请重试'); });
  const timeout = setTimeout(() => finish('expired', '此次授权已超时，请重新授权'), timeoutMs); timeout.unref?.();
  const request = async (endpoint, method = 'GET') => {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/v1/auth/account/${endpoint}`, {
      method, redirect: 'error', headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json', 'x-codebuddy-request': '1' },
      ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Official login service unavailable');
    const value = await response.json(); return value.data || value;
  };
  void (async () => {
    let phase = '启动连接';
    try {
      let status, started = Date.now();
      while (!ended && Date.now() - started < 30000) {
        try { status = await request('status'); break; } catch { await delay(500); }
      }
      if (ended) return;
      if (!status || typeof status.authenticated !== 'boolean') throw Error('Invalid login status');
      if (!status.authenticated) {
        phase = '发起登录';
        const login = await request('login', 'POST');
        if (ended) return;
        phase = '验证官方入口';
        if (!isOfficialLoginUrl(login.authUrl)) throw Error('Invalid official login URL');
        await openUrl(login.authUrl);
        update('running', '官方登录页已打开，请本人完成登录；完成后会自动确认连接');
      }
      while (!ended) {
        phase = '等待官方授权';
        if (status.authenticated) { finish('finished', '官方后台登录已确认；请点击“我已完成登录，继续”，完成执行资格检查'); return; }
        await delay(1500); if (ended) return;
        status = await request('status');
        if (typeof status.authenticated !== 'boolean') throw Error('Invalid login status');
        if (status.loginError) throw Error('Official login failed');
      }
    } catch { finish('failed', `官方后台授权未完成（${phase}），请重新授权`); }
    finally { clearTimeout(timeout); }
  })();
}
module.exports = { startWorkBuddyLogin, isOfficialLoginUrl };
