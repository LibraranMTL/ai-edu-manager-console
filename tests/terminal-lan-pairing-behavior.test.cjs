const assert = require('node:assert/strict');
const test = require('node:test');

const {
  filterDiscoveredHosts,
  hostUrlFromDiscovery,
  normalizeDiscoveredHost,
} = require('../electron/terminal-lan-pairing.cjs');

test('Windows terminal prefers the host URL matching the discovery address', () => {
  assert.equal(hostUrlFromDiscovery({
    lanUrls: ['http://192.168.1.8:18777', 'http://10.0.0.8:18777'],
    serverUrl: 'http://127.0.0.1:18777',
    port: 18777,
  }, '10.0.0.8'), 'http://10.0.0.8:18777');
});

test('discovered hosts use stable identity and fixed-code filtering', () => {
  const host = normalizeDiscoveredHost({
    type: 'AI_EDU_MANAGER_DISCOVERY',
    protocolVersion: 2,
    role: 'host',
    deviceId: 'host-1',
    machineCode: 'H-7K3M-P9Q2',
    displayName: '一班教师主机',
    lanUrls: ['http://192.168.8.2:18777'],
  }, { address: '192.168.8.2' });
  assert.equal(host.identityKey, 'host:host-1');
  assert.equal(host.hostUrl, 'http://192.168.8.2:18777');
  assert.deepEqual(filterDiscoveredHosts([host], 'P9Q2'), [host]);
  assert.deepEqual(filterDiscoveredHosts([host], '二班'), []);
});

test('legacy discovery remains visible but has no invented fixed identity', () => {
  const host = normalizeDiscoveredHost({
    type: 'AI_EDU_MANAGER_DISCOVERY',
    role: 'host',
    hostName: '旧版主机',
    serverUrl: 'http://192.168.3.2:18777',
  }, { address: '192.168.3.2' });
  assert.equal(host.protocolVersion, 1);
  assert.equal(host.deviceId, '');
  assert.equal(host.machineCode, '');
});
