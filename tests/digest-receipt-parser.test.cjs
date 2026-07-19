const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDigestReceipt } = require('../electron/digest-receipt.cjs');

test('valid Agent receipt is accepted without modification', () => {
  const source = JSON.stringify({ version: 1, items: [{ fileName: 'a.png', status: 'covered', notes: '正常说明' }] });
  const result = parseDigestReceipt(source);
  assert.equal(result.ok, true);
  assert.equal(result.repaired, false);
  assert.equal(result.value.items[0].status, 'covered');
});

test('unescaped quotes in Agent notes are repaired without losing the batch', () => {
  const source = `{
    "version": 1,
    "digestBatchId": "digest-1",
    "items": [{
      "fileName": "design.png",
      "status": "covered",
      "confidence": 1,
      "notes": "标题"三种布局模式"，内容完整。"
    }]
  }`;
  const result = parseDigestReceipt(source);
  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.equal(result.value.digestBatchId, 'digest-1');
  assert.equal(result.value.items[0].notes, '标题"三种布局模式"，内容完整。');
});

test('irrecoverable Agent receipt returns a visible parse failure', () => {
  const result = parseDigestReceipt('{"items": [');
  assert.equal(result.ok, false);
  assert.match(result.originalError, /JSON|position|end/i);
});
