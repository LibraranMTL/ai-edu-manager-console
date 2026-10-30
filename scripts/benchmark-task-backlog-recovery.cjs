'use strict';
// Synthetic acceptance only. It never opens the formal task database or invokes an Agent.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {monitorEventLoopDelay,performance}=require('node:perf_hooks');
const {DatabaseSync}=require('node:sqlite');
const {createTaskStateStore}=require('../electron/task-state-store.cjs');
const {createTaskIoClient}=require('../electron/task-io-client.cjs');
const {createTaskStoreService}=require('../electron/task-store-service.cjs');

const count=100000,eligibleCount=21;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-backlog-100k-')),legacy=path.join(root,'tasks.json');
const output=path.resolve('artifacts/p0-agent-0228/task6-backlog-recovery-100k.json');
const store=createTaskStateStore({legacyPath:legacy});
store.open();
for(let offset=0;offset<count;offset+=100){
 const tasks=Array.from({length:Math.min(100,count-offset)},(_,index)=>{
  const n=offset+index,id=`recovery-${String(n).padStart(6,'0')}`,eligible=n<eligibleCount;
  return {id,title:'合成恢复任务',kind:'student_digest',sourceType:'student',sourceId:`synthetic-${n%100}`,
   status:eligible?'waiting_result':'failed',workKey:`work:${id}`,sourceVersion:'v1',executionId:eligible?`run-${id}`:'',
   executionPhase:eligible?'started':'',updatedAt:'2026-10-30T00:00:00.000Z',
   result:eligible?{executionId:`run-${id}`,workKey:`work:${id}`,sourceVersion:'v1',validation:{valid:true}}:null};
 });
 store.upsertTaskBatch(tasks);
}
store.close();

(async()=>{
 const client=createTaskIoClient(),service=createTaskStoreService({request:(...args)=>client.request(...args)});
 try{
  await service.initialize(legacy);
  const delay=monitorEventLoopDelay({resolution:10});delay.enable();
  let cursor='',rowsSeen=0,pages=0,maxWorkerElapsedMs=0;const actionable=[];const started=performance.now();
  for(;;){
   const page=await service.previewTaskRecovery({cursor,limit:20});
   if(!page.rows.length)break;
   rowsSeen+=page.rows.length;pages++;maxWorkerElapsedMs=Math.max(maxWorkerElapsedMs,Number(page.elapsedMs||0));
   actionable.push(...page.rows.filter(row=>row.action==='settle_existing'));
   cursor=page.cursor;
   await new Promise(setImmediate);
  }
  const stages=[];
  for(const [name,rows] of [['one',actionable.slice(0,1)],['twenty',actionable.slice(1,21)]]){
   const at=performance.now();let applied=0;
   for(const row of rows){const result=await service.applyTaskRecovery({...row,jobId:'synthetic-100k'});if(!result.ok)throw Error(result.reason||result.code);if(result.applied)applied++;}
   stages.push({name,count:rows.length,applied,elapsedMs:Number((performance.now()-at).toFixed(3))});
   await new Promise(setImmediate);
  }
  delay.disable();await client.close();
  const db=new DatabaseSync(path.join(root,'task-state.sqlite3'),{readOnly:true});
  const total=db.prepare('SELECT COUNT(*) total FROM tasks').get().total,integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
  const settled=db.prepare("SELECT COUNT(*) total FROM tasks WHERE status='succeeded'").get().total;db.close();
  const report={schema:'edu.task-backlog-recovery-benchmark.v1',synthetic:true,count,rowsSeen,pages,actionable:actionable.length,
   scanMs:Number((performance.now()-started).toFixed(3)),maxWorkerElapsedMs,eventLoopMaxMs:delay.max/1e6,stages,total,settled,integrity,
   agentsInvoked:0,physicalFilesTouched:0};
  report.passed=rowsSeen===count&&actionable.length===eligibleCount&&stages.reduce((n,row)=>n+row.applied,0)===eligibleCount
   &&total===count&&settled===eligibleCount&&integrity==='ok'&&maxWorkerElapsedMs<=500&&report.eventLoopMaxMs<=100;
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(!report.passed)process.exitCode=1;
 }finally{await client.close().catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
