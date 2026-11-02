'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {planTaskRecovery,recoveryEvidence,recoveryEvidenceRevision}=require('../electron/task-backlog-recovery.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(value=>{const i=value.indexOf('=');return [value.slice(2,i),value.slice(i+1)];}));
if(!args.database||!args.output)throw Error('Usage: node scripts/preview-task-backlog-recovery.cjs --database=ABS_DB --output=ABS_JSON');
const database=path.resolve(args.database),output=path.resolve(args.output);
if(database===output)throw Error('Output must not overwrite the source database');
const db=new DatabaseSync(database,{readOnly:true});
try{
 db.exec('BEGIN');const version=db.prepare('PRAGMA user_version').get().user_version;
 const hasAttempts=Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_execution_attempts'").get());
 const report={schema:'edu.task-recovery-preview.v1',readOnly:true,database,schemaVersion:version,createdAt:new Date().toISOString(),counts:{},rows:[],pages:[]};
 let cursor='';
 for(;;){const start=performance.now(),rows=db.prepare('SELECT task_id,task_revision,payload_json FROM tasks WHERE task_id>? ORDER BY task_id LIMIT 20').all(cursor);if(!rows.length)break;
  for(const row of rows){const task=JSON.parse(row.payload_json);const attempt=hasAttempts&&task.executionId?db.prepare('SELECT * FROM task_execution_attempts WHERE execution_id=? AND task_id=?').get(task.executionId,task.id):null;
   const evidence=recoveryEvidence(task,attempt),plan=planTaskRecovery(task,evidence);report.counts[plan.action]=(report.counts[plan.action]||0)+1;
   report.rows.push({taskId:task.id,workKey:task.workKey||'',executionId:task.executionId||'',status:task.status,expectedTaskRevision:row.task_revision,evidenceRevision:recoveryEvidenceRevision(task,evidence),...plan});cursor=row.task_id;
  }report.pages.push({count:rows.length,elapsedMs:performance.now()-start});
 }
 db.exec('COMMIT');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
 process.stdout.write(JSON.stringify({output,total:report.rows.length,counts:report.counts,readOnly:true})+'\n');
}finally{db.close();}
