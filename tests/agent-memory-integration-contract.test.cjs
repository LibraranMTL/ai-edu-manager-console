const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'electron', 'agent-knowledge-mcp.ps1'), 'utf8');
const lifecycleHook = fs.readFileSync(path.join(root, 'electron', 'agent-lifecycle-hook.ps1'), 'utf8');
const terminalLifecycle = fs.readFileSync(path.join(root, 'electron', 'student-agent-lifecycle.cjs'), 'utf8');
const adapterRegistry = fs.readFileSync(path.join(root, 'electron', 'agent-adapter-registry.cjs'), 'utf8');
const adapterRegistryModule = require('../electron/agent-adapter-registry.cjs');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('P0 Agent credentials are private, student-scoped and cannot widen to team scope', () => {
  assert.match(main, /agent-access-tokens/);
  assert.match(main, /grantType: 'student_scoped'/);
  assert.match(main, /resolveAgentAccessGrant\(readAgentAccessGrantStore\(\), token\)/);
  assert.match(main, /request\.authContext\.type === 'agent_grant'/);
  assert.match(main, /allowedProjectIds \|\| \[\]\)\.includes\(String\(project\.id\)\)/);
  assert.match(bridge, /scopePolicy -ne 'fixed_student'/);
  assert.doesNotMatch(main, /fs\.writeFileSync\(tokenPath, ensureApiToken\(\)/);
});

test('P1 authorized Agent conversations are captured and archived without task-center coupling', () => {
  assert.doesNotMatch(main, /function beginTaskAgentMemory/);
  assert.doesNotMatch(main, /function finalizeTaskAgentMemory/);
  assert.doesNotMatch(main, /agentMemorySessionId:/);
  assert.match(main, /'\/api\/agent\/memory\/session\/append': 'append'/);
  assert.match(main, /store\.appendMessages/);
  assert.match(main, /persistAgentConversationSubmission\(\{/);
  assert.match(main, /origin: 'authorized_agent'/);
  assert.match(main, /AUTO_CAPTURE_AGENT_IDS\.includes\(agentId\)/);
  assert.match(adapterRegistry, /'claude-code'/);
  assert.match(adapterRegistry, /'hermes'/);
  assert.match(main, /'\/api\/agent\/memory\/recent'/);
  assert.match(main, /'\/api\/agent\/memory\/handoff\/accept'/);
});

test('P1 UI and native MCP expose one-time authorization, full messages and six Agent registrations', () => {
  assert.match(preload, /getAgentMemoryState\(studentId\)/);
  assert.match(preload, /ipcRenderer\.invoke\('bridge:getAgentMemoryState', studentId\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.sendSync\('bridge:getAgentMemoryState'/);
  assert.match(main, /ipcMain\.handle\('bridge:getAgentMemoryState'/);
  const stateReader = main.slice(main.indexOf('function agentMemoryState(studentId)'), main.indexOf('function openCodexHookReview()'));
  assert.doesNotMatch(stateReader, /drainAgentLifecycleQueue\(\)/);
  assert.match(stateReader, /\.slice\(0, 8\)/);
  assert.match(preload, /setAgentMemoryAutomation\(studentId, enabled\)/);
  assert.match(preload, /activateAgentMemoryCapture\(studentId\)/);
  assert.match(preload, /openCodexHookReview\(\)/);
  assert.match(ui, /自动会话记忆/);
  assert.match(ui, /Codex、QClaw、WorkBuddy、OpenClaw、Claude Code 和 Hermes/);
  assert.match(ui, /查看采集的对话内容/);
  assert.match(ui, /session\.messages/);
  assert.match(ui, /const AgentMemorySessionRow = memo/);
  assert.match(ui, /setTargetSelection\(event\.target\.value\)/);
  assert.doesNotMatch(ui, /agentSessionTargetSelections/);
  assert.match(main, /\.workbuddy', 'mcp\.json'/);
  assert.match(main, /\.openclaw', 'openclaw\.json'/);
  assert.match(main, /upsertOpenClawMcpServer/);
  for (const name of [
    'get_recent_education_context',
    'start_education_session',
    'record_authorized_education_turn',
    'finalize_education_session',
    'accept_education_handoff',
    'cancel_education_handoff',
  ]) assert.match(bridge, new RegExp(name));
  assert.match(bridge, /Never read or submit earlier chats/);
  assert.doesNotMatch(bridge, /Task-center sessions are recorded automatically/);
});

test('multi-student capture separates authorization from the one active machine target', () => {
  assert.match(main, /prepareAgentKnowledgeAccess\(studentId, \{ activateGlobal: false \}\)/);
  assert.match(main, /function activateAgentMemoryCapture\(studentId\)/);
  assert.match(main, /captureSwitchDecision\(\{/);
  assert.match(main, /currentTarget\.studentId === String\(student\.id\)\) disableAgentLifecycleRegistrations\(\)/);
  assert.match(main, /finalizeActiveLifecycleSessionsForStudent\(student, 'authorization-disabled'\)/);
  assert.match(main, /notify\('onNativeAgentMemoryChanged'/);
  assert.match(ui, /当前采集对象/);
  assert.match(ui, /等待切换/);
  assert.match(ui, /切换到\{selectedStudent\.name\}/);
});

test('P1 automatic capture uses lifecycle hooks and never asks the Agent model to submit turns', () => {
  assert.match(main, /upsertLifecycleCommandHooks\(codexHooksPath, 'codex'\)/);
  assert.match(main, /upsertLifecycleCommandHooks\(path\.join\(os\.homedir\(\), '\.workbuddy', 'settings\.json'\), 'workbuddy'\)/);
  assert.match(main, /installOpenClawLifecyclePlugin\(qclawRuntime\.configPath, 'qclaw'\)/);
  assert.match(main, /installOpenClawLifecyclePlugin\(openclawConfigPath, 'openclaw'\)/);
  assert.match(main, /upsertLifecycleCommandHooks\(claudeCodeHooksPath, 'claude-code'\)/);
  assert.match(main, /installHermesLifecyclePlugin\(\)/);
  assert.match(main, /startAgentLifecycleInstallMonitor\(\)/);
  assert.match(main, /reconcileAuthorizedLifecycleAdapters\(\{ force: true \}\)/);
  assert.match(main, /finalizeStaleLifecycleSessions/);
  assert.match(main, /30 \* 60_000/);
  assert.match(main, /lifecycle-stale-empty:/);
  assert.match(main, /sourceAgent === "qclaw"/);
  const hostPluginSource = main.slice(main.indexOf('function openClawLifecyclePluginSource(sourceAgent) {'), main.indexOf('function installOpenClawLifecyclePlugin(configPath, sourceAgent) {'));
  assert.match(hostPluginSource, /!capture\.captureEpoch/);
  assert.match(hostPluginSource, /captureEpoch: String\(capture\.captureEpoch\)/);
  assert.match(main, /\["session_start", "message_received", "llm_output", "session_end"\]/);
  assert.match(main, /\["session_start", "message_received", "message_sent", "session_end"\]/);
  assert.match(main, /allowConversationAccess: true/);
  assert.match(main, /drainAgentLifecycleQueue/);
  assert.match(lifecycleHook, /\[Console\]::In\.ReadToEnd\(\)/);
  assert.match(lifecycleHook, /lifecycleCapture\.enabled/);
  assert.match(lifecycleHook, /\[string\]\$ManagedMarker/);
  assert.match(main, /managedLifecycleHookCommand: buildManagedLifecycleHookCommand/);
  assert.match(main, /function currentCodexHookIdentity\(\)/);
  assert.match(terminalLifecycle, /function lifecycleHookIdentity\(hookSourcePath, nativeHookPath\)/);
  assert.match(terminalLifecycle, /'-ManagedMarker', MANAGED_MARKER/);
  assert.match(main, /activeAgentLifecycleHookExecutablePath\(\)/);
  assert.match(main, /if \(sourceAgent === 'claude-code' && !\['SessionEnd', 'Interrupt'\]\.includes\(eventName\)\) handler\.async = true/);
  assert.doesNotMatch(main, /'# EDU-MANAGER-LIFECYCLE'/);
  assert.match(main, /lifecycleHealth/);
  assert.match(ui, /自动采集中/);
  assert.match(ui, /需要处理/);
  assert.match(ui, /Codex Hook 仅需确认一次/);
  assert.match(ui, /打开 Codex，一次确认/);
  assert.match(ui, /首个真实事件/);
  assert.match(main, /markCodexHookVerified/);
  assert.match(main, /codexHookOnboarding/);
  assert.doesNotMatch(main, /dangerously-bypass-hook-trust/i);
  assert.match(ui, /一次授权后，系统会自动探测并接入/);
  assert.doesNotMatch(main, /会话开始调用 \\`start_education_session\\`/);
  assert.doesNotMatch(main, /每轮回复后调用 \\`record_authorized_education_turn\\`/);
});

test('S1 retired tools are hidden from new selections while legacy data stays readable', () => {
  assert.match(ui, /legacyAgentToolIds = new Set<AgentToolId>\(\['chatgpt', 'coze', 'fastgpt'\]\)/);
  assert.match(ui, /旧配置，已停止适配/);
  assert.match(main, /KNOWN_AGENT_SOURCE_IDS\.map/);
  assert.equal(adapterRegistryModule.ACTIVE_AGENT_TOOL_IDS.includes('coze'), false);
  assert.equal(adapterRegistryModule.ACTIVE_AGENT_TOOL_IDS.includes('fastgpt'), false);
});
