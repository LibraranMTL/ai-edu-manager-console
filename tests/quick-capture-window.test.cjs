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
  assert.equal(routeForAction('archive'), 'learning-materials');
  assert.equal(routeForAction('../settings'), '');
  assert.equal(routeForAction('record-video'), '');
  assert.equal(normalizeQuickCaptureAction('audio'), 'audio');
  assert.equal(normalizeQuickCaptureAction('record-video'), '');
});

test('learning archive toolbar action opens the current student learning archive page', () => {
  const host = read('electron', 'main.cjs');
  const ui = read('src', 'main.tsx');
  assert.doesNotMatch(host, /\['digest', 'flashcards', 'quiz', 'mindmap', 'archive'\]\.includes\(action\)/);
  assert.match(ui, /'learning-materials': 'archive'/);
  assert.match(ui, /tabId === 'learning-materials' \? 'learning' : 'collection'/);
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
  assert.match(html, /data-action="collect-menu"/);
  assert.match(renderer, /button\.dataset\.action === state\.activeAction/);
  assert.match(renderer, /classList\.toggle\('selected', selected\)/);
  assert.match(host, /quickCaptureActiveAction = action/);
  assert.match(host, /activeAction: quickCaptureActiveAction/);
});

test('agent companion toolbar uses approved single-row micro sizes', () => {
  const html = read('electron', 'quick-capture.html');
  const host = read('electron', 'main.cjs');
  assert.match(host, /QUICK_CAPTURE_COLLAPSED_HEIGHT = 29/);
  assert.match(host, /QUICK_CAPTURE_EXPANDED_HEIGHT = 29/);
  assert.match(host, /QUICK_CAPTURE_MIN_WIDTH = 252/);
  assert.match(host, /QUICK_CAPTURE_PREFERRED_WIDTH = 288/);
  assert.match(host, /frame: false, useContentSize: true/);
  assert.match(host, /quickCaptureExpanded \? QUICK_CAPTURE_EXPANDED_HEIGHT : QUICK_CAPTURE_COLLAPSED_HEIGHT/);
  assert.match(host, /function resizeQuickCaptureWindow\(width, height\)/);
  assert.match(host, /window\.setBounds\(next, false\)/);
  assert.match(host, /current\.width !== width \|\| current\.height !== height/);
  assert.match(host, /\}, 80\)/);
  assert.doesNotMatch(host, /quickCaptureWindow\.setSize\(activeCaptureRuntime/);
  assert.match(html, /\.shell\{height:100%;padding:1px/);
  assert.match(html, /\.bar\{display:flex;align-items:center;gap:0;height:26px;min-height:26px/);
  assert.doesNotMatch(html, /\.action \.label\{display:none/);
  assert.match(html, /data-action="collect-menu"/);
  assert.match(html, /data-action="organize-menu"/);
  assert.match(html, /data-action="learning"/);
  assert.doesNotMatch(html, /id="learning-row"/);
});

test('recording is a page route, not a second floating recorder or video recording', () => {
  const html = read('electron', 'quick-capture.html');
  const popoverRenderer = read('electron', 'companion-popover-renderer.js');
  const host = read('electron', 'main.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(html, /data-action="collect-menu"/);
  assert.match(popoverRenderer, /\['audio','录音采集'\]/);
  assert.match(html, /data-action="capture-inbox"/);
  assert.doesNotMatch(html, /录音跳转主机页面/);
  assert.doesNotMatch(html, /MediaRecorder|data-action="record-video"/);
  assert.match(host, /event\.sender !== quickCaptureWindow\.webContents/);
  assert.match(host, /getCaptureInbox\(\)\.listStored\(studentId\)/);
  assert.match(host, /不能把快捷采集工具条自身作为采集来源/);
  assert.match(ui, /onQuickCaptureNavigate/);
  assert.match(ui, /'audio-capture': 'audio-capture'/);
});

test('agent companion production surface keeps AI settings last and removes target and ellipsis controls', () => {
  const html = read('electron', 'quick-capture.html');
  const popover = read('electron', 'companion-popover.html');
  const popoverRenderer = read('electron', 'companion-popover-renderer.js');
  const preload = read('electron', 'companion-popover-preload.cjs');
  const host = read('electron', 'main.cjs');
  for (const action of ['collect-menu', 'organize-menu', 'learning', 'ai-settings']) {
    assert.match(html, new RegExp(`data-action="${action}"`));
  }
  assert.ok(html.indexOf('data-action="ai-settings"') > html.indexOf('data-action="learning"'));
  assert.ok(html.indexOf('data-action="hide"') > html.indexOf('data-action="ai-settings"'));
  assert.doesNotMatch(html, /data-action="targets"|data-action="more"|>⋯<|>•••</);
  assert.match(popoverRenderer, /renderCollect/);
  assert.match(popoverRenderer, /renderOrganize/);
  assert.match(popoverRenderer, /toolbar-action/);
  assert.match(popover, /Agent 伴侣/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(host, /nodeIntegration: false, sandbox: true/);
  assert.match(host, /event\.sender !== quickCapturePopoverWindow\.webContents/);
  assert.doesNotMatch(`${html}\n${read('electron', 'quick-capture-renderer.js')}`, /new KeyboardEvent|dispatchEvent\([^)]*keydown|sendKeys/i);
});

test('learning mode form adapts visual, verification and planning settings', () => {
  const renderer = read('electron', 'companion-popover-renderer.js');
  const host = read('electron', 'main.cjs');
  assert.match(renderer, /selectedAction\.configMode==='visual'/);
  assert.match(renderer, /\['1','1张'\].*\['2','2张'\].*\['auto','自动'\].*\['custom','自定义'\]/);
  assert.match(renderer, /\['simple','简洁'\].*\['standard','标准'\].*\['anime','动漫'\]/);
  assert.match(renderer, /selectedAction\.configMode!=='goal'/);
  assert.match(renderer, /customQuantity/);
  assert.match(host, /\['verify', 'plan'\]/);
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
