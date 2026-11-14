'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createTaskStateStore,migrate,databasePathForLegacy}=require('../electron/task-state-store.cjs');
const {createTaskSourceQueue}=require('../electron/task-source-queue.cjs');
const {createTaskStoreWriter}=require('../electron/task-store-writer.cjs');
const {createTaskStoreService}=require('../electron/task-store-service.cjs');
function fixture(t,tasks=[]){const root=fs.mkdtempSync(path.join(os.tmpdir(),'task-incremental-v2-')),file=path.join(root,'tasks.json');
 fs.writeFileSync(file,JSON.stringify({tasks,history:[],runtime:{}}));const closes=[];
 t.after(async()=>{for(const close of closes)await close();fs.rmSync(root,{recursive:true,force:true});});return {root,file,closes};}
const task=(id,sourceId='s')=>({id,sourceType:'student',sourceId,kind:'student_digest',status:'pending',trigger:'event',automaticExecution:true,updatedAt:'2026-10-23T00:00:00.000Z'});
test('v1 to v5 preserves rows, online backups and integrity; failure rolls back schema',t=>{
 const f=fixture(t,[task('a'),task('b')]),dbPath=databasePathForLegacy(f.file);migrate({legacyPath:f.file,dbPath});
 const s=createTaskStateStore({legacyPath:f.file});f.closes.push(()=>s.close());s.open();
 const db=new DatabaseSync(dbPath);f.closes.unshift(()=>db.close());
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);assert.equal(s.readTasks().tasks.length,2);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const backup=JSON.parse(db.prepare("SELECT value_json FROM task_state_meta WHERE key='v2Backup'").get().value_json);
 const saved=new DatabaseSync(backup,{readOnly:true});assert.equal(saved.prepare('PRAGMA user_version').get().user_version,1);assert.equal(saved.prepare('select count(*) n from tasks').get().n,2);saved.close();
 const v3Backup=JSON.parse(db.prepare("SELECT value_json FROM task_state_meta WHERE key='v3Backup'").get().value_json);
 const savedV2=new DatabaseSync(v3Backup,{readOnly:true});assert.equal(savedV2.prepare('PRAGMA user_version').get().user_version,2);savedV2.close();
 const v4Backup=JSON.parse(db.prepare("SELECT value_json FROM task_state_meta WHERE key='v4Backup'").get().value_json);
 const savedV3=new DatabaseSync(v4Backup,{readOnly:true});assert.equal(savedV3.prepare('PRAGMA user_version').get().user_version,3);savedV3.close();
 const bad=path.join(f.root,'bad');fs.mkdirSync(bad);const legacy=path.join(bad,'tasks.json'),badDb=databasePathForLegacy(legacy);
 fs.writeFileSync(legacy,JSON.stringify({tasks:[task('broken')]}));migrate({legacyPath:legacy,dbPath:badDb});
 const corrupt=new DatabaseSync(badDb);corrupt.exec("UPDATE tasks SET payload_json='{broken'");corrupt.close();
 assert.throws(()=>createTaskStateStore({legacyPath:legacy}).open());
 const unchanged=new DatabaseSync(badDb);assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version,1);assert.equal(unchanged.prepare('PRAGMA table_info(tasks)').all().length,4);unchanged.close();
});
test('v4 stores stable work identity, priority and durable execution budgets',t=>{
 const f=fixture(t,[{...task('a'),workKey:'student_digest:s:content',sourceVersion:'content',pipelineVersion:'v3',priorityClass:60,queuedAt:'2026-10-23T00:00:00.000Z'}]);
 const s=createTaskStateStore({legacyPath:f.file});f.closes.push(()=>s.close());s.open();
 const db=new DatabaseSync(databasePathForLegacy(f.file));f.closes.unshift(()=>db.close());
 const row=db.prepare('SELECT work_key,source_version,pipeline_version,priority_class FROM tasks WHERE task_id=?').get('a');
 assert.deepEqual({...row},{work_key:'student_digest:s:content',source_version:'content',pipeline_version:'v3',priority_class:60});
 const first=s.budget('record',{budgetKey:'budget-a',workKey:row.work_key,errorSignature:'unsupported',inputHash:'h',maxAttempts:2,error:{code:'unsupported'}}).budget;
 const second=s.budget('record',{budgetKey:'budget-a',workKey:row.work_key,errorSignature:'unsupported',inputHash:'h',maxAttempts:2,error:{code:'unsupported'}}).budget;
 assert.equal(first.attempts,1);assert.equal(second.attempts,2);assert.equal(second.terminal_state,'failed_terminal');
 assert.equal(s.budget('get',{budgetKey:'budget-a'}).budget.attempts,2);
});
test('increments only target rows, no-op does not write, conflicts rollback, requests deduplicate',t=>{
 const f=fixture(t,[task('a'),task('b')]),s=createTaskStateStore({legacyPath:f.file});f.closes.push(()=>s.close());s.open();
 const initial=s.readTasks(),revision=s.revision(),result=s.applyDelta({upserts:[{...task('a'),title:'changed'}],expectedRevision:revision,mutationId:'once'});
 assert.deepEqual(result.changedTaskIds,['a']);assert.deepEqual(s.readTasks().tasks.find(t=>t.id==='b'),initial.tasks.find(t=>t.id==='b'));
 assert.equal(s.readTasks().revisions.b,1);assert.equal(s.readTasks().revisions.a,2);
 assert.equal(s.applyDelta({upserts:[{...task('a'),title:'changed'}]}).revision,result.revision);
 assert.equal(s.applyDelta({mutationId:'once',upserts:[task('b')]}).duplicate,true);
 assert.throws(()=>s.patchTask('a',{title:'stale'},1),{code:'TASK_STORE_CONFLICT'});
 assert.equal(s.detail('a').task.title,'changed');assert.throws(()=>s.writeSnapshot({}),{code:'task_full_snapshot_write_forbidden'});
 assert.throws(()=>s.applyDelta({upserts:Array.from({length:101},(_,i)=>task(String(i)))}),{code:'TASK_BATCH_TOO_LARGE'});
});
test('page is bounded, revision/filter sensitive and does not write SQLite',t=>{
 const f=fixture(t,Array.from({length:162},(_,i)=>task(String(i)))),s=createTaskStateStore({legacyPath:f.file});f.closes.push(()=>s.close());s.open();
 const db=new DatabaseSync(databasePathForLegacy(f.file));f.closes.unshift(()=>db.close());let v=db.prepare('PRAGMA data_version').get().data_version;
 const page=s.list({status:'automatic'});assert.equal(page.tasks.length,20);assert.equal(page.summary.total,162);
 assert.equal(s.list({status:'automatic',knownRevision:page.revision}).unchanged,true);
 assert.notEqual(s.list({status:'history',knownRevision:page.revision}).unchanged,true);
 assert.equal(db.prepare('PRAGMA data_version').get().data_version,v);
 s.patchTask('1',{status:'succeeded'});assert.notEqual(s.list({status:'automatic',knownRevision:page.revision}).unchanged,true);
});
test('SQL runnable paging preserves event immediacy, retry deadlines and excludes running/unknown',t=>{
 const f=fixture(t,[{...task('event'),scheduledAt:'2999-01-01'}, {...task('later'),kind:'weekly_action',trigger:'schedule',scheduledAt:'2999-01-01'},
 {...task('resource'),resourceRetryAt:'2999-01-01'}, {...task('running'),status:'running'}, {...task('retry'),status:'failed',nextRetryAt:'2020-01-01'}]);
 const s=createTaskStateStore({legacyPath:f.file});f.closes.push(()=>s.close());s.open();
 assert.deepEqual(s.listRunnableTasks().tasks.map(t=>t.id),['event']);assert.deepEqual(s.listRunnableTasks({retry:true}).tasks.map(t=>t.id),['retry']);
});
test('SQL runnable keyset cursor follows effective priority without duplicates or omissions',t=>{
 const tasks=Array.from({length:45},(_,i)=>({...task(`task-${String(i).padStart(2,'0')}`),
   priorityClass:i%3===0?80:i%3===1?60:40,queuedAt:`2026-10-23T00:${String(i).padStart(2,'0')}:00.000Z`}));
 const f=fixture(t,tasks),s=createTaskStateStore({legacyPath:f.file});f.closes.push(()=>s.close());s.open();
 const seen=[];let cursor='';
 for(let page=0;page<10;page++){
   const result=s.listRunnableTasks({now:'2026-10-23T00:50:00.000Z',limit:7,cursor});
   seen.push(...result.tasks.map(value=>value.id));cursor=result.cursor;
   if(result.tasks.length<7)break;
 }
 assert.equal(seen.length,45);assert.equal(new Set(seen).size,45);
 assert.deepEqual(new Set(seen),new Set(tasks.map(value=>value.id)));
 const priorities=seen.map(id=>tasks.find(value=>value.id===id).priorityClass);
 assert.ok(priorities.every((value,index)=>index===0||priorities[index-1]>=value));
});
test('scoped control writes never retire another source and notify only after commit',async t=>{
 const f=fixture(t,[task('a','one'),task('b','two')]),writer=createTaskStoreWriter();f.closes.push(()=>writer.close());let committed=[];
 const service=createTaskStoreService({request:(...args)=>writer.request(...args),onCommitted:e=>committed.push(e)});await service.initialize(f.file);
 const draft=service.read(f.file,{sourceType:'student',sourceId:'one'}).value;assert.equal(draft.tasks.length,1);
 draft.tasks[0].status='succeeded';service.write(f.file,draft);assert.equal(committed.length,0);await service.flush();
 assert.deepEqual(committed[0].changedTaskIds,['a']);assert.equal((await writer.request(f.file,'detail',{id:'b'})).task.status,'pending');
 const next=service.read(f.file,{sourceType:'student',sourceId:'one'}).value;next.tasks=[];service.write(f.file,next);await service.flush();
 assert.deepEqual((await writer.request(f.file,'records')).tasks.map(t=>t.id),['b']);
});
test('100 source events coalesce, edits during processing survive, failed sources retry',async()=>{
 let timers=0,clock=0,calls=[],saved=[],q;
 q=createTaskSourceQueue({now:()=>clock,setTimer:()=>{timers++;return {unref(){}};},clearTimer:()=>{},yieldTurn:async()=>{},
 persist:async e=>saved.push(e.sourceRevision),processSource:async e=>{calls.push(e.sourceRevision);if(e.sourceRevision==='99')q.mark('student','a','during','100');}});
 for(let i=0;i<100;i++)q.mark('student','a','upload',String(i));assert.equal(timers,1);assert.equal(q.size(),1);
 await q.drain();assert.equal(q.size(),1);await q.drain();assert.equal(q.size(),0);assert.deepEqual(calls,['99','100']);assert.deepEqual(saved,calls);q.close();
 let attempts=0;const retry=createTaskSourceQueue({now:()=>clock,setTimer:()=>({unref(){}}),clearTimer:()=>{},yieldTurn:async()=>{},processSource:async()=>{if(++attempts===1)throw Error('changed');}});
 retry.mark('project','p','change');await retry.drain();assert.equal(retry.size(),1);await retry.drain();assert.equal(attempts,1);clock=30000;await retry.drain();assert.equal(retry.size(),0);retry.close();
});
test('changed source revision cannot be cleared by stale projection completion',t=>{
 const f=fixture(t),s=createTaskStateStore({legacyPath:f.file});f.closes.push(()=>s.close());s.open();
 s.source('dirty',{sourceType:'student',sourceId:'s',sourceRevision:'2'});s.source('projection',{sourceType:'student',sourceId:'s',sourceRevision:'1',projection:{}});
 assert.equal(s.source('get',{sourceType:'student',sourceId:'s'}).source.dirty,1);
 s.source('projection',{sourceType:'student',sourceId:'s',sourceRevision:'2',projection:{pendingCount:1}});assert.equal(s.source('list').sources.length,0);
});
