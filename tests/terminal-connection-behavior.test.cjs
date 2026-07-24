const assert = require('node:assert/strict');
const test = require('node:test');

const { parseConnectionPayload } = require('../electron/terminal-connection.cjs');

const copiedConnectionInfo = JSON.stringify({
  serverUrl: 'http://127.0.0.1:18777',
  lanUrls: ['http://192.168.8.2:18777'],
  tailscaleUrl: 'http://100.88.1.2:18777',
  tailscaleUrls: ['http://100.88.1.2:18777', 'http://teacher.tailnet.ts.net:18777'],
  pairCode: '123456',
});

test('LAN choice only selects a LAN address from copied host information', () => {
  const parsed = parseConnectionPayload(copiedConnectionInfo, '', '', 'lan');
  assert.equal(parsed.connectionMethod, 'lan');
  assert.equal(parsed.hostUrl, 'http://192.168.8.2:18777');
  assert.equal(parsed.pairCode, '123456');
  assert.equal(parsed.hasLanAddress, true);
  assert.equal(parsed.hasTailscaleAddress, true);
});

test('Tailscale choice only selects a Tailscale address from copied host information', () => {
  const parsed = parseConnectionPayload(copiedConnectionInfo, '', '', 'tailscale');
  assert.equal(parsed.connectionMethod, 'tailscale');
  assert.equal(parsed.hostUrl, 'http://100.88.1.2:18777');
  assert.equal(parsed.pairCode, '123456');
});

test('Tailscale choice does not silently fall back to a LAN address', () => {
  const parsed = parseConnectionPayload(JSON.stringify({
    lanUrls: ['http://192.168.8.2:18777'],
    pairCode: '123456',
  }), '', '', 'tailscale');
  assert.equal(parsed.hostUrl, '');
  assert.equal(parsed.hasLanAddress, true);
  assert.equal(parsed.hasTailscaleAddress, false);
});

test('manual address remains valid for the explicitly selected connection choice', () => {
  const parsed = parseConnectionPayload('', '100.88.1.2:18777', '654321', 'tailscale');
  assert.equal(parsed.hostUrl, 'http://100.88.1.2:18777');
  assert.equal(parsed.pairCode, '654321');
});
