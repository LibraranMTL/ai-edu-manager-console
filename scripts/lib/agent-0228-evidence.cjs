'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function validateEvidence(report, root) {
  const failures = [];
  const check = (condition, code) => { if (!condition) failures.push(code); };
  check(report?.schema === 'edu.agent0228.acceptance.v1', 'schema');
  check(/^[a-f0-9]{64}$/i.test(report?.candidateHash || ''), 'candidate_hash');
  const provenance = report?.sourceProvenance || {};
  check(Boolean(provenance.candidateHash)
    && provenance.candidateHash === report?.candidateHash
    && provenance.runtimeAsarHash === report?.candidateHash
    && /^[a-f0-9]{64}$/i.test(provenance.sourceTreeHash || ''), 'candidate_source_mismatch');
  const verified = new Set();
  const documents=new Map();
  for (const artifact of report?.artifacts || []) {
    const file = path.resolve(root, artifact.path || '');
    const relative = path.relative(path.resolve(root), file);
    try {
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(file).isSymbolicLink()) throw Error('scope');
      const realRelative=path.relative(fs.realpathSync(root),fs.realpathSync(file));if(realRelative.startsWith('..')||path.isAbsolute(realRelative))throw Error('real_scope');
      const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (hash.toLowerCase() !== String(artifact.sha256).toLowerCase()) throw Error('hash');
      verified.add(artifact.path);
      if(path.extname(file)==='.json')try{documents.set(artifact.path,JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));}catch{}
    } catch { failures.push(`artifact:${artifact.path}`); }
  }
  check(verified.size > 0, 'no_verified_artifacts');
  for (const provider of ['workbuddy', 'codex']) {
    const scenarios = (report?.scenarios || []).filter(s => s.providerId === provider && s.evidenceKind === 'real_agent_e2e'&&s.expectedOutcome==='completed');
    check(scenarios.length > 0, `real_agent_missing:${provider}`);
    for (const s of scenarios) {
      check(s.observedStatus === 'pass' && s.candidateHash === report.candidateHash && verified.has(s.trace), `scenario_provenance:${s.id}`);
      check(s.started > 0 && s.registered >= s.started && s.receipts === s.started && s.settled === s.started && s.duplicateExecutions === 0, `closure:${s.id}`);
      const trace=documents.get(s.trace),events=trace?.events||[],types=['claim','send_intent','started','receipt','settled'];
      check(trace?.schema==='edu.agent0228.execution-trace.v1'&&trace.candidateHash===report.candidateHash&&trace.providerId===provider&&Boolean(trace.executionId&&trace.workKey&&trace.sourceVersion),`trace_identity:${s.id}`);
      check(types.every(type=>events.filter(e=>e.type===type).length===1)&&events.every(e=>e.executionId===trace?.executionId),`trace_lifecycle:${s.id}`);
      const ordered=types.map(type=>events.find(e=>e.type===type)),times=ordered.map(e=>Date.parse(e?.at));
      check(times.every((n,i)=>Number.isFinite(n)&&(i===0||n>=times[i-1])),`trace_order:${s.id}`);
      const started=ordered[2],tree=documents.get(trace?.processTree),receipt=documents.get(trace?.receipt);
      check(tree?.processes?.some(p=>p.pid===started?.processId&&p.providerId===provider&&Number.isInteger(p.ppid)&&p.executablePath),`process_tree:${s.id}`);
      check(receipt?.executionId===trace?.executionId&&receipt?.workKey===trace?.workKey&&receipt?.sourceVersion===trace?.sourceVersion&&receipt?.validation?.valid===true&&verified.has(receipt?.artifact),`receipt_identity:${s.id}`);
      check(ordered[4]?.businessOutcome==='completed'&&ordered[4]?.settlementState==='settled',`business_settlement:${s.id}`);
    }
  }
  for (const s of report?.scenarios || []) check(s.observedStatus === 'pass' && s.duplicateExecutions === 0, `scenario:${s.id}`);
  const recovery = report?.recovery || {};
  check(Number.isInteger(recovery.lateReceiptsObserved)
    && recovery.lateReceiptsObserved >= 1
    && recovery.lateReceiptsSettled === recovery.lateReceiptsObserved
    && recovery.lateReceiptEvidencePreserved === recovery.lateReceiptsObserved
    && recovery.duplicateExecutions === 0, 'late_receipt_conservation');
  const p = report?.performance || {};
  check(verified.has(p.interactionTrace)&&verified.has(p.processTreeTrace)&&verified.has(p.baselineTrace)&&verified.has(p.taskTimeline), 'performance_raw_evidence');
  check(p.workload === 'real_agent' && p.repeats >= 3 && p.interactionSamples >= 30, 'performance_workload');
  const bounded = (value, limit) => Number.isFinite(value) && value >= 0 && value <= limit;
  check(bounded(p.idleCpuCorePercent, 1) && p.idleCpuCorePercent < 1, 'idle_cpu');
  check(bounded(p.interactionP95Ms, 150) && p.timeouts === 0, 'interaction');
  check(bounded(p.mainLongTaskMaxMs, 100), 'long_task');
  check(bounded(p.extraMainMemoryBytes, 50 * 1024 * 1024), 'main_memory');
  let throughputLossPercent = null;
  if ([p.baselineCompleted, p.treatmentCompleted, p.baselineSeconds, p.treatmentSeconds].every(n => Number.isFinite(n) && n > 0)) {
    throughputLossPercent = 100 * (1 - (p.treatmentCompleted / p.treatmentSeconds) / (p.baselineCompleted / p.baselineSeconds));
    check(throughputLossPercent <= 5, 'throughput_regression');
  } else failures.push('throughput_baseline_missing');
  return { passed: failures.length === 0, failures, throughputLossPercent };
}
module.exports = { validateEvidence };
