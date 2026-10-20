'use strict';
const fs = require('node:fs');
const MAX_WINDOWS_ARTIFACT_BYTES = 100_000_000;
function assertWindowsArtifactBudget(file) {
  const bytes = fs.statSync(file).size;
  if (bytes > MAX_WINDOWS_ARTIFACT_BYTES) throw new Error(`Windows artifact exceeds 100 MB (${MAX_WINDOWS_ARTIFACT_BYTES} bytes): ${file} (${bytes} bytes)`);
  return bytes;
}
module.exports = { MAX_WINDOWS_ARTIFACT_BYTES, assertWindowsArtifactBudget };
