'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const modulePath = path.join(__dirname, '../scripts/lib/agent-0228-evidence.cjs');
const validate = (...args) => { assert.ok(fs.existsSync(modulePath), '0.22.8 evidence validator must exist'); return require(modulePath).validateEvidence(...args); };
function fixture(t,empty=false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'trace.json'), '{}');
  const sha256 = crypto.createHash('sha256').update('{}').digest('hex');
  const value={ root, report: { schema: 'edu.agent0228.acceptance.v1', candidateHash: 'a'.repeat(64),
    sourceProvenance: { candidateHash: 'a'.repeat(64), runtimeAsarHash: 'a'.repeat(64), sourceTreeHash: 'a'.repeat(64) },
    artifacts: [{ path: 'trace.json', sha256 }],
    scenarios: ['workbuddy', 'codex'].map(providerId => ({ id: providerId, providerId,expectedOutcome:'completed', evidenceKind: 'real_agent_e2e', observedStatus: 'pass', candidateHash: 'a'.repeat(64), trace: 'trace.json', registered: 1, started: 1, receipts: 1, settled: 1, duplicateExecutions: 0 })),
    recovery: { lateReceiptsObserved: 1, lateReceiptsSettled: 1, lateReceiptEvidencePreserved: 1, duplicateExecutions: 0 },
    performance: { interactionTrace:'trace.json',processTreeTrace:'trace.json',baselineTrace:'trace.json',taskTimeline:'trace.json',baselineCompleted: 10, treatmentCompleted: 10, baselineSeconds: 100, treatmentSeconds: 100, workload: 'real_agent', idleCpuCorePercent: .5, interactionP95Ms: 100, rendererLongTaskMaxMs: 50, mainEventLoopMaxMs: 40, extraMainMemoryBytes: 1024, repeats: 3, interactionSamples: 30, timeouts: 0 },
  } };
  if(!empty){const add=(file,data)=>{const bytes=JSON.stringify(data);fs.writeFileSync(path.join(root,file),bytes);value.report.artifacts.push({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});};
   for(const s of value.report.scenarios){const id=s.providerId;s.trace=id+'.json';
    add(id+'-artifact.json',{syntheticUnitTest:true});add(id+'-processes.json',{processes:[{pid:12,ppid:11,providerId:id,executablePath:'synthetic-fixture.exe'}]});
    add(id+'-receipt.json',{executionId:id,workKey:'w',sourceVersion:'v',validation:{valid:true},artifact:id+'-artifact.json'});
    add(s.trace,{schema:'edu.agent0228.execution-trace.v1',candidateHash:value.report.candidateHash,runtimeAsarHash:value.report.candidateHash,providerId:id,executionId:id,workKey:'w',sourceVersion:'v',processTree:id+'-processes.json',receipt:id+'-receipt.json',events:['claim','send_intent','started','receipt','settled'].map(type=>({type,executionId:id,at:'2026-10-29T00:00:00Z',processId:12,businessOutcome:'completed',settlementState:'settled'}))});
   }
  }return value;
}
test('known complete evidence passes and performance sampling is informational', t => {
  const { root, report } = fixture(t); assert.equal(validate(report, root).passed, true);
  report.performance.treatmentSeconds = 120; assert.equal(validate(report, root).passed, true);
});
test('a matching file hash alone is not execution evidence',t=>{
 const {root,report}=fixture(t,true);assert.equal(validate(report,root).passed,false);
});
test('injected outcomes and internal workload cannot substitute real Agent closure', t => {
  const { root, report } = fixture(t); report.scenarios[0].evidenceKind = 'contract_injected';
  assert.equal(validate(report, root).passed, false);
  report.scenarios[0].evidenceKind = 'real_agent_e2e'; report.performance.workload = 'internal';
  assert.equal(validate(report, root).passed, true);
});
test('missing provenance, tampered trace and no baseline fail closed', t => {
  const { root, report } = fixture(t); report.artifacts[0].sha256 = 'b'.repeat(64);
  assert.equal(validate(report, root).passed, false);
  fs.unlinkSync(path.join(root, 'trace.json')); assert.equal(validate(report, root).passed, false);
  delete report.performance; assert.equal(validate(report, root).passed, false);
});
test('performance sampling is informational while duplicate execution and not-run fail independently', t => {
  const { root, report } = fixture(t);
  for (const mutate of [r => r.performance.interactionP95Ms = 151, r => r.performance.idleCpuCorePercent = 1.1,
    r => r.performance.rendererLongTaskMaxMs = 101, r => r.performance.mainEventLoopMaxMs = 101]) {
    const r = structuredClone(report); mutate(r); assert.equal(validate(r, root).passed, true);
  }
  for (const mutate of [r => r.scenarios[0].duplicateExecutions = 1, r => r.scenarios[0].observedStatus = 'not_run']) {
    const r = structuredClone(report); mutate(r); assert.equal(validate(r, root).passed, false);
  }
});
