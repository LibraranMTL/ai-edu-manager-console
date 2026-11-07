const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const ui = read('src', 'terminal-main.tsx');
const preload = read('electron', 'terminal-preload.cjs');
const main = read('electron', 'terminal-main.cjs');

test('manual upload remains available in personal and shared student terminal modes', () => {
  const gridStart = ui.indexOf('<section className="student-action-grid"');
  const grid = ui.slice(gridStart, ui.indexOf('</section>', gridStart));
  const uploadIndex = grid.indexOf('title="上传资料"');
  const modeSpecificIndex = grid.indexOf("config.terminalMode === 'personal'");
  assert.ok(uploadIndex > 0, 'manual upload tile should stay in the shared action grid');
  assert.ok(modeSpecificIndex > uploadIndex, 'manual upload must not be conditional on personal-terminal mode');
  assert.match(grid, /title="自动投递"/);
  assert.match(ui, /共享终端不会持续监测文件夹/);
});

test('Windows student terminal groups functions under five primary modules with a separately scoped project workspace', () => {
  assert.match(ui, /type StudentPrimaryModule = 'collection' \| 'connection' \| 'archive' \| 'learning' \| 'project'/);
  assert.match(ui, /aria-label="学生端五个模块"/);
  assert.match(ui, /资料搜集/);
  assert.match(ui, /主机连接/);
  assert.match(ui, /教育档案/);
  assert.match(ui, /学习行动/);
  assert.match(ui, /项目管理/);
  assert.match(ui, /aria-label="资料搜集功能"/);
  assert.match(ui, /aria-label="教育档案功能"/);
  assert.match(ui, /aria-label="学习行动功能"/);
  assert.match(ui, /aria-label="项目管理功能"/);
  assert.match(ui, /主机连接与学生空间/);
  assert.match(ui, /学生端五个模块/);
  assert.match(ui, /项目资料与知识只读取当前学生本人已关联项目/);
});

test('Windows student terminal reads reports and archives through the scoped student session', () => {
  assert.match(preload, /listLearningReports/);
  assert.match(preload, /readLearningReport/);
  assert.match(preload, /listArchiveFiles/);
  assert.match(preload, /readArchiveFile/);
  assert.match(main, /currentStudentSession/);
  assert.match(main, /\/api\/students\/\$\{encodeURIComponent\(studentId\)\}\/reports/);
  assert.match(main, /\/api\/students\/\$\{encodeURIComponent\(studentId\)\}\/archive\/files/);
  assert.match(ui, /成长模型、学情报告与教育档案只读取当前学生自己的内容/);
  assert.match(ui, /只读取当前学生/);
});

test('Windows student home provides a bounded learning workbench and clickable material-statistics share image', () => {
  assert.match(ui, /我的学情工作台/);
  assert.match(ui, /今天最值得推进的一件事/);
  assert.match(ui, /本周行动/);
  assert.match(ui, /重点项目/);
  assert.match(ui, /五维学情/);
  assert.match(ui, /我的资料统计图/);
  assert.match(ui, /materialStatsSvg\(selectedStudent, knowledgeProjects\.length, dashboardWeek\)/);
  assert.match(ui, /exportStudentMaterialStatsImage/);
  assert.match(preload, /exportStudentMaterialStatsImage/);
  assert.match(main, /terminal:export-student-material-stats-image/);
});

test('Windows student exposes existing companion modes from their appropriate workspaces', () => {
  assert.match(ui, /title="学习导师"/);
  assert.match(ui, /openCompanionPanel\('learning'\)/);
  assert.match(ui, /title="项目导师"/);
  assert.match(ui, /openCompanionPanel\('project-tutor'\)/);
  assert.match(preload, /showCompanionPanel/);
  assert.match(main, /terminal:show-companion-panel/);
});

test('Windows student terminal capture opens a floating setup panel and a native topmost control bar', () => {
  const build = read('scripts', 'build-windows-terminal-release.cjs');
  assert.match(ui, /className="student-capture-flyout"/);
  assert.match(ui, /采集策略/);
  assert.match(ui, /最长采集时长/);
  assert.match(ui, /mode: captureMode/);
  assert.match(ui, /durationMinutes: captureDuration/);
  assert.match(ui, /右下角浮动控制条可暂停、重点截取或结束/);
  assert.match(main, /normalizeCaptureOptions\(input\)/);
  assert.match(main, /captureControlWindow = new BrowserWindow/);
  assert.match(main, /loadVisibleCaptureControlWindow\(window, captureControlHtml\(activeCapture\)/);
  assert.match(main, /screen\.getDisplayMatching\(mainWindow\.getBounds\(\)\)/);
  assert.match(main, /duration_complete/);
  assert.match(main, /terminal:capture-control/);
  assert.match(preload, /captureControl/);
  assert.match(build, /capture-protocol\.cjs/);
  assert.match(build, /capture-control-window\.cjs/);
});
