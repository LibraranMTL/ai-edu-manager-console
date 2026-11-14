'use strict';
// Explicit synthetic acceptance tool; never shipped in the application.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const {createTaskStateStore}=require('../electron/task-state-store.cjs');
const {createTaskIoClient}=require('../electron/task-io-client.cjs');
const {createTaskStoreService}=require('../electron/task-store-service.cjs');
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
async function time(work,n=30){const values=[];for(let i=0;i<n;i++){const start=performance.now();await work(i);values.push(performance.now()-start);}return {p95:p95(values),max:Math.max(...values)};}
(async()=>{
 const report={at:new Date().toISOString(),synthetic:true,node:process.version,results:[]};
 for(const count of [162,10000,100000]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-task-benchmark-')),file=path.join(root,'tasks.json');
  const store=createTaskStateStore({legacyPath:file});store.open();
  for(let offset=0;offset<count;offset+=100)store.upsertTaskBatch(Array.from({length:Math.min(100,count-offset)},(_,i)=>({
    id:'task-'+String(offset+i).padStart(6,'0'),title:'合成测试任务',kind:'student_digest',sourceType:'student',sourceId:'synthetic-'+((offset+i)%100),
    status:(offset+i)%3===0?'succeeded':'pending',trigger:'event',automaticExecution:true,executor:'codex',updatedAt:'2026-10-23T00:00:00.000Z',
    input:{synthetic:true,version:1},result:null})));
  store.close();
  const client=createTaskIoClient(),service=createTaskStoreService({request:(...args)=>client.request(...args)});
  try{
   await service.initialize(file);global.gc?.();const before=process.memoryUsage();const delay=monitorEventLoopDelay({resolution:10});delay.enable();
   const page=await time(()=>client.request(file,'list',{status:'automatic'}));
   const single=await time(i=>service.patchTask('task-000001',{count:i}));
   const batches={};for(const size of [20,100])batches[size]=await time(async i=>{
     const current=await client.request(file,'records',{limit:size});await service.upsertTaskBatch(current.tasks.map(task=>({...task,count:i+1000*size})));});
   const unchanged=await client.request(file,'list',{}),noChange=await time(()=>client.request(file,'list',{knownRevision:unchanged.revision}));
   delay.disable();const after=process.memoryUsage();
   const r={count,page,single,batches,noChange,eventLoopMaxMs:delay.max/1e6,heapDeltaMB:(after.heapUsed-before.heapUsed)/1048576,rssDeltaMB:(after.rss-before.rss)/1048576};
   r.passed=page.p95<=100&&single.p95<=20&&batches[100].p95<=250&&r.eventLoopMaxMs<=100&&r.rssDeltaMB<=50;
   report.results.push(r);console.log(JSON.stringify(r));
  }finally{await client.close();fs.rmSync(root,{recursive:true,force:true});}
 }
 report.passed=report.results.every(row=>row.passed);
 const output=path.resolve('artifacts/task-incremental-benchmark.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
