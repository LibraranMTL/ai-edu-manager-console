const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('growth evidence review exposes one local batch operation across main, preload and renderer', () => {
  assert.match(main, /function batchReviewGrowthEvidence\(studentId\)/);
  assert.match(main, /bridge:batchReviewGrowthEvidence/);
  assert.match(preload, /batchReviewGrowthEvidence\(studentId\)/);
  assert.match(ui, /batchReviewGrowthEvidence\?: \(studentId: string\) => string/);
  assert.match(ui, />一键处理本批次</);
  assert.match(ui, /window\.confirm\(`确认一次处理本批成长证据吗/);
});

test('default review queue hides low risk candidates and keeps high risk records individual', () => {
  assert.match(ui, /useState<'attention' \| 'all' \| 'low'>\('attention'\)/);
  assert.match(ui, /risk\.level === 'low'/);
  assert.match(ui, /默认：只看需关注/);
  assert.match(main, /plan\.summary\.high/);
  assert.match(main, /高风险记录保留逐条确认/);
});

test('batch review writes one audit batch while medium items remain observations', () => {
  assert.match(main, /applyGrowthEvidenceReviewDecision\(item, 'confirmed'/);
  assert.match(main, /applyGrowthEvidenceReviewDecision\(item, 'watching'/);
  assert.match(main, /batchId/);
  assert.match(main, /未发布为正式结论/);
});
