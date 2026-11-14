'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTaskStateStore}=require('../electron/task-state-store.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edu-session-')),file=path.join(dir,'tasks.json');
 fs.writeFileSync(file,JSON.stringify({tasks:['a','b','c'].map(id=>({id,workKey:id,sourceVersion:'1',status:'pending',sourceType:'student',sourceId:'synthetic'})),runtime:{},history:[]}));
 const store=createTaskStateStore({legacyPath:file});store.open();t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return store;}
function claim(s,id,provider='codex',session='now'){const value=s.claimTaskExecution({taskId:id,workKey:id,sourceVersion:'1',providerId:provider,sessionRunId:session,dispatchOrigin:'automatic',policyRevision:'p',expectedTaskRevision:s.detail(id).taskRevision});assert.equal(value.claimed,true);return value.executionId;}
function step(s,id,from,to,extra={}){const r=s.advanceTaskExecution({executionId:id,expectedPhase:from,nextPhase:to,policyRevision:'p',...extra});assert.equal(r.ok,true);return r;}
function start(s,id){step(s,id,'claimed','send_intent');step(s,id,'send_intent','started',{evidence:{processId:123}});}
test('claimed and no-work never count as an automatic start or output success',t=>{const s=fixture(t),a=claim(s,'a');claim(s,'b');step(s,a,'claimed','settled',{resultKind:'no_work',settlementSessionRunId:'now',evidence:{receiptVerified:true}});const r=s.getTaskSessionSummary('now');assert.equal(r.automaticStarted,0);assert.equal(r.automaticSucceeded,0);assert.equal(r.noWork,1);assert.equal(r.claimedNotStarted,1);});
test('two real provider starts count two attempts but one business work; yesterday receipt is historical and idempotent',t=>{const s=fixture(t);let id=claim(s,'a');start(s,id);step(s,id,'started','not_sent',{evidence:{notSentVerified:true}});id=claim(s,'a','workbuddy');start(s,id);step(s,id,'started','settled',{resultKind:'completed',settlementSessionRunId:'now',evidence:{receiptVerified:true}});
 const old=claim(s,'b','codex','yesterday');start(s,old);const q={executionId:old,expectedPhase:'started',nextPhase:'settled',resultKind:'completed',settlementSessionRunId:'now',evidence:{receiptVerified:true}};s.advanceTaskExecution(q);s.advanceTaskExecution(q);
 const r=s.getTaskSessionSummary('now');assert.equal(r.automaticStarted,2);assert.equal(r.automaticStartedWorkItems,1);assert.equal(r.automaticSucceeded,1);assert.equal(r.historicalSettledThisRun,1);assert.equal(r.byExecutor.find(x=>x.providerId==='workbuddy').started,1);
});
test('unknown execution is separate from failure; manual packets count unique packets rather than row properties',t=>{const s=fixture(t),id=claim(s,'a');start(s,id);step(s,id,'started','unknown');s.patchTask('b',{status:'waiting_result',executionMode:'agent_handoff',executionId:'packet-b',result:{packet:{command:'not logged'}}});
 const q={taskId:'b',sessionRunId:'now',kind:'manual_packet',packetId:'packet-b'};s.recordTaskRunOutcome(q);s.recordTaskRunOutcome(q);s.patchTask('b',{executor:'codex'});
 const r=s.getTaskSessionSummary('now');assert.equal(r.executionUnknown,1);assert.equal(r.automaticFailed,0);assert.equal(r.manualFallbacks,1);assert.equal(r.automaticStarted,1);});
