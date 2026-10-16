'use strict';
// Opt-in: opens one synthetic desktop handoff using production main callbacks.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { spawn } = require('node:child_process');
async function createDesktopHost(root, spawnProcess = spawn) {
  const host = await require('../tests/helpers/smart-inbox-task-host.cjs').createTaskHost(root);
  Object.assign(host.context, { ...require('../electron/workbuddy-runtime.cjs'), ...require('../electron/agent-task-channel.cjs'), spawn: spawnProcess,
    adapterCapabilities: () => ({ workbuddy: { exePath: 'D:/Program Files/WorkBuddy/WorkBuddy.exe' } }),
    findExecutableInPath: () => process.execPath, process, notify() {},
    taskPowerRecovery: { canDispatch: () => true }, publicLicenseStatus: () => ({ active: true }),
    workbuddyTaskOutboxPath: () => path.join(root, 'task-center/agent-inbox/workbuddy'),
    currentArchiveAccess: () => ({ buildContextBundle: () => ({ resources: [] }) }),
    ARCHIVE_ACCESS_SCHEMA: 'synthetic', REMOTE_ARCHIVE_REQUEST_SCHEMA: 'synthetic',
    writeJsonFile: (file, value) => fs.writeFileSync(file, JSON.stringify(value)),
  });
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  for (const name of ['canonicalTaskPath', 'assertTaskDispatchCurrent', 'writeTaskPacket', 'normalizeTaskResult', 'savePreparedTaskResult', 'submitWorkBuddyTask',
    'quarantineAgentPayload', 'archiveAgentPayload', 'consumeAgentTaskResults', 'commitValidatedTaskResult']) {
    let start = source.indexOf(`function ${name}(`); if (source.slice(start - 6, start) === 'async ') start -= 6;
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), host.context);
  }
  return host;
}
async function consume(root) {
  const assert = require('node:assert/strict');
  const host = await createDesktopHost(root);
  try {
    const reportFile = path.join(root, 'acceptance.json'); const report = JSON.parse(await fsp.readFile(reportFile, 'utf8'));
    // This is a transport-only synthetic task, not a student digest schema.
    Object.assign(host.context, { timestampForFilename: () => String(Date.now()), isDigestTask: () => false,
      isAutoPublishReportTask: () => false, shouldAutoAccept: () => false, RESEARCH_KINDS: new Set(),
      validateTaskCompletion: (task, startedAt, payload) => ({ valid: payload.message === '合成验收通过，平均值25' && payload.artifacts?.length === 0,
        message: 'Synthetic transport response checked', artifacts: [] }),
    });
    const channel = require('../electron/agent-task-channel.cjs');
    await host.client.request(host.file, 'inbox', { agentId: 'workbuddy' });
    await new Promise(resolve => setTimeout(resolve, 650));
    const discovered = await host.client.request(host.file, 'inbox', { agentId: 'workbuddy' });
    assert.equal(discovered.results.length, 1);
    assert.equal(require('../electron/task-protocol.cjs').validateExternalTaskResultIdentity(host.disk().tasks[0], discovered.results[0].payload).ok, true);
    const result = JSON.parse(await host.context.consumeAgentTaskResults('workbuddy', discovered));
    assert.equal(result.imported, 1); assert.equal(result.rejected, 0);
    const saved = host.disk().tasks[0]; assert.equal(saved.status, 'reviewing');
    assert.equal(saved.result.requiresUserAction, false);
    Object.assign(report, { realDesktopResponse: true, receiptIdentityPassed: true, hostImported: true, hostState: saved.status,
      productionWorkerAndConsumer: true, validationScope: 'synthetic transport message only; not business digest validation', resultFile: saved.result.resultFile });
    await fsp.writeFile(reportFile, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await host.close(); }
}
async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'workbuddy-desktop-acceptance-'));
  const host = await createDesktopHost(root);
  try {
    const task = { id: `synthetic-desktop-${Date.now()}`, title: 'AI教育管家桌面交接验收（合成数据）', protocolVersion: host.context.TASK_PROTOCOL_VERSION,
      kind: 'agent_acceptance', status: 'approved', sourceType: 'student', sourceId: 'synthetic-only', attempt: 0, input: { knowledgeRoot: root } };
    const store = host.context.readTaskStore(); store.tasks.push(task); await host.context.writeTaskStoreDurably(store);
    const result = await host.context.submitWorkBuddyTask(task, '这是软件验收用合成任务，无真实学生资料。请勿搜索互联网或读取其他文件。计算合成数列20、25、30的平均值，在回执message中写“合成验收通过，平均值25”，artifacts填空数组。只允许写入下文指定的回执路径，不执行其他任务。');
    const report = { syntheticOnly: true, root, opened: result.ok, taskId: task.id, taskState: host.disk().tasks[0].status,
      executionId: result.task?.executionId, resultDelivery: result.packet?.resultDelivery, message: result.message };
    await fsp.writeFile(path.join(root, 'acceptance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await host.close(); }
}
if (require.main === module) (process.argv[2] === '--consume' ? consume(path.resolve(process.argv[3])) : run()).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { createDesktopHost };
