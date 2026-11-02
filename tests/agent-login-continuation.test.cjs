'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const start = source.indexOf('async function agentControlAction(');
const actionSource = source.slice(start, source.indexOf('\n}', start) + 2);

test('login status polling reads only the selected login session and never probes or dispatches', async () => {
  const ctx = vm.createContext({ classificationAuth: () => ({ status: id => ({ state: 'finished', message: id }) }) });
  vm.runInContext(actionSource, ctx);
  assert.equal((await ctx.agentControlAction('loginStatus', { providerId: 'workbuddy' })).login.message, 'workbuddy');
  assert.equal((await ctx.agentControlAction('loginStatus', { providerId: 'codex' })).login.state, 'finished');
  await assert.rejects(ctx.agentControlAction('loginStatus', { providerId: 'untrusted' }), /不支持/);
});

test('ordinary connection verification preserves authorization version and clears login guidance only after success', async () => {
  let fail = true, cleared = 0, released = 0, invalidated = 0;
  const auth = { invalidate: async () => { invalidated++; }, complete: () => { cleared++; } };
  const ctx = vm.createContext({
    require: name => require(path.join(__dirname, '../electron', name)), aiExecutorRegistry: () => [],
    classificationAuth: () => auth, classificationAdapter: async id => ({ id }), taskChildProcesses: new Set(),
    agentControlStore: () => ({ migrate: async () => {} }),
    acquireUserAgentProbe: () => ({ release: () => { released++; }, message: '' }),
    captureHeavyWorkGate: { state: () => [], tryAcquire: () => () => { released++; } }, captureTimelineResourceSnapshot: () => ({}),
    smartInboxHostRuntime: { routing: { invalidate() {}, qualify: async () => { if (fail) throw Error('synthetic network failure'); } } },
    getSmartInbox: async () => ({ resumeAgent: async () => { throw Error('must not run'); } }), readStudentsIndex: () => [],
  });
  vm.runInContext(actionSource, ctx);
  await assert.rejects(ctx.agentControlAction('verify', { providerId: 'codex', requestId: 'one' }), /network failure/);
  assert.equal(cleared, 0); assert.equal(released, 1);
  fail = false;
  assert.match((await ctx.agentControlAction('verify', { providerId: 'codex', requestId: 'two' })).message, /连接仍然有效/);
  assert.equal(cleared, 1); assert.equal(released, 2); assert.equal(invalidated, 0);
});
