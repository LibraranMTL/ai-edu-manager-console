const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const terminal = fs.readFileSync(path.join(root, 'electron', 'terminal-main.cjs'), 'utf8');
const terminalUi = fs.readFileSync(path.join(root, 'src', 'terminal-main.tsx'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('Windows student capture automatically persists delivery and closes the host session', () => {
  assert.match(terminal, /capture-delivery-queue\.json/);
  assert.match(terminal, /runCaptureDeliveryQueue/);
  assert.match(terminal, /notifyCaptureSessionComplete/);
  assert.match(terminal, /CAPTURE_DELIVERY_RETRY_DELAYS/);
  assert.match(host, /handleRemoteCaptureSessionComplete/);
  assert.match(host, /scheduleCaptureTimelineSemanticProcessing\(completed/);
  assert.match(host, /capture-sessions\\\/\(\[\^\/]\+\)\\\/complete/);
  assert.match(terminalUi, /系统正在后台送达并整理，无需再次确认/);
  assert.doesNotMatch(terminalUi, />确认入库</);
});

test('remote capture frames stay outside raw digestion until one semantic bundle is published', () => {
  assert.match(host, /captureInboxRootPath\(\)/);
  assert.match(host, /skipMaterialRegistration: Boolean\(remoteCapture\)/);
  assert.match(host, /role: remoteCapture \? 'capture_candidate' : 'project_raw'/);
  assert.match(host, /importedCount > 0 && !remoteCapture/);
});

test('host and student capture both exclude sensitive application windows', () => {
  assert.match(host, /isSensitiveCaptureSourceName/);
  assert.match(terminal, /SENSITIVE_CAPTURE_SOURCE_PATTERN/);
  assert.match(terminal, /该窗口可能包含密码、凭据或私人通信，已自动排除/);
  assert.match(terminalUi, /disabled=\{source\.blocked \|\| source\.available === false\}/);
});

test('resource scheduling uses measured latency, disk, cpu, memory, power and idle state', () => {
  assert.match(host, /fs\.statfsSync/);
  assert.match(host, /os\.cpus\(\)/);
  assert.match(host, /cpuPercent/);
  assert.match(host, /rendererLatencyMs/);
  assert.match(preload, /reportCaptureTimelinePerformance/);
  assert.match(ui, /performance\.now\(\) - performanceStartedAt/);
});

test('knowledge and growth views can navigate back to exact timeline evidence', () => {
  assert.match(preload, /getCaptureTimelineKnowledgeLinks/);
  assert.match(host, /getCaptureTimelineKnowledgeLinks/);
  assert.match(ui, /openKnowledgeTimeline/);
  assert.match(ui, /学习时间线来源/);
  assert.match(ui, /时间线来源/);
});

test('activity duration closure keeps complete samples, frame coverage and student-safe SVG reports', () => {
  assert.match(terminal, /capture-samples\.index\.json/);
  assert.match(terminal, /writeCaptureSampleIndex\(activeCapture\)/);
  assert.match(terminal, /contentHash,\s*path: target/);
  assert.match(terminal, /decision: 'capture_error'/);
  assert.match(host, /rebuildSessionTimeline\(captureCenterRootPath\(\), completed\)/);
  assert.match(ui, /<svg className="capture-activity-track"/);
  assert.match(ui, /captureTimelineRequestRef/);
  assert.match(ui, /requestStudentId === selectedStudentIdRef\.current/);
});
