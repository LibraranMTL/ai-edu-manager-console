'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJsonAtomic } = require('./project-materials.cjs');
const { buildControlledWorkBuddyInvocation } = require('./workbuddy-runtime.cjs');
const { createWorkBuddyCliManager } = require('./workbuddy-cli-manager.cjs');

// Stores descriptors only. Credentials belong to the official CLI and are never
// read, copied, logged or returned over IPC by the host.
function createClassificationAuth({ directory, spawn, openUrl, changed = () => {}, cliManager, workBuddyLogin = require('./workbuddy-login.cjs').startWorkBuddyLogin } = {}) {
  const sessions = new Map();
  const officialCli = cliManager || createWorkBuddyCliManager({ directory: path.join(directory, 'official-workbuddy-cli') });
  const file = id => path.join(directory, `${id}.json`);
  const valid = id => { if (!['codex', 'workbuddy'].includes(id)) throw Error('不支持的 Agent'); return id; };
  async function read(id) {
    valid(id);
    try { return JSON.parse(await fs.readFile(file(id), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; return { version: 0 }; }
  }
  async function save(id, value) { await fs.mkdir(directory, { recursive: true }); await writeJsonAtomic(file(id), value); return value; }
  function apply(runtime, state) {
    if (!state.root) return runtime;
    return { ...runtime, ...(state.cliPath ? { cliPath: state.cliPath, mode: 'node' } : {}),
      configDir: path.join(state.root, '.workbuddy'), authRoot: state.root };
  }
  const api = {
    read, apply,
    status(id) { const session = sessions.get(id); return session ? { state: session.state, message: session.message } : null; },
    complete(id) { valid(id); sessions.delete(id); },
    async invalidate(id, requestId) { const state = await read(id);
      if (requestId && state.continueRequestId === requestId) return state;
      return save(id, { ...state, version: state.version + 1, continueRequestId: requestId }); },
    async start(id, adapter, requestId = '') {
      valid(id); if (sessions.get(id)?.state === 'running') return { message: '授权窗口已打开，请完成官方登录' };
      let state = await read(id), invocation;
      if (requestId && state.loginRequestId === requestId) return { message: '此授权请求已提交，完成官方登录后点击继续' };
      if (id === 'workbuddy') {
        let interactive = state.cliPath;
        if (!await fs.stat(interactive || '').then(s => s.isFile(), () => false)) interactive = (await officialCli.ensure()).cliPath;
        const root = state.root || path.join(directory, 'workbuddy-profile');
        state = { ...state, root, cliPath: interactive, version: state.version + 1 };
        for (const relative of ['.workbuddy', 'workspace', 'AppData/Local', 'AppData/Roaming']) await fs.mkdir(path.join(root, relative), { recursive: true });
        const runtime = apply(adapter.runtime, state);
        invocation = buildControlledWorkBuddyInvocation(runtime, { cwd: path.join(root, 'workspace') });
        invocation.args = invocation.args.filter((arg, i, all) => !['--print', '--input-format', '--output-format'].includes(arg) && !['--input-format', '--output-format'].includes(all[i - 1]));
        delete invocation.env.CODEBUDDY_FORCE_LITE_WB_BUNDLE; delete invocation.env.CODEBUDDY_FORCE_HEADLESS_BUNDLE;
        for (const name of Object.keys(invocation.env)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(name)) delete invocation.env[name];
      } else {
        state = { ...state, version: state.version + 1 };
        invocation = { executable: adapter.executable, args: ['login'], cwd: directory, env: process.env };
      }
      await save(id, { ...state, loginRequestId: requestId });
      const session = { state: 'running', message: '正在启动官方登录；完成后点击“我已完成登录，继续”' };
      sessions.set(id, session); changed();
      if (id === 'workbuddy') {
        // WorkBuddy may keep the login helper alive until the browser flow finishes.
        // Do not hold the renderer IPC request for that whole interactive session.
        Promise.resolve().then(() => workBuddyLogin({ invocation, spawn, openUrl,
          update: (state, message) => { session.state = state; session.message = message; changed(); },
        })).catch(() => { session.state = 'failed'; session.message = '官方登录服务启动失败，请重新授权'; changed(); });
        return { message: session.message };
      }
      let child;
      try { child = spawn(invocation.executable, invocation.args, { cwd: invocation.cwd, env: invocation.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch { session.state = 'failed'; session.message = '官方登录进程启动失败'; changed(); return { message: session.message }; }
      let tail = '', opened = false;
      const consume = chunk => {
        tail = (tail + String(chunk)).slice(-8192);
        if (opened) return;
        for (const match of tail.matchAll(/https:\/\/[^\s<>"\x1b]+/g)) {
          if (match.index + match[0].length === tail.length) continue;
          try { const url = new URL(match[0]);
            if ((id === 'workbuddy' && url.hostname === 'www.workbuddy.cn' && url.pathname === '/login')
              || (id === 'codex' && url.hostname === 'auth.openai.com' && url.pathname.startsWith('/oauth/authorize'))) {
              opened = true; void Promise.resolve(openUrl(url.href)).catch(() => { session.message = '未能打开官方登录窗口，请重试授权'; changed(); }); break;
            }
          } catch { /* Partial URL; wait for the next bounded chunk. */ }
        }
      };
      child.stdout?.on('data', consume); child.stderr?.on('data', consume);
      const timeout = setTimeout(() => { child.kill(); session.state = 'expired'; session.message = '此次授权已超时，请重新授权'; changed(); }, 300000); timeout.unref?.();
      child.once('error', () => { clearTimeout(timeout); session.state = 'failed'; session.message = '官方登录进程启动失败'; changed(); });
      child.once('close', code => { clearTimeout(timeout); tail = ''; session.state = code === 0 ? 'finished' : 'closed'; session.message = '登录窗口已结束；点击“我已完成登录，继续”验证并恢复资料'; changed(); });
      return { message: session.message };
    },
  };
  const starts = new Map(), begin = api.start;
  api.start = (...args) => {
    const id = args[0];
    if (starts.has(id)) return starts.get(id);
    const work = begin(...args).finally(() => starts.delete(id)); starts.set(id, work); return work;
  };
  return api;
}
module.exports = { createClassificationAuth };
