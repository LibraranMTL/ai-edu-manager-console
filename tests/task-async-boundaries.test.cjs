'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function load(name, context) {
  let start=source.indexOf(`function ${name}(`); if(source.slice(start-6,start)==='async ')start-=6;
  vm.createContext(context); vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context); return context[name];
}
test('manual imported success cannot be published before durable storage', async () => {
  let release,published=false;
  const task={id:'t',status:'running',executionId:'e'};
  const accept=load('acceptImportedTaskResult',{readTaskStore:()=>({tasks:[task]}),
    validateExternalTaskResultIdentity:()=>({ok:true}),validateImportedTaskCompletion:async()=>({valid:true}),
    normalizeTaskResult:(_t,p)=>p,commitValidatedTaskResult:()=>({ok:true,task:{...task,status:'succeeded'}}),
    writeTaskStoreDurably:()=>new Promise((_r,reject)=>release=reject),
    publishCompletedRemoteCollaborationTask:()=>{published=true;},isDigestTask:()=>false});
  const pending=accept('t',{status:'completed'});
  await new Promise(r=>setImmediate(r));assert.equal(published,false);
  release(Error('disk full'));await assert.rejects(pending,/disk full/);assert.equal(published,false);
});
test('cancellation persists revocation before external stop; storage failure does not kill', async () => {
  for(const broken of [false,true]) {
    let store={tasks:[{id:'t',executionId:'e',status:'running',adapterId:'x'}]}, stopped=0,saved=false;
    const cancel=load('cancelTask',{taskChildProcesses:new Map(),readTaskStore:()=>structuredClone(store),
      getAgentExecutionAdapters:()=>({x:{cancel(){assert(saved);stopped++;}}}),
      transitionTaskInStore:(s,id,status,patch)=>{Object.assign(s.tasks[0],patch,{status});return {ok:true,task:s.tasks[0]};},
      writeTaskStoreDurably:async s=>{if(broken)throw Error('disk full'); store=structuredClone(s);saved=true;}});
    const result=JSON.parse(await cancel('t'));
    assert.equal(result.ok,!broken);assert.equal(stopped,broken?0:1);
    assert.equal(store.tasks[0].status,broken?'running':'cancelled');
    if(!broken)assert.equal(store.tasks[0].recoveryState,'unknown');
  }
});
test('handoff result patches a fresh ledger and never overwrites another task or new batch', async () => {
  let store={tasks:[{id:'t',executionId:'e',status:'waiting_result'},{id:'other',status:'succeeded'}]};
  const save=load('savePreparedTaskResult',{readTaskStore:()=>structuredClone(store),writeTaskStoreDurably:async s=>{store=s;}});
  await save({id:'t',executionId:'e',result:{summary:'sent request'}});
  assert.equal(store.tasks[1].status,'succeeded');
  await assert.rejects(save({id:'t',executionId:'old',result:{summary:'stale'}}),{code:'DISPATCH_STATE_CHANGED'});
});
test('receipt is committed before archive, archive path before inbox removal; failed disk keeps original', async () => {
  for(const broken of [false,true]) {
    let store={tasks:[{id:'t',executionId:'e',status:'running'}]}, commits=0;const events=[];
    const consume=load('consumeAgentTaskResults',{
      crypto, agentTaskChannel:()=>({}),taskCenterDirPath:()=>'/synthetic',readTaskStore:()=>structuredClone(store),
      validateExternalTaskResultIdentity:()=>({ok:true}),validateTaskChannelIdentity:()=>({ok:true}),
      validateImportedTaskCompletion:async()=>({valid:true}),normalizeTaskResult:(_t,r)=>r,
      commitValidatedTaskResult:(s,t,result)=>{commits++;Object.assign(t,{status:'succeeded',result});return {ok:true,task:t};},
      writeTaskStoreDurably:async s=>{events.push('save');if(broken)throw Error('disk full');store=structuredClone(s);},
      archiveAgentPayload:async()=>{events.push('archive');assert.equal(store.tasks[0].status,'succeeded');return '/archive/result.json';},
      fs:{promises:{unlink:async()=>{assert.equal(store.tasks[0].result.resultFile,'/archive/result.json');events.push('unlink');}}},
      taskStoreGuard:{flush:async()=>{}},isDigestTask:()=>false,notify:()=>{},
    });
    const receipt={claims:[],results:[{file:'/inbox/result.json',payload:{taskId:'t',executionId:'e',status:'completed'},channel:{agentId:'x'}}]};
    const result=JSON.parse(await consume('x',receipt));assert.equal(result.ok,!broken);
    assert.deepEqual(events,broken?['save']:['save','archive','save','unlink']);
    if(!broken){ await consume('x',receipt);assert.equal(commits,1,'duplicate after crash cannot reapply knowledge'); }
  }
});
test('dispatch admission lifetime spans async execution preparation', async () => {
  const {createProjectArchiveRuntime}=require('../electron/project-archive-runtime.cjs');
  const runtime=createProjectArchiveRuntime(); let finish;
  const pending=new Map();
  const execute=load('executeTaskByAdapter',{projectArchiveRuntime:runtime,taskDispatchPending:pending,
    executeTaskByAdapterCore:()=>new Promise(r=>finish=r),notify(){},console});
  assert.equal(JSON.parse(execute('t')).queued,true);await new Promise(r=>setImmediate(r));
  await assert.rejects(runtime.maintenance(async()=>{}),/业务操作/);
  finish('{"ok":true}');await pending.get('t');
  assert.equal(runtime.status().activeOperations,0);
});
