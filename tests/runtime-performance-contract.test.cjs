const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('learning report progress uses a lightweight status endpoint end to end', () => {
  assert.match(main, /function getTaskStatuses\(taskIds = \[\]\)/);
  assert.match(main, /bridge:getTaskStatusesAsync/);
  assert.match(preload, /getTaskStatusesAsync\(taskIds = \[\]\)/);
  assert.match(ui, /getTaskStatusesAsync\(learningReportTaskIds\)/);
  const pollingEffect = ui.slice(ui.indexOf('if (!learningReportTaskIds.length'), ui.indexOf('const submitDailyActionFeedback'));
  assert.doesNotMatch(pollingEffect, /getTaskCenterAsync\(true\)/);
});

test('report task construction shares one governed evidence scan per student', () => {
  assert.match(main, /function currentLearningReportTaskCandidates\(student\)/);
  assert.match(main, /const eligibleEvidence = reportEligibleEvidence\(toHostStudent\(student\)\)/);
  assert.match(main, /buildWeeklyActionTask\(student, eligibleEvidence\)/);
  assert.match(main, /buildPeriodicLearningReportTask\(student, 'learning_profile', eligibleEvidence\)/);
  assert.match(main, /tasks\.push\(\.\.\.currentLearningReportTaskCandidates\(student\)\.map/);
  assert.match(main, /automationSuspended: periodicPaused/);
});

test('report execution retries compatible agents automatically before asking for attention', () => {
  const reportBuilder = main.slice(main.indexOf('function buildPeriodicLearningReportTask'), main.indexOf('function dailyActionFeedbackPath'));
  const weeklyBuilder = main.slice(main.indexOf('function buildWeeklyActionTask'), main.indexOf('function currentLearningReportTaskCandidates'));
  for (const source of [reportBuilder, weeklyBuilder]) {
    assert.match(source, /autoRetry: true/);
    assert.match(source, /maxAttempts: 6/);
    assert.match(source, /retryBackoffSeconds: 10/);
  }
  assert.match(main, /function fallbackTaskAfterFailure/);
});
