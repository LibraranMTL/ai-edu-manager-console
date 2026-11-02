'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { probeWorkBuddyConnection } = require('../electron/workbuddy-runtime.cjs');

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
