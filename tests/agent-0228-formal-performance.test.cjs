'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFormalPerformance } = require('../scripts/build-agent-0228-formal-performance.cjs');

function run(scenario, completed, cpu = 0.2, memory = 100) {
  return {
    scenario, passed: true, agentProvider: scenario.includes('agent') ? 'workbuddy' : '',
    agentBusinessCompleted: completed > 0,
    businessEvidence: { completed: completed > 0 ? 1 : 0, completedElapsedMs: completed > 0 ? 10000 : 0, businessCompleted: completed > 0 },
    runtimeSummary: { mainCpuCoreEquivalentAveragePercent: cpu, mainPrivateMemoryMaximumBytes: memory, nonRespondingSamples: 0 },
    rendererSummary: { failures: 0, p95Ms: 20, maximumMs: 30 },
    taskSemantic: { afterStatuses: Array.from({ length: Math.max(0, completed - 1) }, (_, index) => ({
      taskId: `internal-${index}`, executor: 'internal', businessOutcome: 'completed', settlementState: 'settled', status: 'succeeded',
    })) },
    projectQueryStress: { requested: scenario.includes('backlog'), passed: true },
  };
}

test('formal performance counts only settled business inputs and accepts equal-or-better backlog throughput', () => {
  const report = buildFormalPerformance({
    idle: { durationSeconds: 600, repeats: 3, results: [run('idle-unknown', 0, .2, 90), run('idle-unknown', 0, .3, 95), run('idle-unknown', 0, .1, 92)] },
    normal: { durationSeconds: 600, repeats: 3, results: [run('agent-workbuddy', 1), run('agent-workbuddy', 1), run('agent-workbuddy', 1)] },
    backlog: { durationSeconds: 1800, repeats: 3, results: [run('agent-backlog-workbuddy', 13), run('agent-backlog-workbuddy', 13), run('agent-backlog-workbuddy', 13)] },
    visible: { passed: true, interactionSamples: 90, p95Ms: 40, maximumLongTaskMs: 0, mainEventLoop: { maximumMs: 20 }, failures: 0 },
    traces: { interactionTrace: 'visible.json', processTreeTrace: 'tree.json', baselineTrace: 'normal.json', taskTimeline: 'timeline.json' },
  });
  assert.equal(report.baselineCompleted, 3);
  assert.equal(report.treatmentCompleted, 3);
  assert.ok(report.throughputLossPercent <= 5);
  assert.equal(report.passed, true);
});

test('no_work task rows cannot satisfy the real business throughput denominator', () => {
  const noWork = run('agent-workbuddy', 0);
  noWork.passed = true;
  noWork.taskSemantic.afterStatuses = [{ status: 'succeeded', businessOutcome: 'no_work', settlementState: 'settled' }];
  const report = buildFormalPerformance({
    idle: { durationSeconds: 600, repeats: 3, results: [run('idle-unknown', 0), run('idle-unknown', 0), run('idle-unknown', 0)] },
    normal: { durationSeconds: 600, repeats: 3, results: [noWork, noWork, noWork] },
    backlog: { durationSeconds: 1800, repeats: 3, results: [run('agent-backlog-workbuddy', 13), run('agent-backlog-workbuddy', 13), run('agent-backlog-workbuddy', 13)] },
    visible: { passed: true, interactionSamples: 90, p95Ms: 40, maximumLongTaskMs: 0, mainEventLoop: { maximumMs: 20 }, failures: 0 },
    traces: { interactionTrace: 'visible.json', processTreeTrace: 'tree.json', baselineTrace: 'normal.json', taskTimeline: 'timeline.json' },
  });
  assert.equal(report.baselineCompleted, 0);
  assert.equal(report.passed, false);
  assert.ok(report.failures.includes('valid_business_baseline_missing'));
});
