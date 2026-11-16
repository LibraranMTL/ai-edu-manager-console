'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWorkBuddyRuntimeStatusProbe, probeWindowsProcessImages,
  validCachedQualification } = require('../electron/workbuddy-runtime-status.cjs');

test('background status checks stay bounded and can stop without scheduling another poll', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const file = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let fn;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'startWorkBuddyStatusMonitor') fn = node; else ts.forEachChild(node, visit); }
  visit(file); assert.ok(fn);
  const timers = [], calls = [];
  const ctx = vm.createContext({ AUTOMATION_FEATURES: { workBuddyRuntimeStatusV2: true }, workBuddyStatusMonitor: null,
    workBuddyStatusMonitorStopped: false, refreshWorkBuddyRuntimeStatus: async value => calls.push(value),
    setTimeout: (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; } });
  vm.runInContext(source.slice(fn.getStart(file), fn.end), ctx);
  ctx.startWorkBuddyStatusMonitor();
  assert.equal(calls.length, 1); assert.equal(timers[0].delay, 60000);
  ctx.workBuddyStatusMonitorStopped = true;
  await timers[0].callback();
  assert.equal(calls.length, 2); assert.equal(timers.length, 1);
});

test('externally started WorkBuddy is open even when manager did not launch it', async () => {
  const status = createWorkBuddyRuntimeStatusProbe({
    now: () => Date.parse('2026-11-04T00:00:00.000Z'),
    findInstall: async () => ({ installed: true, exePath: 'C:/WorkBuddy/WorkBuddy.exe' }),
    discoverRuntime: () => ({ available: true, exePath: 'C:/WorkBuddy/WorkBuddy.exe', cliPath: 'C:/WorkBuddy/cli.js' }),
    findExecutable: () => 'C:/node.exe', hostNodePath: 'C:/electron.exe',
    readAuthorization: async () => ({ version: 0 }), applyAuthorization: value => value,
    processProbe: async () => true,
    ipcProbe: async () => ({ connected: true, authenticated: true }),
    readTaskRuntime: () => ({ agentQualifications: { workbuddy: {} } }),
    startedByManager: () => false,
  });
  const value = await status({ force: true });
  assert.equal(value.processRunning, true);
  assert.equal(value.workbuddyOpened, true);
  assert.equal(value.startedByManager, false);
  assert.equal(value.ipcReachable, true);
  assert.equal(value.reasonCode, 'desktop_connected');
});

test('dispatch readiness is separate from desktop presence', async () => {
  const now = Date.parse('2026-11-04T00:00:00.000Z');
  const status = createWorkBuddyRuntimeStatusProbe({
    now: () => now,
    findInstall: async () => ({ installed: true, exePath: 'C:/WorkBuddy/WorkBuddy.exe' }),
    discoverRuntime: () => ({ available: true, exePath: 'C:/WorkBuddy/WorkBuddy.exe', cliPath: 'C:/WorkBuddy/cli.js' }),
    findExecutable: () => 'C:/node.exe', hostNodePath: 'C:/electron.exe',
    readAuthorization: async () => ({ version: 1 }), applyAuthorization: value => value,
    processProbe: async () => false,
    ipcProbe: async () => ({ connected: false, authenticated: false }),
    readTaskRuntime: () => ({ agentQualifications: { workbuddy: { digest: {
      ready: true, expiresAt: '2026-11-04T01:00:00.000Z',
    } } } }),
    startedByManager: () => false,
  });
  const value = await status({ force: true });
  assert.equal(value.processRunning, false);
  assert.equal(value.dispatchReady, true);
  assert.equal(value.reasonCode, 'dispatch_ready');
});

test('a live desktop pipe keeps the legacy opened projection true when tasklist is unavailable', async () => {
  const status = createWorkBuddyRuntimeStatusProbe({
    findInstall: async () => ({ installed: true, exePath: 'C:/WorkBuddy/WorkBuddy.exe' }),
    discoverRuntime: () => ({ available: false, exePath: 'C:/WorkBuddy/WorkBuddy.exe' }),
    readAuthorization: async () => ({ version: 0 }), applyAuthorization: value => value,
    processProbe: async () => false,
    ipcProbe: async () => ({ connected: true, authenticated: true }),
    readTaskRuntime: () => ({}), startedByManager: () => false,
  });
  const value = await status({ force: true });
  assert.equal(value.processRunning, false);
  assert.equal(value.ipcReachable, true);
  assert.equal(value.workbuddyOpened, true);
});

test('process image probe recognizes a tasklist row', async () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter();
  const pending = probeWindowsProcessImages(['WorkBuddy.exe'], {
    platform: 'win32',
    spawnProcess: () => {
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from('"WorkBuddy.exe","123","Console","1","10,000 K"\r\n')); child.emit('close', 0); });
      return child;
    },
  });
  assert.equal(await pending, true);
});

test('expired qualifications never make automatic dispatch ready', () => {
  assert.equal(validCachedQualification({ agentQualifications: { workbuddy: { digest: {
    ready: true, expiresAt: '2026-11-03T23:59:59.000Z',
  } } } }, Date.parse('2026-11-04T00:00:00.000Z')), false);
});
