'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {validateEvidence}=require('../scripts/lib/agent-0228-evidence.cjs');

const HASH='a'.repeat(64);
function write(root,name,value){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});const bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(file,bytes);return {path:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu0228-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const artifacts=[];const scenarios=[];
 for(const providerId of ['workbuddy','codex']){
  const executionId=`${providerId}-execution`,workKey=`${providerId}-work`,sourceVersion='v1';
  const artifact=write(root,`${providerId}-result.md`,{ok:true});artifacts.push(artifact);
  const receipt=write(root,`${providerId}-receipt.json`,{executionId,workKey,sourceVersion,validation:{valid:true},artifact:artifact.path});artifacts.push(receipt);
  const processTree=write(root,`${providerId}-process.json`,{processes:[{pid:100+(providerId==='codex'?1:0),ppid:1,providerId,executablePath:`C:/${providerId}.exe`}]});artifacts.push(processTree);
  const names=['claim','send_intent','started','receipt','settled'];
  const trace=write(root,`${providerId}-trace.json`,{schema:'edu.agent0228.execution-trace.v1',candidateHash:HASH,providerId,executionId,workKey,sourceVersion,receipt:receipt.path,processTree:processTree.path,events:names.map((type,i)=>({type,executionId,at:new Date(Date.UTC(2026,9,30,0,0,i)).toISOString(),...(type==='started'?{processId:100+(providerId==='codex'?1:0)}:{}),...(type==='settled'?{businessOutcome:'completed',settlementState:'settled'}:{})}))});artifacts.push(trace);
  scenarios.push({id:`${providerId}-real`,providerId,expectedOutcome:'completed',evidenceKind:'real_agent_e2e',observedStatus:'pass',candidateHash:HASH,trace:trace.path,registered:1,started:1,receipts:1,settled:1,duplicateExecutions:0});
 }
 const perf={};for(const name of ['interaction','tree','baseline','timeline']){const a=write(root,`performance-${name}.json`,{name});artifacts.push(a);perf[name]=a.path;}
 const report={schema:'edu.agent0228.acceptance.v1',candidateHash:HASH,sourceProvenance:{candidateHash:HASH,runtimeAsarHash:HASH,sourceTreeHash:HASH},artifacts,scenarios,
  recovery:{lateReceiptsObserved:2,lateReceiptsSettled:2,lateReceiptEvidencePreserved:2,duplicateExecutions:0},
  performance:{workload:'real_agent',repeats:3,interactionSamples:90,idleCpuCorePercent:.2,interactionP95Ms:30,mainLongTaskMaxMs:50,extraMainMemoryBytes:1024,timeouts:0,interactionTrace:perf.interaction,processTreeTrace:perf.tree,baselineTrace:perf.baseline,taskTimeline:perf.timeline,baselineCompleted:30,treatmentCompleted:30,baselineSeconds:600,treatmentSeconds:600}};
 return {root,report};
}
test('release CLI refuses an empty evidence directory and saves explicit missing-evidence findings',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu0228-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/acceptance-agent-0228.cjs'),`--evidence=${root}`,'--stage=release'],{encoding:'utf8'});
 assert.equal(result.status,1);const report=JSON.parse(fs.readFileSync(path.join(root,'acceptance-result.json'),'utf8'));
 assert.equal(report.passed,false);assert.ok(report.failures.includes('acceptance_index_missing'));assert.equal(report.formalDataModified,false);
});

test('a complete real-agent, provenance, recovery and paired-performance fixture passes',t=>{const {root,report}=fixture(t);assert.deepEqual(validateEvidence(report,root).failures,[]);});
test('missing real closure is rejected',t=>{const {root,report}=fixture(t);report.scenarios=report.scenarios.filter(x=>x.providerId!=='codex');assert.ok(validateEvidence(report,root).failures.includes('real_agent_missing:codex'));});
test('injected-only evidence cannot substitute for a real closure',t=>{const {root,report}=fixture(t);report.scenarios.find(x=>x.providerId==='codex').evidenceKind='injected_contract';assert.ok(validateEvidence(report,root).failures.includes('real_agent_missing:codex'));});
test('performance without a paired baseline is rejected',t=>{const {root,report}=fixture(t);delete report.performance.baselineCompleted;assert.ok(validateEvidence(report,root).failures.includes('throughput_baseline_missing'));});
test('candidate/source/runtime hash mismatch is rejected',t=>{const {root,report}=fixture(t);report.sourceProvenance.runtimeAsarHash='b'.repeat(64);assert.ok(validateEvidence(report,root).failures.includes('candidate_source_mismatch'));});
test('any duplicate external execution is rejected',t=>{const {root,report}=fixture(t);report.scenarios[0].duplicateExecutions=1;assert.ok(validateEvidence(report,root).failures.some(x=>x.includes('workbuddy-real')));});
test('lost late-receipt evidence is rejected',t=>{const {root,report}=fixture(t);report.recovery.lateReceiptsSettled=1;assert.ok(validateEvidence(report,root).failures.includes('late_receipt_conservation'));});

test('release CLI requires the C1-C5 provider and intake matrix as well as A and B',t=>{
 const {root,report}=fixture(t);const matrixEvidence=write(root,'matrix.json',{passed:true});report.artifacts.push(matrixEvidence);
 report.matrix=[...Array.from({length:15},(_,i)=>({id:`A${i+1}`,status:'pass',candidateHash:HASH,evidence:matrixEvidence.path})),
  ...Array.from({length:7},(_,i)=>({id:`B${i+1}`,status:'pass',candidateHash:HASH,evidence:matrixEvidence.path}))];
 fs.writeFileSync(path.join(root,'acceptance-index.json'),JSON.stringify(report));
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/acceptance-agent-0228.cjs'),`--evidence=${root}`,'--stage=pre-candidate'],{encoding:'utf8'});
 assert.equal(result.status,1);const checked=JSON.parse(fs.readFileSync(path.join(root,'acceptance-result.json'),'utf8'));
 for(const id of ['C1','C2','C3','C4','C5'])assert.ok(checked.failures.includes(`matrix:${id}`));
});
