'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { automaticTaskDispatchDecision } = require('../electron/task-auto-dispatch.cjs');
const { normalizePriorityClass } = require('../electron/task-work-identity.cjs');

const waitingTask = {
  id: 'digest-orphan', kind: 'student_digest', status: 'queued', sourceId: 'student-a',
  trigger: 'event', automaticExecution: true, attempt: 1, result: null, error: null,
};

test('a pre-send orphan with attempt history re-enters automatic dispatch safely', () => {
  assert.equal(automaticTaskDispatchDecision(waitingTask, { now: Date.now() }).eligible, true);
  assert.equal(automaticTaskDispatchDecision({ ...waitingTask, executionId: 'possibly-running' }).reason, 'execution_unknown');
  assert.equal(automaticTaskDispatchDecision({ ...waitingTask, resourceRetryAt: '2099-01-01T00:00:00.000Z' }).reason, 'retry_path_owned');
});

test('expired priority boost returns to the task base class', () => {
  assert.equal(normalizePriorityClass({ trigger: 'event', priorityClass: 100,
    priorityBoostUntil: '2020-01-01T00:00:00.000Z' }, Date.parse('2026-10-24T00:00:00Z')), 60);
  assert.equal(normalizePriorityClass({ trigger: 'manual', priorityClass: 80,
    priorityBoostUntil: '2020-01-01T00:00:00.000Z' }, Date.parse('2026-10-24T00:00:00Z')), 80);
});

test('production scheduler keeps control-plane work alive and inbox uses scoped admission', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const scheduler = main.slice(main.indexOf('async function runUnifiedTaskScheduler()'), main.indexOf('function startUnifiedTaskScheduler()'));
  assert.ok(scheduler.indexOf('await syncAgentTaskResults()')>=0);
  assert.ok(scheduler.indexOf('await syncAgentTaskResults()') < scheduler.indexOf('taskStoreGuard.listRunnableTasks'));
  assert.doesNotMatch(scheduler,/captureTimelineScheduler\?\.state\(\)\.running\.length/);
  const inboxHost = main.slice(main.indexOf('function getSmartInbox()'), main.indexOf('let customOptionsRuntime'));
  assert.doesNotMatch(inboxHost, /taskChildProcesses\.size \|\| digestWorkflowRunning/);
  assert.match(inboxHost, /scheduleSmartInboxResourceRetry/);
  assert.match(main, /projectDigestPolicy = projectDigestCandidatePolicy\(materialAutomation, scope\.requestOrigin\)/);
  assert.match(main, /automaticExecution: projectDigestPolicy\.automatic \|\| projectDigestPolicy\.requestOrigin === 'user_manual_once'/);
  assert.match(main, /automationSuspendedAt: projectDigestPolicy\.paused \? 'project_material_processing_paused'/);
});

test('smart inbox table has stable columns and avoids duplicate refresh', () => {
  const root = path.join(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'src', 'SmartInboxPanel.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'smart-inbox.css'), 'utf8');
  const appCss = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  assert.match(panel, /className="smart-inbox-table"/);
  assert.match(panel, /<colgroup>/);
  assert.doesNotMatch(panel, /onClick=\{\(\) => void run\(refresh\)\}/);
  assert.match(css, /overflow-x: hidden/);
  assert.doesNotMatch(css, /overflow-x: auto/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /content-visibility: auto/);
  const workspaceTabs = appCss.slice(appCss.indexOf('.workspace-page-tabs {'), appCss.indexOf('.workspace-page-tab {'));
  assert.match(workspaceTabs, /flex-wrap: wrap/);
  assert.match(workspaceTabs, /overflow-x: hidden/);
  assert.doesNotMatch(workspaceTabs, /overflow-x: auto/);
});
