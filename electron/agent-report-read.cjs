'use strict';
const crypto = require('node:crypto');
// The caller resolves a permitted report ID and student before reading. This
// helper accepts content, never a client-supplied filesystem path.
function reportPage(content, input = {}) {
  const offset = input.offset ?? 0, limit = input.limit ?? 65536;
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000000 || !Number.isInteger(limit) || limit < 1 || limit > 65536 ||
      input.contentHash !== undefined && !/^[a-f0-9]{64}$/.test(input.contentHash)) return { ok: false, code: 'INVALID_INPUT' };
  const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  if (offset > 0 && !input.contentHash) return { ok: false, code: 'REPORT_VERSION_REQUIRED' };
  if (input.contentHash && input.contentHash !== contentHash) return { ok: false, code: 'REPORT_CHANGED', message: '报告已更新，请从第一页重新读取，不要拼接不同版本。' };
  if (offset > content.length) return { ok: false, code: 'INVALID_REPORT_OFFSET' };
  const end = Math.min(offset + limit, content.length);
  return { ok: true, content: content.slice(offset, end), offset, nextOffset: end < content.length ? end : null,
    truncated: end < content.length, totalCharacters: content.length, contentHash };
}
module.exports = { reportPage };
