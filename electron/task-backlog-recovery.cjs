'use strict';
const crypto=require('node:crypto');
const {classifyBatchClosure}=require('./task-closure-decision.cjs');
const {executionSourceVersion}=require('./task-execution-ledger.cjs');
function planTaskRecovery(task,evidence={}){
 const result=(action,reason,extra={})=>({action,reason,...extra});
 if(['cancelled','archived','suspended'].includes(task.status)||task.automationSuspended||task.processingPaused||evidence.paused)return result('keep_paused','cancelled_or_paused');
 if(task.status==='succeeded'&&task.settlementState==='settled')return result('no_change','already_settled');
 const matching=value=>value?.executionId===task.executionId&&value?.workKey===task.workKey&&value?.sourceVersion===task.sourceVersion;
 if(evidence.receipt?.verified&&matching(evidence.receipt))return result('settle_existing','verified_original_receipt');
 if(task.status==='running'||evidence.processAlive)return result('no_change','active_execution_owned_by_runtime');
 // A confirmed stopped in-process execution has no external process to query.
 // Do not make the backlog loop reopen it as an unknown external execution.
 if(task.recoveryState==='host_confirmed_stopped'&&task.adapterId==='internal')return result('no_change','internal_stop_requires_business_reconciliation');
 if(task.kind==='smart_material_intake'&&['reviewing','waiting_result'].includes(task.status)
  &&['automatic_pending','receipt_pending','needs_user_action'].includes(task.result?.structuredOutput?.closure?.phase))
  return result('no_change','intake_items_owned_by_inbox');
 if(task.kind==='smart_material_intake'&&Array.isArray(evidence.items)){
  const closure=classifyBatchClosure(evidence.items);
  if(closure.safeItemIds.length)return result('resume_safe_items','source_owned_resume',{itemIds:closure.safeItemIds,receiptPending:closure.receiptPending});
 }
 if(evidence.attempt?.phase==='not_sent'&&evidence.attempt.executionId===task.executionId&&evidence.attempt.workKey===task.workKey&&evidence.attempt.sourceVersion===executionSourceVersion(task)&&!evidence.processAlive)return task.status==='queued'&&task.recoveryState==='stopped'?result('no_change','already_queued'):result('requeue_proven_not_sent','durable_not_sent');
 if(evidence.packetCopied||evidence.packetExported||evidence.distributionComplete===false)return result('needs_confirmation','manual_distribution_unresolved');
 if(task.executionId||['send_intent','started','unknown'].includes(task.executionPhase))return result('reconcile_original','original_execution_must_be_checked');
 if(task.kind==='smart_material_intake')return result('needs_confirmation','inspect_original_item_states');
 return result('no_change','no_proven_recovery');
}
function recoveryEvidence(task,attemptRow){
 const result=task.result||{},identityMatches=result.executionId===task.executionId&&result.workKey===task.workKey&&result.sourceVersion===task.sourceVersion;
 return {receipt:{verified:result.validation?.valid===true&&(identityMatches||task.status==='succeeded'),executionId:task.executionId,workKey:task.workKey,sourceVersion:task.sourceVersion},
  attempt:attemptRow?{phase:attemptRow.phase,executionId:attemptRow.execution_id,workKey:attemptRow.work_key,sourceVersion:attemptRow.source_version}:null,
  packetCopied:Boolean(result.packet?.copiedAt||result.packet?.exportedAt),
  distributionComplete:result.handoffState==='awaiting_user_send'?false:undefined};
}
function recoveryEvidenceRevision(task,evidence){return crypto.createHash('sha256').update(JSON.stringify({taskId:task.id,status:task.status,workKey:task.workKey,sourceVersion:task.sourceVersion,executionId:task.executionId,phase:task.executionPhase,updatedAt:task.updatedAt,evidence})).digest('hex');}
module.exports={planTaskRecovery,recoveryEvidence,recoveryEvidenceRevision};
