'use strict';
// Isolated Electron acceptance harness. Loads production window/action functions;
// only students, screenshot acquisition and camera hardware are synthetic.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright', 'quick-capture-direct-20261006');
const fixtureRoot = path.join(output, 'fixtures', String(Date.now()));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'user-data'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('no-proxy-server');
const source = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const { createCaptureInbox } = require('../electron/capture-inbox.cjs');
const inbox = createCaptureInbox({ resolveStudentDir: async id => path.join(fixtureRoot, id), deliver: async () => { throw Error('No automatic delivery permitted'); } });
const checks = [];
let scope;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await sleep(100); }
  throw Error(`Timed out: ${label}`);
}
const run = (win, code) => win.webContents.executeJavaScript(code, true);
async function click(win, id) { await run(win, `document.querySelector(${JSON.stringify(id)}).click()`); await sleep(150); }
async function capture(win, name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(250);
    try { const screenshot = await win.capturePage(); fs.writeFileSync(path.join(output, `${name}.png`), screenshot.toPNG()); return; }
    catch (error) { if (attempt === 4) throw error; }
  }
}
function check(name, condition) { assert.ok(condition, name); checks.push(name); }
// Windows non-integral display scaling rounds outer bounds by a few logical pixels.
const heightNear = (window, height) => Math.abs(window.getSize()[1] - height) <= 3;

app.whenReady().then(async () => {
  const modules = createRequire(path.join(root, 'electron', 'main.cjs'));
  scope = vm.createContext({ BrowserWindow, screen, fs, path, crypto: require('node:crypto'), console, setTimeout, clearTimeout,
    __dirname: path.join(root, 'electron'), require: modules,
    ...require('../electron/quick-capture-window.cjs'), ...require('../electron/capture-control-window.cjs'),
    ...require('../electron/quick-capture-direct.cjs'),
    app, quickCaptureWindow: null, quickCaptureLoaded: false, quickCaptureEnabled: true, quickCaptureExpanded: false,
    quickCaptureActiveAction: '', quickCaptureSetupOpen: false, quickCaptureDirect: null, quickPhotoWindow: null, quickPhotoContext: null,
    quickCaptureStudentId: 'qa-a', quickCaptureStudentName: '测试学生甲', quickCaptureDismissedSessionId: '', quickCapturePendingCount: 0,
    quickCaptureCountStatus: 'unknown', quickCaptureCountStudentId: '', quickCapturePosition: null, activeCaptureRuntime: null,
    QUICK_CAPTURE_COLLAPSED_HEIGHT: 72, QUICK_CAPTURE_EXPANDED_HEIGHT: 160,
    mainWindow: null, updateCaptureTray() {}, writeJsonAtomic(file, data) { fs.writeFileSync(file, JSON.stringify(data)); },
    readStudentsIndex: () => [{ id: 'qa-a', name: '测试学生甲' }, { id: 'qa-b', name: '测试学生乙' }],
    readProjects: () => [{ id: 'qa-project', name: '测试项目', studentIds: ['qa-a'] }],
    licenseRequiredJson: () => '', getCaptureInbox: () => inbox, showMainWindow: () => { throw Error('Unexpected main-window navigation'); },
    listCaptureSources: async () => JSON.stringify({ ok: true, sources: Array.from({ length: 8 }, (_, i) => ({ id: `screen:${i}`, name: `合成验收来源 ${i + 1}`, type: i < 2 ? 'screen' : 'window', thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', blocked: i === 7, blockReason: i === 7 ? '敏感窗口' : '' })) }),
    startCaptureSession: async (json, validate) => {
      validate(); const input = JSON.parse(json);
      scope.activeCaptureRuntime = { session: { ...input, studentName: '测试学生甲', id: 'qa-session', status: 'capturing', screenshotCount: 1, sourceName: '合成验收窗口' } };
      scope.updateCaptureControlWindow(); return JSON.stringify({ ok: true });
    },
    pauseCaptureSession: async () => { scope.activeCaptureRuntime.session.status = 'paused'; scope.sendQuickCaptureState(); return '{"ok":true}'; },
    resumeCaptureSession: async () => { scope.activeCaptureRuntime.session.status = 'capturing'; scope.sendQuickCaptureState(); return '{"ok":true}'; },
    stopCaptureSession: async () => { scope.activeCaptureRuntime = null; scope.updateCaptureControlWindow(); return '{"ok":true}'; },
    highlightCaptureSession: async () => { scope.activeCaptureRuntime.session.screenshotCount++; scope.sendQuickCaptureState(); return '{"ok":true}'; },
    openCaptureInbox: () => '{"ok":true}',
  });
  vm.runInContext(source.slice(source.indexOf('function updateCaptureControlWindow()'), source.indexOf('async function listCaptureSources()')), scope);
  scope.ipcMain = ipcMain;
  vm.runInContext(source.slice(source.indexOf("ipcMain.handle('quick-capture:action'"), source.indexOf("ipcMain.on('bridge:setCaptureVisionConsent'")), scope);
  scope.updateCaptureControlWindow();
  await until(() => scope.quickCaptureLoaded, 'toolbar ready');
  const bar = scope.quickCaptureWindow;
  console.log('Initial toolbar bounds', bar.getBounds(), 'content', bar.getContentBounds(), 'display scale', screen.getDisplayMatching(bar.getBounds()).scaleFactor);
  await capture(bar, '01-collapsed');
  check('initial toolbar requests slim 72px height (DPI rounding <=3px)', heightNear(bar, 72));
  await click(bar, '[data-action="screen"]');
  await until(() => run(bar, 'document.querySelectorAll(".source").length === 8'), 'source selector');
  check('screen setup expands within toolbar', heightNear(bar, 500));
  check('start requires source selection', await run(bar, 'document.getElementById("start-screen").disabled'));
  check('blocked source disabled', await run(bar, 'document.querySelectorAll(".source")[7].disabled'));
  await click(bar, '.source');
  scope.sendQuickCaptureState(); await sleep(100);
  check('source selection survives state refresh', await run(bar, 'document.querySelector(".source").getAttribute("aria-pressed") === "true"'));
  await capture(bar, '02-screen-setup');
  check('screen start button fits viewport', await run(bar, 'document.getElementById("start-screen").getBoundingClientRect().bottom <= innerHeight'));
  await click(bar, '#start-screen');
  await until(() => Boolean(scope.activeCaptureRuntime), 'screen started');
  check('screen started for correct student', scope.activeCaptureRuntime.session.studentId === 'qa-a');
  check('setup collapses on start', heightNear(bar, 72));
  await click(bar, '[data-action="pause"]'); check('pause direct', scope.activeCaptureRuntime.session.status === 'paused');
  await click(bar, '[data-action="pause"]'); check('resume direct', scope.activeCaptureRuntime.session.status === 'capturing');
  await click(bar, '[data-action="highlight"]'); check('highlight direct', scope.activeCaptureRuntime.session.screenshotCount === 2);
  await capture(bar, '03-screen-active');
  await click(bar, '[data-action="stop"]'); check('stop direct', scope.activeCaptureRuntime === null);
  await click(bar, '[data-action="screen"]'); await click(bar, '[data-action="close-screen"]');
  check('closing setup restores slim toolbar', heightNear(bar, 72));
  await click(bar, '[data-action="more"]'); await click(bar, '[data-action="more"]');
  check('more opens and collapses to 72', heightNear(bar, 72));
  await click(bar, '[data-action="photo"]');
  await until(() => scope.quickPhotoWindow?.isVisible(), 'photo window');
  const photo = scope.quickPhotoWindow;
  await until(() => run(photo, '!document.getElementById("open").disabled'), 'photo context');
  await capture(photo, '04-camera-idle');
  await click(photo, '#open');
  await until(() => run(photo, '!document.getElementById("take").hidden'), 'fake camera opened');
  check('camera permission accepts video only', await run(photo, 'document.getElementById("camera").srcObject.getAudioTracks().length === 0'));
  check('camera window denies microphone permission', await run(photo, 'navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { s.getTracks().forEach(t => t.stop()); return false; }, e => e.name === "NotAllowedError")'));
  check('toolbar rejects commands from photo renderer', !(await scope.handleQuickCaptureAction({ sender: photo.webContents }, 'screen')).ok);
  await capture(photo, '05-camera-preview');
  await click(photo, '#take');
  await until(() => run(photo, '!document.getElementById("save").hidden'), 'shot ready');
  check('camera released after shutter', await run(photo, 'document.getElementById("camera").srcObject === null'));
  check('shutter does not save automatically', (await inbox.listStored('qa-a')).length === 0);
  await capture(photo, '06-shot-confirm');
  scope.quickCaptureStudentId = 'qa-b'; scope.quickCaptureStudentName = '测试学生乙'; scope.sendQuickCaptureState();
  await click(photo, '#save');
  await until(async () => (await inbox.listStored('qa-a')).length === 1, 'photo saved');
  check('photo stays with original student after switch', (await inbox.listStored('qa-b')).length === 0);
  await capture(photo, '07-saved');
  check('photo controls fit viewport', await run(photo, 'document.getElementById("close").getBoundingClientRect().bottom <= innerHeight'));
  await click(photo, '#retake'); await until(() => run(photo, '!document.getElementById("take").hidden'), 'retake');
  await click(photo, '#stop'); check('camera stop releases stream', await run(photo, 'document.getElementById("camera").srcObject === null'));
  photo.webContents.session.setPermissionCheckHandler(() => false);
  photo.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await click(photo, '#open');
  await until(() => run(photo, 'document.getElementById("message").textContent.includes("拒绝")'), 'permission denial message');
  check('camera denial leaves retry available and no active stream', await run(photo, '!document.getElementById("open").disabled && document.getElementById("camera").srcObject === null'));
  await capture(photo, '08-camera-denied');
  await click(photo, '#close'); await until(() => scope.quickPhotoWindow === null, 'photo closed');
  check('photo window session revoked on close', scope.quickPhotoContext === null);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: true, syntheticHardware: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }, null, 2));
}).catch(error => {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: false, checks, error: error.stack }, null, 2));
  console.error(error); process.exitCode = 1;
}).finally(() => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(process.exitCode || 0); });
