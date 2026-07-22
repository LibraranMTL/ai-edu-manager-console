const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDirectoryCountCache } = require('../electron/directory-count-cache.cjs');

test('directory count cache reuses scans until invalidated or expired', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-count-cache-'));
  let clock = 1000;
  try {
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    const cache = createDirectoryCountCache({ ttlMs: 5000, now: () => clock });
    assert.equal(cache.count(root), 1);
    fs.writeFileSync(path.join(root, 'nested', 'b.txt'), 'b');
    assert.equal(cache.count(root), 1);
    cache.invalidate(path.join(root, 'nested'));
    assert.equal(cache.count(root), 2);
    fs.writeFileSync(path.join(root, 'c.txt'), 'c');
    clock += 5001;
    assert.equal(cache.count(root), 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('directory count cache keeps independent predicates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-count-kind-'));
  try {
    fs.writeFileSync(path.join(root, 'one.md'), '# one');
    fs.writeFileSync(path.join(root, 'two.txt'), 'two');
    const cache = createDirectoryCountCache();
    assert.equal(cache.count(root, 'all'), 2);
    assert.equal(cache.count(root, 'markdown', (name) => name.toLowerCase().endsWith('.md')), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
