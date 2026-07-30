const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  exportDirectoryWithFallback,
  learningReportHtml,
  markdownToHtml,
  safeExportStem,
  writeFileWithFallback,
} = require('../electron/report-export.cjs');

test('education archive export falls back when the preferred directory is unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-report-export-'));
  const source = path.join(root, 'source');
  const unavailable = path.join(root, 'unavailable');
  const fallback = path.join(root, 'fallback');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, '教育档案.md'), '# 教育档案', 'utf8');
  fs.writeFileSync(unavailable, 'not a directory', 'utf8');
  const exported = exportDirectoryWithFallback(source, [unavailable, fallback], '档案');
  assert.equal(exported.base, fallback);
  assert.equal(fs.readFileSync(path.join(exported.path, '教育档案.md'), 'utf8'), '# 教育档案');
});

test('Markdown report export keeps Unicode content and uses a safe filename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-report-markdown-'));
  const exported = writeFileWithFallback(
    [root],
    safeExportStem('赵书源:整体画像'),
    'md',
    Buffer.from('# 整体画像\n\n稳定进步。', 'utf8'),
  );
  assert.equal(path.basename(exported.path).includes(':'), false);
  assert.equal(fs.readFileSync(exported.path, 'utf8'), '# 整体画像\n\n稳定进步。');
});

test('PDF source HTML renders report headings, lists, tables and Chinese metadata safely', () => {
  const markdown = '# 学习进展\n\n## 数学\n\n- 能独立完成二位数除法\n- 继续练习验算\n\n| 指标 | 状态 |\n| --- | --- |\n| 除法 | 进步 |';
  const body = markdownToHtml(markdown);
  assert.match(body, /<h1>学习进展<\/h1>/);
  assert.match(body, /<h2>数学<\/h2>/);
  assert.match(body, /<li>能独立完成二位数除法<\/li>/);
  assert.match(body, /<table>/);
  assert.match(body, /<td>进步<\/td>/);
  const html = learningReportHtml({
    studentName: '赵书源',
    reportTitle: '阶段总结',
    markdown,
    generatedAt: '2026/7/30 12:00:00',
  });
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /赵书源/);
  assert.match(html, /阶段总结/);
  assert.match(html, /Microsoft YaHei/);
});
