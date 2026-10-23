'use strict';
const fs = require('node:fs');
const WINDOWS_ARTIFACT_WARNING_BYTES = 95_000_000;
const WINDOWS_ARTIFACT_TARGET_BYTES = 100_000_000;

function inspectWindowsArtifactBudget(file) {
  const bytes = fs.statSync(file).size;
  return {
    file,
    bytes,
    warningBytes: WINDOWS_ARTIFACT_WARNING_BYTES,
    targetBytes: WINDOWS_ARTIFACT_TARGET_BYTES,
    deltaToTargetBytes: WINDOWS_ARTIFACT_TARGET_BYTES - bytes,
    status: bytes > WINDOWS_ARTIFACT_TARGET_BYTES ? 'over_target'
      : bytes > WINDOWS_ARTIFACT_WARNING_BYTES ? 'warning' : 'ok',
  };
}

function assertWindowsArtifactBudget(file) {
  return inspectWindowsArtifactBudget(file).bytes;
}
module.exports = {
  WINDOWS_ARTIFACT_WARNING_BYTES,
  WINDOWS_ARTIFACT_TARGET_BYTES,
  inspectWindowsArtifactBudget,
  assertWindowsArtifactBudget,
};
