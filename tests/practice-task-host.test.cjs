const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPracticeTaskHost}=require('../electron/practice-task-host.cjs');
const {validateTaskTransition}=require('../electron/task-protocol.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(review,options={}){
 let store={tasks:[]},release=0,notified=0,host,api;
 const transition=(doc,id,status,patch={})=>{const i=doc.tasks.findIndex(t=>t.id===id),result=validateTaskTransition(doc.tasks[i].status,status);if(!result.ok)return result;doc.tasks[i]={...doc.tasks[i],...patch,status};return {ok:true,task:doc.tasks[i]};};
 host={read:()=>structuredClone(store),write:value=>{store=value;},student:id=>id==='a'?{id,name:'Synthetic'}:null,studentDirectory:()=>'/fixture',active:()=>true,running:new Map(),
 upsert:values=>store.tasks.push(...values),transition,acquire:()=>()=>release++,retryLater:()=>{},heartbeat:()=>{},notify:()=>notified++,
 runtime:()=>({reviewAttempt:review,recoverable:async()=>['one']}),execute:id=>{const next=host.read(),task=next.tasks.find(t=>t.id===id);if(task.status==='pending'){transition(next,id,'approved');host.write(next);}return api.submit(host.read().tasks.find(t=>t.id===id));},...options};
 api=createPracticeTaskHost(host);return {api,host,get store(){return store;},get releases(){return release;},get notified(){return notified;}};
}
test('task center serializes card reviews, deduplicates submissions and releases permits',async()=>{
 const pending=[];let calls=0;const f=fixture(async()=>{calls++;return new Promise(resolve=>pending.push(resolve));});
 await f.api.enqueue('a','one');await f.api.enqueue('a','one');await f.api.enqueue('a','two');await turn();
 assert.equal(calls,1);assert.equal(f.store.tasks.length,2);const first=[...f.host.running.values()][0].completion;
 pending.shift()({status:'reviewed'});await first;await turn();assert.equal(calls,2);
 const second=[...f.host.running.values()][0].completion;pending.shift()({status:'needs_attention'});await second;
 assert.deepEqual(f.store.tasks.map(t=>t.status),['succeeded','succeeded']);assert.equal(f.releases,2);assert.equal(f.notified,2);
});
test('cancellation and timeout stop work without succeeding; retry is explicit',async()=>{
 const review=async(id,attempt,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))));
 const f=fixture(review);await f.api.enqueue('a','one');await turn();const running=[...f.host.running.values()][0];running.child.kill();await running.completion;
 assert.equal(f.store.tasks[0].status,'cancelled');assert.equal(f.host.running.size,0);assert.equal(f.releases,1);
 const timed=fixture(review,{timeoutMs:15});await timed.api.enqueue('a','one');await turn();await Promise.all([[...timed.host.running.values()][0].completion,new Promise(r=>setTimeout(r,30))]);assert.equal(timed.store.tasks[0].status,'timed_out');
});
test('restart recovers only runtime-owned attempts, expired scope never queues a review',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return {status:'reviewed'};});
 f.host.upsert([{id:f.api.taskId('a','one'),kind:'practice_attempt_review',sourceId:'a',status:'running',input:{attemptId:'one'}}]);
 await f.api.recover('a');await turn();await Promise.all([...f.host.running.values()].map(r=>r.completion));await turn();assert.equal(calls,1);assert.equal(f.store.tasks[0].status,'succeeded');
 await assert.rejects(f.api.enqueue('other','one'),/学生/);
});
