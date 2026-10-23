'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WINDOWS_ARTIFACT_WARNING_BYTES, WINDOWS_ARTIFACT_TARGET_BYTES,
  inspectWindowsArtifactBudget, assertWindowsArtifactBudget } = require('../scripts/windows-artifact-budget.cjs');
test('Windows budget keeps decimal 100 MB as an advisory target without blocking oversized artifacts', () => {
  assert.equal(WINDOWS_ARTIFACT_WARNING_BYTES, 95000000);
  assert.equal(WINDOWS_ARTIFACT_TARGET_BYTES, 100000000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-budget-'));
  const file = path.join(root, 'size-only-fixture.bin');
  const fd = fs.openSync(file, 'wx');
  try {
    fs.ftruncateSync(fd, 100000000);
    assert.equal(assertWindowsArtifactBudget(file), 100000000);
    assert.deepEqual(inspectWindowsArtifactBudget(file), {
      file, bytes: 100000000, warningBytes: 95000000, targetBytes: 100000000,
      deltaToTargetBytes: 0, status: 'warning',
    });
    fs.ftruncateSync(fd, 100000001);
    assert.equal(assertWindowsArtifactBudget(file), 100000001);
    assert.equal(inspectWindowsArtifactBudget(file).status, 'over_target');
  } finally { fs.closeSync(fd); fs.unlinkSync(file); fs.rmdirSync(root); }
});
