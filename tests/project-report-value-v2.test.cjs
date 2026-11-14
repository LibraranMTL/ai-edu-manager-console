'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeProjectSuccessCriteria, computeNumericCriterion, validateDescriptiveInference, validateIterationEvents } = require('../electron/project-report-value.cjs');

const criteria = normalizeProjectSuccessCriteria([
  { criterionId: 'numeric-range', title: '温度覆盖目标区间', kind: 'numeric', operator: 'between', targetMin: 20, targetMax: 30, unit: '℃', conditions: ['同一设备'], validationMethod: '校准温度计', active: true },
  { criterionId: 'descriptive', title: '方案能解释关键取舍', kind: 'descriptive', conditions: ['答辩场景'], validationMethod: '对照设计记录', active: true },
]);

test('success criteria are bounded and numeric range distinguishes full, partial and conflict', () => {
  assert.equal(criteria.length, 2);
  assert.equal(computeNumericCriterion(criteria[0], [{ value: 19, evidenceId: 'e1' }, { value: 31, evidenceId: 'e2' }]).status, 'achieved');
  assert.equal(computeNumericCriterion(criteria[0], [{ value: 19, evidenceId: 'e1' }, { value: 25, evidenceId: 'e2' }]).status, 'partially_achieved');
  assert.equal(computeNumericCriterion(criteria[0], [{ value: 25, evidenceId: 'e1', observationKey: 'same' }, { value: 26, evidenceId: 'e2', observationKey: 'same' }]).status, 'conflicted');
  assert.throws(() => normalizeProjectSuccessCriteria(Array.from({ length: 21 }, (_, index) => ({ title: `标准${index}`, kind: 'descriptive' }))));
});

test('AI descriptive inference requires snapshot evidence and keeps AI status explicit', () => {
  const achieved = validateDescriptiveInference({ criterionId: 'descriptive', status: 'inferred_achieved', confidence: 'high', reasoning: '设计记录覆盖主要取舍。', supportingEvidenceIds: ['e1'], counterEvidenceIds: [], missingValidation: [], applicableConditions: ['答辩场景'] }, { criteria, evidenceIds: ['e1'] });
  assert.equal(achieved.status, 'inferred_achieved');
  const noEvidence = validateDescriptiveInference({ criterionId: 'descriptive', status: 'inferred_achieved', confidence: 'high', reasoning: '没有直接证据。' }, { criteria, evidenceIds: ['e1'] });
  assert.equal(noEvidence.status, 'insufficient_evidence');
  const conflicted = validateDescriptiveInference({ criterionId: 'descriptive', status: 'inferred_achieved', confidence: 'medium', reasoning: '支持与反例并存。', supportingEvidenceIds: ['e1'], counterEvidenceIds: ['e2'] }, { criteria, evidenceIds: ['e1', 'e2'] });
  assert.equal(conflicted.status, 'conflicted');
  assert.throws(() => validateDescriptiveInference({ criterionId: 'descriptive', status: 'inferred_achieved', reasoning: '越界', supportingEvidenceIds: ['other'] }, { criteria, evidenceIds: ['e1'] }));
});

test('iteration reasons need independent evidence and UI/bridges expose value upgrade', () => {
  const events = validateIterationEvents([{ type: 'modification', title: '调整结构', description: '减少重量', evidenceIds: ['e1'], reason: '测试失败', reasonEvidenceIds: [] }], ['e1']);
  assert.equal(events[0].reasonStatus, 'missing'); assert.equal(events[0].reason, '');
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src/ProjectOverallReportPanel.tsx'), 'utf8');
  for (const value of ['saveProjectSuccessCriteria', 'previewProjectReportActionTask', 'commitProjectReportActionTask']) {
    assert.match(main, new RegExp(value)); assert.match(preload, new RegExp(value)); assert.match(ui, new RegExp(value));
  }
  assert.match(main, /role, readerId: String\(student\.id\)/);
  assert.match(ui, /AI推定/); assert.match(ui, /资料矛盾/); assert.match(ui, /修改原因待补充/);
});
