const test = require('node:test'), assert = require('node:assert/strict');
const { reportPage } = require('../electron/agent-report-read.cjs');
const { validateCapabilityInput } = require('../electron/agent-capability-contract.cjs');
test('report MCP pages reconstruct full Unicode content without local-file fallback', () => {
  const content = '整体画像😀\n'.repeat(12000); let combined = '', offset = 0, contentHash;
  do {
    const r = reportPage(content, { offset, limit: 10001, ...(contentHash ? { contentHash } : {}) });
    assert.equal(r.ok, true); assert.equal(r.totalCharacters, content.length);
    contentHash ||= r.contentHash; assert.equal(r.contentHash, contentHash);
    combined += r.content; offset = r.nextOffset;
  } while (offset !== null);
  assert.equal(combined, content); assert.equal(reportPage(content).content.length, 65536);
});
test('report pagination binds versions and rejects invalid offsets, limits and hashes', () => {
  const first = reportPage('first version', { limit: 3 });
  assert.equal(reportPage('changed version', { offset: 3, contentHash: first.contentHash }).code, 'REPORT_CHANGED');
  assert.equal(reportPage('first version', { offset: 3 }).code, 'REPORT_VERSION_REQUIRED');
  assert.equal(reportPage('first version', { offset: 99, contentHash: first.contentHash }).code, 'INVALID_REPORT_OFFSET');
  for (const input of [{ offset: -1 }, { limit: 0 }, { limit: 65537 }, { offset: '3' }, { contentHash: 'bad' }]) assert.equal(reportPage('x', input).code, 'INVALID_INPUT');
  assert.equal(reportPage('').truncated, false); assert.equal(reportPage('').nextOffset, null);
  assert.equal(validateCapabilityInput('report.read', { studentId: 's1', reportId: 'profile', offset: 0, limit: 20 }).ok, true);
  assert.equal(validateCapabilityInput('report.read', { studentId: 's1', reportId: 'profile', path: 'arbitrary.md' }).ok, false);
});
