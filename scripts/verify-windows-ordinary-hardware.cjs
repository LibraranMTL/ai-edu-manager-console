'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WINDOWS_ARTIFACT_TARGET_BYTES } = require('./windows-artifact-budget.cjs');

const REQUIRED_MANUAL_CHECKS = Object.freeze([
  'launchSucceeded',
  'assetFirstScreenResponsive',
  'rebuildRemainedInteractive',
  'rebuildCancelSucceeded',
  'backupRestoreSucceeded',
  'physicalStudentFilesUnchanged',
]);

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function evaluateOrdinaryHardwareAcceptance({ hardware, audit, benchmark, evidence }) {
  const checks = [];
  const check = (id, passed, details = {}) => checks.push({ id, passed: Boolean(passed), ...details });
  const memoryGiB = Number(hardware.memoryGiB || 0);
  check('ordinary_memory_8_to_16_gib', memoryGiB >= 7.5 && memoryGiB <= 17, { actual: memoryGiB });
  check('at_least_four_logical_cpus', Number(hardware.logicalCpus || 0) >= 4, { actual: Number(hardware.logicalCpus || 0) });
  check('standard_ssd', String(hardware.storageType || '').toLowerCase() === 'ssd', { actual: hardware.storageType || 'unknown' });

  const exe = audit?.artifacts?.exe || {};
  check('artifact_size_measured', Number(exe.bytes || 0) > 0,
    { actualBytes: Number(exe.bytes || 0), advisoryTargetBytes: WINDOWS_ARTIFACT_TARGET_BYTES,
      overTargetBytes: Math.max(0, Number(exe.bytes || 0) - WINDOWS_ARTIFACT_TARGET_BYTES) });
  if (exe.path && fs.existsSync(exe.path)) {
    check('artifact_sha256_matches', fileSha256(exe.path) === String(exe.sha256 || '').toUpperCase());
  } else check('artifact_sha256_matches', false, { reason: 'artifact_missing' });

  for (const count of [100_000, 1_000_000]) {
    const result = (benchmark?.results || []).find(item => Number(item.count) === count);
    check(`benchmark_${count}_present`, Boolean(result));
    if (!result) continue;
    check(`benchmark_${count}_integrity`, result.integrityCheck === 'ok', { actual: result.integrityCheck });
    check(`benchmark_${count}_cold_summary`, Number(result.coldSummaryMs) <= 200, { actualMs: Number(result.coldSummaryMs) });
    check(`benchmark_${count}_filtered_summary_p95`, Number(result.filteredSummary?.p95Ms) <= 200, { actualMs: Number(result.filteredSummary?.p95Ms) });
    check(`benchmark_${count}_first_page_p95`, Number(result.firstPage?.p95Ms) <= 500, { actualMs: Number(result.firstPage?.p95Ms) });
  }
  for (const name of REQUIRED_MANUAL_CHECKS) check(`manual_${name}`, evidence?.[name] === true);
  return {
    schema: 'edu-manager.windows-ordinary-hardware-acceptance.v1',
    evaluatedAt: new Date().toISOString(),
    status: checks.every(item => item.passed) ? 'passed' : 'incomplete_or_failed',
    hardware,
    checks,
    boundary: 'This report is valid only for the measured machine and supplied hands-on evidence; it is not universal device acceptance.',
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

if (require.main === module) {
  const auditPath = argument('--audit');
  const benchmarkPath = argument('--benchmark');
  const evidencePath = argument('--evidence');
  const storageType = argument('--storage');
  const outputPath = argument('--output');
  if (!auditPath || !benchmarkPath || !evidencePath || !storageType) {
    throw new Error('Required: --audit <build-audit.json> --benchmark <asset-benchmark.json> --evidence <manual-evidence.json> --storage ssd [--output report.json]');
  }
  const load = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const hardware = {
    platform: process.platform,
    release: os.release(),
    cpu: os.cpus()[0]?.model || '',
    logicalCpus: os.cpus().length,
    memoryGiB: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
    storageType,
  };
  const report = evaluateOrdinaryHardwareAcceptance({
    hardware,
    audit: load(auditPath),
    benchmark: load(benchmarkPath),
    evidence: load(evidencePath),
  });
  if (outputPath) {
    const destination = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

module.exports = { REQUIRED_MANUAL_CHECKS, evaluateOrdinaryHardwareAcceptance };
