'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDispatchCapabilityGate}=require('../electron/agent-capability-readiness.cjs');
const {createTaskRetryQueue}=require('../electron/task-retry-queue.cjs');
const {automaticTaskDispatchDecision}=require('../electron/task-auto-dispatch.cjs');
const {taskPresentation}=require('../electron/task-read-model.cjs');
const base={id:'synthetic',kind:'student_digest',status:'queued',trigger:'event',automaticExecution:true,attempt:0};
test('repeated checks do not extend a pending shared-probe deadline',()=>{
 let now=0;const g=createDispatchCapabilityGate({now:()=>now,probe:()=>new Promise(()=>{})});
 try{const a=g.ensureReady({providers:['codex'],profileId:'digest',configRevision:1});now=1000;
  const b=g.ensureReady({providers:['codex'],profileId:'digest',configRevision:1});assert.equal(b.retryAt,a.retryAt);
 }finally{g.close();}
});
test('capability retry owns a timer and stays automatic without consuming an execution attempt',async()=>{
 let now=0,callback,delay,calls=0;const task={...base,capabilityWait:{providerIds:['codex'],nextRetryAt:new Date(15000).toISOString()},nextRetryAt:new Date(15000).toISOString()};
 assert.equal(automaticTaskDispatchDecision(task,{now}).reason,'capability_wait');
 const q=createTaskRetryQueue({now:()=>now,setTimer:(fn,ms)=>{callback=fn;delay=ms;return 1;},clearTimer:()=>{},yieldTurn:async()=>{},run:()=>{calls++;}});
 try{q.schedule(task.id,'capability_wait',15000);assert.equal(delay,15000);now=15000;await callback();assert.equal(calls,1);
 assert.equal(automaticTaskDispatchDecision(task,{now}).eligible,true);assert.equal(task.attempt,0);assert.equal(taskPresentation(task).userGroup,'automatic');
 }finally{q.close();}
});
test('exhausted capability checks request environment help without manufacturing a manual handoff',()=>{
 const p=taskPresentation({...base,capabilityWait:{exhausted:true,nextRetryAt:'2030-01-01',reasonCode:'probe_unknown'}});
 assert.equal(p.userGroup,'needs_help');assert.equal(p.automationState,'environment_help');assert.equal(p.awaitingSend,false);
});
test('production normalization preserves capability wait and durable execution phase',async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-capability-normalize-'));
 const host=await require('./helpers/smart-inbox-task-host.cjs').createTaskHost(root);
 t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
 const task={...base,executionId:'execution',executionPhase:'claimed',capabilityWait:{providerIds:['codex'],nextRetryAt:'2030-01-01',exhausted:false}};
 const normalized=host.context.normalizeTaskEnvelope(task);
 assert.equal(normalized.executionPhase,'claimed');assert.deepEqual(JSON.parse(JSON.stringify(normalized.capabilityWait)),task.capabilityWait);
 assert.equal(host.context.normalizeTaskEnvelope({...normalized,capabilityWait:null},normalized).capabilityWait,null);
 const old={...normalized,executionPhase:'not_sent',settlementState:'needs_attention',businessOutcome:'needs_user_action'};
 const cleared=host.context.normalizeTaskEnvelope({...old,settlementState:null,businessOutcome:null},old);
 assert.equal(cleared.settlementState,'');assert.equal(cleared.businessOutcome,'');
 assert.equal(host.context.normalizeTaskEnvelope({...old,executionPhase:'unknown',settlementState:null,businessOutcome:null},old).businessOutcome,'needs_user_action');
});

test('candidate refresh cannot replace the work identity of an active execution',async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-active-identity-'));
 const host=await require('./helpers/smart-inbox-task-host.cjs').createTaskHost(root);
 t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
 const active={id:'active',kind:'student_digest',sourceType:'student',sourceId:'s1',status:'running',workKey:'student_digest:s1:old',sourceVersion:'source-v1',pipelineVersion:'pipe-v1',
  executionId:'execution-v1',executionPhase:'started',startedAt:'2026-10-30T00:00:00.000Z',automaticExecution:true};
 host.context.upsertTaskCandidates([active]);
 host.context.upsertTaskCandidates([{...active,status:'pending',workKey:'student_digest:s1:new',sourceVersion:'source-v2',pipelineVersion:'pipe-v2',executionId:'',executionPhase:'',startedAt:''}]);
 const stored=host.disk().tasks.find(task=>task.id==='active');
 assert.equal(stored.status,'running');
 assert.equal(stored.executionId,'execution-v1');
 assert.equal(stored.workKey,'student_digest:s1:old');
 assert.equal(stored.sourceVersion,'source-v1');
 assert.equal(stored.pipelineVersion,'pipe-v1');
});

test('a new work cycle clears the previous settlement while keeping the stable task id',async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-new-cycle-settlement-'));
 const host=await require('./helpers/smart-inbox-task-host.cjs').createTaskHost(root);
 t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
 const completed={id:'digest',kind:'project_digest',sourceType:'project',sourceId:'p1',status:'succeeded',idempotencyKey:'project_digest:p1:source-v1',workKey:'project_digest:p1:source-v1',sourceVersion:'source-v1',pipelineVersion:'pipe-v1',
  executionId:'execution-v1',executionPhase:'settled',settlementState:'settled',businessOutcome:'completed',completedAt:'2026-10-30T00:00:00.000Z',automaticExecution:true,
  result:{status:'completed',validation:{valid:true},businessOutcome:'completed'}};
 host.context.upsertTaskCandidates([completed]);
 host.context.upsertTaskCandidates([{...completed,status:'pending',idempotencyKey:'project_digest:p1:source-v2',workKey:'project_digest:p1:source-v2',sourceVersion:'source-v2',pipelineVersion:'pipe-v1',
  executionId:'',executionPhase:'',settlementState:'',businessOutcome:'',completedAt:'',result:null}]);
 const stored=host.disk().tasks.find(task=>task.id==='digest');
 assert.equal(stored.status,'pending');
 assert.equal(stored.workKey,'project_digest:p1:source-v2');
 assert.equal(stored.settlementState,'');
 assert.equal(stored.businessOutcome,'');
 assert.equal(stored.executionId,'');
 assert.equal(stored.result,null);
});
