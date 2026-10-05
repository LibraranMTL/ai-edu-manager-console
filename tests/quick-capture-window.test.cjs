'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { routeForAction, normalizeQuickCaptureAction, clampQuickCaptureBounds, locateQuickCaptureBounds, publicQuickCaptureState } = require('../electron/quick-capture-window.cjs');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('quick capture routes only known collection actions', () => {
  assert.equal(routeForAction('audio'), 'audio-capture');
  assert.equal(routeForAction('import'), 'materials-import');
  assert.equal(routeForAction('inbox'), 'share-capture');
  assert.equal(routeForAction('automatic'), 'session-auto-capture');
  assert.equal(routeForAction('../settings'), '');
  assert.equal(routeForAction('record-video'), '');
  assert.equal(normalizeQuickCaptureAction('audio'), 'audio');
  assert.equal(normalizeQuickCaptureAction('record-video'), '');
});

test('quick capture stays on negative-coordinate secondary displays', () => {
  assert.deepEqual(clampQuickCaptureBounds({ x: -1920, y: 0, width: 1920, height: 1040 }, { x: -3000, y: 1400, width: 520, height: 160 }),
    { x: -1920, y: 880, width: 520, height: 160 });
  assert.deepEqual(clampQuickCaptureBounds({ x: 0, y: 0, width: 1280, height: 720 }, { x: 1000, y: 660, width: 520, height: 86 }),
    { x: 760, y: 634, width: 520, height: 86 });
  assert.deepEqual(clampQuickCaptureBounds({ x: -1920, y: 0, width: 1920, height: 1040 }, { x: 0, y: 0, width: 520, height: 86 }),
    { x: -520, y: 0, width: 520, height: 86 });
});

test('explicit locate places the toolbar inside and near the current main window', () => {
  assert.deepEqual(locateQuickCaptureBounds({ x: 100, y: 60, width: 1200, height: 760 },
    { x: 0, y: 0, width: 1920, height: 1040 }, 520, 86),
  { x: 440, y: 132, width: 520, height: 86 });
  assert.deepEqual(locateQuickCaptureBounds({ x: -1800, y: 0, width: 900, height: 800 },
    { x: -1920, y: 0, width: 1920, height: 1040 }, 520, 160),
  { x: -1610, y: 72, width: 520, height: 160 });
});

test('quick capture state omits paths, screenshots and student records', () => {
  const state = publicQuickCaptureState({
    student: { id: 's-1', name: '测试学生', phone: '123456' },
    session: { id: 'cap-1', studentId: 's-1', status: 'capturing', screenshotCount: 3, sourceName: '课堂窗口', inboxPath: 'D:/private', items: ['secret'] },
    visible: true, expanded: false, activeAction: 'photo', pendingCount: 2, countStatus: 'ready',
  });
  assert.equal(state.studentId, 's-1');
  assert.equal(state.capture.screenshotCount, 3);
  assert.equal(state.pendingCount, 2);
  assert.equal(state.activeAction, 'photo');
  assert.doesNotMatch(JSON.stringify(state), /123456|private|secret/);
});

test('quick capture uses mutually exclusive selected styles instead of a permanent screen primary style', () => {
  const html = read('electron', 'quick-capture.html');
  const renderer = read('electron', 'quick-capture-renderer.js');
  const host = read('electron', 'main.cjs');
  assert.doesNotMatch(html, /action primary needs-student/);
  assert.match(html, /\.action\.selected/);
  assert.match(html, /data-action="screen" aria-pressed="false"/);
  assert.match(renderer, /button\.dataset\.action === state\.activeAction/);
  assert.match(renderer, /classList\.toggle\('selected', selected\)/);
  assert.match(host, /quickCaptureActiveAction = action/);
  assert.match(host, /activeAction: quickCaptureActiveAction/);
});

test('collapsed quick capture toolbar is shorter and expands only for more actions', () => {
  const html = read('electron', 'quick-capture.html');
  const host = read('electron', 'main.cjs');
  assert.match(host, /QUICK_CAPTURE_COLLAPSED_HEIGHT = 72/);
  assert.match(host, /QUICK_CAPTURE_EXPANDED_HEIGHT = 160/);
  assert.match(host, /quickCaptureExpanded \? QUICK_CAPTURE_EXPANDED_HEIGHT : QUICK_CAPTURE_COLLAPSED_HEIGHT/);
  assert.match(host, /function resizeQuickCaptureWindow\(width, height\)/);
  assert.match(host, /window\.setBounds\(next, false\)/);
  assert.match(host, /current\.width !== width \|\| current\.height !== height/);
  assert.match(host, /\}, 80\)/);
  assert.doesNotMatch(host, /quickCaptureWindow\.setSize\(activeCaptureRuntime/);
  assert.match(html, /\.shell\{height:100%;padding:5px 10px/);
  assert.match(html, /\.bar\{display:flex;align-items:center;gap:7px;min-height:56px/);
});

test('recording is a page route, not a second floating recorder or video recording', () => {
  const html = read('electron', 'quick-capture.html');
  const host = read('electron', 'main.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(html, /data-action="audio"/);
  assert.match(html, /data-action="capture-inbox"/);
  assert.match(html, /录音跳转主机页面/);
  assert.doesNotMatch(html, /MediaRecorder|data-action="record-video"/);
  assert.match(host, /event\.sender !== quickCaptureWindow\.webContents/);
  assert.match(host, /getCaptureInbox\(\)\.listStored\(studentId\)/);
  assert.match(host, /不能把快捷采集工具条自身作为采集来源/);
  assert.match(ui, /onQuickCaptureNavigate/);
  assert.match(ui, /'audio-capture': 'audio-capture'/);
});

test('explicit show relocates, foregrounds and acknowledges the floating window', () => {
  const host = read('electron', 'main.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(host, /setQuickCaptureEnabled\(true, \{ locate: true \}\)/);
  assert.match(host, /locateQuickCaptureBounds\(mainBounds, display\.workArea/);
  assert.match(host, /transparent: false, backgroundColor: '#f8fcfa'/);
  assert.doesNotMatch(host, /quickCaptureWindow\.setContentProtection|window\.setContentProtection/);
  assert.match(host, /window\.setOpacity\(1\)/);
  assert.match(host, /window\.moveTop\(\)/);
  assert.match(host, /window\.focus\(\)/);
  assert.match(host, /ok: window\.isVisible\(\)/);
  assert.match(host, /!qaIsolated \|\| !process\.argv\.includes\('--qa-show-quick-capture'\)/);
  assert.match(ui, /显示／定位快捷采集工具条/);
  assert.match(ui, /快捷采集工具条已显示在教育管家主窗口上方区域/);
});
