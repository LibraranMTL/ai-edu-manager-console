'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('isolated Windows desktop shows first run and resumes a paused guide', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-onboarding-desktop-'));
  const installedExe = process.env.EDU_FIRST_RUN_INSTALLED_EXE;
  const electron = installedExe || require('electron');
  const port = 19473 + Math.floor(Math.random() * 1000);
  const env = { ...process.env, EDU_DISABLE_TASK_SCHEDULER: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [...(installedExe ? [] : [root]), `--user-data-dir=${dir}`, '--qa-isolated', `--remote-debugging-port=${port}`], { windowsHide: true, stdio: 'ignore', env });
  t.after(() => {
    if (child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  });
  let page;
  for (let i = 0; i < 100; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = pages.find(item => /dist\/index\.html/.test(item.url));
      if (page) break;
    } catch { /* startup */ }
    await pause(500);
  }
  assert.ok(page, 'desktop renderer opened');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  t.after(() => socket.close());
  let id = 0; const pending = new Map();
  socket.onmessage = event => { const value = JSON.parse(event.data), item = pending.get(value.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(value.id); value.error ? item.reject(Error(value.error.message)) : item.resolve(value.result); };
  const evaluate = expression => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error('renderer call timed out')); }, 12000);
    pending.set(key, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true } }));
  }).then(result => { if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; });
  let snapshot;
  for (let i = 0; i < 80; i++) {
    snapshot = await evaluate('JSON.parse(await window.AndroidBridge.firstRun("snapshot"))');
    if (snapshot.status !== 'waiting') break;
    await pause(500);
  }
  assert.equal(snapshot.status, 'new');
  let visible = false;
  for (let i = 0; i < 30; i++) {
    visible = await evaluate('document.body.innerText.includes("开始使用 AI教育管家")');
    if (visible) break;
    await pause(300);
  }
  assert.equal(visible, true, String(await evaluate('document.body.innerText.slice(0, 1800)')));
  await evaluate('Array.from(document.querySelectorAll("button")).find(item => item.innerText === "稍后设置")?.click()');
  for (let i = 0; i < 20; i++) {
    if (await evaluate('document.body.innerText.includes("继续首次引导")')) break;
    await pause(200);
  }
  snapshot = await evaluate('JSON.parse(await window.AndroidBridge.firstRun("snapshot"))');
  assert.equal(snapshot.status, 'paused');
  assert.equal(snapshot.state.step, 'welcome');
  await evaluate('Array.from(document.querySelectorAll("button")).find(item => item.innerText === "继续首次引导")?.click()');
  for (let i = 0; i < 20; i++) {
    if (await evaluate('document.body.innerText.includes("稍后设置")')) break;
    await pause(200);
  }
  assert.equal((await evaluate('JSON.parse(await window.AndroidBridge.firstRun("snapshot"))')).status, 'resume');
  await evaluate('window.AndroidBridge.firstRun("progress", { step: "consent", provider: "codex" })');
  await evaluate('setTimeout(() => window.location.reload(), 100)');
  let consentVisible = false;
  for (let i = 0; i < 40; i++) {
    try { consentVisible = await evaluate('document.body.innerText.includes("一个会话访问所有授权学生")'); }
    catch { /* renderer reloading */ }
    if (consentVisible) break;
    await pause(300);
  }
  assert.equal(consentVisible, true, 'first-run consent defaults rendered');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".first-run-guide input[type=checkbox]")).map(item => item.checked)'), [true, true, true]);
});
