'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseEvidence } = require('./agent-0228-evidence.cjs');

function gateError(code, detail) {
  const error = new Error(`${code}${detail ? `:${detail}` : ''}`);
  error.code = code;
  return error;
}

function assertFormalRuntimeAccepted({ runtimeAsarSha256, acceptanceIndexPath }) {
  const runtimeHash = String(runtimeAsarSha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(runtimeHash)) throw gateError('WINDOWS_FORMAL_RUNTIME_HASH_INVALID');
  const indexPath = path.resolve(String(acceptanceIndexPath || ''));
  if (!acceptanceIndexPath || !fs.existsSync(indexPath)) throw gateError('WINDOWS_FORMAL_ACCEPTANCE_INDEX_MISSING');
  let report;
  try {
    report = JSON.parse(fs.readFileSync(indexPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw gateError('WINDOWS_FORMAL_ACCEPTANCE_INDEX_INVALID', error.message);
  }
  const evidenceRoot = path.dirname(indexPath);
  const validation = validateReleaseEvidence(report, evidenceRoot, { stage: 'release' });
  if (!validation.passed) throw gateError('WINDOWS_FORMAL_ACCEPTANCE_FAILED', validation.failures.join(','));
  const acceptedHash = String(report?.sourceProvenance?.runtimeAsarHash || '').toLowerCase();
  if (runtimeHash !== acceptedHash) {
    throw gateError('WINDOWS_FORMAL_RUNTIME_NOT_ACCEPTED', `formal=${runtimeHash},accepted=${acceptedHash}`);
  }
  return { acceptedRuntimeAsarSha256: acceptedHash, acceptanceIndexPath: indexPath };
}

module.exports = { assertFormalRuntimeAccepted };
