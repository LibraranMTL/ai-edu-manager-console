const test = require('node:test');
const assert = require('node:assert/strict');
const { createInboxIndex } = require('../electron/smart-inbox-index.cjs');
test('derived index paginates by authorized student and rebuilds from authoritative records', () => {
  const records = Array.from({ length: 80 }, (_, i) => ({ id: `id-${i}`, sourceId: 'source',
    studentId: i < 30 ? 'a' : i < 60 ? 'b' : '', status: i === 1 ? 'ignored' : 'review', createdAt: `2026-01-${String(i % 28 + 1).padStart(2, '0')}` }));
  let index = createInboxIndex('', records);
  const first = index.list({ studentId: 'a', sourceId: 'source', page: 1, size: 25 });
  const second = index.list({ studentId: 'a', sourceId: 'source', page: 2, size: 25 });
  assert.equal(first.total, 49); assert.equal(second.total, 49); assert.equal(new Set([...first.ids, ...second.ids]).size, 49);
  index.update({ ...records[0], status: 'delivered' });
  assert.equal(index.list({ studentId: 'a', sourceId: 'source', page: 1, size: 25 }).total, 48);
  index.close(); records[0].status = 'delivered'; index = createInboxIndex('', records);
  assert.equal(index.list({ studentId: 'a', sourceId: 'source', page: 1, size: 25 }).total, 48); index.close();
});
test('fingerprint index never returns another student or an unresolved item', () => {
  const hash = 'a'.repeat(64), index = createInboxIndex('', [
    { id: 'same', studentId: 'a', status: 'delivered', fingerprint: { sha256: hash } },
    { id: 'other', studentId: 'b', status: 'delivered', fingerprint: { sha256: hash } },
    { id: 'unknown', studentId: 'a', status: 'delivery_reconcile', fingerprint: { sha256: hash } },
  ]);
  assert.deepEqual(index.matchingFingerprint('a', hash), ['same']); index.close();
});
