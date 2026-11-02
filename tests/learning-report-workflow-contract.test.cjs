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
    assert.match(main, new RegExp(`buildPeriodicLearningReportTask\\(student, '${kind}', eligibleEvidence\\)`));
    assert.match(main, new RegExp(`${kind}: new Set\\(\\['read', 'create_draft'\\]\\)`));
  }
  assert.match(main, /function taskMonthRange/);
  assert.match(main, /idempotencyKey: `\$\{kind\}:\$\{normalized\.id\}:\$\{period\.key\}:\$\{growthFingerprint \|\| 'growth-pending'\}:\$\{learningState\.learningStateFingerprint\}`/);
  assert.match(main, /taskStableId\(kind, 'student', normalized\.id, period\.key\)/);
  assert.match(main, /actionCycleKey: `weekly_action:\$\{normalized\.id\}:\$\{week\.key\}`/);
  assert.match(main, /periodicKinds\.has\(task\.kind\)/);
  assert.match(main, /automaticTaskWakeDecision\(task\)\.eligible/);
  assert.match(main, /taskStoreGuard\.listRunnableTasks/);
  assert.match(main, /scheduleAutomaticTaskWakeups\(\[task\.id\],'fallback_scan'/);
  assert.match(main, /new Set\(\['published', 'current', 'updated', 'active'\]\)\.has\(reportStatus\)/);
});

test('periodic reports read bounded learning candidates without promoting them to citeable evidence', () => {
  assert.match(main, /buildLearningReportCandidateContext\(normalized\.rootPath/);
  assert.match(main, /learningCandidate,/);
  assert.match(main, /本周期纵向学习轨迹候选（不是可引用证据白名单）/);
  assert.match(main, /未在上方白名单确认的事件 ID 和来源 ID 不得写成/);
  assert.doesNotMatch(main, /eligibleEvidenceIds: learningCandidate/);
  assert.match(ui, /分维度证据估计：概念理解/);
  assert.match(ui, /未知维度不按零分计算/);
});

test('new report drafts are validated and automatically published without routine review', () => {
  assert.match(main, /task\.kind === 'weekly_action' \|\| PERIODIC_REPORT_TASKS\[task\.kind\]/);
  assert.match(main, /validateSectionedReport/);
  assert.match(main, /validateReportAutoPublication/);
  assert.match(main, /completionPolicy: 'auto_after_validation'/);
  assert.match(main, /report_auto_published/);
  assert.match(workflow, /generated\|pending_review/);
  assert.match(workflow, /publishValidatedReport/);
  assert.match(main, /directReportExecutionCommand/);
  assert.match(main, /status: generated/);
  assert.match(main, /本次执行必须实际写入或更新系统校验区文件/);
  assert.match(main, /行动建议、观察点和依据来源可以引用 watching 证据/);
  assert.match(main, /报告已通过自动校验并发布/);
  assert.match(ui, /系统正在校验并自动发布，无需人工操作/);
  assert.doesNotMatch(ui, /采用并发布/);
  assert.doesNotMatch(ui, /审批、驳回或反馈说明/);
  assert.doesNotMatch(ui, /人工审核说明/);
});

test('report page recovers valid drafts and exposes one explicit update action', () => {
  assert.match(main, /function recoverValidatedLearningReportDrafts/);
  assert.match(main, /learning_report_draft_recovered/);
  assert.match(main, /async function updateLearningReports/);
  assert.match(main, /bridge:updateLearningReports/);
  assert.match(ui, /updateCurrentLearningReports/);
  assert.match(ui, /更新学情报告/);
  assert.match(ui, /重新读取/);
  assert.match(ui, /learningReportTaskIds/);
  assert.match(ui, /getTaskStatusesAsync\(learningReportTaskIds\)/);
  assert.match(ui, /完成后将自动刷新/);
  assert.match(ui, /上一版报告保持不变/);
});

test('knowledge synchronization recovers validated reports before collecting governed files', () => {
  const syncFunction = main.slice(
    main.indexOf('function publishStudentArchiveSync'),
    main.indexOf('function scheduleStudentArchiveSync'),
  );
  assert.ok(syncFunction.indexOf('recoverValidatedLearningReportDrafts') < syncFunction.indexOf('pendingStudentArchiveReports'));
  assert.ok(syncFunction.indexOf('recoverValidatedLearningReportDrafts') < syncFunction.indexOf('collectStudentArchiveFiles'));
  assert.match(syncFunction, /recoveredReports: draftRecovery\.recovered/);
  assert.match(main, /isPublishableLearningReportStatus\(publishedStatus\)/);
});

test('digest and task flows expose theme-aware next action guidance', () => {
  assert.match(ui, /未复制消化指令/);
  assert.match(ui, /getMaterialImportRecords/);
  assert.match(ui, /workflow-action next/);
  assert.match(css, /\.workflow-action\.next/);
  assert.match(css, /var\(--accent\)/);
  assert.match(css, /\.project-flow-step\.done/);
});
