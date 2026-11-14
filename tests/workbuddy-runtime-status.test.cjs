'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWorkBuddyRuntimeStatusProbe, probeWindowsProcessImages,
  validCachedQualification } = require('../electron/workbuddy-runtime-status.cjs');

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
