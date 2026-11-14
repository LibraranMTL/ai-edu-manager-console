'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { probeWorkBuddyConnection, probeWorkBuddyDesktopIpc } = require('../electron/workbuddy-runtime.cjs');

test('connection check never invokes the classification model contract', async () => {
  const calls = { qualify: 0 };
  const result = await probeWorkBuddyConnection({
    available: true,
    exePath: 'C:/Program Files/WorkBuddy/WorkBuddy.exe',
    cliPath: 'C:/Program Files/WorkBuddy/codebuddy.js',
    desktopSessionAvailable: true,
  }, { qualify: async () => { calls.qualify++; } });
  assert.equal(calls.qualify, 0);
  assert.equal(result.installed, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.connected, true);
  assert.equal(result.code, 'connected');
});

test('connection health separates missing authentication from installation', async () => {
  const result = await probeWorkBuddyConnection({ available: true, exePath: 'workbuddy.exe', cliPath: 'codebuddy.js', desktopSessionAvailable: false });
  assert.equal(result.installed, true);
  assert.equal(result.connected, false);
  assert.equal(result.code, 'authentication_required');
});

test('desktop ipc probe verifies an externally-started named pipe without invoking a model', async () => {
  let connectedEndpoint = '';
  const socket = new EventEmitter(); socket.destroy = () => {};
  const pending = probeWorkBuddyDesktopIpc({ endpointPath: 'endpoint.json' }, {
    readFile: async () => JSON.stringify({ endpoint: '\\\\.\\pipe\\wbipc-abc-123', ticket: 'redacted' }),
    connect: endpoint => { connectedEndpoint = endpoint; queueMicrotask(() => socket.emit('connect')); return socket; },
  });
  const result = await pending;
  assert.equal(connectedEndpoint, '\\\\.\\pipe\\wbipc-abc-123');
  assert.deepEqual(result, { connected: true, authenticated: true, endpointFound: true, code: 'connected' });
});

test('stale desktop endpoint is authenticated but not reachable', async () => {
  const socket = new EventEmitter(); socket.destroy = () => {};
  const result = await probeWorkBuddyDesktopIpc({ endpointPath: 'endpoint.json' }, {
    readFile: async () => JSON.stringify({ endpoint: '\\\\.\\pipe\\wbipc-stale', ticket: 'redacted' }),
    connect: () => { queueMicrotask(() => socket.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }))); return socket; },
  });
  assert.equal(result.connected, false);
  assert.equal(result.authenticated, true);
  assert.equal(result.code, 'enoent');
});
