'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { TASK_CHANNEL_AGENT_IDS, agentTaskChannel } = require('./agent-task-channel.cjs');
const { taskPayloadKind } = require('./task-result-inbox.cjs');
function createTaskInboxReader({ now = Date.now, stableMs = 500, invalidAfterMs = 30000, maxBytes = 16 * 1024 * 1024, batchBytes = 16 * 1024 * 1024 } = {}) {
  const known = new Map();
  let reads = 0;
  async function scan(root, agentId = '') {
    const ids = agentId ? [agentTaskChannel(root, agentId).agentId] : TASK_CHANNEL_AGENT_IDS;
    const channels = ids.map(id => agentTaskChannel(root, id));
    if (!agentId || agentId === 'qclaw') channels.push({ agentId: 'qclaw', resultPath: path.join(root, 'qclaw-results'), legacy: true });
    const result = { claims: [], results: [], deferred: 0, reads: 0 };
    const before = reads, present = new Set();
    let count = 0, bytes = 0;
    for (const channel of channels) {
      let dir;
      try {
        if ((await fs.lstat(channel.resultPath)).isSymbolicLink()) continue;
        dir = await fs.opendir(channel.resultPath);
      } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for await (const entry of dir) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const file = path.join(channel.resultPath, entry.name);
        present.add(file);
        if (count >= 50) { result.deferred++; continue; }
        let stat;
        try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
        let item = known.get(file);
        if (!item || item.signature !== signature) { item = { signature, firstAt: now() }; known.set(file, item); }
        if (now() - item.firstAt < stableMs) { result.deferred++; continue; }
        // Bound both IPC payload and parser memory, not just the number of receipts.
        if (stat.size <= maxBytes && bytes + stat.size > batchBytes && count > 0) { result.deferred++; continue; }
        if (stat.size <= maxBytes) bytes += stat.size;
        if (item.parseFailedAt !== undefined && !item.parsed) {
          if (now() - item.firstAt < invalidAfterMs) { result.deferred++; continue; }
          item.payload = null; item.parsed = true; item.reason = 'INVALID_RESULT_JSON';
        }
        if (!item.parsed) {
          if (stat.size > maxBytes) { item.parsed = true; item.payload = null; item.reason = 'RESULT_TOO_LARGE'; }
          else {
            try {
              reads++;
              const raw = await fs.readFile(file, 'utf8');
              const after = await fs.lstat(file);
              if (`${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== signature) { known.delete(file); result.deferred++; continue; }
              item.payload = JSON.parse(raw.replace(/^\uFEFF/, '')); item.parsed = true;
            } catch (error) {
              if (error.code === 'ENOENT') { known.delete(file); continue; }
              // A locked file is transient. Stable invalid JSON is rechecked by
              // metadata, not reparsed each second while the writer is paused.
              if (!(error instanceof SyntaxError)) { result.deferred++; continue; }
              item.parseFailedAt = now();
              if (now() - item.firstAt < invalidAfterMs) { result.deferred++; continue; }
              item.payload = null; item.parsed = true; item.reason = 'INVALID_RESULT_JSON';
            }
          }
        }
        const kind = taskPayloadKind(item.payload) || (entry.name.endsWith('.claim.json') ? 'claim' : 'result');
        result[kind === 'claim' ? 'claims' : 'results'].push({ file, payload: item.payload, channel, invalidReason: item.reason });
        count++;
      }
    }
    for (const file of known.keys()) if (!present.has(file)) known.delete(file);
    // Keep only metadata for excess entries; parsed results are limited to this batch.
    if (known.size > 10000) for (const [file, item] of known) { if (!item.parsed) known.delete(file); if (known.size <= 10000) break; }
    result.reads = reads - before;
    return result;
  }
  return { scan };
}
module.exports = { createTaskInboxReader };
