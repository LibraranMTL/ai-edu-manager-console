'use strict';

const fs = require('node:fs');
const path = require('node:path');

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function businessCompletionCount(report = {}) {
  return (report.results || []).reduce((total, run) => {
    const agentCompleted = Number(run.businessEvidence?.completed || 0);
    const internalCompleted = (run.taskSemantic?.afterStatuses || []).filter(task =>
      task.executor === 'internal'
      && task.businessOutcome === 'completed'
      && task.settlementState === 'settled').length;
    return total + agentCompleted + internalCompleted;
  }, 0);
}

function buildFormalPerformance({ idle = {}, normal = {}, backlog = {}, visible = {}, traces = {} }) {
  const failures = [];
  const idleRuns = idle.results || [];
  const normalRuns = normal.results || [];
  const backlogRuns = backlog.results || [];
  if (Number(idle.durationSeconds) < 600 || Number(idle.repeats) < 3 || idleRuns.length < 3) failures.push('idle_10m_x3_missing');
  if (Number(normal.durationSeconds) < 600 || Number(normal.repeats) < 3 || normalRuns.length < 3) failures.push('normal_10m_x3_missing');
  if (Number(backlog.durationSeconds) < 1800 || Number(backlog.repeats) < 3 || backlogRuns.length < 3) failures.push('backlog_30m_x3_missing');
  const idleCpuCorePercent = average(idleRuns.map(run => Number(run.runtimeSummary?.mainCpuCoreEquivalentAveragePercent || 0)));
  if (!(idleCpuCorePercent < 1)) failures.push('idle_cpu');
  if (idleRuns.some(run => run.passed !== true)) failures.push('idle_run_failed');
  if (normalRuns.some(run => run.passed !== true)) failures.push('normal_run_failed');
  if (backlogRuns.some(run => run.passed !== true)) failures.push('backlog_run_failed');
  if (backlogRuns.some(run => run.projectQueryStress?.requested !== true || run.projectQueryStress?.passed !== true)) {
    failures.push('project_query_stress_missing');
  }
  if (visible.passed !== true || Number(visible.interactionSamples || 0) < 90
    || Number(visible.p95Ms ?? Infinity) > 150 || Number(visible.maximumLongTaskMs ?? Infinity) > 100
    || Number(visible.failures || 0) > 0) failures.push('visible_interaction');
  const baselineCompleted = businessCompletionCount(normal);
  const treatmentCompleted = businessCompletionCount(backlog);
  const baselineSeconds = Number(normal.durationSeconds || 0) * Number(normal.repeats || 0);
  const treatmentSeconds = Number(backlog.durationSeconds || 0) * Number(backlog.repeats || 0);
  if (baselineCompleted <= 0) failures.push('valid_business_baseline_missing');
  if (treatmentCompleted <= 0) failures.push('valid_business_treatment_missing');
  const throughputLossPercent = baselineCompleted > 0 && treatmentCompleted > 0 && baselineSeconds > 0 && treatmentSeconds > 0
    ? 100 * (1 - (treatmentCompleted / treatmentSeconds) / (baselineCompleted / baselineSeconds))
    : null;
  if (Number.isFinite(throughputLossPercent) && throughputLossPercent > 5) failures.push('throughput_regression');
  const idleMemory = Math.min(...idleRuns.map(run => Number(run.runtimeSummary?.mainPrivateMemoryMaximumBytes || 0)).filter(Boolean));
  const busyMemory = Math.max(...[...normalRuns, ...backlogRuns]
    .map(run => Number(run.runtimeSummary?.mainPrivateMemoryMaximumBytes || 0)).filter(Boolean));
  const extraMainMemoryBytes = Number.isFinite(idleMemory) && Number.isFinite(busyMemory) ? Math.max(0, busyMemory - idleMemory) : Infinity;
  if (!(extraMainMemoryBytes <= 50 * 1024 * 1024)) failures.push('main_memory');
  const timeouts = [...idleRuns, ...normalRuns, ...backlogRuns]
    .reduce((sum, run) => sum + Number(run.rendererSummary?.failures || 0), 0);
  return {
    schema: 'edu.agent0228.formal-performance.v1', generatedAt: new Date().toISOString(),
    passed: failures.length === 0, failures, workload: 'real_agent', repeats: Math.min(Number(normal.repeats || 0), Number(backlog.repeats || 0)),
    interactionSamples: Number(visible.interactionSamples || 0), idleCpuCorePercent,
    interactionP95Ms: Number(visible.p95Ms || 0), mainLongTaskMaxMs: Number(visible.maximumLongTaskMs || 0),
    extraMainMemoryBytes, timeouts,
    baselineCompleted, treatmentCompleted, baselineSeconds, treatmentSeconds, throughputLossPercent,
    interactionTrace: traces.interactionTrace, processTreeTrace: traces.processTreeTrace,
    baselineTrace: traces.baselineTrace, taskTimeline: traces.taskTimeline,
    scenarioDurations: { idleSeconds: Number(idle.durationSeconds || 0), normalSeconds: Number(normal.durationSeconds || 0), backlogSeconds: Number(backlog.durationSeconds || 0) },
  };
}

function main() {
  const configFile = path.resolve(process.argv[2] || '');
  const output = path.resolve(process.argv[3] || '');
  if (!configFile || !output) throw new Error('usage: node build-agent-0228-formal-performance.cjs <config> <output>');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  const read = value => JSON.parse(fs.readFileSync(path.resolve(path.dirname(configFile), value), 'utf8').replace(/^\uFEFF/, ''));
  const report = buildFormalPerformance({
    idle: read(config.idle), normal: read(config.normal), backlog: read(config.backlog), visible: read(config.visible), traces: config.traces,
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, passed: report.passed, failures: report.failures })}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { buildFormalPerformance, businessCompletionCount };
