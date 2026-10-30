'use strict';
const {randomUUID}=require('node:crypto');
const SCHEMA=`CREATE TABLE IF NOT EXISTS task_execution_attempts (
 execution_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, work_key TEXT NOT NULL, source_version TEXT NOT NULL,
 provider_id TEXT NOT NULL, profile_id TEXT NOT NULL DEFAULT 'legacy', session_run_id TEXT NOT NULL, dispatch_origin TEXT NOT NULL,
 policy_revision TEXT NOT NULL, phase TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN(0,1)),
 created_at TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT '', settled_at TEXT NOT NULL DEFAULT '',
 result_kind TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '{}');
 CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_active_task ON task_execution_attempts(task_id) WHERE active=1;
 CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_active_work ON task_execution_attempts(work_key) WHERE active=1;
 CREATE INDEX IF NOT EXISTS idx_execution_session_provider ON task_execution_attempts(session_run_id,provider_id,started_at);
 CREATE INDEX IF NOT EXISTS idx_execution_task_history ON task_execution_attempts(task_id,created_at);
 CREATE TABLE IF NOT EXISTS task_run_settlements(session_run_id TEXT NOT NULL,work_key TEXT NOT NULL,execution_session_id TEXT NOT NULL,result_kind TEXT NOT NULL,PRIMARY KEY(session_run_id,work_key));
 CREATE TABLE IF NOT EXISTS task_manual_packets(packet_id TEXT PRIMARY KEY,session_run_id TEXT NOT NULL,task_id TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_manual_packet_session ON task_manual_packets(session_run_id);`;
function readTaskSessionSummary(stmt,sessionRunId){
 const result=stmt(`SELECT COUNT(CASE WHEN dispatch_origin='automatic' AND started_at<>'' THEN 1 END) automaticStarted,
 COUNT(DISTINCT CASE WHEN dispatch_origin='automatic' AND started_at<>'' THEN work_key END) automaticStartedWorkItems,
 COUNT(CASE WHEN dispatch_origin='automatic' AND started_at<>'' AND phase='settled' AND result_kind='completed' THEN 1 END) automaticSucceeded,
 COUNT(CASE WHEN dispatch_origin='automatic' AND started_at<>'' AND phase='settled' AND result_kind='failed' THEN 1 END) automaticFailed,
 COUNT(CASE WHEN phase='unknown' THEN 1 END) executionUnknown,COUNT(CASE WHEN phase='claimed' THEN 1 END) claimedNotStarted
 FROM task_execution_attempts WHERE session_run_id=?`).get(sessionRunId);
 const outcomes=stmt(`SELECT COUNT(CASE WHEN execution_session_id<>? AND result_kind='completed' THEN 1 END) historicalSettledThisRun,COUNT(CASE WHEN result_kind='no_work' THEN 1 END) noWork FROM task_run_settlements WHERE session_run_id=?`).get(sessionRunId,sessionRunId);
 const packets=stmt('SELECT COUNT(*) manualFallbacks FROM task_manual_packets WHERE session_run_id=?').get(sessionRunId);
 const byExecutor=stmt(`SELECT provider_id providerId,COUNT(CASE WHEN started_at<>'' THEN 1 END) started,COUNT(CASE WHEN started_at<>'' AND phase='settled' AND result_kind='completed' THEN 1 END) succeeded FROM task_execution_attempts WHERE session_run_id=? AND dispatch_origin='automatic' GROUP BY provider_id`).all(sessionRunId);
 return {ok:true,sessionRunId,...result,...outcomes,...packets,byExecutor};
}
const RUNNABLE=new Set(['pending','approved','queued','failed']);
// Legacy work versions are a claim barrier only; never rewrite the business
// sourceVersion or reset an existing error/input retry budget.
function executionSourceVersion(task){return String(task.sourceVersion||'')||(task.workKey?`work:${task.workKey}`:'');}
const TRANSITIONS={claimed:['send_intent','not_sent','settled'],send_intent:['started','unknown','not_sent','settled'],started:['unknown','settled','not_sent'],unknown:['started','settled','not_sent']};
function createTaskExecutionLedger({stmt,persist}){
 const rejected=reason=>({ok:true,claimed:false,reason});
 function claim(q){
  const row=stmt('SELECT task_revision,payload_json FROM tasks WHERE task_id=?').get(String(q.taskId));
  if(!row)return rejected('task_not_found');
  const task=JSON.parse(row.payload_json);
  if(!q.workKey||!q.sourceVersion||!q.providerId||!q.sessionRunId||!q.dispatchOrigin||q.policyRevision==null)return rejected('claim_identity_required');
  const active=stmt('SELECT execution_id FROM task_execution_attempts WHERE active=1 AND (task_id=? OR work_key=?) LIMIT 1').get(String(q.taskId),String(q.workKey));
  if(active)return {...rejected('active_execution'),executionId:active.execution_id};
  if(Number(q.expectedTaskRevision)!==row.task_revision)return rejected('revision_conflict');
  if(task.workKey!==q.workKey||executionSourceVersion(task)!==String(q.sourceVersion))return rejected('source_changed');
  if(!RUNNABLE.has(task.status)||task.processingPaused===true||task.manualOnly===true&&q.dispatchOrigin==='automatic')return rejected('task_not_runnable');
  if(task.executionId&&!['settled','not_sent'].includes(task.executionPhase)&&task.settlementState!=='settled')return rejected('legacy_execution_unresolved');
  if(task.executionState==='unknown'||task.businessOutcome==='execution_unknown'||task.executionUnresolved===true)return rejected('execution_unknown');
  // Old rows without attempts still block a new task for the same work identity.
  const legacy=stmt("SELECT task_id,payload_json FROM tasks WHERE work_key=? AND task_id<>? AND (status IN('running','waiting_result','reviewing','committing','publishing') OR business_outcome='execution_unknown') LIMIT 1").get(q.workKey,q.taskId);
  if(legacy)return rejected('legacy_execution_unresolved');
  const executionId=randomUUID(),at=new Date().toISOString();
  stmt(`INSERT INTO task_execution_attempts(execution_id,task_id,work_key,source_version,provider_id,profile_id,session_run_id,dispatch_origin,policy_revision,phase,active,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,'claimed',1,?)`).run(executionId,q.taskId,q.workKey,q.sourceVersion,q.providerId,String(q.profileId||task.kind||'legacy'),q.sessionRunId,q.dispatchOrigin,String(q.policyRevision),at);
  const next={...task,executionId,executionPhase:'claimed',updatedAt:at};
  return {...persist(next,row.task_revision+1,'execution_claimed',{executionId,providerId:q.providerId}),claimed:true,executionId};
 }
 function advance(q){
  const attempt=stmt('SELECT * FROM task_execution_attempts WHERE execution_id=?').get(String(q.executionId));
  const reject=reason=>({ok:false,reason,code:'TASK_EXECUTION_CONFLICT'});
  if(!attempt)return reject('execution_not_found');
  const row=stmt('SELECT payload_json,task_revision FROM tasks WHERE task_id=?').get(attempt.task_id);
  if(!row)return reject('task_not_found');const task=JSON.parse(row.payload_json),evidence=q.evidence||{};
  if(task.executionId!==q.executionId)return reject('execution_identity_changed');
  if(attempt.phase===q.nextPhase)return {ok:true,duplicate:true,executionId:q.executionId};
  if(!attempt.active||attempt.phase!==q.expectedPhase||!TRANSITIONS[attempt.phase]?.includes(q.nextPhase))return reject('phase_conflict');
  if(q.nextPhase==='send_intent'){
    if((!RUNNABLE.has(task.status)&&!(task.status==='running'&&task.executionPhase==='claimed'))||task.processingPaused===true)return reject('task_not_runnable');
    if(task.workKey!==attempt.work_key||executionSourceVersion(task)!==attempt.source_version)return reject('source_changed');
    if(String(q.policyRevision)!==attempt.policy_revision)return reject('policy_changed');
  }
  if(q.nextPhase==='started'&&!evidence.processId&&!evidence.remoteRequestId&&!(evidence.transportAcknowledged===true&&evidence.httpStatus>=200&&evidence.httpStatus<300))return reject('start_evidence_required');
  if(q.nextPhase==='not_sent'&&attempt.phase!=='claimed'&&evidence.notSentVerified!==true)return reject('not_sent_evidence_required');
  const validResultKind=['completed','partial','failed','no_work','cancelled','safe_retry_no_output'].includes(q.resultKind);
  const validResultEvidence=q.resultKind==='safe_retry_no_output'
    ? evidence.noOutputVerified===true&&evidence.terminationClosed===true
    : evidence.receiptVerified===true;
  if(q.nextPhase==='settled'&&(!validResultEvidence||!validResultKind))return reject('settlement_evidence_required');
  if(q.nextPhase==='settled'&&attempt.phase==='claimed'&&q.resultKind!=='no_work'&&!(q.resultKind==='partial'&&evidence.resultLocalOnly===true))return reject('execution_not_started');
  const at=new Date().toISOString(),terminal=['settled','not_sent'].includes(q.nextPhase),started=q.nextPhase==='started'?at:attempt.started_at;
  if(q.nextPhase==='send_intent'&&q.providerId){stmt('UPDATE task_execution_attempts SET provider_id=? WHERE execution_id=?').run(String(q.providerId),q.executionId);attempt.provider_id=String(q.providerId);task.adapterId=String(q.providerId);task.executor=String(q.providerId);}
  stmt('UPDATE task_execution_attempts SET phase=?,active=?,started_at=?,settled_at=?,result_kind=?,evidence_json=? WHERE execution_id=? AND phase=?')
    .run(q.nextPhase,terminal?0:1,started,terminal?at:'',q.resultKind||'',JSON.stringify({...JSON.parse(attempt.evidence_json),...evidence}),q.executionId,q.expectedPhase);
  if(q.nextPhase==='settled'&&q.settlementSessionRunId)stmt('INSERT OR IGNORE INTO task_run_settlements VALUES(?,?,?,?)').run(String(q.settlementSessionRunId),attempt.work_key,attempt.session_run_id,q.resultKind);
  const next={...task,executionPhase:q.nextPhase,updatedAt:at};
  if(q.nextPhase==='started')Object.assign(next,{status:'running',startedAt:started});
  if(q.nextPhase==='unknown')Object.assign(next,{status:'waiting_result',businessOutcome:'execution_unknown',recoveryState:'unknown',autoRetry:false,nextRetryAt:''});
  if(q.nextPhase==='settled'&&!q.preserveBusinessState)Object.assign(next,{status:q.resultKind==='partial'?'reviewing':q.resultKind==='failed'?'failed':q.resultKind==='cancelled'?'cancelled':'succeeded',settlementState:'settled',businessOutcome:q.resultKind,completedAt:at});
  if(q.nextPhase==='not_sent')Object.assign(next,{status:task.status==='cancelled'?'cancelled':'queued',businessOutcome:'not_sent',recoveryState:'stopped'});
  return {...persist(next,row.task_revision+1,'execution_'+q.nextPhase,{executionId:q.executionId,providerId:attempt.provider_id}),executionId:q.executionId};
 }
 function recordOutcome(q){
  const row=stmt('SELECT payload_json,task_revision FROM tasks WHERE task_id=?').get(String(q.taskId));
  if(!row||!q.sessionRunId)return {ok:false,code:'TASK_EXECUTION_CONFLICT',reason:'outcome_identity_required'};
  const task=JSON.parse(row.payload_json);let changed=0;
  if(q.kind==='manual_packet'){
   if(!q.packetId||q.packetId!==task.executionId||!task.result?.packet||!['manual','agent_handoff'].includes(task.executionMode))return {ok:false,code:'TASK_EXECUTION_CONFLICT',reason:'packet_evidence_required'};
   changed=stmt('INSERT OR IGNORE INTO task_manual_packets VALUES(?,?,?)').run(q.packetId,q.sessionRunId,task.id).changes;
  }else if(q.kind==='settlement'){
   if(task.status!=='succeeded'||!task.workKey||!(task.businessOutcome==='no_work'||task.result?.validation?.valid))return {ok:false,code:'TASK_EXECUTION_CONFLICT',reason:'settlement_evidence_required'};
   const original=stmt('SELECT session_run_id FROM task_execution_attempts WHERE execution_id=?').get(String(task.executionId||''));
   changed=stmt('INSERT OR IGNORE INTO task_run_settlements VALUES(?,?,?,?)').run(q.sessionRunId,task.workKey,original?.session_run_id||'legacy',task.businessOutcome==='no_work'?'no_work':'completed').changes;
  }else return {ok:false,code:'TASK_EXECUTION_CONFLICT',reason:'outcome_kind_invalid'};
  return changed?persist(task,row.task_revision+1,'task_run_outcome_recorded',{kind:q.kind}):{ok:true,duplicate:true};
 }
 return {claim,advance,recordOutcome};
}
module.exports={SCHEMA,createTaskExecutionLedger,readTaskSessionSummary,executionSourceVersion};
