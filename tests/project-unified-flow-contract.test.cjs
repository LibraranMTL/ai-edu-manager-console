const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('low-risk project items are automatically applied while risky growth evidence stays manual', () => {
  assert.match(main, /function projectUnifiedReviewSnapshot/);
  assert.match(main, /function getProjectUnifiedReview/);
  assert.match(main, /function applyProjectUnifiedReview/);
  assert.match(main, /applyProjectUnifiedReview\(projectId, \{ automatic: true, snapshot \}\)/);
  assert.match(main, /project_low_risk_auto_applied/);
  assert.match(main, /automaticReview = JSON\.parse\(getProjectUnifiedReview\(ensured\.id\)\)/);
  assert.match(main, /reviewPackage\?\.attention\?\.count \|\| 0\) === 0/);
  assert.match(main, /高风险或归属不明确的成长证据仍需人工确认/);
  assert.match(preload, /getProjectUnifiedReview\(projectId\)/);
  assert.match(preload, /applyProjectUnifiedReview\(projectId\)/);
  assert.match(ui, /自动处理与异常清单/);
  assert.doesNotMatch(ui, /确认本批次/);
  assert.match(ui, /低风险资料和知识已自动处理/);
});

test('primary project action performs work instead of only scrolling', () => {
  assert.match(ui, /selectedProjectNextStep\.action === 'add'[\s\S]*scanSelectedProjectWorkspace/);
  assert.match(ui, /selectedProjectNextStep\.action === 'digest'[\s\S]*startDigestWorkflowFromPage/);
});
