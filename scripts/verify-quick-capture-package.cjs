'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const candidateTag = String(process.env.EDU_WINDOWS_CANDIDATE_TAG || '').trim();
const directory = candidateTag
  ? path.join(root, 'release/windows/candidates', candidateTag)
  : path.join(root, 'release/windows');
const artifactStem = `AI-edu-manager-console-Windows-${version}${candidateTag ? `-${candidateTag}` : ''}`;
const audit = JSON.parse(fs.readFileSync(path.join(directory, `${artifactStem}-build-audit.json`), 'utf8'));
const qaRoot = path.join(root, '.codex_tmp');
fs.mkdirSync(qaRoot, { recursive: true });
const qa = fs.mkdtempSync(path.join(qaRoot, 'quick-capture-package-'));
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
    : path.join(directory, `${artifactStem}-isolated-launch-verification.json`);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex').toUpperCase();
  assert.equal(sha256, audit.artifacts.exe.sha256);
  const pnpm = path.join(root, 'node_modules/.pnpm');
  const asar = require(path.join(pnpm, fs.readdirSync(pnpm).find(name => name.startsWith('@electron+asar@')), 'node_modules/@electron/asar'));
  const archive = path.join(audit.stagingRoot, 'out/win-unpacked/resources/app.asar');
  const archivedFilesMatchSource = ['main.cjs', 'preload.cjs', 'capture-inbox.cjs', 'quick-capture-direct.cjs', 'quick-capture.html', 'quick-capture-preload.cjs', 'quick-capture-renderer.js',
    'companion-toolbar.cjs', 'companion-popover.html', 'companion-popover-preload.cjs', 'companion-popover-renderer.js', 'companion-logo.png',
    'quick-photo.html', 'quick-photo-preload.cjs', 'quick-photo-renderer.js'];
  const comparisonRoot = process.env.EDU_QA_SOURCE_ROOT ? path.resolve(process.env.EDU_QA_SOURCE_ROOT) : root;
  const esbuild = audit.runtimeCompaction ? require(path.join(pnpm, fs.readdirSync(pnpm).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild')) : null;
  for (const file of archivedFilesMatchSource) {
    let expected = fs.readFileSync(path.join(comparisonRoot, 'electron', file));
    if (esbuild && !process.env.EDU_QA_SOURCE_ROOT && file.endsWith('.cjs')) expected = Buffer.from(require('./compact-windows-runtime.cjs').compactRuntimeSource(expected.toString('utf8'), esbuild));
    assert.ok(asar.extractFile(archive, `electron/${file}`).equals(expected), `package mismatch: ${file}`);
  }
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const launchStartedAt = performance.now();
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
  const launchToVersionVisibleMs = performance.now() - launchStartedAt;
  const asyncStatusParity = await evaluate(send, `(async () => {
    const bridge = window.AndroidBridge;
    if (typeof bridge.getAppStatusAsync !== 'function') return { supported: false };
    const asyncValue = await bridge.getAppStatusAsync();
    return { supported: true, equal: asyncValue === bridge.getAppStatus() };
  })()`);
  if (candidateTag.startsWith('performance-')) assert.deepEqual(asyncStatusParity, { supported: true, equal: true });
  const storage = JSON.parse(await evaluate(send, 'window.AndroidBridge.getStorageConfig()'));
  assert.equal(storage.baseDir, studentBaseDir); assert.equal(storage.taskAutomationEnabled, false);
  const assetSummary = JSON.parse(await evaluate(send, '(async () => await window.AndroidBridge.getAssetSummary({}))()'));
  assert.equal(assetSummary.ok, true);
  assert.equal(assetSummary.health, 'ok');
  assert.equal(assetSummary.total, 0);
  const assetPage = JSON.parse(await evaluate(send, '(async () => await window.AndroidBridge.listAssets({ pageSize: 100 }))()'));
  assert.deepEqual(assetPage.items, []);
  assert.equal(assetPage.total, 0);
  const skillLibraryEnvelope = JSON.parse(await evaluate(send, `(async () => await window.AndroidBridge.skillLibraryAction('snapshot', {}))()`));
  assert.equal(typeof skillLibraryEnvelope.ok, 'boolean');
  if (skillLibraryEnvelope.ok) {
    assert.equal(skillLibraryEnvelope.data.scope, 'host');
    assert.equal(skillLibraryEnvelope.data.mcpEnabled, false);
    assert.equal(skillLibraryEnvelope.data.pluginInstallEnabled, false);
    assert.deepEqual(skillLibraryEnvelope.data.providers.map(item => item.providerId), ['codex', 'workbuddy', 'qclaw']);
  } else assert.ok(skillLibraryEnvelope.message, 'licensed Skill bridge returns an actionable denial');
  const sessionBatchBridgeAvailable = await evaluate(send, 'typeof window.AndroidBridge.manageConversationImportsAsync === "function"');
  if (candidateTag.startsWith('session-')) assert.equal(sessionBatchBridgeAvailable, true);
  assert.equal(await evaluate(bar, 'typeof window.QuickCapture.invoke'), 'function');
  // The host context is delivered asynchronously after the renderer's initial load.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate(bar, 'document.querySelectorAll(".needs-student:not(:disabled)").length === 0')) break;
    await sleep(250);
  }
  assert.equal(await evaluate(bar, 'document.querySelectorAll(".needs-student:not(:disabled)").length'), 0);
  const fixtures = [{ id: '17894430145-demo-a', name: '示例学生甲', loginId: 'S-DEMO-A', rootPath: path.join(studentBaseDir, 'a') },
    { id: '17894430146-demo-b', name: '示例学生乙', loginId: 'S-DEMO-B', rootPath: path.join(studentBaseDir, 'b') }];
  for (const student of fixtures) fs.mkdirSync(student.rootPath);
  fs.writeFileSync(path.join(userData, 'students.json'), JSON.stringify(fixtures));
  fs.writeFileSync(path.join(userData, 'projects.json'), JSON.stringify({ projects: [
    { id: 'demo-project-a', name: '示例项目甲', studentIds: [fixtures[0].id] },
    { id: 'demo-project-b', name: '示例项目乙', studentIds: [fixtures[1].id] }
  ] }));
  for (const student of fixtures) {
    await evaluate(send, `window.AndroidBridge.setQuickCaptureContext(${JSON.stringify(student.id)})`);
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate(bar, `document.querySelector('#student').textContent === ${JSON.stringify(student.name)}`)) break;
      await sleep(100);
    }
    assert.equal(await evaluate(bar, 'document.querySelector("#student").textContent'), student.name);
  }
  await evaluate(send, `window.AndroidBridge.setQuickCaptureContext(${JSON.stringify(fixtures[0].id)})`);
  assert.equal(await evaluate(bar, 'document.querySelector(".brand img").complete && document.querySelector(".brand img").naturalWidth > 0'), true);
  const compactHeight = await evaluate(bar, 'innerHeight');
  assert.ok(compactHeight <= 40, `toolbar is not compact: ${compactHeight}px`);
  const toolbarContract = await evaluate(bar, `(() => {
    const actions = [...document.querySelectorAll('[data-action]')].map(node => node.dataset.action);
    const idleActions = [...document.querySelectorAll('#idle-actions [data-action]')].map(node => node.dataset.action);
    const ai = document.querySelector('[data-action="ai-settings"]');
    const close = document.querySelector('[data-action="hide"]');
    return {
      actions,
      idleActions,
      aiBeforeClose: Boolean(ai && close && (ai.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING)),
      hasEllipsis: document.body.innerText.includes('⋯') || document.body.innerText.includes('•••'),
      hasTargetAgent: document.body.innerText.includes('目标Agent') || document.body.innerText.includes('目标 Agent')
    };
  })()`);
  assert.deepEqual(toolbarContract.idleActions, ['collect-menu', 'organize-menu', 'learning']);
  assert.equal(toolbarContract.aiBeforeClose, true);
  assert.equal(toolbarContract.hasEllipsis, false);
  assert.equal(toolbarContract.hasTargetAgent, false);

  await evaluate(bar, 'window.QuickCapture.invoke("learning")');
  let popoverPage;
  for (let attempt = 0; attempt < 40; attempt++) {
    const currentPages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    popoverPage = currentPages.find(page => /companion-popover\.html$/.test(page.url));
    if (popoverPage) break;
    await sleep(250);
  }
  assert.ok(popoverPage, 'learning popover ready');
  const popover = await connect(popoverPage.webSocketDebuggerUrl);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate(popover, 'document.querySelectorAll(".group").length === 5')) break;
    await sleep(250);
  }
  const learningContract = await evaluate(popover, `(() => ({
    tabs: [...document.querySelectorAll('.group')].map(node => node.textContent.trim()),
    actions: [...document.querySelectorAll('.mode-action strong')].map(node => node.textContent.trim())
  }))()`);
  assert.deepEqual(learningContract.tabs, ['学习', '互动', '测验', '核验', '计划']);
  for (const label of ['知识闪卡', '思维导图', '信息图', '图表总结']) assert.ok(learningContract.actions.includes(label), `missing learning action: ${label}`);
  const visualSettings = await evaluate(popover, `(() => ({
    labels:[...document.querySelectorAll('.form label')].map(node=>node.childNodes[0].textContent.trim()),
    quantity:[...document.querySelectorAll('#quantity option')].map(node=>node.textContent),
    style:[...document.querySelectorAll('#style option')].map(node=>node.textContent),
    hasDifficulty:Boolean(document.querySelector('#difficulty')),hasDuration:Boolean(document.querySelector('#duration'))
  }))()`);
  assert.deepEqual(visualSettings.quantity, ['1张', '2张', '自动', '自定义']);
  assert.deepEqual(visualSettings.style, ['简洁', '标准', '动漫']);
  assert.equal(visualSettings.hasDifficulty, false); assert.equal(visualSettings.hasDuration, false);
  const customQuantityInitiallyHidden = await evaluate(popover, `getComputedStyle(document.querySelector('.custom-quantity')).display==='none'`);
  assert.equal(customQuantityInitiallyHidden, true);
  const customQuantityVisible = await evaluate(popover, `(() => { const select=document.querySelector('#quantity');select.value='custom';select.dispatchEvent(new Event('change'));return getComputedStyle(document.querySelector('.custom-quantity')).display!=='none'; })()`);
  assert.equal(customQuantityVisible, true);
  const goalOnlySettings = {};
  for (const label of ['核验', '计划']) {
    goalOnlySettings[label] = await evaluate(popover, `(() => { [...document.querySelectorAll('.group')].find(node=>node.textContent.trim()===${JSON.stringify(label)}).click();return {hasDifficulty:Boolean(document.querySelector('#difficulty')),hasDuration:Boolean(document.querySelector('#duration')),hasQuantity:Boolean(document.querySelector('#quantity')),hasGoal:Boolean(document.querySelector('#goal'))}; })()`);
    assert.deepEqual(goalOnlySettings[label], { hasDifficulty: false, hasDuration: false, hasQuantity: false, hasGoal: true });
  }
  await evaluate(popover, `[...document.querySelectorAll('.group')].find(node=>node.textContent.trim()==='学习').click()`);
  for (const [label, channel] of [['packaged-main', send], ['packaged-toolbar', bar]]) {
    const shot = await channel('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(qa, `${label}.png`), Buffer.from(shot.data, 'base64'));
  }
  const popoverShot = await popover('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(qa, 'packaged-learning-popover.png'), Buffer.from(popoverShot.data, 'base64'));
  async function openPanel(action, expectedTitle) {
    await evaluate(bar, `window.QuickCapture.invoke(${JSON.stringify(action)})`);
    for (let attempt = 0; attempt < 50; attempt++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const entry = list.find(p => /companion-popover\.html$/.test(p.url));
      if (entry) {
        const channel = await connect(entry.webSocketDebuggerUrl);
        try {
          if (await evaluate(channel, `document.querySelector('#title').textContent === ${JSON.stringify(expectedTitle)}`)) { await sleep(200); return channel; }
        } catch { /* Previous panel may still be closing. */ }
      }
      await sleep(100);
    }
    throw Error(`panel did not open: ${expectedTitle}`);
  }
  const panelChecks = [];
  for (const [action, label] of [['collect-menu', '采集'], ['organize-menu', '整理'], ['scope', '选择资料范围'], ['ai-settings', 'AI设置']]) {
    const channel = await openPanel(action, label);
    const layout = await evaluate(channel, `({title:document.querySelector('#title').textContent,
      height:innerHeight, contentHeight:document.querySelector('.panel').getBoundingClientRect().height,
      buttonFont:parseFloat(getComputedStyle(document.querySelector('#content button')).fontSize),
      buttons:[...document.querySelectorAll('#content button')].map(n=>n.textContent.trim())})`);
    assert.ok(layout.contentHeight <= layout.height + 2, `${label} content overflows window`);
    assert.ok(layout.buttonFont <= 11, `${label} has oversized button text`);
    if (action === 'collect-menu') assert.equal(layout.buttons.length, 4);
    if (action === 'scope') {
      assert.equal(await evaluate(channel, 'document.querySelectorAll(".scope:disabled").length'), 0);
      const selected = await evaluate(channel, 'window.CompanionPopover.invoke("select-scope", {scope:"student"})');
      assert.equal(selected.ok, true);
      const project = await evaluate(channel, 'window.CompanionPopover.invoke("select-scope", {scope:"project",projectId:"demo-project-a"})');
      assert.equal(project.ok, true);
      const foreign = await evaluate(channel, 'window.CompanionPopover.invoke("select-scope", {scope:"project",projectId:"demo-project-b"})');
      assert.equal(foreign.ok, false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'agent-companion-settings.json'))).projectId, 'demo-project-a');
    }
    if (action === 'ai-settings') assert.deepEqual(layout.buttons, ['智能体人设', '目标智能体']);
    const shot = await channel('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(qa, `packaged-${action}.png`), Buffer.from(shot.data, 'base64'));
    panelChecks.push(layout);
  }
  // Click the actual AI settings submenu and wait for the target connection card.
  const settingsPage = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => /companion-popover\.html$/.test(p.url));
  const settingsChannel = await connect(settingsPage.webSocketDebuggerUrl);
  await evaluate(settingsChannel, 'setTimeout(()=>document.querySelector("[data-command=open-targets]").click(),0); true');
  let targetsReady = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    await sleep(100);
    const entry = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => /companion-popover\.html$/.test(p.url));
    if (!entry) continue;
    try { const channel = await connect(entry.webSocketDebuggerUrl); targetsReady = await evaluate(channel, 'document.querySelector("#title").textContent === "目标智能体" && document.querySelectorAll(".target").length > 0'); } catch {}
    if (targetsReady) break;
  }
  assert.equal(targetsReady, true);
  const verification = { ok: true, packageVersion: version, executableSha256: sha256, archivedFilesMatchSource, comparisonRoot,
    timing: { launchToVersionVisibleMs, boundary: 'Single isolated launch including portable extraction; not a universal performance guarantee.' }, asyncStatusParity,
    isolatedLaunch: { versionVisible: visible, storage, assetIndex: {
      health: assetSummary.health,
      total: assetSummary.total,
      referenceTotal: assetSummary.referenceTotal,
      pageSizeBounded: assetPage.items.length <= 100,
    }, skillLibraryBridge: {
      available: true,
      licensedSnapshotReached: Boolean(skillLibraryEnvelope.ok),
      scope: skillLibraryEnvelope.data?.scope || '',
      mcpEnabled: skillLibraryEnvelope.data?.mcpEnabled,
      pluginInstallEnabled: skillLibraryEnvelope.data?.pluginInstallEnabled,
      providers: (skillLibraryEnvelope.data?.providers || []).map(item => ({ providerId: item.providerId, canInstallSkill: item.canInstallSkill, exportOnly: item.canExport && !item.canInstallSkill })),
    }, toolbarReady: true, sessionBatchBridgeAvailable, noStudentActionsDisabled: true,
      compactHeight, toolbarContract, learningContract, visualSettings, customQuantityInitiallyHidden, customQuantityVisible, goalOnlySettings,
      syntheticStudentNameSwitch: true, logoLoaded: true, panelChecks, targetsReady,
      scopeSelection: 'student and owned project accepted; foreign project denied' },
    boundary: 'Real portable EXE startup with synthetic isolated students; physical camera, actual student license and real capture remain device acceptance items.', qa, testedAt: new Date().toISOString() };
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
