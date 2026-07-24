const fs = require('node:fs');
const path = require('node:path');

function taskPayloadKind(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  if (!String(payload.taskId || '').trim() || !String(payload.executionId || '').trim()) return '';
  if (String(payload.status || '').trim()) return 'result';
  if (String(payload.claimedAt || '').trim() || String(payload.agentId || '').trim()) return 'claim';
  return '';
}

function readPayload(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function discoverTaskPayloads(root) {
  fs.mkdirSync(root, { recursive: true });
  const claims = [];
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    const file = path.join(root, entry.name);
    const payload = readPayload(file);
    const canonicalKind = entry.name.endsWith('.claim.json') ? 'claim'
      : entry.name.endsWith('.result.json') ? 'result'
        : '';
    const kind = taskPayloadKind(payload) || canonicalKind;
    if (!kind) continue;
    const record = { file, name: entry.name, payload, canonical: Boolean(canonicalKind) };
    if (kind === 'claim') claims.push(record);
    if (kind === 'result') results.push(record);
  }
  return { claims, results };
}

module.exports = {
  discoverTaskPayloads,
  taskPayloadKind,
};
