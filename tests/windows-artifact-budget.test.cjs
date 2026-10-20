'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertWindowsArtifactBudget, MAX_WINDOWS_ARTIFACT_BYTES } = require('../scripts/windows-artifact-budget.cjs');
test('Windows budget uses decimal 100 MB and rejects oversized artifacts before publishing', () => {
  assert.equal(MAX_WINDOWS_ARTIFACT_BYTES, 100000000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-budget-'));
  const file = path.join(root, 'size-only-fixture.bin');
  const fd = fs.openSync(file, 'wx');
  try {
    fs.ftruncateSync(fd, 100000000);
    assert.equal(assertWindowsArtifactBudget(file), 100000000);
    fs.ftruncateSync(fd, 100000001);
    assert.throws(() => assertWindowsArtifactBudget(file), /exceeds 100 MB/);
  } finally { fs.closeSync(fd); fs.unlinkSync(file); fs.rmdirSync(root); }
});
