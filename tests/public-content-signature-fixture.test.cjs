const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const vector = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public-content-contract', 'fixtures', 'canonical-signature-vector.v1.json'), 'utf8'));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

test('frozen canonical signature vector verifies and detects mutation', () => {
  assert.equal(canonical(vector.payload), vector.canonical);
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(vector.canonical), vector.publicKey, Buffer.from(vector.signature, 'base64')), true);
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${vector.canonical} `), vector.publicKey, Buffer.from(vector.signature, 'base64')), false);
});
