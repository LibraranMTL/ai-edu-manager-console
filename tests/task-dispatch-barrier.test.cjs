'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTaskDispatchBarrier}=require('../electron/task-dispatch-barrier.cjs');
test('scheduler origin is durably automatic and missing legacy source version preserves work identity',async()=>{
 let recorded;const b=createTaskDispatchBarrier({readTask:()=>({id:'legacy',workKey:'fixed-work',sourceVersion:''}),readPolicy:()=>({}),sessionRunId:'s',canSend:async()=>({ok:true}),store:{claimTaskExecution:async q=>{recorded=q;return {claimed:true,executionId:'e'};}}});
 await b.claim('legacy','codex','scheduler','digest.v1');assert.equal(recorded.dispatchOrigin,'automatic');assert.equal(recorded.sourceVersion,'work:fixed-work');assert.equal(recorded.profileId,'digest.v1');
});
test('send waits for durable acknowledgement; policy revocation after claim prevents sending',async()=>{
 let policy={version:1},ack,events=[];
 const barrier=createTaskDispatchBarrier({sessionRunId:'synthetic',readTask:()=>({id:'a',workKey:'s:a:v1',sourceVersion:'1'}),readPolicy:()=>policy,
  canSend:async()=>({ok:true}),store:{claimTaskExecution:async()=>({ok:true,claimed:true,executionId:'e'}),advanceTaskExecution:async q=>{events.push(q);if(q.nextPhase==='send_intent')await new Promise(r=>ack=r);return {ok:true};}}});
 const c=await barrier.claim('a','codex','scheduler');let sent=false;const run=barrier.sendIntent(c).then(()=>sent=true);
 await new Promise(setImmediate);assert.equal(sent,false);ack();await run;assert.equal(sent,true);
 policy={version:2};assert.equal((await barrier.sendIntent(c)).code,'AGENT_POLICY_CHANGED');assert.equal(events.at(-1).nextPhase,'not_sent');
});
test('denied scope creates no claim or dispatch side effect',async()=>{
 let claims=0;
 const b=createTaskDispatchBarrier({readTask:()=>({id:'a'}),readPolicy:()=>({}),sessionRunId:'s',canSend:async()=>({ok:false,code:'AGENT_SCOPE_DENIED'}),store:{claimTaskExecution:async()=>{claims++;}}});
 assert.equal((await b.claim('a','codex','scheduler')).code,'AGENT_SCOPE_DENIED');assert.equal(claims,0);
});
