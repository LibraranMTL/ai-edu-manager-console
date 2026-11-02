'use strict';
// Database-only recovery rehearsal. No runtime, agent or source-file operations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync,backup}=require('node:sqlite');
const {createTaskIoClient}=require('../electron/task-io-client.cjs'),{createTaskStoreService}=require('../electron/task-store-service.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(2,i),v.slice(i+1)];}));
if(!args.source||!args.output)throw Error('Required --source=DB --output=NEW_ARTIFACT_DIR');
const source=path.resolve(args.source),root=path.resolve(args.output),base=path.resolve(__dirname,'../artifacts');
const relative=path.relative(base,root);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.existsSync(root))throw Error('Output must be a new artifacts subdirectory');
fs.mkdirSync(root,{recursive:true});const database=path.join(root,'task-state.sqlite3'),legacy=path.join(root,'tasks.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(db){return db.prepare('SELECT task_id,payload_json FROM tasks ORDER BY task_id').all().map(r=>{const t=JSON.parse(r.payload_json);return {id:r.task_id,workKey:t.workKey,sourceVersion:t.sourceVersion,executionId:t.executionId,status:t.status,attempt:t.attempt,budget:t.executionBudget,resultHash:hash(JSON.stringify(t.result??null))};});}
function auditInventory(db){const exists=name=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));return {budgets:exists('task_execution_budget')?hash(JSON.stringify(db.prepare('SELECT * FROM task_execution_budget ORDER BY work_key').all())):'',events:exists('task_events')?db.prepare('SELECT COUNT(*) n FROM task_events').get().n:0};}
(async()=>{
 const original=new DatabaseSync(source,{readOnly:true});try{await backup(original,database);}finally{original.close();}
 const copied=new DatabaseSync(database,{readOnly:true});const before=inventory(copied),auditBefore=auditInventory(copied);copied.close();
 const client=createTaskIoClient(),service=createTaskStoreService({request:(...a)=>client.request(...a)}),stages=[];
 try{
  await service.initialize(legacy);let cursor='',eligible=[];
  for(;;){const page=await service.previewTaskRecovery({cursor,limit:20});if(!page.rows.length)break;eligible.push(...page.rows.filter(r=>['settle_existing','requeue_proven_not_sent','reconcile_original'].includes(r.action)));cursor=page.cursor;}
  const groups=[eligible.slice(0,1),eligible.slice(1,21)];for(let n=21;n<eligible.length;n+=20)groups.push(eligible.slice(n,n+20));
  for(const [index,rows]of groups.entries()){const at=performance.now(),results=[];for(const row of rows){const result=await service.applyTaskRecovery({...row,jobId:'copy-recovery'});if(!result.ok)throw Error(`Recovery rejected: ${result.reason}`);results.push({taskId:row.taskId,action:row.action,applied:result.applied});}stages.push({stage:index===0?'one':index===1?'twenty':'remainder',elapsedMs:performance.now()-at,results});await new Promise(setImmediate);}
 }finally{await client.close();}
 const final=new DatabaseSync(database,{readOnly:true});let after,integrity,foreignKeys,auditAfter;try{after=inventory(final);auditAfter=auditInventory(final);integrity=final.prepare('PRAGMA integrity_check').get().integrity_check;foreignKeys=final.prepare('PRAGMA foreign_key_check').all().length;}finally{final.close();}
 const conserved=before.length===after.length&&before.every((old,i)=>{const next=after[i];return old.id===next.id&&['workKey','sourceVersion','executionId','attempt','budget','resultHash'].every(k=>JSON.stringify(old[k])===JSON.stringify(next[k]))&&(!['cancelled','archived','suspended'].includes(old.status)||old.status===next.status);});
 const auditConserved=auditBefore.budgets===auditAfter.budgets&&auditAfter.events>=auditBefore.events+stages.reduce((n,s)=>n+s.results.filter(r=>r.applied).length,0);
 const report={schema:'edu.backlog-copy-rehearsal.v1',at:new Date().toISOString(),sourceReadOnly:true,source,copy:database,agentsInvoked:0,physicalFilesTouched:0,totalBefore:before.length,totalAfter:after.length,stages,conserved,auditBefore,auditAfter,auditConserved,integrity,foreignKeys,passed:conserved&&auditConserved&&integrity==='ok'&&foreignKeys===0};
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output:root,total:before.length,applied:stages.reduce((n,s)=>n+s.results.filter(r=>r.applied).length,0),passed:report.passed}));if(!report.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
