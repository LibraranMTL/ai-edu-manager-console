'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const gate = path.join(root, 'scripts', 'check-p0-evidence-readiness.cjs');

async function writeJson(directory, name, value) {
  await fsp.writeFile(path.join(directory, name), JSON.stringify(value, null, 2));
}

async function createBase(directory, options = {}) {
  const diagnosticHash = options.diagnosticHash || 'CANDIDATE';
  const originalHash = options.originalHash || diagnosticHash;
  await writeJson(directory, 'p0-red-gate-report.json', {
    schema: 1, verdict: 'red_gate_confirmed', environment: { repeat: 3, sourceHashes: { 'electron/main.cjs': 'SOURCE' } },
    summary: { total: 7, reproduced: 7, controlsPassed: 7, harnessErrors: 0 },
    results: Array.from({ length: 7 }, (_, index) => ({ id: `CASE-${index}`, runs: [{ reproduced: true }, { reproduced: true }, { reproduced: true }], controlValid: true })),
  });
  await writeJson(directory, 'p0-green-gate-report.json', {
    schema: 1, verdict: 'green_gate_failed', summary: { desiredPassed: 0 },
  });
  const provenance = {
    schema: 1, workspace: { commit: 'COMMIT' }, candidate: { exe: { sha256: diagnosticHash } },
    running: { wrapper: { sha256: diagnosticHash } },
    mapping: { status: 'candidate_and_workspace_verified_same_source', runningArtifactMatches: true },
  };
  if (options.includeChains !== false) provenance.chains = {
    originalCandidate: { status: 'verified_artifact_identity', buildCommit: 'BUILD-COMMIT', candidateSha256: originalHash,
      observedRunningArtifactMatches: true },
    diagnosticCandidate: { status: 'same_source_verified', workspaceCommit: 'COMMIT', candidateSha256: diagnosticHash },
  };
  await writeJson(directory, 'p0-candidate-provenance.json', provenance);
  for (const scenario of ['idle', 'normal-task', 'backlog-recovery']) {
    const duration = scenario === 'backlog-recovery' ? 1800 : 600;
    const samples = Array.from({ length: duration * 2 }, () => ({ actualIntervalMilliseconds: 500,
      treeCpuWholeMachinePercent: 1, mainPrivateMemoryBytes: 100 }));
    for (let run = 1; run <= 3; run++) await writeJson(directory, `p0-live-runtime-${scenario}-${run}.json`, {
      schema: 2, scenario, runId: String(run), provenance: { workspaceCommit: 'COMMIT', candidateSha256: 'CANDIDATE' },
      isolation: { verified: true, userDataDir: path.join(directory, 'profile'),
        studentBaseDir: path.join(directory, 'profile', 'student-data') },
      requestedDurationSeconds: duration, actualDurationSeconds: duration,
      summary: { sampleCount: samples.length, treeCpuWholeMachineAveragePercent: 1, mainPrivateMemoryAverageBytes: 100 }, samples,
    });
  }
}

async function createCompleteEvidence(directory) {
  const extras = {
    'DATA-01': { baseline: { materialRowsRead: 100, resultHash: 'SAME' }, treatment: { materialRowsRead: 0, resultHash: 'SAME' } },
    'PERF-01': { baseline: { drainCount: 20, startLatencyAfterReleaseMs: 10 }, treatment: { drainCount: 2, startLatencyAfterReleaseMs: 10 } },
    'PERF-02': { baseline: { normalizationCalls: 100, stateValid: true, finalHeartbeat: 'x', persistedHeartbeat: 'x' },
      treatment: { normalizationCalls: 0, stateValid: true, finalHeartbeat: 'x', persistedHeartbeat: 'x' } },
  };
  for (const id of ['DATA-01', 'PERF-01', 'PERF-02']) {
    const baselineRuns = Array.from({ length: 3 }, (_, index) => ({ runId: String(index + 1), sampleCount: 120, durationSeconds: 60,
      primaryMetric: 100, ...extras[id].baseline }));
    const treatmentRuns = Array.from({ length: 3 }, (_, index) => ({ runId: String(index + 1), sampleCount: 120, durationSeconds: 60,
      primaryMetric: 80, ...extras[id].treatment }));
    await writeJson(directory, `ablation-${id}.json`, {
    schema: 1, id, provenance: { workspaceCommit: 'COMMIT', candidateSha256: 'CANDIDATE' },
    baseline: { runs: baselineRuns }, treatment: { runs: treatmentRuns },
    comparison: { metric: 'primaryMetric', direction: 'lower_is_better', baselineMean: 100, treatmentMean: 80, improvementPercent: 20 },
    conclusion: 'measured improvement',
    });
  }
  await writeJson(directory, 'p0-task-timeline.json', {
    schema: 1, provenance: { workspaceCommit: 'COMMIT', candidateSha256: 'CANDIDATE' }, correlationId: 'task-1',
    events: ['enqueue', 'permit_wait', 'execution', 'reconciliation', 'settlement'].map((stage, index) => ({ stage, at: `2026-10-26T00:00:0${index}.000Z` })),
    observed: { finalStatus: 'delivered', deliveryCalls: 1, duplicateDeliveryCalls: 0, reconcileCalls: 1, settlementCalls: 1 },
  });
  await writeJson(directory, 'p0-cmd-process-trace.json', {
    schema: 1, provenance: { workspaceCommit: 'COMMIT', candidateSha256: 'CANDIDATE' },
    observations: [{ at: '2026-10-26T00:00:00.000Z', processes: [{ processId: 1, name: 'candidate.exe' }] }],
  });
  await writeJson(directory, 'p0-original-candidate-failure-baseline.json', {
    schema: 1, provenance: { buildCommit: 'BUILD-COMMIT', candidateSha256: 'CANDIDATE' },
    observations: [{ at: '2026-10-26T00:00:00.000Z', symptom: 'task_backlog_with_ui_latency', sampleFile: 'original-run-1.json' }],
  });
  await writeJson(directory, 'p0-runtime-repair-preview.json', {
    schema: 'edu-manager.p0-runtime-repair-preview.v1', readOnlyVerified: true,
    sourceHashes: {
      before: { taskStoreSha256: 'a'.repeat(64), materialsSha256: 'b'.repeat(64), firewallInspectionSha256: 'c'.repeat(64) },
      after: { taskStoreSha256: 'a'.repeat(64), materialsSha256: 'b'.repeat(64), firewallInspectionSha256: 'c'.repeat(64) },
    },
    wouldRedispatchUnknown: [],
    blocked: [
      { taskId: 'unknown-self', reasonCode: 'execution_unknown_self' },
      { taskId: 'same-work', reasonCode: 'execution_unknown_same_work' },
    ],
    firewall: { repairMode: 'explicit_user_uac_only', phoneAccepted: false },
  });
}

async function rewriteOriginalBaselineHash(directory, candidateSha256) {
  const file = path.join(directory, 'p0-original-candidate-failure-baseline.json');
  const value = JSON.parse(await fsp.readFile(file, 'utf8'));
  value.provenance.candidateSha256 = candidateSha256;
  await writeJson(directory, path.basename(file), value);
}

function runGate(directory, stage = 'causal') {
  return spawnSync(process.execPath, [gate, `--stage=${stage}`, `--output=${directory}`], { cwd: root, encoding: 'utf8' });
}

test('causal gate rejects empty evidence shells', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-empty-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  for (const name of ['ablation-DATA-01.json', 'ablation-PERF-01.json', 'ablation-PERF-02.json', 'p0-task-timeline.json', 'p0-cmd-process-trace.json']) {
    await writeJson(directory, name, {});
  }

  const result = runGate(directory);

  assert.notEqual(result.status, 0, `empty evidence unexpectedly passed:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate rejects evidence from a different candidate hash', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-hash-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);
  const mismatched = JSON.parse(await fsp.readFile(path.join(directory, 'ablation-PERF-01.json'), 'utf8'));
  mismatched.provenance.candidateSha256 = 'OTHER-CANDIDATE';
  await writeJson(directory, 'ablation-PERF-01.json', mismatched);

  const result = runGate(directory);

  assert.notEqual(result.status, 0, `mismatched candidate evidence unexpectedly passed:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate rejects a runtime summary that contradicts raw samples', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-summary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);
  const file = path.join(directory, 'p0-live-runtime-idle-2.json');
  const inconsistent = JSON.parse(await fsp.readFile(file, 'utf8'));
  inconsistent.summary.sampleCount = 999;
  await writeJson(directory, path.basename(file), inconsistent);

  const result = runGate(directory);

  assert.notEqual(result.status, 0, `contradictory runtime evidence unexpectedly passed:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate rejects runtime evidence whose student root escapes the isolated profile', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-isolation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);
  const file = path.join(directory, 'p0-live-runtime-idle-2.json');
  const contaminated = JSON.parse(await fsp.readFile(file, 'utf8'));
  contaminated.isolation.studentBaseDir = path.resolve(directory, '..', 'production-student-data');
  await writeJson(directory, path.basename(file), contaminated);

  const result = runGate(directory);

  assert.notEqual(result.status, 0, `runtime evidence outside the isolated profile unexpectedly passed:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate rejects an ablation comparison that contradicts its runs', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-ablation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);
  const file = path.join(directory, 'ablation-DATA-01.json');
  const inconsistent = JSON.parse(await fsp.readFile(file, 'utf8'));
  inconsistent.comparison.improvementPercent = 95;
  await writeJson(directory, path.basename(file), inconsistent);

  const result = runGate(directory);

  assert.notEqual(result.status, 0, `contradictory ablation evidence unexpectedly passed:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate rejects an ablation with no measured improvement', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-no-improvement-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);
  const file = path.join(directory, 'ablation-DATA-01.json');
  const ineffective = JSON.parse(await fsp.readFile(file, 'utf8'));
  for (const run of ineffective.treatment.runs) run.primaryMetric = 100;
  ineffective.comparison.treatmentMean = 100;
  ineffective.comparison.improvementPercent = 0;
  await writeJson(directory, path.basename(file), ineffective);

  const result = runGate(directory);

  assert.notEqual(result.status, 0, `ineffective ablation unexpectedly passed:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate rejects a timeline with reordered or duplicate execution', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-flow-semantics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);
  const file = path.join(directory, 'p0-task-timeline.json');
  const invalid = JSON.parse(await fsp.readFile(file, 'utf8'));
  invalid.events = [invalid.events[0], invalid.events[2], invalid.events[1], invalid.events[2], invalid.events[3], invalid.events[4]];
  invalid.observed = { finalStatus: 'delivered', deliveryCalls: 2, duplicateDeliveryCalls: 1, reconcileCalls: 1, settlementCalls: 1 };
  await writeJson(directory, path.basename(file), invalid);

  const result = runGate(directory);

  assert.notEqual(result.status, 0, `semantically invalid flow unexpectedly passed:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate accepts complete internally consistent synthetic evidence', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-valid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);

  const result = runGate(directory);

  assert.equal(result.status, 0, `valid evidence was rejected:\n${result.stdout}\n${result.stderr}`);
});

test('correctness gate accepts a fully green repaired gate while retaining red controls', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-repaired-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);
  await writeJson(directory, 'p0-green-gate-report.json', {
    schema: 1, verdict: 'green_gate_passed',
    summary: { total: 7, desiredPassed: 7, controlsPassed: 7, harnessErrors: 0 },
  });

  const result = runGate(directory, 'correctness');

  assert.equal(result.status, 0, `repaired green evidence was rejected:\n${result.stdout}\n${result.stderr}`);
});

test('provenance gate rejects a report without separate original and diagnostic chains', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-chains-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory, { includeChains: false });

  const result = runGate(directory, 'provenance');

  assert.notEqual(result.status, 0, `single-chain provenance unexpectedly passed:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate rejects evidence that omits the original candidate failure baseline', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-original-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory);
  await createCompleteEvidence(directory);
  await fsp.unlink(path.join(directory, 'p0-original-candidate-failure-baseline.json'));

  const result = runGate(directory);

  assert.notEqual(result.status, 0, `causal gate passed without the original failure baseline:\n${result.stdout}\n${result.stderr}`);
});

test('causal gate keeps distinct original and diagnostic candidate hashes', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-evidence-distinct-chains-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createBase(directory, { originalHash: 'ORIGINAL-CANDIDATE', diagnosticHash: 'CANDIDATE' });
  await createCompleteEvidence(directory);
  await rewriteOriginalBaselineHash(directory, 'ORIGINAL-CANDIDATE');

  const result = runGate(directory);

  assert.equal(result.status, 0, `distinct evidence chains were incorrectly coupled:\n${result.stdout}\n${result.stderr}`);
});

