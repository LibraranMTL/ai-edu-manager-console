const { normalizeHostUrl } = require('./terminal-upload.cjs');

function parseConnectionPayload(text, fallbackHostUrl = '', fallbackPairCode = '', connectionMethod = 'lan') {
  let payload = {};
  const input = String(text || '').trim();
  if (input) {
    try { payload = JSON.parse(input); }
    catch {
      if (/^https?:\/\//i.test(input)) payload.serverUrl = input;
      else if (/^\d{6}$/.test(input)) payload.pairCode = input;
    }
  }
  const method = connectionMethod === 'tailscale' ? 'tailscale' : 'lan';
  const lanCandidates = [
    ...(Array.isArray(payload.lanUrls) ? payload.lanUrls : []),
    payload.serverUrl,
  ];
  const tailscaleCandidates = [
    payload.tailscaleUrl,
    ...(Array.isArray(payload.tailscaleUrls) ? payload.tailscaleUrls : []),
  ];
  const candidates = [
    fallbackHostUrl,
    ...(method === 'tailscale' ? tailscaleCandidates : lanCandidates),
  ].filter(Boolean);
  return {
    connectionMethod: method,
    hostUrl: candidates.map(normalizeHostUrl).find(Boolean) || '',
    pairCode: String(fallbackPairCode || payload.pairCode || '').trim(),
    hasLanAddress: lanCandidates.map(normalizeHostUrl).some(Boolean),
    hasTailscaleAddress: tailscaleCandidates.map(normalizeHostUrl).some(Boolean),
  };
}

module.exports = {
  parseConnectionPayload,
};
