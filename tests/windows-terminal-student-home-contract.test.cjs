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
  const uploadIndex = grid.indexOf('title="上传学习资料"');
  const modeSpecificIndex = grid.indexOf("config.terminalMode === 'personal'");
  assert.ok(uploadIndex > 0, 'manual upload tile should stay in the shared action grid');
  assert.ok(modeSpecificIndex > uploadIndex, 'manual upload must not be conditional on personal-terminal mode');
  assert.match(grid, /title="自动投递"/);
  assert.match(ui, /共享终端不会持续监测文件夹/);
});

test('Windows student terminal reads reports and archives through the scoped student session', () => {
  assert.match(preload, /listLearningReports/);
  assert.match(preload, /readLearningReport/);
  assert.match(preload, /listArchiveFiles/);
  assert.match(preload, /readArchiveFile/);
  assert.match(main, /currentStudentSession/);
  assert.match(main, /\/api\/students\/\$\{encodeURIComponent\(studentId\)\}\/reports/);
  assert.match(main, /\/api\/students\/\$\{encodeURIComponent\(studentId\)\}\/archive\/files/);
  assert.match(ui, /学情报告、教育档案与项目知识/);
  assert.match(ui, /只读取当前学生/);
});
