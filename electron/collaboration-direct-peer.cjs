const { normalizeDeliveryStore } = require('./collaboration-direct-queue.cjs');

const LEGACY_SHARED_SECRET_PATTERN = /^[a-f0-9]{64}$/i;
const ENDPOINT_IDENTITY_MISMATCH_PATTERN = /发送方或目标主机不匹配|目标主机不匹配/;

function directEndpointKey(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return '';
  }
}

function isAutomaticPrivateEndpoint(value) {
  try {
    const hostname = new URL(String(value || '').trim()).hostname.replace(/^\[|\]$/g, '');
    return hostname.startsWith('169.254.');
  } catch {
    return false;
  }
}

function excludeLocalDirectEndpoints(peerEndpoints = [], localEndpoints = []) {
  const localKeys = new Set(localEndpoints.map(directEndpointKey).filter(Boolean));
  return [...new Set(peerEndpoints.map(String).filter((endpoint) => {
    const key = directEndpointKey(endpoint);
    return Boolean(key) && !isAutomaticPrivateEndpoint(endpoint) && !localKeys.has(key);
  }))];
}

function selectDirectDeliveryError(errors = []) {
  const usable = errors.filter(Boolean);
  const meaningful = usable.filter((error) => !ENDPOINT_IDENTITY_MISMATCH_PATTERN.test(String(error?.message || error || '')));
  if (meaningful.length) return meaningful[meaningful.length - 1];
  if (usable.length) {
    const error = new Error('已忽略指向本机或其他主机的旧协作地址；正在等待重新发现对端主机。');
    error.code = 'DIRECT_ENDPOINT_IDENTITY_MISMATCH';
    return error;
  }
  return new Error('局域网和 Tailscale 地址均暂不可用。');
}

function directSecretForBinding(binding = {}, secrets = {}) {
  const stored = String(secrets?.[binding.bindingId] || '').trim();
  if (stored) return stored;
  const legacy = String(binding.sharedSecretRef || '').trim();
  return LEGACY_SHARED_SECRET_PATTERN.test(legacy) ? legacy : '';
}

function mergeBindingDirectOffer(binding = {}, peerNodeId, offer = {}) {
  const cleanPeerNodeId = String(peerNodeId || '').trim();
  const endpoints = Array.from(new Set((Array.isArray(offer.endpoints) ? offer.endpoints : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  if (!cleanPeerNodeId || !endpoints.length) return { binding, changed: false };
  const current = Array.isArray(binding.transportOffers) ? binding.transportOffers : [];
  const previous = current.find((item) => (
    item?.nodeId === cleanPeerNodeId
    && item?.transportId === String(offer.transportId || 'lan_direct')
  ));
  const nextOffer = {
    nodeId: cleanPeerNodeId,
    transportId: String(offer.transportId || 'lan_direct'),
    protocolVersion: String(offer.protocolVersion || '1.0'),
    endpoints,
    preferred: offer.preferred !== false,
  };
  if (
    previous
    && previous.protocolVersion === nextOffer.protocolVersion
    && previous.preferred === nextOffer.preferred
    && JSON.stringify(previous.endpoints) === JSON.stringify(nextOffer.endpoints)
  ) return { binding, changed: false };
  return {
    binding: {
      ...binding,
      transportOffers: [
        ...current.filter((item) => !(
          item?.nodeId === cleanPeerNodeId
          && item?.transportId === nextOffer.transportId
        )),
        nextOffer,
      ],
      lastSeenAt: String(offer.lastSeenAt || new Date().toISOString()),
    },
    changed: true,
  };
}

function promoteCompatibilityDeliveries(input = {}, options = {}) {
  const targetNodeId = String(options.targetNodeId || '').trim();
  const bindingId = String(options.bindingId || '').trim();
  const baseUrls = Array.from(new Set((Array.isArray(options.baseUrls) ? options.baseUrls : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  const packageExists = typeof options.packageExists === 'function' ? options.packageExists : () => true;
  const store = normalizeDeliveryStore(input);
  const promotedManifestIds = [];
  if (!targetNodeId || !bindingId || !baseUrls.length) return { store, promotedManifestIds };
  for (const record of Object.values(store.deliveries)) {
    if (
      record.status !== 'compatibility_queue'
      || record.targetNodeId !== targetNodeId
      || !record.packageRoot
      || !packageExists(record.packageRoot)
    ) continue;
    record.status = 'queued';
    record.bindingId = bindingId;
    record.baseUrls = baseUrls;
    record.nextAttemptAt = '';
    record.error = '';
    record.updatedAt = new Date().toISOString();
    promotedManifestIds.push(record.manifestId);
  }
  return { store, promotedManifestIds };
}

module.exports = {
  directSecretForBinding,
  excludeLocalDirectEndpoints,
  mergeBindingDirectOffer,
  promoteCompatibilityDeliveries,
  selectDirectDeliveryError,
};
