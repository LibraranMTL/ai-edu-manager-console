'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { auditWindowsResources } = require('../scripts/audit-windows-resources.cjs');
const policy = require('../scripts/windows-runtime-resource-policy.cjs');
const { captureHeadBaseline } = require('../scripts/verify-windows-build-baseline.cjs');
const { evaluateOrdinaryHardwareAcceptance, REQUIRED_MANUAL_CHECKS } = require('../scripts/verify-windows-ordinary-hardware.cjs');
const { runBenchmark } = require('../scripts/benchmark-asset-index.cjs');

const repoRoot = path.resolve(__dirname, '..');

test('resource audit preserves required runtime files and reports advisory candidates without deleting them', () => {
  const before = fs.statSync(path.join(repoRoot, 'public', 'brand', 'robogala.ico')).size;
  const report = auditWindowsResources({ repoRoot, strict: true });
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.source.missingRequiredFiles, []);
  assert.match(report.boundary, /never deletes files/);
  assert.equal(fs.statSync(path.join(repoRoot, 'public', 'brand', 'robogala.ico')).size, before);
});

test('resource audit fails closed when a required source resource is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-resource-audit-'));
  try {
    assert.throws(() => auditWindowsResources({ repoRoot: root, strict: true }), /missing source resource/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean baseline fingerprints committed release inputs and exposes scoped worktree state', () => {
  const baseline = captureHeadBaseline(repoRoot);
  assert.equal(baseline.schema, 'edu-manager.windows-clean-build-baseline.v1');
  assert.match(baseline.commit, /^[a-f0-9]{40}$/i);
  assert.ok(baseline.trackedFileCount > 100);
  assert.match(baseline.gitTreeListingSha256, /^[A-F0-9]{64}$/);
  assert.equal(typeof baseline.workingTreeMatchesHead, 'boolean');
});

test('ordinary hardware acceptance requires performance, artifact integrity and hands-on evidence together', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-ordinary-hardware-'));
  const artifact = path.join(root, 'candidate.exe');
  try {
    fs.writeFileSync(artifact, 'candidate', 'utf8');
    const crypto = require('node:crypto');
    const sha256 = crypto.createHash('sha256').update('candidate').digest('hex').toUpperCase();
    const audit = { artifacts: { exe: { path: artifact, bytes: fs.statSync(artifact).size, sha256 } } };
    const result = value => ({ count: value, integrityCheck: 'ok', coldSummaryMs: 25, filteredSummary: { p95Ms: 20 }, firstPage: { p95Ms: 30 } });
    const benchmark = { results: [result(100000), result(1000000)] };
    const evidence = Object.fromEntries(REQUIRED_MANUAL_CHECKS.map(name => [name, true]));
    const passed = evaluateOrdinaryHardwareAcceptance({ hardware: { memoryGiB: 16, logicalCpus: 8, storageType: 'ssd' }, audit, benchmark, evidence });
    assert.equal(passed.status, 'passed');
    const failed = evaluateOrdinaryHardwareAcceptance({ hardware: { memoryGiB: 64, logicalCpus: 8, storageType: 'ssd' }, audit, benchmark, evidence: {} });
    assert.equal(failed.status, 'incomplete_or_failed');
    assert.ok(failed.checks.some(item => item.id === 'ordinary_memory_8_to_16_gib' && !item.passed));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('asset benchmark exercises search, deep paging, duplicate groups and batch writes behaviorally', () => {
  const report = runBenchmark(['100']);
  assert.equal(report.passed, true);
  const result = report.results[0];
  assert.equal(result.integrityCheck, 'ok');
  for (const metric of ['filteredSummary', 'textSearch', 'sha1Search', 'duplicateGroups', 'deepPage']) {
    assert.equal(result[metric].samples.length, 7);
  }
  assert.ok(result.batchUpsert250Ms >= 0);
});

test('packaged resource policy includes native, legal, PDF and recovery-critical resources', () => {
  assert.ok(policy.REQUIRED_PACKAGED_RESOURCES.includes('resources/app.asar'));
  assert.ok(policy.REQUIRED_PACKAGED_RESOURCES.some(value => value.endsWith('pdfjs/LICENSE')));
  assert.ok(policy.REQUIRED_PACKAGED_DIRECTORIES.some(value => value.endsWith('/wasm')));
  assert.ok(policy.REQUIRED_SOURCE_FILES.includes('electron/asset-index-worker.cjs'));
  assert.ok(policy.REQUIRED_SOURCE_FILES.includes('electron/asset-governance-worker.cjs'));
});
