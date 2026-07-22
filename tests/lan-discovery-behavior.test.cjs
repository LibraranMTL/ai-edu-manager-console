const assert = require('node:assert/strict');
const test = require('node:test');

const { ipv4BroadcastAddress, lanDiscoveryBroadcastTargets } = require('../electron/lan-discovery.cjs');

test('directed broadcast addresses follow the active IPv4 netmask', () => {
  assert.equal(ipv4BroadcastAddress('192.168.23.41', '255.255.255.0'), '192.168.23.255');
  assert.equal(ipv4BroadcastAddress('10.12.34.56', '255.255.0.0'), '10.12.255.255');
  assert.equal(ipv4BroadcastAddress('192.168.1.9', '255.255.255.255'), '');
  assert.equal(ipv4BroadcastAddress('not-an-ip', '255.255.255.0'), '');
});

test('tablet discovery uses global and physical-LAN broadcasts only', () => {
  const targets = lanDiscoveryBroadcastTargets({
    WiFi: [{ family: 'IPv4', internal: false, address: '192.168.8.20', netmask: '255.255.255.0' }],
    Ethernet: [{ family: 'IPv4', internal: false, address: '10.0.5.8', netmask: '255.255.0.0' }],
    Tailscale: [{ family: 'IPv4', internal: false, address: '100.88.1.2', netmask: '255.255.255.255' }],
    'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.32.1', netmask: '255.255.240.0' }],
  });
  assert.deepEqual(targets, ['255.255.255.255', '192.168.8.255', '10.0.255.255']);
});
