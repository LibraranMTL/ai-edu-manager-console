const ACTIVE_AGENT_TOOL_IDS = Object.freeze([
  'qclaw',
  'marvis',
  'hohu',
  'openclaw',
  'ima.copilot',
  'workbuddy',
  'codex',
  'claude-code',
  'chatgpt',
  'claude',
  'doubao',
  'hermes',
]);

// Legacy IDs remain readable so an upgrade never relabels historical sources or
// silently changes an existing student binding. They are not offered for new use.
const LEGACY_AGENT_SOURCE_IDS = Object.freeze(['coze', 'fastgpt']);
const KNOWN_AGENT_SOURCE_IDS = Object.freeze([
  ...ACTIVE_AGENT_TOOL_IDS,
  ...LEGACY_AGENT_SOURCE_IDS,
]);

const AUTO_CAPTURE_AGENT_IDS = Object.freeze([
  'codex',
  'qclaw',
  'workbuddy',
  'openclaw',
  'claude-code',
  'hermes',
]);

const AGENT_ADAPTERS = Object.freeze({
  codex: Object.freeze({ id: 'codex', label: 'Codex', surface: 'local-cli', captureMode: 'command-hook', hookEvents: ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'Interrupt'] }),
  qclaw: Object.freeze({ id: 'qclaw', label: 'QClaw', surface: 'local-app', captureMode: 'plugin' }),
  workbuddy: Object.freeze({ id: 'workbuddy', label: 'WorkBuddy', surface: 'local-app', captureMode: 'command-hook', hookEvents: ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'] }),
  openclaw: Object.freeze({ id: 'openclaw', label: 'OpenClaw', surface: 'local-app', captureMode: 'plugin' }),
  'claude-code': Object.freeze({ id: 'claude-code', label: 'Claude Code', surface: 'local-cli', captureMode: 'command-hook', hookEvents: ['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd'] }),
  hermes: Object.freeze({ id: 'hermes', label: 'Hermes', surface: 'local-agent', captureMode: 'plugin' }),
});

function isActiveAgentTool(value) {
  return ACTIVE_AGENT_TOOL_IDS.includes(String(value || '').toLowerCase());
}

function isKnownAgentSource(value) {
  return KNOWN_AGENT_SOURCE_IDS.includes(String(value || '').toLowerCase());
}

function isLegacyAgentSource(value) {
  return LEGACY_AGENT_SOURCE_IDS.includes(String(value || '').toLowerCase());
}

function lifecycleAdapter(value) {
  return AGENT_ADAPTERS[String(value || '').toLowerCase()] || null;
}

module.exports = {
  ACTIVE_AGENT_TOOL_IDS,
  AGENT_ADAPTERS,
  AUTO_CAPTURE_AGENT_IDS,
  KNOWN_AGENT_SOURCE_IDS,
  LEGACY_AGENT_SOURCE_IDS,
  isActiveAgentTool,
  isKnownAgentSource,
  isLegacyAgentSource,
  lifecycleAdapter,
};
