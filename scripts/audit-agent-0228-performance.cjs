'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { summarizeFixture } = require('./lib/agent-0228-business-result.cjs');

function nonBusinessCriteriaPassed(result = {}) {
  if (typeof result.performanceCriteriaPassed === 'boolean') return result.performanceCriteriaPassed;
  if (result.runtimeSummary && result.rendererSummary && result.fileCadenceSummary) {
    return Number(result.runtimeSummary.nonRespondingSamples || 0) === 0
      && Number(result.rendererSummary.failures || 0) === 0
      && Number(result.rendererSummary.p95Ms || 0) <= 150
      && Number(result.rendererSummary.maximumMs || 0) <= 100
      && result.fileCadenceSummary.accepted === true
      && (result.projectQueryStress?.requested !== true || result.projectQueryStress?.passed === true)
      && (result.visibleInteractions?.requested !== true || result.visibleInteractions?.passed === true)
      && (result.scenario !== 'idle-unknown'
        || Number(result.runtimeSummary.mainCpuCoreEquivalentAveragePercent || 0) < 1);
  }
  return result.passed === true || result.agentBusinessCompleted === false;
}

function auditPerformanceReport(report = {}, summarize = summarizeFixture, auxiliaryEvidence = () => ({})) {
  const results = (report.results || []).map(result => {
    if (!result.agentProvider) return { ...result };
    const normalized = { ...result, ...auxiliaryEvidence(result) };
    const businessEvidence = summarize(result.fixture);
    const performanceCriteriaPassed = nonBusinessCriteriaPassed(normalized);
    return {
      ...normalized,
      performanceCriteriaPassed,
      agentBusinessCompleted: businessEvidence.businessCompleted === true,
      businessEvidence,
      passed: performanceCriteriaPassed && businessEvidence.businessCompleted === true,
    };
  });
  return {
    ...report,
    schema: 'edu.p0.host-performance-audited.v1',
    auditedAt: new Date().toISOString(),
    results,
    validBusinessCompletedCount: results.filter(item => item.agentProvider && item.agentBusinessCompleted).length,
    failedBusinessCount: results.filter(item => item.agentProvider && !item.agentBusinessCompleted).length,
    passed: results.length > 0 && results.every(item => item.passed === true),
  };
}

function main() {
  const source = path.resolve(process.argv[2] || '');
  const destination = path.resolve(process.argv[3] || '');
  if (!source || !destination) throw new Error('usage: node audit-agent-0228-performance.cjs <source> <destination>');
  const bytes = fs.readFileSync(source);
  const report = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const sourceDir = path.dirname(source);
  const readIfPresent = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : null;
  const audited = auditPerformanceReport(report, summarizeFixture, result => {
    const runDir = path.join(sourceDir, String(result.runId || ''));
    const query = readIfPresent(path.join(runDir, 'project-query-stress.json'));
    const visible = readIfPresent(path.join(runDir, 'visible-interactions.json'));
    const cadence = readIfPresent(path.join(runDir, 'file-cadence.json'));
    const tail = (cadence?.intervals || []).slice(-12);
    const tailQuietIntervals = tail.filter(interval => Number(interval.changedCount || 0) === 0).length;
    const tailChangedIntervals = tail.length - tailQuietIntervals;
    const cadenceAccepted = cadence
      ? cadence.continuousWriteDetected !== true || (tailQuietIntervals >= 6 && tailChangedIntervals <= 1)
      : result.fileCadenceSummary?.accepted === true;
    return {
      projectQueryStress: result.projectQueryStress?.requested === true
        ? { ...result.projectQueryStress, passed: query?.passed === true }
        : result.projectQueryStress,
      visibleInteractions: result.visibleInteractions?.requested === true
        ? { ...result.visibleInteractions, passed: visible?.passed === true }
        : result.visibleInteractions,
      fileCadenceSummary: cadence ? {
        ...result.fileCadenceSummary, accepted: cadenceAccepted, tailQuietIntervals, tailChangedIntervals,
      } : result.fileCadenceSummary,
    };
  });
  audited.source = { path: source, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(audited, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output: destination, passed: audited.passed, validBusinessCompletedCount: audited.validBusinessCompletedCount })}\n`);
}

if (require.main === module) main();
module.exports = { auditPerformanceReport, nonBusinessCriteriaPassed };
