const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'electron', 'learning-report-workflow.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('all four learning reports have idempotent weekly or monthly tasks', () => {
  for (const kind of ['learning_profile', 'learning_changes', 'learning_stage']) {
    assert.match(main, new RegExp(`buildPeriodicLearningReportTask\\(student, '${kind}'\\)`));
    assert.match(main, new RegExp(`${kind}: new Set\\(\\['read', 'create_draft'\\]\\)`));
  }
  assert.match(main, /function taskMonthRange/);
  assert.match(main, /idempotencyKey: `\$\{kind\}:\$\{normalized\.id\}:\$\{period\.key\}:\$\{growthFingerprint \|\| 'growth-pending'\}`/);
  assert.match(main, /periodicKinds\.has\(task\.kind\)/);
  assert.match(main, /scheduledReportKinds\.has\(task\.kind\)/);
});

test('new report drafts are validated and automatically published without routine review', () => {
  assert.match(main, /task\.kind === 'weekly_action' \|\| PERIODIC_REPORT_TASKS\[task\.kind\]/);
  assert.match(main, /validateSectionedDraft/);
  assert.match(main, /validateReportAutoPublication/);
  assert.match(main, /completionPolicy: 'auto_after_validation'/);
  assert.match(main, /report_auto_published/);
  assert.match(workflow, /status:\\s\*pending_review/);
  assert.match(main, /报告已通过自动校验并发布/);
  // Legacy pending drafts remain manually recoverable, but new scheduled tasks do not require this step.
  assert.match(ui, /采用并发布/);
  assert.match(ui, /需要修改/);
  assert.doesNotMatch(ui, /审批、驳回或反馈说明/);
  assert.doesNotMatch(ui, /人工审核说明/);
});

test('digest and task flows expose theme-aware next action guidance', () => {
  assert.match(ui, /未复制消化指令/);
  assert.match(ui, /getMaterialImportRecords/);
  assert.match(ui, /workflow-action next/);
  assert.match(css, /\.workflow-action\.next/);
  assert.match(css, /var\(--accent\)/);
  assert.match(css, /\.project-flow-step\.done/);
});
