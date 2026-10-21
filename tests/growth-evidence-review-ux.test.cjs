const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('ordinary growth evidence is processed automatically without a renderer confirmation', () => {
  assert.match(main, /function applyAutomaticGrowthEvidencePlan\(student, review\)/);
  assert.match(main, /function batchReviewGrowthEvidence\(studentId\)/);
  assert.match(main, /bridge:batchReviewGrowthEvidence/);
  assert.match(preload, /batchReviewGrowthEvidence\(studentId\)/);
  assert.match(ui, /batchReviewGrowthEvidence\?: \(studentId: string\) => Promise<string>/);
  assert.match(ui, /系统会自动确认来源完整且归属明确的低风险证据/);
  assert.doesNotMatch(ui, />一键处理本批次</);
  assert.doesNotMatch(ui, /确认一次处理本批成长证据吗/);
  assert.match(main, /reviewerId: 'system-risk-policy'/);
  assert.match(main, /automated: true/);
  assert.match(main, /reportEvidenceSourceAccessible\(\{ sourceId: normalized\.id \}, item\)/);
});

test('default review queue hides low risk candidates and keeps high risk records individual', () => {
  assert.match(ui, /useState<'attention' \| 'all' \| 'low'>\('attention'\)/);
  assert.match(ui, /risk\.level === 'low'/);
  assert.match(ui, /默认：只看需关注/);
  assert.match(main, /plan\.summary\.high/);
  assert.match(main, /高风险记录保留逐条确认/);
});

test('automatic processing writes one audit batch while medium items remain observations', () => {
  assert.match(main, /applyGrowthEvidenceReviewDecision\(item, 'confirmed'/);
  assert.match(main, /applyGrowthEvidenceReviewDecision\(item, 'watching'/);
  assert.match(main, /batchId/);
  assert.match(main, /未发布为正式结论/);
  assert.match(main, /growth_evidence_auto_processed/);
});
