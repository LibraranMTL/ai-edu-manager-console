'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditPerformanceReport } = require('../scripts/audit-agent-0228-performance.cjs');
const { mergePerformanceReports } = require('../scripts/merge-agent-0228-performance.cjs');

test('performance audit replaces task-row success with project material business evidence', () => {
  const report = {
    results: [{ runId: 'run-1', agentProvider: 'workbuddy', agentBusinessCompleted: true, passed: true, fixture: 'fixture' }],
    passed: true,
  };
  const audited = auditPerformanceReport(report, () => ({ completed: 0, failed: 1, unknown: 0, businessCompleted: false }));
  assert.equal(audited.results[0].agentBusinessCompleted, false);
  assert.equal(audited.results[0].passed, false);
  assert.equal(audited.validBusinessCompletedCount, 0);
  assert.equal(audited.passed, false);
});

test('performance audit keeps valid completed evidence and non-agent runs unchanged', () => {
  const report = {
    results: [
      { runId: 'agent', agentProvider: 'codex', agentBusinessCompleted: false, passed: false, fixture: 'fixture' },
      { runId: 'idle', agentProvider: '', passed: true },
    ],
    passed: false,
  };
  const audited = auditPerformanceReport(report, () => ({ completed: 1, failed: 0, unknown: 0, businessCompleted: true }));
  assert.equal(audited.results[0].agentBusinessCompleted, true);
  assert.equal(audited.results[0].passed, true);
  assert.equal(audited.results[1].passed, true);
  assert.equal(audited.validBusinessCompletedCount, 1);
  assert.equal(audited.passed, true);
});

test('performance audit may correct stale harness verdicts from immutable auxiliary reports', () => {
  const report = {
    results: [{
      runId: 'backlog-1', scenario: 'agent-backlog-workbuddy', agentProvider: 'workbuddy',
      fixture: 'fixture', passed: false,
      runtimeSummary: { nonRespondingSamples: 0 },
      rendererSummary: { failures: 0, p95Ms: 0.2, maximumMs: 1.4 },
      fileCadenceSummary: { accepted: false },
      projectQueryStress: { requested: true, passed: false },
      visibleInteractions: { requested: true, passed: false },
    }],
  };
  const audited = auditPerformanceReport(
    report,
    () => ({ completed: 1, failed: 0, unknown: 0, businessCompleted: true }),
    () => ({
      projectQueryStress: { requested: true, passed: true },
      visibleInteractions: { requested: true, passed: true },
      fileCadenceSummary: { accepted: true, tailQuietIntervals: 11, tailChangedIntervals: 1 },
    }),
  );
  assert.equal(audited.results[0].passed, true);
  assert.equal(audited.results[0].projectQueryStress.passed, true);
  assert.equal(audited.results[0].visibleInteractions.passed, true);
  assert.equal(audited.results[0].fileCadenceSummary.tailChangedIntervals, 1);
});

test('performance report merge preserves three independent raw runs', () => {
  const merged = mergePerformanceReports([
    { durationSeconds: 1800, warmupSeconds: 120, results: [{ runId: 'run-1', passed: true }] },
    { durationSeconds: 1800, warmupSeconds: 120, results: [{ runId: 'run-2', passed: true }, { runId: 'run-3', passed: true }] },
  ]);
  assert.equal(merged.repeats, 3);
  assert.deepEqual(merged.results.map(item => item.runId), ['run-1', 'run-2', 'run-3']);
  assert.equal(merged.passed, true);
});

test('performance report merge keeps duration metadata when the first input is a single audited run', () => {
  const merged = mergePerformanceReports([
    { runId: 'run-1', passed: true, results: [{ runId: 'run-1', passed: true }] },
    { durationSeconds: 1800, warmupSeconds: 120, results: [{ runId: 'run-2', passed: true }, { runId: 'run-3', passed: true }] },
  ]);
  assert.equal(merged.durationSeconds, 1800);
  assert.equal(merged.warmupSeconds, 120);
  assert.equal(merged.repeats, 3);
});
