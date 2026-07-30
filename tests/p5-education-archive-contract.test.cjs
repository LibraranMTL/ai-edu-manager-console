const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('growth and formal report changes coalesce into an idempotent archive version', () => {
  assert.match(main, /scheduleEducationArchiveVersion\(normalized\.id\)/);
  assert.match(main, /if \(!publication\.unchanged\) scheduleEducationArchiveVersion\(task\.sourceId\)/);
  assert.match(main, /educationArchiveVersionTimers/);
  assert.match(main, /flushEducationArchiveVersions\(\)/);
});

test('one ordinary action exports a portable Markdown and JSON archive', () => {
  assert.match(main, /function exportEducationArchive\(studentKey\)/);
  assert.match(main, /exportDirectoryWithFallback\(/);
  assert.match(main, /bridge:exportEducationArchive/);
  assert.match(preload, /exportEducationArchive\(studentId\)/);
  assert.match(ui, /导出完整档案/);
  assert.match(ui, /exportSelectedEducationArchive/);
  assert.doesNotMatch(main, /education-archive[\s\S]{0,300}pdf/iu);
});

test('a selected learning report exports to Markdown or PDF', () => {
  assert.match(main, /async function exportLearningReport\(studentKey, reportId, format\)/);
  assert.match(main, /printToPDF\(/);
  assert.match(main, /writeFileWithFallback\(/);
  assert.match(main, /bridge:exportLearningReport/);
  assert.match(preload, /exportLearningReport\(studentId, reportId, format\)/);
  assert.match(ui, /导出 Markdown/);
  assert.match(ui, /导出 PDF/);
});

test('host backup and restore carry compatible education archive snapshots', () => {
  assert.match(main, /educationArchives: collectEducationArchiveBackups\(backupStudents\)/);
  assert.match(main, /restoreEducationArchiveSnapshot\(student, snapshot\)/);
  assert.match(main, /restoredEducationArchives/);
});

test('education archive browser supports search and modified-date sorting', () => {
  assert.match(ui, /placeholder="搜索文件名或路径"/);
  assert.match(ui, /aria-label="档案日期排序"/);
  assert.match(ui, /最新更新优先/);
  assert.match(ui, /最早更新优先/);
  assert.match(ui, /archiveSearch\.trim\(\)\.toLocaleLowerCase/);
  assert.match(ui, /archiveDateSort === 'modified-desc'/);
  assert.match(ui, /显示 \{filteredMarkdownFiles\.length\}/);
});
