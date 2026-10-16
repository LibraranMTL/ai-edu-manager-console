const fs = require('node:fs');
const path = require('node:path');
const { ACTIVE_AGENT_TOOL_IDS } = require('./agent-adapter-registry.cjs');
const { discoverTaskPayloads } = require('./task-result-inbox.cjs');

const TASK_CHANNEL_AGENT_IDS = Object.freeze([...ACTIVE_AGENT_TOOL_IDS, 'llm-api', 'manual', 'internal']);
const HANDOFF_AGENT_LABELS = Object.freeze({
  marvis: 'Marvis', hohu: 'Hohu', 'ima.copilot': 'IMA Copilot',
  'claude-code': 'Claude Code', chatgpt: 'ChatGPT', claude: 'Claude', doubao: '豆包', hermes: 'Hermes',
  trae: 'TRAE IDE / TraeCode', 'qoder-work': 'Qoder Work',
});

function taskChannelAgentId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!TASK_CHANNEL_AGENT_IDS.includes(id) && !/^custom:[0-9a-f-]{36}$/.test(id)) throw new Error('未知的任务 Agent。');
  return id;
}

function agentTaskChannel(root, agentId = '') {
  const id = agentId ? taskChannelAgentId(agentId) : '';
  const segment = id.replace(':', '-');
  return { agentId: id, inboxPath: path.join(root, 'agent-inbox', segment), resultPath: path.join(root, 'agent-results', segment) };
}

function taskResultDelivery(root, task) {
  const agentId = taskChannelAgentId(task.adapterId || task.executor || 'manual');
  const channel = agentTaskChannel(root, agentId);
  const taskId = String(task.id || '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 160);
  const executionId = String(task.executionId || '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 100);
  if (!taskId || !executionId) throw new Error('任务回写缺少当前执行批次。');
  return { agentId, resultPath: path.join(channel.resultPath, `${taskId}-${executionId}.result.json`),
    identity: { protocolVersion: task.protocolVersion, taskId: task.id, executionId: task.executionId, agentId } };
}

function taskResultCommand(command, delivery) {
  return `${command}\n\n## 统一任务结果回写\n完成任务后，将 TaskResult JSON 写入：${delivery.resultPath}\n` +
    `当前执行身份（原样保留）：${JSON.stringify(delivery.identity)}\n` +
    '另外填写 status（completed 或 failed）、message 和 artifacts（实际产物路径）。仅此回执文件为额外允许写入的位置，其他读写仍遵守任务声明的范围。先写临时文件再重命名为结果文件；无法写文件时，在对话中返回该 JSON 供用户导入。教育管家会核对当前批次和实际产物。';
}

function discoverAgentTaskPayloads(root, selectedAgent = '') {
  const selected = selectedAgent ? taskChannelAgentId(selectedAgent) : '';
  const customRoot = path.join(root, 'agent-results');
  const customIds = fs.existsSync(customRoot) && !fs.lstatSync(customRoot).isSymbolicLink()
    ? fs.readdirSync(customRoot).filter(id => /^custom-[0-9a-f-]{36}$/.test(id)).map(id => id.replace('custom-', 'custom:')) : [];
  const ids = selected ? [selected] : [...TASK_CHANNEL_AGENT_IDS, ...customIds];
  const channels = ids.map(id => agentTaskChannel(root, id));
  if (!selected || selected === 'qclaw') channels.push({ agentId: 'qclaw', resultPath: path.join(root, 'qclaw-results'), legacy: true });
  const discovered = { claims: [], results: [] };
  for (const channel of channels) {
    if (!fs.existsSync(channel.resultPath) || fs.lstatSync(channel.resultPath).isSymbolicLink()) continue;
    const payloads = discoverTaskPayloads(channel.resultPath);
    for (const kind of ['claims', 'results']) {
      discovered[kind].push(...payloads[kind].map(item => ({ ...item, channel })));
    }
  }
  return discovered;
}

function validateTaskChannelIdentity(task, payload, channel) {
  const expected = String(task?.adapterId || task?.executor || '');
  // Legacy QClaw claims use agentId for the worker/sub-agent, not the adapter.
  if (channel.agentId !== expected || (!channel.legacy && payload?.agentId && payload.agentId !== expected)) {
    return { ok: false, code: 'AGENT_CHANNEL_MISMATCH', message: '结果 Agent 与当前任务执行器不一致。' };
  }
  return { ok: true };
}

function handoffAgentCapabilities() {
  return Object.fromEntries(Object.entries(HANDOFF_AGENT_LABELS).map(([id, label]) => [id, {
    id, label, available: true, authorized: true, automatic: false, inbox: true,
    structuredResult: true, permissionEnforcement: 'human_review', handoffOnly: true,
    healthMessage: '任务包交接：复制指令到所选 Agent；结果回写后自动校验',
  }]));
}

module.exports = { TASK_CHANNEL_AGENT_IDS, agentTaskChannel, discoverAgentTaskPayloads,
  taskResultDelivery, taskResultCommand, validateTaskChannelIdentity, handoffAgentCapabilities };
