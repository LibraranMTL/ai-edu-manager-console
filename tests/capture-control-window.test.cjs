const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { captureControlBounds, loadVisibleCaptureControlWindow } = require('../electron/capture-control-window.cjs');

function fakeWindow(loadURL = () => new Promise(() => {})) {
  let visible = false;
  let destroyed = false;
  const calls = [];
  return {
    calls,
    loadURL: (url) => { calls.push(['loadURL', url]); return loadURL(url); },
    isVisible: () => visible,
    isDestroyed: () => destroyed,
    showInactive: () => { calls.push(['showInactive']); visible = true; },
    setAlwaysOnTop: (...args) => calls.push(['setAlwaysOnTop', ...args]),
    hide: () => { visible = false; },
    destroy: () => { destroyed = true; },
  };
}

test('capture control stays inside the work area of a secondary display', () => {
  assert.deepEqual(captureControlBounds({ x: -1920, y: 0, width: 1920, height: 1040 }, 450, 68), {
    width: 450, height: 68, x: -470, y: 952,
  });
});

test('capture control is revealed without waiting for ready-to-show', () => {
  const window = fakeWindow();
  loadVisibleCaptureControlWindow(window, '<button>结束</button>', () => true);
  assert.equal(window.isVisible(), true);
  assert.equal(window.calls[0][0], 'loadURL');
  assert.match(window.calls[0][1], /^data:text\/html;charset=utf-8,/);
  assert.deepEqual(window.calls[1], ['showInactive']);
  assert.deepEqual(window.calls[2], ['setAlwaysOnTop', true, 'floating']);
});

test('a completed load cannot reopen a stopped or replaced capture control', async () => {
  let finishLoad;
  const window = fakeWindow(() => new Promise((resolve) => { finishLoad = resolve; }));
  let current = true;
  loadVisibleCaptureControlWindow(window, '<p>采集中</p>', () => current);
  current = false;
  window.hide();
  finishLoad();
  await Promise.resolve();
  assert.equal(window.isVisible(), false);
  assert.equal(window.calls.filter(([name]) => name === 'showInactive').length, 1);
});

test('host uses one quick capture window while the student terminal keeps its capture control', () => {
  const root = path.resolve(__dirname, '..');
  const host = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const terminal = fs.readFileSync(path.join(root, 'electron', 'terminal-main.cjs'), 'utf8');
  assert.match(host, /screen\.getDisplayMatching\(mainWindow\.getBounds\(\)\)/);
  assert.match(host, /quickCaptureWindow = new BrowserWindow/);
  assert.match(host, /quick-capture-preload\.cjs/);
  assert.doesNotMatch(host, /captureControlWindow = new BrowserWindow/);
  assert.match(terminal, /screen\.getDisplayMatching\(mainWindow\.getBounds\(\)\)/);
  assert.match(terminal, /loadVisibleCaptureControlWindow\(window, captureControlHtml\(/);
});
