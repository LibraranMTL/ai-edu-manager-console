const os = require('os');

function ipv4ToNumber(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((total, part) => (((total << 8) | part) >>> 0), 0);
}

function ipv4BroadcastAddress(address, netmask) {
  const ip = ipv4ToNumber(address);
  const mask = ipv4ToNumber(netmask);
  if (ip === null || mask === null || mask === 0xffffffff) return '';
  const broadcast = ((ip & mask) | (~mask >>> 0)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (broadcast >>> shift) & 255).join('.');
}

function isTailscaleAddress(name, address) {
  const parts = String(address || '').split('.').map(Number);
  return String(name || '').toLowerCase().includes('tailscale') || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function lanDiscoveryBroadcastTargets(interfaces = os.networkInterfaces()) {
  const targets = new Set(['255.255.255.255']);
  for (const [name, entries] of Object.entries(interfaces || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== 'IPv4' || entry.internal || isTailscaleAddress(name, entry.address)) continue;
      if (/vEthernet|vmware|virtualbox|docker|hyper-v/i.test(String(name || ''))) continue;
      const broadcast = ipv4BroadcastAddress(entry.address, entry.netmask);
      if (broadcast) targets.add(broadcast);
    }
  }
  return [...targets];
}

module.exports = { ipv4BroadcastAddress, lanDiscoveryBroadcastTargets };
