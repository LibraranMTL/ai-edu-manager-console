'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const candidateTag = process.env.EDU_WINDOWS_CANDIDATE_TAG || 'quick-screenshot-20261008';
const directory = path.join(root, 'release/windows/candidates', candidateTag);
const audit = JSON.parse(fs.readFileSync(path.join(directory, `AI-edu-manager-console-Windows-${version}-${candidateTag}-build-audit.json`), 'utf8'));
const qa = fs.mkdtempSync(path.join(root, '.codex_tmp/quick-capture-package-'));
const userData = path.join(qa, 'user-data'), studentBaseDir = path.join(qa, 'students');
fs.mkdirSync(userData); fs.mkdirSync(studentBaseDir);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ studentBaseDir, archiveRoot: studentBaseDir, taskAutomationEnabled: false }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, sockets = [];
async function connect(url) {
  const socket = new WebSocket(url); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = event => {
    const value = JSON.parse(event.data), item = pending.get(value.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(value.id);
    if (value.error) item.reject(Error(value.error.message)); else item.resolve(value.result);
  };
  return (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(`CDP timeout: ${method}`)); }, 8000);
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
  });
}
async function main() {
  const exe = process.argv[2] ? path.resolve(process.argv[2]) : audit.artifacts.exe.path;
  const verificationOutput = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(directory, 'isolated-launch-verification.json');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex').toUpperCase();
  assert.equal(sha256, audit.artifacts.exe.sha256);
  const pnpm = path.join(root, 'node_modules/.pnpm');
  const asar = require(path.join(pnpm, fs.readdirSync(pnpm).find(name => name.startsWith('@electron+asar@')), 'node_modules/@electron/asar'));
  const archive = path.join(audit.stagingRoot, 'out/win-unpacked/resources/app.asar');
  const archivedFilesMatchSource = ['main.cjs', 'preload.cjs', 'capture-inbox.cjs', 'quick-capture-direct.cjs', 'quick-capture.html', 'quick-capture-preload.cjs', 'quick-capture-renderer.js', 'quick-photo.html', 'quick-photo-preload.cjs', 'quick-photo-renderer.js'];
  for (const file of archivedFilesMatchSource) assert.ok(asar.extractFile(archive, `electron/${file}`).equals(fs.readFileSync(path.join(root, 'electron', file))), `package mismatch: ${file}`);
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  child = spawn(exe, [`--user-data-dir=${userData}`, '--qa-isolated', '--qa-show-quick-capture', `--remote-debugging-port=${port}`],
    { windowsHide: true, stdio: 'ignore', env: { ...process.env, EDU_DISABLE_TASK_SCHEDULER: '1' } });
  let pages;
  for (let attempt = 0; attempt < 180; attempt++) {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (pages.some(p => /quick-capture\.html$/.test(p.url)) && pages.some(p => /dist\/index\.html$/.test(p.url))) break; }
    catch { /* Portable extraction and first startup take a few seconds. */ }
    await sleep(500);
  }
  assert.ok(pages, 'debugging endpoint ready');
  const target = pages.find(p => /dist\/index\.html$/.test(p.url)), toolbar = pages.find(p => /quick-capture\.html$/.test(p.url));
  assert.ok(target && toolbar, 'main and toolbar windows ready');
  const send = await connect(target.webSocketDebuggerUrl), bar = await connect(toolbar.webSocketDebuggerUrl);
  async function evaluate(channel, expression) {
    const value = await channel('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.text); return value.result.value;
  }
  let visible;
  for (let attempt = 0; attempt < 40; attempt++) {
    visible = await evaluate(send, `document.body.innerText.includes(${JSON.stringify(version)})`); if (visible) break; await sleep(250);
  }
  assert.ok(visible, 'version shown');
  const storage = JSON.parse(await evaluate(send, 'window.AndroidBridge.getStorageConfig()'));
  assert.equal(storage.baseDir, studentBaseDir); assert.equal(storage.taskAutomationEnabled, false);
  const sessionBatchBridgeAvailable = await evaluate(send, 'typeof window.AndroidBridge.manageConversationImportsAsync === "function"');
  if (candidateTag.startsWith('session-')) assert.equal(sessionBatchBridgeAvailable, true);
  assert.equal(await evaluate(bar, 'typeof window.QuickCapture.invoke'), 'function');
  // The host context is delivered asynchronously after the renderer's initial load.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate(bar, 'document.querySelectorAll(".needs-student:not(:disabled)").length === 0')) break;
    await sleep(250);
  }
  assert.equal(await evaluate(bar, 'document.querySelectorAll(".needs-student:not(:disabled)").length'), 0);
  await evaluate(bar, 'window.QuickCapture.invoke("more")'); await sleep(200);
  const expanded = await evaluate(bar, 'innerHeight');
  await evaluate(bar, 'window.QuickCapture.invoke("more")'); await sleep(200);
  const collapsed = await evaluate(bar, 'innerHeight'); assert.ok(expanded > collapsed && collapsed <= 76);
  for (const [label, channel] of [['packaged-main', send], ['packaged-toolbar', bar]]) {
    const shot = await channel('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(qa, `${label}.png`), Buffer.from(shot.data, 'base64'));
  }
  const verification = { ok: true, packageVersion: version, executableSha256: sha256, archivedFilesMatchSource,
    isolatedLaunch: { versionVisible: visible, storage, toolbarReady: true, sessionBatchBridgeAvailable, noStudentActionsDisabled: true, expanded, collapsed },
    boundary: 'Real portable EXE startup with empty isolated data; physical camera, actual student license and real capture remain device acceptance items.', qa, testedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(verificationOutput), { recursive: true });
  fs.writeFileSync(verificationOutput, JSON.stringify(verification, null, 2));
  console.log(JSON.stringify(verification, null, 2));
  await send('Browser.close').catch(() => {});
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  sockets.forEach(socket => socket.close());
  if (child && child.exitCode === null) {
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]);
    if (child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
});
