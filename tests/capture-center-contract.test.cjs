const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'AndroidManifest.xml'), 'utf8');
const androidMain = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');
const captureService = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'CaptureProjectionService.java'), 'utf8');

test('Windows capture API is bridged end to end', () => {
  for (const method of ['listCaptureSources', 'startCaptureSession', 'pauseCaptureSession', 'resumeCaptureSession', 'highlightCaptureSession', 'stopCaptureSession', 'promoteCaptureSession']) {
    assert.match(main, new RegExp(`bridge:${method}`));
    assert.match(preload, new RegExp(`${method}\\(`));
    assert.match(ui, new RegExp(method));
  }
  assert.match(main, /desktopCapturer\.getSources/);
  assert.match(main, /status: 'candidate'/);
  assert.match(main, /function promoteCaptureSession/);
  assert.match(main, /addUploadRecords\(records\)/);
});

test('capture candidates do not enter student raw storage before promotion', () => {
  const start = main.indexOf('async function captureFrame');
  const end = main.indexOf('function scheduleCaptureRuntime', start);
  const captureFrame = main.slice(start, end);
  assert.match(captureFrame, /runtime\.session\.inboxPath/);
  assert.match(captureFrame, /role: 'capture_candidate'/);
  assert.doesNotMatch(captureFrame, /getRawDir/);
  assert.doesNotMatch(captureFrame, /addUploadRecords/);
});

test('Android uses explicit MediaProjection foreground service and quick tile', () => {
  assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PROJECTION/);
  assert.match(manifest, /foregroundServiceType="mediaProjection"/);
  assert.match(manifest, /BIND_QUICK_SETTINGS_TILE/);
  assert.match(androidMain, /createScreenCaptureIntent/);
  assert.match(androidMain, /REQUEST_SCREEN_CAPTURE/);
  assert.match(captureService, /getMediaProjection/);
  assert.match(captureService, /startForeground/);
  assert.match(captureService, /ACTION_HIGHLIGHT/);
  assert.match(captureService, /visualChangeThreshold/);
});

test('capture UI follows setup, live control, review, and promotion sequence', () => {
  const setup = ui.indexOf('capture-setup-grid');
  const live = ui.indexOf('capture-live-strip');
  const sessions = ui.indexOf('capture-session-list');
  assert.ok(setup > 0);
  assert.ok(live > 0);
  assert.ok(sessions > setup);
  assert.match(ui, /晋升资料/);
  assert.match(ui, /打开采集箱/);
});
