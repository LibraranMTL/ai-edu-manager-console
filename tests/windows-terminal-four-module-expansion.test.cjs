'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createTerminalAgentBridge } = require('../electron/terminal-agent-bridge.cjs');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Windows student four-module UI exposes the scoped companion and collection methods', () => {
  const ui = read('src', 'terminal-main.tsx');
  const preload = read('electron', 'terminal-preload.cjs');
  const main = read('electron', 'terminal-main.cjs');
  for (const label of ['资料搜集', '主机连接', '教育档案', '学习行动', '拍照', '录音', '知识点跟踪', '每周知识增长图']) assert.match(ui, new RegExp(label));
  assert.match(ui, /显示学习工具条/);
  assert.match(ui, /立即截屏并上传/);
  assert.match(preload, /showCompanion/);
  assert.match(preload, /uploadCapturedMedia/);
  assert.match(preload, /quickScreenshot/);
  assert.match(main, /windows_terminal_photo/);
  assert.match(main, /windows_terminal_audio/);
  assert.match(main, /windows_terminal_quick_screenshot/);
});

test('knowledge tracking and weekly growth sharing stay inside the student session', () => {
  const ui = read('src', 'terminal-main.tsx');
  const main = read('electron', 'terminal-main.cjs');
  assert.match(main, /requestJson\('\/api\/student-session\/learning-trajectory', \{ token: config\.sessionToken \}\)/);
  assert.match(ui, /不代表已经掌握或遗忘/);
  assert.match(ui, /exportGrowthImage\('copy'\)/);
  assert.match(ui, /exportGrowthImage\('save'\)/);
  assert.match(ui, /exportGrowthImage\('share'\)/);
});

test('external Agent bridge is personal-terminal-only and never copies host credentials into MCP config', () => {
  const main = read('electron', 'terminal-main.cjs');
  assert.match(main, /只有个人终端可以授权外部 Agent 查询/);
  assert.match(main, /scopePolicy: 'fixed_student'/);
  assert.match(main, /SCOPE_CHANGED/);
  const copy = main.slice(main.indexOf('function copyTerminalAgentBridgeConfig'), main.indexOf('function loadTerminalLearningCapabilities'));
  assert.doesNotMatch(copy, /sessionToken|hostUrl|config\.token/);
  assert.match(copy, /ELECTRON_RUN_AS_NODE/);
  assert.match(copy, /PORTABLE_EXECUTABLE_FILE/);
  assert.match(copy, /durableMcpScript/);
});

test('local Agent bridge binds loopback, uses a private credential file and revokes it on stop', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-agent-bridge-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const scope = { studentId: 'student-1', deviceId: 'device-1', hostId: 'host-1', dataGeneration: 'generation-1' };
  const bridge = createTerminalAgentBridge({ root: folder, currentScope: () => scope, invoke: async input => ({ ok: true, echo: input.action }) });
  const state = await bridge.start(scope);
  assert.equal(state.enabled, true);
  const descriptor = JSON.parse(fs.readFileSync(state.descriptorFile, 'utf8'));
  assert.match(descriptor.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/invoke$/);
  assert.equal(descriptor.studentId, 'student-1');
  assert.equal(Object.hasOwn(descriptor, 'hostUrl'), false);
  assert.equal(Object.hasOwn(descriptor, 'sessionToken'), false);
  const token = fs.readFileSync(state.credentialFile, 'utf8').trim();
  const response = await fetch(descriptor.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'query' }) });
  assert.deepEqual(await response.json(), { ok: true, echo: 'query' });
  await bridge.stop();
  assert.equal(fs.existsSync(state.credentialFile), false);
});

test('student installer includes companion and local Agent bridge runtime files', () => {
  const build = read('scripts', 'build-windows-terminal-release.cjs');
  for (const file of ['terminal-companion.html', 'terminal-companion-preload.cjs', 'terminal-companion-renderer.js', 'terminal-agent-bridge.cjs', 'terminal-agent-mcp.cjs']) {
    assert.match(build, new RegExp(file.replaceAll('.', '\\.')));
  }
});

test('external conversation shares are durable, single-instance and confirmation-gated', () => {
  const ui = read('src', 'terminal-main.tsx');
  const preload = read('electron', 'terminal-preload.cjs');
  const main = read('electron', 'terminal-main.cjs');
  assert.match(main, /ai-education-student:\/\//);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /setAsDefaultProtocolClient\('ai-education-student', path\.resolve\(portableExecutable\)\)/);
  assert.match(main, /conversation-import-drafts\.json/);
  assert.match(main, /writeJson\(conversationImportQueuePath\(\), \{ version: 1, drafts: pendingConversationImports \}\)/);
  assert.match(preload, /takeConversationImport/);
  assert.match(preload, /onConversationImport/);
  assert.match(ui, /请预览并确认后提交/);
  assert.match(ui, /conversationImportActiveRef/);
});

test('learning-cockpit UI keeps four modules, a home view and wide read-only document dialogs', () => {
  const ui = read('src', 'terminal-main.tsx');
  const css = read('src', 'terminal-styles.css');
  assert.match(ui, /type StudentPrimaryModule = 'collection' \| 'connection' \| 'archive' \| 'learning'/);
  assert.match(ui, /type StudentPrimaryView = 'home' \| StudentPrimaryModule/);
  assert.match(ui, /今天想做什么？/);
  assert.match(ui, /student-app-frame/);
  assert.match(ui, /student-reader-dialog/);
  assert.match(ui, /项目综合报告/);
  assert.match(css, /grid-template-columns: 214px minmax\(0, 1fr\)/);
  assert.match(css, /\.student-reader-backdrop/);
  assert.match(css, /@media print/);
});

test('archive owns knowledge tracking and planning while weekly growth has one learning entry', () => {
  const ui = read('src', 'terminal-main.tsx');
  const archiveStart = ui.indexOf("activePrimaryModule === 'archive' ? <section");
  const learningStart = ui.indexOf("activePrimaryModule === 'learning' ? <section", archiveStart);
  const learningEnd = ui.indexOf('</section> : null}', learningStart);
  const archive = ui.slice(archiveStart, learningStart);
  const learning = ui.slice(learningStart, learningEnd);
  assert.match(archive, /title="知识点跟踪"/);
  assert.match(archive, /title="规划指导"/);
  assert.doesNotMatch(learning, /title="知识点跟踪"|title="规划指导"/);
  assert.match(learning, /title="学习状态与每周成长"/);
  assert.doesNotMatch(learning, /title="每周知识增长图"/);
});

test('conversation collection combines explicit AI share import with personal-session auto capture', () => {
  const ui = read('src', 'terminal-main.tsx');
  assert.match(ui, /title="对话采集"/);
  assert.match(ui, /AI 对话分享导入/);
  assert.match(ui, /会话自动采集/);
  assert.match(ui, /其他 AI 应用分享/);
  assert.match(ui, /共享终端不支持自动会话采集/);
});

test('student companion learning opens the host-style second-level menu and exposes project tutor', () => {
  const toolbar = read('electron', 'terminal-companion.html');
  const terminalMain = read('electron', 'terminal-main.cjs');
  const popover = read('electron', 'companion-popover-renderer.js');
  const build = read('scripts', 'build-windows-terminal-release.cjs');
  assert.match(toolbar, /data-action="learning"/);
  assert.match(toolbar, /data-action="project-tutor"/);
  assert.match(terminalMain, /MODE_GROUPS: COMPANION_MODE_GROUPS/);
  assert.match(terminalMain, /showTerminalCompanionPopover\(value\)/);
  assert.match(terminalMain, /createCompanionPromptPacket/);
  assert.match(terminalMain, /项目引导/);
  assert.match(popover, /renderProjectTutor/);
  for (const file of ['companion-popover.html', 'companion-popover-preload.cjs', 'companion-popover-renderer.js', 'companion-toolbar.cjs']) {
    assert.match(build, new RegExp(file.replaceAll('.', '\\.')));
  }
});

test('course isolation view follows the rendered capture toolbar and keeps native capture controls topmost', () => {
  const ui = read('src', 'terminal-main.tsx');
  const preload = read('electron', 'terminal-preload.cjs');
  const main = read('electron', 'terminal-main.cjs');
  assert.match(ui, /courseBrowserAnchorRef/);
  assert.match(ui, /getBoundingClientRect\(\)\.bottom/);
  assert.match(preload, /setCourseViewTop/);
  assert.match(main, /terminal:set-course-view-top/);
  assert.match(main, /courseViewTop = 300/);
  assert.match(main, /captureControlWindow\.setAlwaysOnTop\(true, 'screen-saver'\)/);
});
