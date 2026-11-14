'use strict';
// Only the SQLite online backup reads the original; all migrations/writes use
// the isolated copy. No Agent calls, file scans, or student file writes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const {createTaskIoClient}=require('../electron/task-io-client.cjs');
const {createTaskStoreService}=require('../electron/task-store-service.cjs');
const digest=rows=>crypto.createHash('sha256').update(rows.map(row=>row.payload_json).join('\n')).digest('hex');
const p95=v=>v.sort((a,b)=>a-b)[Math.ceil(v.length*.95)-1];
(async()=>{
 const original=path.resolve(process.argv[2]);if(!fs.existsSync(original))throw Error('Original SQLite not found');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-task-real-copy-')),file=path.join(root,'tasks.json'),destination=path.join(root,'task-state.sqlite3');
 const source=new DatabaseSync(original,{readOnly:true});try{await backup(source,destination);}finally{source.close();}
 const before=new DatabaseSync(destination,{readOnly:true}),rows=before.prepare('SELECT payload_json FROM tasks ORDER BY task_id').all();
 const hash=digest(rows),initialVersion=before.prepare('PRAGMA user_version').get().user_version;before.close();
 const client=createTaskIoClient(),service=createTaskStoreService({request:(...args)=>client.request(...args)});
 try{
  await service.initialize(file);global.gc?.();const memory=process.memoryUsage().rss,delays=monitorEventLoopDelay({resolution:10});delays.enable();
  const page=[],patch=[];for(let i=0;i<40;i++){let start=performance.now();await client.request(file,'list',{status:'automatic'});page.push(performance.now()-start);}
  const sample=JSON.parse(rows[0].payload_json);for(let i=0;i<30;i++){const start=performance.now();await service.patchTask(sample.id,{detail:sample.detail||''});patch.push(performance.now()-start);}
  delays.disable();await service.flush();
  const db=new DatabaseSync(destination,{readOnly:true});const afterRows=db.prepare('SELECT payload_json FROM tasks ORDER BY task_id').all();
  const report={at:new Date().toISOString(),copy:root,sourceReadOnly:true,agentCalls:0,physicalFileWrites:0,
    count:rows.length,initialVersion,version:db.prepare('PRAGMA user_version').get().user_version,
    originalPayloadPreserved:digest(afterRows)===hash,integrity:Object.values(db.prepare('PRAGMA integrity_check').get())[0],foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length,
    pageP95Ms:p95(page),noOpPatchP95Ms:p95(patch),mainEventLoopMaxMs:delays.max/1e6,rssDeltaMB:(process.memoryUsage().rss-memory)/1048576};
  db.close();report.passed=report.originalPayloadPreserved&&report.integrity==='ok'&&!report.foreignKeyErrors&&report.pageP95Ms<=100&&report.mainEventLoopMaxMs<=100;
  fs.writeFileSync(path.resolve('artifacts/task-incremental-real-copy.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
 }finally{await client.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
