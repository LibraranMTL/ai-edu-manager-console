'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectCodexAuthorization } = require('../electron/agent-authorization-detection.cjs');

function fixture(overrides = {}) {
  const original = { runtime: { circuits: { codex: { phase: 'authorization', failures: 0, lastExecutionId: 'old-run' } } } };
  const calls = { acquired: 0, released: 0, refreshed: 0, probed: 0, written: 0 };
  let persisted;
  const options = {
    confirmed: true,
    acquire: () => { calls.acquired++; return () => { calls.released++; }; },
    refreshCapabilities: async () => { calls.refreshed++; return { codex: { available: true, authorized: true, exePath: 'synthetic-codex', healthMessage: 'CLI 已授权' } }; },
    probe: async executable => { calls.probed++; assert.equal(executable, 'synthetic-codex'); return { passed: true, message: 'synthetic ready' }; },
    readStore: () => original,
    writeStore: async value => { calls.written++; persisted = value; },
    now: () => '2026-10-12T08:00:00.000Z',
    ...overrides,
  };
  return { options, original, calls, persisted: () => persisted };
}

test('Codex detection requires explicit confirmation and sends no probe without it', async () => {
  const f = fixture({ confirmed: false });
  const result = await detectCodexAuthorization(f.options);
  assert.equal(result.ok, false);
  assert.match(result.message, /主动确认/);
  assert.deepEqual(f.calls, { acquired: 0, released: 0, refreshed: 0, probed: 0, written: 0 });
});

test('Codex detection respects the shared heavy-work gate', async () => {
  const f = fixture({ busy: true });
  const result = await detectCodexAuthorization(f.options);
  assert.equal(result.ok, false);
  assert.match(result.message, /后台正在处理资料/);
  assert.equal(f.calls.acquired, 0);
  assert.equal(f.calls.probed, 0);
});

test('logged-out Codex remains authorization-blocked without a structured probe', async () => {
  const f = fixture({ refreshCapabilities: async () => ({ codex: { available: true, authorized: false, exePath: 'synthetic-codex', healthMessage: 'CLI 配置或授权异常' } }) });
  const result = await detectCodexAuthorization(f.options);
  assert.equal(result.ok, false);
  assert.equal(result.automaticReady, false);
  assert.equal(f.calls.probed, 0);
  assert.equal(f.persisted().runtime.circuits.codex.phase, 'authorization');
  assert.equal(f.calls.released, 1);
});

test('successful synthetic Codex probe closes the authorization circuit but does not dispatch documents', async () => {
  const f = fixture();
  const result = await detectCodexAuthorization(f.options);
  assert.equal(result.ok, true);
  assert.equal(result.automaticReady, true);
  assert.equal(f.persisted().runtime.circuits.codex.phase, 'closed');
  assert.equal(f.persisted().runtime.circuits.codex.failures, 0);
  assert.equal(f.persisted().runtime.circuits.codex.lastExecutionId, 'old-run');
  assert.equal(f.calls.probed, 1);
  assert.equal(f.calls.written, 1);
  assert.equal(f.calls.released, 1);
  assert.deepEqual(f.original.runtime.circuits.codex, { phase: 'authorization', failures: 0, lastExecutionId: 'old-run' }, 'read model is cloned before mutation');
  assert.match(result.message, /明确选择.*重新分析/);
});

test('failed controlled probe opens cooldown and never claims authorization recovery', async () => {
  const f = fixture({ probe: async () => ({ passed: false, code: 'ETIMEDOUT', message: 'synthetic timeout' }) });
  const result = await detectCodexAuthorization(f.options);
  assert.equal(result.ok, false);
  assert.equal(result.authorized, true);
  assert.equal(result.automaticReady, false);
  assert.equal(f.persisted().runtime.circuits.codex.phase, 'open');
  assert.equal(f.persisted().runtime.circuits.codex.failures, 3);
  assert.match(result.message, /未发送学生资料.*未自动重派/);
  assert.equal(f.calls.released, 1);
});

test('persistence failure releases resources and leaves the live read model unchanged', async () => {
  const f = fixture({ writeStore: async () => { throw Error('synthetic disk failure'); } });
  const result = await detectCodexAuthorization(f.options);
  assert.equal(result.ok, false);
  assert.match(result.message, /synthetic disk failure/);
  assert.equal(f.calls.released, 1);
  assert.equal(f.original.runtime.circuits.codex.phase, 'authorization');
});

test('smart inbox and task center remove user-visible detection while legacy bridges remain compatible', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const inbox = fs.readFileSync(path.join(root, 'src', 'SmartInboxPanel.tsx'), 'utf8');
  const taskCenter = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  assert.match(main, /action === 'agentStatus'[\s\S]*agentControlPolicy\(student, CLASSIFICATION_PROFILE\)/);
  assert.match(main, /action === 'detectAgent'[\s\S]*student\.agentTool[\s\S]*detectCodexBackgroundAuthorization/);
  assert.match(main, /bridge:detectCodexBackgroundAuthorization/);
  assert.match(preload, /detectCodexBackgroundAuthorization\(confirmed\)[\s\S]*bridge:detectCodexBackgroundAuthorization/);
  assert.doesNotMatch(inbox, />检测当前学生 Agent 授权</);
  assert.match(inbox, /切换学生无需重新登录/);
  assert.match(inbox, /Agent 可用，可继续待办/);
  assert.match(inbox, /我已完成登录，继续/);
  assert.match(inbox, /r\.blockReason\?\.category/);
  assert.doesNotMatch(inbox, /需要重新登录并检测\/\.test/);
  assert.match(inbox, /agentStatus\?\.state === 'ready'/);
  assert.doesNotMatch(taskCenter, />检测 Codex 后台授权</);
  assert.doesNotMatch(taskCenter, />检测 WorkBuddy 后台授权</);
  assert.match(taskCenter, /启动或重试任务时，系统会先用不含学生资料的合成请求自动完成安全校验/);
});
