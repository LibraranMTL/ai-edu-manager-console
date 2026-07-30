const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const taskRuntime = fs.readFileSync(path.join(root, 'electron', 'task-runtime-policy.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('high-risk project operations are queued before internal execution', () => {
  assert.match(main, /function executeProjectPromotionPlan\(projectId, planJson\) \{\s*return queueProjectPromotionOperation\(projectId, 'execute_archive_plan', planJson\);\s*\}/);
  assert.match(main, /function publishProjectPromotion\(projectId\) \{\s*return queueProjectPromotionOperation\(projectId, 'publish_growth_evidence'\);\s*\}/);
  assert.match(main, /function rollbackProjectPromotionRun\(projectId, runId\) \{\s*return queueProjectPromotionOperation\(projectId, 'rollback_promotion'/);
  assert.match(main, /authorizeInternalTaskOperation\(taskContext, 'execute_archive_plan'/);
  assert.match(main, /authorizeInternalTaskOperation\(taskContext, 'publish_growth_evidence'/);
});

test('all execution paths use the adapter registry and Codex is sandboxed', () => {
  for (const adapter of ['internal', 'openclaw', 'codex', 'qclaw', 'manual']) {
    assert.match(main, new RegExp(`${adapter}: \\{ \\.\\.\\.common, id: '${adapter}'`));
  }
  assert.match(main, /status: adapterTaskStatus, readResult: adapterTaskResult/);
  assert.match(main, /const sandboxMode = task\.input\?\.remoteLocalExecution \? 'read-only' : 'workspace-write'/);
  assert.match(main, /\['exec', '--sandbox', sandboxMode/);
  assert.doesNotMatch(main, /--full-auto/);
  assert.match(main, /codexAuthHealthy/);
  assert.match(main, /error loading configuration\|unknown variant/);
  assert.match(main, /function probeExecutable[\s\S]*resolveNodeCommandShim\(executable, args\)/);
});

test('manual and QClaw results enforce the current execution identity', () => {
  assert.match(main, /validateExternalTaskResultIdentity\(task, payload\)/);
  assert.match(main, /validateExternalTaskResultIdentity\(task, payload, \{ allowedStatuses: \['waiting_result'\] \}\)/);
  assert.match(main, /qclaw_inbox_prepared/);
  assert.match(main, /manual_execution_prepared/);
  assert.match(main, /quarantineQClawPayload/);
  assert.match(main, /discoverTaskPayloads/);
  assert.match(main, /archiveQClawPayload/);
  assert.match(main, /'processed', kind === 'claim' \? 'claims' : 'results'/);
});

test('weekly action output keeps daily routines, weekly focus and milestones', () => {
  for (const section of ['每周重点', '每日固定动作', '阶段性里程碑', '给学生', '给家长', '给老师', '本周不建议做的事', '观察点', '依据来源']) {
    assert.match(main, new RegExp(`'${section}'`));
  }
  assert.match(main, /输出结构校验失败/);
  assert.match(main, /validateDailyActionDocument/);
  assert.match(main, /selectPreviousDailyFeedback/);
  assert.match(main, /writeJsonFile\(dailyActionFeedbackPath\(normalized\)/);
  assert.match(main, /taskStableId\('weekly_action'.*week\.key/);
  assert.match(main, /reconcileWeeklyActions/);
  assert.match(main, /旧每日任务退出当前队列/);
});

test('runtime failure has heartbeat, retry and manual fallback safeguards', () => {
  const runtimeSources = `${main}\n${taskRuntime}`;
  assert.match(main, /function fallbackTaskAfterFailure/);
  assert.match(runtimeSources, /HEARTBEAT_LOST/);
  assert.match(runtimeSources, /retryBackoffSeconds/);
  assert.match(main, /selectFallbackAdapter/);
  assert.match(main, /task\.autoRetry === false \|\| Number\(task\.attempt \|\| 0\) >= Number\(task\.maxAttempts \|\| 1\)/);
  assert.match(main, /task\.nextRetryAt = ''/);
  assert.match(main, /automatic_retry_stopped/);
  assert.match(main, /attempt: 0, autoRetry: false/);
});

test('task center renders protocol details, heartbeat, inputs, outputs and history', () => {
  for (const marker of ['最近心跳', '查看任务输入、预期输出与权限', '查看标准结果与文件变更', '查看状态流转历史']) {
    assert.match(ui, new RegExp(marker));
  }
  assert.match(ui, /Agent 反馈结果/);
  assert.match(ui, /scrollIntoView/);
  assert.match(ui, /打开结果文件/);
  assert.match(main, /function openTaskResultPath/);
  assert.match(preload, /openTaskResultPath\(taskId\)/);
  assert.match(main, /function importTaskResultText/);
  assert.match(main, /task_result_text_imported/);
  assert.match(preload, /importTaskResultText\(taskId, content\)/);
  assert.match(ui, /粘贴 Agent 结果/);
  assert.match(ui, /从文件导入/);
  assert.match(ui, /refreshLearningReports\(student\)/);
  assert.match(ui, /openLearningReport\('daily', student\)/);
});

test('managed OpenClaw cron is disabled externally and scheduled by the task center', () => {
  assert.match(main, /isManagedOpenClawCronJob/);
  assert.match(main, /\['cron', 'disable', definition\.id/);
  assert.match(main, /scheduledReportKinds\.has\(task\.kind\)/);
  assert.match(main, /openclaw-managed-cron\.json/);
});

test('agent health probes and OpenClaw cron checks never block the renderer IPC path', () => {
  const capabilityReader = main.match(/function adapterCapabilities\(force = false\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(main, /function probeExecutableAsync/);
  assert.match(main, /Promise\.all\(\[/);
  assert.doesNotMatch(capabilityReader, /probeExecutable\(/);
  assert.match(main, /await probeExecutableAsync\(refreshedCapability\.exePath, \['cron', 'list'/);
  assert.match(main, /10 \* 60 \* 1000/);
  assert.match(preload, /getTaskCenterAsync\(force = false\)/);
  assert.match(main, /ipcMain\.handle\('bridge:getTaskCenterAsync'/);
  assert.match(ui, /await api\.getTaskCenterAsync\(force\)/);
  assert.match(ui, /\}, 60000\)/);
  assert.match(ui, /if \(!document\.hidden\)/);
});

test('global manual mode stops automatic scheduling while keeping the task center operable', () => {
  assert.match(main, /function taskAutomationEnabled\(\)/);
  assert.match(main, /function setTaskAutomationEnabled\(enabled\)/);
  assert.match(main, /function stopUnifiedTaskScheduler\(\)/);
  assert.match(main, /当前为仅手动模式，未运行自动调度/);
  assert.match(main, /bridge:setTaskAutomationEnabled/);
  assert.match(preload, /setTaskAutomationEnabled\(enabled\)/);
  assert.match(ui, /task-automation-toggle/);
  assert.match(ui, /仅手动/);
  assert.match(main, /executeTaskByAdapterWithFreshCapabilities/);
  assert.match(main, /refreshCapabilitiesForExplicitExecution/);
  assert.match(main, /requested !== 'qclaw'/);
  assert.match(main, /await probeLocalPort\(base\.qclaw\.gatewayPort\)/);
  assert.match(main, /explicit_execution_capability_refreshed/);
  assert.match(preload, /ipcRenderer\.invoke\('bridge:executeTask'/);
});

test('npm cmd shim resolver preserves multiline Chinese arguments', { skip: process.platform !== 'win32' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-bridge-'));
  try {
    const capture = path.join(temp, 'capture.cjs');
    const command = path.join(temp, 'capture.cmd');
    fs.writeFileSync(capture, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n", 'utf8');
    fs.writeFileSync(command, '@ECHO off\r\nSET dp0=%~dp0\r\n"node" "%dp0%\\capture.cjs" %*\r\n', 'utf8');
    const args = ['agent', '--message', '第一行\n第二行 中文参数', '--json'];
    const shimText = fs.readFileSync(command, 'utf8');
    const match = shimText.match(/"%dp0%\\([^"\r\n]+\.(?:mjs|cjs|js))"\s+%\*/i);
    assert.ok(match);
    const result = spawnSync(process.execPath, [path.join(temp, match[1]), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
