'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createTaskStateStore,databasePathForLegacy}=require('../electron/task-state-store.cjs');
const {createTaskStoreWriter}=require('../electron/task-store-writer.cjs');
const {createTaskStoreService}=require('../electron/task-store-service.cjs');
function fixture(t,overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edu-claim-')),file=path.join(dir,'tasks.json');
 const task={id:'a',sourceType:'student',sourceId:'synthetic',workKey:'student:synthetic:v1',sourceVersion:'1',status:'pending',automaticExecution:true,...overrides};
 fs.writeFileSync(file,JSON.stringify({tasks:[task,{...task,id:'b'}],runtime:{},history:[]}));
 let store=createTaskStateStore({legacyPath:file});store.open();
 const closes=[];
 t.after(()=>{for(const close of closes)close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {file,closes,get store(){return store},restart(){store.close();store=createTaskStateStore({legacyPath:file});store.open();},claim(extra={}){
   assert.equal(typeof store.claimTaskExecution,'function','persistent claim API required');
   return store.claimTaskExecution({taskId:'a',workKey:task.workKey,sourceVersion:'1',providerId:'codex',sessionRunId:'test-session',dispatchOrigin:'automatic',policyRevision:'p1',expectedTaskRevision:store.detail('a').taskRevision,...extra});
 }};
}
test('one task/work key can only be claimed once; restart preserves claim',t=>{
 const f=fixture(t),first=f.claim();assert.equal(first.claimed,true);assert.ok(first.executionId);assert.equal(f.claim().reason,'active_execution');
 assert.equal(f.claim({taskId:'b',expectedTaskRevision:f.store.detail('b').taskRevision}).reason,'active_execution');
 f.restart();assert.equal(f.claim().reason,'active_execution');assert.equal(f.store.detail('a').task.executionId,first.executionId);
});
test('a duplicate phase acknowledgement cannot authorize a superseded task identity',t=>{
 const f=fixture(t),c=f.claim();
 f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:'p1'});
 f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'send_intent',nextPhase:'started',evidence:{processId:123}});
 f.store.patchTask('a',{executionId:'superseded'});
 assert.equal(f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'send_intent',nextPhase:'started',evidence:{processId:123}}).ok,false);
});
test('legacy work-key version can be claimed without changing the business retry input hash',t=>{
 const f=fixture(t,{sourceVersion:''}),first=f.claim({sourceVersion:'work:student:synthetic:v1'});assert.equal(first.claimed,true);
 assert.equal(f.store.detail('a').task.sourceVersion,'');
 assert.equal(f.store.advanceTaskExecution({executionId:first.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:'p1'}).ok,true);
});
test('atomic send intent survives lost reply and cannot be reclaimed after restart',t=>{
 const f=fixture(t),claim=f.claim();const args={executionId:claim.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:'p1'};
 assert.equal(f.store.advanceTaskExecution(args).ok,true);assert.equal(f.store.advanceTaskExecution(args).duplicate,true);
 f.restart();assert.equal(f.claim().claimed,false);
 assert.equal(f.store.advanceTaskExecution({executionId:claim.executionId,expectedPhase:'send_intent',nextPhase:'not_sent'}).ok,false);
});
test('revision/source mismatch or cancellation cannot claim or send',t=>{
 const f=fixture(t);assert.equal(f.claim({sourceVersion:'2'}).reason,'source_changed');assert.equal(f.claim({expectedTaskRevision:-1}).reason,'revision_conflict');
 const c=f.claim();f.store.patchTask('a',{status:'cancelled'});
 assert.equal(f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:'p1'}).reason,'task_not_runnable');
});
test('legacy unknown execution and live protected states prevent new claims',t=>{
 const f=fixture(t,{status:'waiting_result',executionId:'legacy-run'});assert.equal(f.claim().claimed,false);
 f.store.patchTask('a',{status:'queued',executionId:'legacy-run',executionState:'unknown'});assert.equal(f.claim().claimed,false);
});
test('owned preparation can cross send barrier; no-work closes without a fabricated process start',t=>{
 const f=fixture(t),c=f.claim();f.store.patchTask('a',{status:'running'});
 assert.equal(f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:'p1'}).ok,true);
 const d=fixture(t),n=d.claim();assert.equal(d.store.advanceTaskExecution({executionId:n.executionId,expectedPhase:'claimed',nextPhase:'settled',resultKind:'no_work',evidence:{receiptVerified:true}}).ok,true);
 const db=new DatabaseSync(databasePathForLegacy(d.file));try{assert.equal(db.prepare('SELECT started_at FROM task_execution_attempts').get().started_at,'');}finally{db.close();}
});
test('future capability waits can be recovered by bounded SQL pages after restart',t=>{
 const f=fixture(t);f.store.patchTask('a',{status:'queued',nextRetryAt:'2030-01-01T00:00:00.000Z',capabilityWait:{providerIds:['codex'],nextRetryAt:'2030-01-01T00:00:00.000Z'}});f.restart();
 assert.equal(typeof f.store.listCapabilityWaitTasks,'function');
 const result=f.store.listCapabilityWaitTasks({limit:1});assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].id,'a');
 assert.equal(f.store.listCapabilityWaitTasks({cursor:result.cursor,limit:1}).tasks.length,0);
});
test('settlement requires result evidence; completed attempts are immutable and queryable',t=>{
 const f=fixture(t),c=f.claim();f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:'p1'});
 assert.equal(f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'send_intent',nextPhase:'started',evidence:{processId:123}}).ok,true);
 assert.equal(f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'started',nextPhase:'settled',resultKind:'completed'}).ok,false);
 assert.equal(f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'started',nextPhase:'settled',resultKind:'completed',evidence:{receiptVerified:true,artifactHash:'a'.repeat(64)}}).ok,true);
 assert.equal(f.store.detail('a').task.status,'succeeded');assert.equal(f.claim().claimed,false);
 const db=new DatabaseSync(databasePathForLegacy(f.file));t.after(()=>{});
 try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);assert.equal(db.prepare('SELECT COUNT(*) n FROM task_execution_attempts WHERE active=1').get().n,0);assert.ok(fs.readdirSync(path.join(path.dirname(f.file),'migration-backups')).some(x=>x.includes('v4-')));}finally{db.close();}
});
test('confirmed no-effect research timeout can close the attempt without marking business success',t=>{
 const f=fixture(t),c=f.claim();
 f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:'p1'});
 f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'send_intent',nextPhase:'started',evidence:{processId:123}});
 f.store.patchTask('a',{status:'failed',businessOutcome:'failed_retryable',autoRetry:true,nextRetryAt:'2030-01-01T00:00:00.000Z'});
 const result=f.store.advanceTaskExecution({executionId:c.executionId,expectedPhase:'started',nextPhase:'settled',
  resultKind:'safe_retry_no_output',preserveBusinessState:true,evidence:{noOutputVerified:true,terminationClosed:true}});
 assert.equal(result.ok,true);const task=f.store.detail('a').task;
 assert.equal(task.status,'failed');assert.equal(task.businessOutcome,'failed_retryable');assert.equal(task.autoRetry,true);
 const db=new DatabaseSync(databasePathForLegacy(f.file));try{assert.equal(db.prepare('SELECT result_kind FROM task_execution_attempts').get().result_kind,'safe_retry_no_output');}finally{db.close();}
});
test('Worker claim updates row cache and durable revision; competing writes cannot erase execution identity',async t=>{
 const f=fixture(t),writer=createTaskStoreWriter();let release;
 const service=createTaskStoreService({request:async(file,op,q)=>{
   if(op==='store_claim_execution')await new Promise(r=>release=r);
   return writer.request(file,op,q);
 }});f.closes.push(()=>writer.close());await service.initialize(f.file);
 assert.equal(typeof service.claimTaskExecution,'function');
 const work=service.claimTaskExecution({taskId:'a',workKey:'student:synthetic:v1',sourceVersion:'1',providerId:'codex',sessionRunId:'s1',dispatchOrigin:'automatic',policyRevision:'p1'});
 await new Promise(setImmediate);
 assert.throws(()=>service.patchTask('a',{status:'queued'}),{code:'TASK_EXECUTION_PENDING'});
 release();const claim=await work;assert.equal(claim.claimed,true);assert.equal(service.read(f.file,{taskIds:['a']}).value.tasks[0].executionId,claim.executionId);
 assert.equal(service.status(),null);await service.patchTask('a',{message:'unrelated progress'});
 const send=await service.advanceTaskExecution({executionId:claim.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:'p1'});assert.equal(send.ok,true);
 assert.equal(service.read(f.file,{taskIds:['a']}).value.tasks[0].executionPhase,'send_intent');await service.flush();
 const dbrow=await writer.request(f.file,'detail',{id:'a'});assert.equal(dbrow.task.message,'unrelated progress');assert.equal(dbrow.task.executionId,claim.executionId);
});
