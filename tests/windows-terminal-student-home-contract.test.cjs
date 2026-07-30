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
  const grid = ui.slice(ui.indexOf('<div className="terminal-feature-grid">'), ui.indexOf('<section className="terminal-card feature-card wide-card">'));
  assert.match(grid, /<h2>上传本地资料<\/h2>/);
  assert.doesNotMatch(grid, /terminalMode === 'personal'[\s\S]*<h2>上传本地资料<\/h2>/);
  assert.match(grid, /config\.terminalMode === 'personal'[\s\S]*<h2>自动投递文件夹<\/h2>[\s\S]*共享终端不会持续监测文件夹/);
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
