const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  captureEpochMatches,
  codexTurnAllowed,
  lifecycleCaptureAllowed,
  normalizeLifecycleEnvelope,
} = require('../electron/agent-lifecycle-capture.cjs');
const { compileLifecycleHook } = require('../scripts/compile-lifecycle-hook.cjs');
const {
  managedLifecycleHookCommand,
  resolveWindowsPowerShellExecutable,
} = require('../electron/student-agent-lifecycle.cjs');

test('Codex and WorkBuddy lifecycle events become deterministic user and assistant messages', () => {
  const user = normalizeLifecycleEnvelope({
    sourceAgent: 'codex',
    scopeId: 'student-1',
    grantId: 'grant-1',
    capturedAt: '2026-09-05T00:00:00.000Z',
    payload: { hook_event_name: 'UserPromptSubmit', session_id: 'native-1', turn_id: 'turn-1', prompt: '请解释二次函数。' },
  });
  const assistant = normalizeLifecycleEnvelope({
    sourceAgent: 'workbuddy',
    scopeId: 'student-1',
    grantId: 'grant-1',
    capturedAt: '2026-09-05T00:00:01.000Z',
    payload: { hook_event_name: 'Stop', session_id: 'native-2', last_assistant_message: '可以从图像开始理解。' },
  });
  assert.equal(user.action, 'append');
  assert.equal(user.message.role, 'user');
  assert.equal(user.message.content, '请解释二次函数。');
  assert.equal(assistant.action, 'append');
  assert.equal(assistant.message.role, 'assistant');
  assert.equal(assistant.message.content, '可以从图像开始理解。');
  assert.equal(user.sessionId, normalizeLifecycleEnvelope({
    sourceAgent: 'codex',
    capturedAt: '2026-09-05T00:00:02.000Z',
    payload: { hook_event_name: 'SessionEnd', session_id: 'native-1' },
  }).sessionId);
});

test('OpenClaw and QClaw typed hooks use only emitted event content and session identity', () => {
  const received = normalizeLifecycleEnvelope({
    sourceAgent: 'qclaw',
    scopeId: 'student-2',
    grantId: 'grant-2',
    payload: {
      hook_event_name: 'message_received',
      event: { content: '只采集这一条新消息', messageId: 'm1' },
      context: { sessionKey: 'channel:student-2' },
    },
  });
  const ended = normalizeLifecycleEnvelope({
    sourceAgent: 'openclaw',
    payload: {
      hook_event_name: 'session_end',
      event: { sessionId: 'session-9', reason: 'idle' },
      context: { sessionId: 'session-9' },
    },
  });
  assert.equal(received.nativeSessionId, 'channel:student-2');
  assert.deepEqual(received.message.role, 'user');
  assert.equal(ended.action, 'finalize');
});

test('current QClaw llm_output captures only the emitted assistant text for the same session', () => {
  const received = normalizeLifecycleEnvelope({
    sourceAgent: 'qclaw',
    scopeId: 'student-2',
    grantId: 'grant-2',
    payload: {
      hook_event_name: 'message_received',
      event: { content: '自动会话采集验收测试', messageId: 'message-1' },
      context: { sessionKey: 'agent:baoshuyuan:session-1' },
    },
  });
  const output = normalizeLifecycleEnvelope({
    sourceAgent: 'qclaw',
    scopeId: 'student-2',
    grantId: 'grant-2',
    capturedAt: '2026-09-07T07:46:01.000Z',
    payload: {
      hook_event_name: 'llm_output',
      event: {
        runId: 'run-1',
        sessionId: '7cba7054-c6b4-4ac4-8ad4-69fe42e6aed1',
        assistantTexts: ['测试通过'],
        lastAssistant: { role: 'assistant', content: '不读取这个扩展对象' },
      },
      context: { sessionKey: 'agent:baoshuyuan:session-1' },
    },
  });
  assert.equal(output.action, 'append');
  assert.equal(output.message.role, 'assistant');
  assert.equal(output.message.content, '测试通过');
  assert.equal(output.nativeSessionId, 'agent:baoshuyuan:session-1');
  assert.equal(output.sessionId, received.sessionId);
});

test('Claude Code and Hermes lifecycle events use the same normalized queue protocol', () => {
  const claudeFailure = normalizeLifecycleEnvelope({
    sourceAgent: 'claude-code',
    payload: { hook_event_name: 'StopFailure', session_id: 'claude-native-1' },
  });
  const hermesUser = normalizeLifecycleEnvelope({
    sourceAgent: 'hermes',
    capturedAt: '2026-09-06T00:00:00.000Z',
    payload: { hook_event_name: 'pre_llm_call', session_id: 'hermes-native-1', user_message: '请总结实验现象。' },
  });
  const hermesAssistant = normalizeLifecycleEnvelope({
    sourceAgent: 'hermes',
    capturedAt: '2026-09-06T00:00:01.000Z',
    payload: { hook_event_name: 'post_llm_call', session_id: 'hermes-native-1', assistant_response: '现象表明温度升高会加快反应。' },
  });
  assert.equal(claudeFailure.action, 'finalize');
  assert.equal(claudeFailure.status, 'failed');
  assert.equal(hermesUser.message.role, 'user');
  assert.equal(hermesUser.message.content, '请总结实验现象。');
  assert.equal(hermesAssistant.message.role, 'assistant');
  assert.equal(hermesUser.sessionId, hermesAssistant.sessionId);
});

test('unsupported, protected and disabled lifecycle inputs are ignored', () => {
  assert.equal(normalizeLifecycleEnvelope({ sourceAgent: 'codex', payload: { hook_event_name: 'PreToolUse', session_id: 's' } }), null);
  assert.equal(normalizeLifecycleEnvelope({ sourceAgent: 'codex', payload: { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '' } }), null);
  assert.equal(lifecycleCaptureAllowed({ lifecycleCapture: { enabled: true, allowedAgents: ['codex'] } }, 'codex'), true);
  assert.equal(lifecycleCaptureAllowed({ lifecycleCapture: { enabled: false, allowedAgents: ['codex'] } }, 'codex'), false);
});

test('an existing Codex session starts a new authorization segment at the next user turn', () => {
  const base = {
    sourceAgent: 'codex',
    scopeId: 'student-1',
    grantId: 'grant-1',
    captureEpoch: 'epoch-2',
  };
  const priorStop = normalizeLifecycleEnvelope({
    ...base,
    capturedAt: '2026-09-12T10:00:01.000Z',
    payload: { hook_event_name: 'Stop', session_id: 'already-open', turn_id: 'before-consent', last_assistant_message: 'Old answer' },
  });
  assert.equal(codexTurnAllowed(priorStop, null), false);
  const user = normalizeLifecycleEnvelope({
    ...base,
    capturedAt: '2026-09-12T10:00:02.000Z',
    payload: { hook_event_name: 'UserPromptSubmit', session_id: 'already-open', turn_id: 'after-consent', prompt: 'New question' },
  });
  assert.equal(codexTurnAllowed(user, null), true);
  const assistant = normalizeLifecycleEnvelope({
    ...base,
    capturedAt: '2026-09-12T10:00:03.000Z',
    payload: { hook_event_name: 'Stop', session_id: 'already-open', turn_id: 'after-consent', last_assistant_message: 'New answer' },
  });
  assert.equal(codexTurnAllowed(assistant, { messages: [user.message] }), true);
  assert.equal(codexTurnAllowed(priorStop, { messages: [user.message] }), false);
  const laterEpoch = normalizeLifecycleEnvelope({
    ...base,
    captureEpoch: 'epoch-3',
    capturedAt: '2026-09-12T10:00:04.000Z',
    payload: { hook_event_name: 'UserPromptSubmit', session_id: 'already-open', turn_id: 'after-consent', prompt: 'New question' },
  });
  assert.notEqual(user.sessionId, laterEpoch.sessionId);
  assert.notEqual(user.turnMarker, laterEpoch.turnMarker);
  assert.equal(captureEpochMatches({ captureEpoch: 'epoch-2', capturedAt: '2026-09-12T10:00:02.000Z' }, { enabled: true, captureEpoch: 'epoch-2', authorizedAt: '2026-09-12T10:00:00.000Z' }), true);
  assert.equal(captureEpochMatches({ captureEpoch: 'epoch-1', capturedAt: '2026-09-12T10:00:02.000Z' }, { enabled: true, captureEpoch: 'epoch-2', authorizedAt: '2026-09-12T10:00:00.000Z' }), false);
  assert.equal(captureEpochMatches({ captureEpoch: 'epoch-2', capturedAt: '2026-09-12T10:00:02.000Z' }, { enabled: false, captureEpoch: 'epoch-2', authorizedAt: '2026-09-12T10:00:00.000Z' }), false);
});

test('Windows WorkBuddy lifecycle hook accepts the managed marker and queues an authorized event', { skip: process.platform !== 'win32' }, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-lifecycle-hook-'));
  try {
    const queueDir = path.join(tempRoot, 'queue');
    const descriptorPath = path.join(tempRoot, 'descriptor.json');
    fs.writeFileSync(descriptorPath, JSON.stringify({
      authentication: { grantId: 'grant-test' },
      defaults: { scopeId: 'student-test' },
      lifecycleCapture: { enabled: true, captureEpoch: 'epoch-test', allowedAgents: ['workbuddy'], queueDir },
    }), 'utf8');
    const prompt = '自动会话采集验收测试 🧪';
    const powershell = resolveWindowsPowerShellExecutable();
    const command = managedLifecycleHookCommand('workbuddy', path.join(__dirname, '..', 'electron', 'agent-lifecycle-hook.ps1'), descriptorPath, '');
    assert.ok(path.isAbsolute(powershell));
    assert.ok(command.startsWith(`${powershell} -NoProfile`));
    const result = spawnSync(powershell, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, '..', 'electron', 'agent-lifecycle-hook.ps1'),
      '-Descriptor', descriptorPath,
      '-SourceAgent', 'workbuddy',
      '-ManagedMarker', 'EDU-MANAGER-LIFECYCLE',
    ], {
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt }),
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, PATH: '' },
    });
    assert.equal(result.status, 0);
    const queued = fs.readdirSync(queueDir).filter((name) => name.endsWith('.json'));
    assert.equal(queued.length, 1);
    const envelope = JSON.parse(fs.readFileSync(path.join(queueDir, queued[0]), 'utf8'));
    assert.equal(envelope.scopeId, 'student-test');
    assert.equal(envelope.grantId, 'grant-test');
    assert.equal(envelope.captureEpoch, 'epoch-test');
    assert.equal(envelope.sourceAgent, 'workbuddy');
    assert.equal(envelope.payload.prompt, prompt);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Windows lifecycle hook accepts Claude Code and Hermes adapter ids', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'agent-lifecycle-hook.ps1'), 'utf8');
  assert.match(source, /ValidateSet\('codex', 'qclaw', 'workbuddy', 'openclaw', 'claude-code', 'hermes'\)/);
});

test('native Codex lifecycle hook queues only authorized new events and returns valid Stop JSON', { skip: process.platform !== 'win32' }, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-native-lifecycle-hook-'));
  try {
    const executable = compileLifecycleHook(
      path.join(__dirname, '..', 'electron', 'agent-lifecycle-hook.cs'),
      path.join(tempRoot, 'agent-lifecycle-hook.exe'),
    );
    const queueDir = path.join(tempRoot, 'queue');
    const descriptorPath = path.join(tempRoot, 'descriptor.json');
    const descriptor = {
      authentication: { grantId: 'grant-test' },
      defaults: { scopeId: 'student-test' },
      lifecycleCapture: { enabled: true, captureEpoch: 'epoch-test', allowedAgents: ['codex'], queueDir },
    };
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor), 'utf8');
    const invoke = (event) => spawnSync(executable, [
      '-Descriptor', descriptorPath, '-SourceAgent', 'codex', '-ManagedMarker', 'EDU-MANAGER-LIFECYCLE',
    ], { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true });
    const prompt = invoke({ hook_event_name: 'UserPromptSubmit', session_id: 'old-session', turn_id: 'new-turn', prompt: '授权后的问题 🧪' });
    assert.equal(prompt.status, 0);
    assert.deepEqual(JSON.parse(prompt.stdout), {});
    const stop = invoke({ hook_event_name: 'Stop', session_id: 'old-session', turn_id: 'new-turn', last_assistant_message: '授权后的回答。' });
    assert.equal(stop.status, 0);
    assert.deepEqual(JSON.parse(stop.stdout), {});
    const queued = fs.readdirSync(queueDir).filter((name) => name.endsWith('.json'));
    assert.equal(queued.length, 2);
    const envelopes = queued.map((name) => JSON.parse(fs.readFileSync(path.join(queueDir, name), 'utf8')));
    assert.equal(envelopes.every((item) => item.captureEpoch === 'epoch-test' && item.scopeId === 'student-test'), true);
    assert.equal(envelopes.some((item) => item.payload.prompt === '授权后的问题 🧪'), true);
    descriptor.lifecycleCapture.enabled = false;
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor), 'utf8');
    assert.deepEqual(JSON.parse(invoke({ hook_event_name: 'Stop', session_id: 'old-session', last_assistant_message: '不应采集' }).stdout), {});
    assert.equal(fs.readdirSync(queueDir).filter((name) => name.endsWith('.json')).length, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
