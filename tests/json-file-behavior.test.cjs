const test = require('node:test');
const assert = require('node:assert/strict');

const { parseJsonText } = require('../electron/json-file.cjs');

test('agent JSON parser accepts UTF-8 BOM without weakening JSON validation', () => {
  assert.deepEqual(parseJsonText('\uFEFF{"status":"completed"}'), { status: 'completed' });
  assert.throws(() => parseJsonText('\uFEFF{"status":}'), SyntaxError);
});
