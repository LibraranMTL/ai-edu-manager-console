const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ACTIVE_AGENT_TOOL_IDS,
  AGENT_ADAPTERS,
  AUTO_CAPTURE_AGENT_IDS,
  KNOWN_AGENT_SOURCE_IDS,
  LEGACY_AGENT_SOURCE_IDS,
  isActiveAgentTool,
  isKnownAgentSource,
  isLegacyAgentSource,
} = require('../electron/agent-adapter-registry.cjs');

test('active adapter list adds Hermes and excludes retired FastGPT and Coze choices', () => {
  assert.equal(ACTIVE_AGENT_TOOL_IDS.includes('hermes'), true);
  assert.equal(ACTIVE_AGENT_TOOL_IDS.includes('fastgpt'), false);
  assert.equal(ACTIVE_AGENT_TOOL_IDS.includes('coze'), false);
  assert.deepEqual(LEGACY_AGENT_SOURCE_IDS, ['coze', 'fastgpt']);
});

test('legacy sources remain readable without being active selections', () => {
  assert.equal(isKnownAgentSource('coze'), true);
  assert.equal(isKnownAgentSource('fastgpt'), true);
  assert.equal(isActiveAgentTool('coze'), false);
  assert.equal(isLegacyAgentSource('fastgpt'), true);
  assert.equal(KNOWN_AGENT_SOURCE_IDS.includes('hermes'), true);
});

test('automatic capture is registry driven for six lifecycle adapters', () => {
  assert.deepEqual(AUTO_CAPTURE_AGENT_IDS, ['codex', 'qclaw', 'workbuddy', 'openclaw', 'claude-code', 'hermes']);
  assert.deepEqual(Object.keys(AGENT_ADAPTERS), AUTO_CAPTURE_AGENT_IDS);
  assert.equal(AGENT_ADAPTERS['claude-code'].captureMode, 'command-hook');
  assert.equal(AGENT_ADAPTERS.hermes.captureMode, 'plugin');
});
