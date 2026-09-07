const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  AUTO_CAPTURE_AGENT_IDS,
} = require('../electron/agent-adapter-registry.cjs');
const {
  MANAGED_MARKER,
  buildTerminalLifecycleDescriptor,
  drainTerminalLifecycleQueue,
  reconcileTerminalLifecycle,
  terminalGrantId,
  terminalLifecyclePaths,
} = require('../electron/student-agent-lifecycle.cjs');

const root = path.resolve(__dirname, '..');

function withTempRoot(run) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-student-agent-lifecycle-'));
  return Promise.resolve(run(tempRoot)).finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
}

function writeEnvelope(queueDir, name, overrides = {}) {
  fs.mkdirSync(queueDir, { recursive: true });
  const envelope = {
    schema: 'edu-manager.agent-lifecycle-event.v1',
    sourceAgent: 'codex',
    scopeId: 'student-1',
    grantId: terminalGrantId('device-1'),
    capturedAt: '2026-09-06T00:00:00.000Z',
    payload: { hook_event_name: 'UserPromptSubmit', session_id: 'native-1', prompt: '解释勾股定理。' },
    ...overrides,
  };
  fs.writeFileSync(path.join(queueDir, name), JSON.stringify(envelope), 'utf8');
  return envelope;
}

test('personal terminal descriptor fixes student and device scope without storing host credentials', () => {
  const descriptor = buildTerminalLifecycleDescriptor({
    studentId: 'student-1',
    deviceId: 'device-1',
    queueDir: path.join(os.tmpdir(), 'edu-student-agent-test-queue'),
    enabled: true,
  });
  assert.equal(descriptor.defaults.scopePolicy, 'fixed_personal_terminal_student');
  assert.equal(descriptor.defaults.scopeId, 'student-1');
  assert.equal(descriptor.defaults.deviceId, 'device-1');
  assert.equal(descriptor.authentication.grantId, 'terminal-device:device-1');
  assert.deepEqual(descriptor.lifecycleCapture.allowedAgents, AUTO_CAPTURE_AGENT_IDS);
  assert.deepEqual(descriptor.lifecycleCapture.excludes, ['historical_sessions', 'system_prompts', 'tool_secrets', 'task_center_context']);
  assert.doesNotMatch(JSON.stringify(descriptor), /sessionToken|deviceToken|hostUrl|bearer/i);
});

test('personal terminal installs managed Codex, WorkBuddy and QClaw adapters without deleting unrelated hooks', async () => withTempRoot(async (tempRoot) => {
  const homeDir = path.join(tempRoot, 'home');
  const userDataDir = path.join(tempRoot, 'user-data');
  const codexConfig = path.join(homeDir, '.codex', 'hooks.json');
  const qclawConfig = path.join(homeDir, '.qclaw', 'openclaw.json');
  const workBuddyConfigs = [path.join(homeDir, '.workbuddy', 'settings.json'), path.join(homeDir, '.codebuddy', 'settings.json')];
  fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
  fs.mkdirSync(path.dirname(qclawConfig), { recursive: true });
  for (const configPath of workBuddyConfigs) fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(codexConfig, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'keep-user-hook' }] }] } }), 'utf8');
  fs.writeFileSync(qclawConfig, JSON.stringify({ plugins: { allow: ['existing-plugin'] } }), 'utf8');

  const result = reconcileTerminalLifecycle({
    userDataDir,
    homeDir,
    hookSourcePath: path.join(root, 'electron', 'agent-lifecycle-hook.ps1'),
    studentId: 'student-1',
    deviceId: 'device-1',
    enabled: true,
    detectedAgents: {
      codex: { installed: true },
      qclaw: { installed: true, configPath: qclawConfig },
      workbuddy: { installed: true },
      openclaw: { installed: false },
      'claude-code': { installed: false },
      hermes: { installed: false },
    },
  });

  assert.equal(result.registrations.codex.connected, true);
  assert.equal(result.registrations.qclaw.connected, true);
  assert.equal(result.registrations.workbuddy.connected, true);
  const codex = JSON.parse(fs.readFileSync(codexConfig, 'utf8'));
  assert.equal(codex.hooks.SessionStart.some((group) => group.hooks.some((hook) => hook.command === 'keep-user-hook')), true);
  assert.equal(codex.hooks.SessionStart.some((group) => group.hooks.some((hook) => hook.command.includes(MANAGED_MARKER))), true);
  const qclaw = JSON.parse(fs.readFileSync(qclawConfig, 'utf8'));
  assert.equal(qclaw.plugins.entries['edu-manager-lifecycle'].enabled, true);
  assert.equal(qclaw.plugins.entries['edu-manager-lifecycle'].hooks.allowConversationAccess, true);
  assert.equal(qclaw.plugins.allow.includes('existing-plugin'), true);
  assert.equal(qclaw.plugins.allow.includes('edu-manager-lifecycle'), true);
  for (const configPath of workBuddyConfigs) {
    const workBuddy = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(workBuddy.hooks.SessionStart.some((group) => group.hooks.some((hook) => hook.command.includes(MANAGED_MARKER))), true);
  }
  const descriptor = JSON.parse(fs.readFileSync(terminalLifecyclePaths(userDataDir).descriptorPath, 'utf8'));
  assert.equal(descriptor.defaults.scopeId, 'student-1');
}));

test('queue relay posts only matching authorized events and removes successful files', async () => withTempRoot(async (tempRoot) => {
  const queueDir = path.join(tempRoot, 'queue');
  const expected = writeEnvelope(queueDir, '001.json');
  writeEnvelope(queueDir, '002.json', { scopeId: 'another-student' });
  const posted = [];
  const result = await drainTerminalLifecycleQueue({
    queueDir,
    studentId: 'student-1',
    deviceId: 'device-1',
    postEnvelope: async (envelope) => posted.push(envelope),
  });
  assert.deepEqual(posted, [expected]);
  assert.deepEqual(result, { processed: 1, discarded: 1, deferred: 0, pending: 0 });
}));

test('queue relay preserves an authorized event when the host is unavailable', async () => withTempRoot(async (tempRoot) => {
  const queueDir = path.join(tempRoot, 'queue');
  writeEnvelope(queueDir, '001.json');
  const result = await drainTerminalLifecycleQueue({
    queueDir,
    studentId: 'student-1',
    deviceId: 'device-1',
    postEnvelope: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(result, { processed: 0, discarded: 0, deferred: 1, pending: 1 });
  assert.equal(fs.readdirSync(queueDir).filter((name) => name.endsWith('.json')).length, 1);
}));

test('S1 host, terminal UI and package contract enforce personal Windows student capture', () => {
  const host = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const terminal = fs.readFileSync(path.join(root, 'electron', 'terminal-main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'terminal-preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src', 'terminal-main.tsx'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts', 'build-windows-terminal-release.cjs'), 'utf8');
  assert.match(host, /\/api\/student-session\/agent-memory\/capture/);
  assert.match(host, /\/api\/student-session\/agent-memory\/events/);
  assert.match(host, /auth\?\.type !== 'student_session' \|\| auth\.terminalMode !== 'personal'/);
  assert.match(host, /String\(device\.platform \|\| ''\)\.toLowerCase\(\) !== 'windows'/);
  assert.match(host, /String\(device\.boundStudentId \|\| ''\) !== String\(auth\.studentId\)/);
  assert.match(terminal, /token: config\.sessionToken/);
  assert.match(terminal, /agentCaptureDrainTimer = setInterval/);
  assert.match(terminal, /\[401, 403\]\.includes\(status\)/);
  assert.match(terminal, /主机暂不可达，新会话继续保留在本机队列/);
  assert.match(terminal, /当前 Windows 主机版本不支持个人终端自动会话采集，请将主机升级到 0\.16\.10 或更高版本/);
  assert.match(terminal, /detectedAgentCaptureRegistrations/);
  assert.match(terminal, /terminal:get-agent-capture', \(\) => refreshPersonalAgentCapture\(\)/);
  assert.match(terminal, /return \{ \.\.\.publicAgentCaptureState\(\), message: remote\.message/);
  assert.match(preload, /setAgentCapture/);
  assert.match(ui, /一次授权后，自动采集本机受支持 Agent 的新会话/);
  assert.match(ui, /共享终端不支持自动会话采集/);
  assert.match(ui, /已检测到.*个受支持 Agent.*授权后接入/);
  for (const file of ['student-agent-lifecycle.cjs', 'agent-adapter-registry.cjs', 'agent-lifecycle-hook.ps1']) {
    assert.match(build, new RegExp(file.replace(/\./g, '\\.')));
  }
});
