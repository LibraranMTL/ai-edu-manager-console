const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('report evidence is exposed as a read-only scoped bridge', () => {
  assert.match(main, /function learningReportEvidence/);
  assert.match(main, /canonicalIsPathInside\(root, target\)/);
  assert.match(main, /projectIds\.has\(String\(resource\.scopeId\)\)/);
  assert.match(main, /bridge:getLearningReportEvidence/);
  assert.match(main, /bridge:openLearningReportEvidenceSource/);
  assert.match(preload, /getLearningReportEvidence\(studentId, reportId\)/);
  assert.match(preload, /openLearningReportEvidenceSource\(studentId, reportId, evidenceId, sourceIndex\)/);
});

test('ordinary report UI reaches evidence and source in at most two actions', () => {
  assert.match(ui, /'查看依据'/);
  assert.match(ui, /openLearningReportEvidenceSource\(card\.evidenceId, sourceIndex\)/);
  assert.match(ui, /只读查看，不会修改报告或成长模型/);
  assert.doesNotMatch(ui, /报告依据[\s\S]{0,500}批准依据/);
});

test('historical reports degrade without being rewritten', () => {
  assert.match(ui, /历史报告没有证据 ID，可继续正常阅读/);
  const readOnlySection = main.slice(
    main.indexOf('function learningReportEvidence'),
    main.indexOf('function ensureLearningReports', main.indexOf('function learningReportEvidence')),
  );
  assert.doesNotMatch(readOnlySection, /writeFileSync|writeJson|persist/);
});
