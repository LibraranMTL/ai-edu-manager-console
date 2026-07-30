const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const main = read('electron/main.cjs');
const renderer = read('src/main.tsx');

test('formal education conclusions retain evidence and source traceability', () => {
  assert.match(main, /evidence|sourceUri|sourcePath|citation/i);
  assert.match(main, /sha1|sha256/i);
  assert.match(renderer, /来源|证据|引用/);
});

test('repeat processing and collaboration imports are idempotent', () => {
  assert.match(main, /dedup|duplicate|alreadyImported|supersed/i);
  assert.match(main, /manifestId|packageId/);
  assert.match(main, /sha1|sha256/i);
});

test('large sources use bounded scans and retained ledgers instead of unbounded polling', () => {
  assert.match(main, /MAX_[A-Z_]*(FILES|ENTRIES|ITEMS)|slice\(0,\s*\d+\)|limit:\s*\d+/);
  assert.match(main, /ledger|retention|processed/i);
  assert.doesNotMatch(main, /setInterval\([^,]+,\s*(?:[0-9]|[1-9][0-9]{1,3})\s*\)/);
});

test('ordinary UI keeps diagnostics collapsed and avoids exposing audit work', () => {
  assert.match(renderer, /高级|诊断/);
  assert.match(renderer, /details|summary/);
  assert.match(renderer, /需要补充/);
});
