const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../cloud-report-web/src/PublicContentPanel.tsx'), 'utf8');

test('published courses remain previewable and edits create drafts instead of mutating the active manifest', () => {
  assert.match(source, /当前已发布课程/);
  assert.match(source, /预览课程/);
  assert.match(source, /编辑并创建修订/);
  assert.match(source, /publishedCourseToDraft\(item\)/);
  assert.match(source, /readOnly=\{Boolean\(editorSource\)\}/);
  assert.match(source, /当前已发布版本保持不变/);
  assert.match(source, /重新校验和确认SHA-256后才会替换线上版本/);
  assert.match(source, /request\(`\/v2\/public-content\/releases\/\$\{item\.manifestRevision\}`\)/);
});

test('selection and release identity changes invalidate stale frozen candidates', () => {
  assert.match(source, /function clearCandidate\(\)/);
  assert.match(source, /setSelectedCourses\(current => event\.target\.checked[\s\S]*?clearCandidate\(\)/);
  assert.match(source, /setReleaseId\(event\.target\.value\); clearCandidate\(\)/);
  assert.match(source, /已选择 <strong>\{selectedCourses\.length\}<\/strong> \/ \{courses\.length\} 门/);
  assert.match(source, /全选草稿课程/);
});

test('new release IDs use local calendar time and are refreshed for every published-course revision', () => {
  assert.match(source, /function createReleaseId\(now = new Date\(\)\)/);
  assert.doesNotMatch(source, /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(source, /setReleaseId\(createReleaseId\(\)\)/);
});
