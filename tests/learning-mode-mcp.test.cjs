'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { setTimeout: wait } = require('node:timers/promises');
const test = require('node:test');
const { createFocusServer, createFocusClient, ENABLE, STATUS } = require('../electron/learning-mode-mcp.cjs');

function fixture(t, role) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-focus-mcp-'));
  const executable = path.join(root, 'installed.exe');
  fs.closeSync(fs.openSync(executable, 'w'));
  let mode = 'disabled';
  let decision;
  let requests = 0;
  const server = createFocusServer({
    root, role, executable, installed: () => true,
    snapshot: () => ({ mode, applicationControl: 'waiting', browsers: { edge: 'not_connected', chrome: 'not_connected' } }),
    activate: ({ permitted, signal, onConfirmed }) => {
      requests++;
      return new Promise(resolve => {
        decision = state => {
          if (state === 'enabled' && permitted()) { onConfirmed(); mode = 'enabled'; }
          resolve({ state });
        };
        signal.addEventListener('abort', () => decision('cancelled'), { once: true });
      });
    },
  });
  t.after(() => {
    server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const config = provider => ({ root, role, provider });
  return { root, server, executable, config, approve: state => decision(state), count: () => requests };
}

async function settled(query) {
  for (let i = 0; i < 50; i++) {
    const value = await query();
    if (value.state !== 'awaiting_confirmation') return value;
    await wait(10);
  }
  assert.fail('receipt never settled');
}

test('cold start, concurrent retry, local confirmation and distinct browser status', async t => {
  const f = fixture(t, 'host');
  let launched = 0;
  const codex = createFocusClient(f.config('codex'), {
    launch: async (exe, userData) => {
      assert.equal(exe, f.executable);
      assert.equal(userData, path.dirname(f.root));
      launched++;
      await f.server.start();
    },
  });
  assert.deepEqual(codex.tools(), []);
  assert.equal((await codex.call(ENABLE)).code, 'FOCUS_NOT_AUTHORIZED');
  f.server.setAccess('codex', true);
  assert.deepEqual(codex.tools().map(tool => tool.name), [ENABLE, STATUS]);
  assert.equal((await codex.call(STATUS)).code, 'FOCUS_NOT_RUNNING');
  assert.equal(launched, 0);
  const [first, second] = await Promise.all([codex.call(ENABLE), codex.call(ENABLE)]);
  assert.equal(launched, 1);
  assert.equal(first.requestId, second.requestId);
  assert.equal(f.count(), 1);
  assert.equal(first.mode, 'disabled');
  assert.equal((await codex.call(ENABLE, { password: '123456' })).code, 'INVALID_FOCUS_REQUEST');
  f.approve('enabled');
  const outcome = await settled(() => codex.call(STATUS, { requestId: first.requestId }));
  assert.equal(outcome.state, 'enabled');
  assert.equal(outcome.mode, 'enabled');
  assert.equal(outcome.applicationControl, 'waiting');
  assert.equal(outcome.browsers.edge, 'not_connected');
  assert.equal((await codex.call(ENABLE)).state, 'already_enabled');
});

test('distinct Agent grants, cancellation, timeout and immediate revocation', async t => {
  const f = fixture(t, 'student');
  f.server.setAccess('codex', true);
  f.server.setAccess('workbuddy', true);
  await f.server.start();
  const codex = createFocusClient(f.config('codex'));
  const buddy = createFocusClient(f.config('workbuddy'));
  const requested = await codex.call(ENABLE);
  assert.equal((await buddy.call(ENABLE)).code, 'FOCUS_BUSY');
  assert.equal((await buddy.call(STATUS, { requestId: requested.requestId })).code, 'FOCUS_REQUEST_EXPIRED');
  f.approve('timed_out');
  assert.equal((await settled(() => codex.call(STATUS, { requestId: requested.requestId }))).state, 'timed_out');
  const next = await buddy.call(ENABLE);
  f.approve('cancelled');
  assert.equal((await settled(() => buddy.call(STATUS, { requestId: next.requestId }))).mode, 'disabled');
  await codex.call(ENABLE);
  f.server.setAccess('codex', false);
  assert.equal((await codex.call(STATUS)).code, 'FOCUS_NOT_AUTHORIZED');
  assert.equal((await buddy.call(STATUS)).mode, 'disabled');
});

for (const role of ['host', 'student']) {
  test(role + ' stdio connector advertises focus only when educational data service is unavailable', async t => {
    const f = fixture(t, role);
    f.server.setAccess('workbuddy', true);
    const configFile = path.join(f.root, 'mcp.json');
    fs.writeFileSync(configFile, JSON.stringify({
      focus: f.config('workbuddy'), endpoint: 'http://127.0.0.1:1/api/agent/connector',
      credentialFile: path.join(f.root, 'missing'), knowledgeConfigPath: path.join(f.root, 'missing-session'),
    }));
    await f.server.start();
    const script = role === 'host' ? 'external-agent-mcp.cjs' : 'terminal-agent-mcp.cjs';
    const child = spawn(process.execPath, [path.join(__dirname, '../electron', script), configFile], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    t.after(() => child.kill());
    const lines = createInterface({ input: child.stdout });
    let counter = 0;
    async function rpc(method, params) {
      const id = ++counter;
      const answer = once(lines, 'line', { signal: AbortSignal.timeout(5000) });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      const [line] = await answer;
      const parsed = JSON.parse(line);
      assert.equal(parsed.id, id);
      assert.ok(parsed.result, line);
      return parsed.result;
    }
    assert.deepEqual((await rpc('tools/list')).tools.map(tool => tool.name), [ENABLE, STATUS]);
    const result = await rpc('tools/call', { name: ENABLE, arguments: {} });
    assert.equal(JSON.parse(result.content[0].text).state, 'awaiting_confirmation');
    f.approve('enabled');
    const status = await rpc('tools/call', { name: STATUS, arguments: {} });
    assert.equal(JSON.parse(status.content[0].text).mode, 'enabled');
  });
}
