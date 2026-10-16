'use strict';

const { ACTIVE_AGENT_TOOL_IDS, AUTO_CAPTURE_AGENT_IDS } = require('./agent-adapter-registry.cjs');

const SCHEMA = 'edu-manager.executor-adapter.v1';
const VERSION = 1;
const PROFILE_SPECS = Object.freeze({
  'classification_readonly.v1': Object.freeze({ label: '资料分类', handoff: false }),
  'digest_host_mediated.v1': Object.freeze({ label: '资料消化', handoff: true }),
  'learning_card_generation.v1': Object.freeze({ label: '学习卡片', handoff: false }),
  'research.v1': Object.freeze({ label: '联网研究', handoff: false }),
});
const PROFILE_IDS = Object.freeze(Object.keys(PROFILE_SPECS));
const STRUCTURED_PROFILE_IDS = Object.freeze(PROFILE_IDS.filter(id => id !== 'research.v1'));
const BUILTIN_STRUCTURED_IDS = Object.freeze(['openclaw', 'qclaw', 'claude-code', 'trae', 'qoder-work']);
const LABELS = Object.freeze({
  codex: 'Codex', workbuddy: 'WorkBuddy', qclaw: 'QClaw', openclaw: 'OpenClaw', marvis: 'Marvis', hohu: 'Hohu',
  'ima.copilot': 'IMA Copilot', 'claude-code': 'Claude Code', chatgpt: 'ChatGPT', claude: 'Claude', doubao: '豆包',
  hermes: 'Hermes', trae: 'TRAE', 'qoder-work': 'Qoder Work', 'llm-api': 'LLM API',
});

function manifest(spec) {
  const value = { schema: SCHEMA, version: VERSION, ...spec };
  validateManifest(value);
  return Object.freeze(value);
}

function validateManifest(value) {
  if (!value || value.schema !== SCHEMA || value.version !== VERSION || !value.id || !value.label) throw Error('执行器清单版本无效');
  if (!['managed', 'api', 'handoff', 'web', 'exe', 'cli'].includes(value.connection)) throw Error('执行器连接方式无效');
  if (!Array.isArray(value.automaticProfiles) || value.automaticProfiles.some(id => !PROFILE_IDS.includes(id))) throw Error('执行器任务合同无效');
  if (typeof value.handoff !== 'boolean' || typeof value.capture !== 'boolean') throw Error('执行器能力声明无效');
  return value;
}

function builtinExecutorManifests() {
  return [...ACTIVE_AGENT_TOOL_IDS, 'llm-api'].map(id => manifest({
    id,
    label: LABELS[id] || id,
    custom: false,
    adapterKind: BUILTIN_STRUCTURED_IDS.includes(id) ? 'builtin-structured' : id === 'llm-api' ? 'llm-api' : id === 'codex' || id === 'workbuddy' ? 'managed' : 'handoff',
    connection: id === 'llm-api' ? 'api' : ['codex', 'workbuddy', ...BUILTIN_STRUCTURED_IDS].includes(id) ? 'managed' : 'handoff',
    automaticProfiles: id === 'codex' || id === 'llm-api' || id === 'workbuddy' ? PROFILE_IDS.slice()
        : BUILTIN_STRUCTURED_IDS.includes(id) ? STRUCTURED_PROFILE_IDS.slice() : [],
    handoff: id !== 'llm-api',
    capture: AUTO_CAPTURE_AGENT_IDS.includes(id),
  }));
}

function customExecutorManifest(tool) {
  const automaticProfiles = tool.kind === 'cli'
    ? (Array.isArray(tool.requestedProfiles) ? tool.requestedProfiles.filter(id => STRUCTURED_PROFILE_IDS.includes(id)) : STRUCTURED_PROFILE_IDS.slice())
    : [];
  return manifest({
    id: tool.id,
    label: tool.name,
    custom: true,
    adapterKind: tool.kind === 'cli' ? 'standard-json-cli' : 'handoff',
    connection: tool.kind,
    automaticProfiles,
    handoff: true,
    capture: false,
    tool,
  });
}

module.exports = {
  SCHEMA,
  VERSION,
  PROFILE_SPECS,
  PROFILE_IDS,
  STRUCTURED_PROFILE_IDS,
  BUILTIN_STRUCTURED_IDS,
  builtinExecutorManifests,
  customExecutorManifest,
  validateManifest,
};
