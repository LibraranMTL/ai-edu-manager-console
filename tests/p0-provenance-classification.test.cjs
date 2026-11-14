'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyDiagnosticCandidate, expectedRuntimeBuffer, isRunningCandidateArtifact,
  selectTargetProcess } = require('../scripts/capture-p0-provenance.cjs');
const { REQUIRED_REPAIR_GATE_IDS, EXPECTED_R11_SHA256 } = require('../scripts/acceptance-p0-red-gate.cjs');

test('r11 provenance and five repair gates are frozen', () => {
  assert.equal(EXPECTED_R11_SHA256, '937F2A11FCEF97319AF95AB600AAC108259C3E9BB47E0D730E06EBA550A76BF0');
  assert.deepEqual(REQUIRED_REPAIR_GATE_IDS, ['FLOW-02', 'FLOW-03', 'PERF-03', 'AGENT-01', 'NET-01']);
});

test('an audited same-source artifact is reported as built while runtime verification is pending', () => {
  const result = classifyDiagnosticCandidate({
    artifactAuditMatches: true,
    buildStatusMatches: true,
    runningArtifactMatches: false,
    runtimeFilesMatch: false,
    exeSha256: 'ABC123',
  });

  assert.deepEqual(result, {
    status: 'artifact_built_runtime_unverified',
    candidateSha256: 'ABC123',
    reason: '诊断候选已由当前工作树构建并通过包审计，但尚未作为运行程序核验。',
  });
});

test('an explicit process id selects an isolated diagnostic instance instead of the oldest live instance', () => {
  const processes = [
    { ProcessId: 101, CreationDate: '20261026070000.000000+480', ExecutablePath: 'r2.exe' },
    { ProcessId: 202, CreationDate: '20261026100000.000000+480', ExecutablePath: 'r5.exe' },
  ];

  assert.equal(selectTargetProcess(processes, 202).ExecutablePath, 'r5.exe');
  assert.equal(selectTargetProcess(processes, 0).ExecutablePath, 'r2.exe');
  assert.throws(() => selectTargetProcess(processes, 999), /target_process_not_found:999/);
});

test('runtime comparison applies the same CJS compaction used by the Windows build', () => {
  const compact = source => source.replace(/\s+/g, '');

  assert.equal(expectedRuntimeBuffer('electron/main.cjs', 'const value = 1;\n', compact).toString(), 'constvalue=1;');
  assert.equal(expectedRuntimeBuffer('electron/helper.ps1', 'Write-Host  value\n', compact).toString(), 'Write-Host  value\n');
});

test('an unpacked Electron main is bound to the audited candidate through the staged app.asar', () => {
  assert.equal(isRunningCandidateArtifact({
    wrapperSha256: '',
    candidateSha256: 'PORTABLE',
    runningAsarSha256: 'ASAR',
    stagedAsarSha256: 'ASAR',
  }), true);
  assert.equal(isRunningCandidateArtifact({
    wrapperSha256: '',
    candidateSha256: 'PORTABLE',
    runningAsarSha256: 'OTHER',
    stagedAsarSha256: 'ASAR',
  }), false);
});

