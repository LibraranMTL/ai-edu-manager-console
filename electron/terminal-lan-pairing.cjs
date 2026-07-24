const { normalizeHostUrl } = require('./terminal-upload.cjs');

const HOST_DISCOVERY_PORT = 18778;
const HOST_DISCOVERY_REQUEST_V1 = 'AI_EDU_MANAGER_DISCOVER_V1';
const HOST_DISCOVERY_REQUEST_V2 = 'AI_EDU_MANAGER_DISCOVER';
const HOST_DISCOVERY_RESPONSE = 'AI_EDU_MANAGER_DISCOVERY';
const HOST_PAIR_INVITE = 'AI_EDU_MANAGER_PAIR_INVITE';

function hostUrlFromDiscovery(payload = {}, remoteAddress = '') {
  const candidates = [
    ...(Array.isArray(payload.lanUrls) ? payload.lanUrls : []),
    payload.serverUrl,
  ].map(normalizeHostUrl).filter(Boolean);
  const exact = candidates.find((candidate) => {
    try { return new URL(candidate).hostname === String(remoteAddress || ''); }
    catch { return false; }
  });
  if (exact) return exact;
  const nonLoopback = candidates.find((candidate) => !/\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(candidate));
  if (nonLoopback) return nonLoopback;
  const port = Number(payload.port || 18777);
  if (remoteAddress && Number.isInteger(port) && port > 0 && port <= 65535) return `http://${remoteAddress}:${port}`;
  return candidates[0] || '';
}

function normalizeDiscoveredHost(payload = {}, remote = {}) {
  if (payload.type !== HOST_DISCOVERY_RESPONSE || payload.role !== 'host') return null;
  const protocolVersion = Number(payload.protocolVersion || 1);
  const deviceId = String(payload.deviceId || '').trim();
  const machineCode = String(payload.machineCode || '').trim().toUpperCase();
  const hostUrl = hostUrlFromDiscovery(payload, remote.address);
  if (!hostUrl) return null;
  return {
    identityKey: deviceId ? `host:${deviceId}` : `endpoint:${hostUrl}`,
    deviceId,
    machineCode,
    displayName: String(payload.displayName || payload.hostName || 'AI教育管家主机').trim().slice(0, 80) || 'AI教育管家主机',
    appVersion: String(payload.appVersion || ''),
    protocolVersion,
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    hostUrl,
    address: String(remote.address || ''),
    lastSeenAt: new Date().toISOString(),
  };
}

function filterDiscoveredHosts(hosts, query) {
  const normalizedQuery = String(query || '').trim().toUpperCase();
  if (!normalizedQuery) return Array.isArray(hosts) ? hosts : [];
  return (Array.isArray(hosts) ? hosts : []).filter((host) =>
    String(host.machineCode || '').toUpperCase().includes(normalizedQuery)
    || String(host.displayName || '').toUpperCase().includes(normalizedQuery));
}

module.exports = {
  HOST_DISCOVERY_PORT,
  HOST_DISCOVERY_REQUEST_V1,
  HOST_DISCOVERY_REQUEST_V2,
  HOST_DISCOVERY_RESPONSE,
  HOST_PAIR_INVITE,
  filterDiscoveredHosts,
  hostUrlFromDiscovery,
  normalizeDiscoveredHost,
};
