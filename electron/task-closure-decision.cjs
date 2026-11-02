'use strict';
const {recoveryBudget}=require('./task-recovery-experience.cjs');
const {receiptReconcileDelay}=require('./task-auto-dispatch.cjs');
function classifyBatchClosure(itemStates=[]){
 const out={automaticPending:0,receiptPending:0,needsUserAction:0,delivered:0,ignored:0,terminalFailed:0,safeItemIds:[]};
 for(const item of itemStates){
  if(['pending','retry'].includes(item?.status)&&!item.receipt){out.automaticPending++;if(item.id)out.safeItemIds.push(String(item.id));}
  else if(item?.status==='delivered')out.delivered++;
  else if(['ignored','skipped_unsupported'].includes(item?.status))out.ignored++;
  else if(item?.status==='review')out.needsUserAction++;
  else if(['failed_terminal','failed'].includes(item?.status))out.terminalFailed++;
  else out.receiptPending++;
 }
 out.phase=out.automaticPending?'automatic_pending':out.receiptPending?'receipt_pending':out.needsUserAction||out.terminalFailed?'needs_user_action':out.delivered?'completed':'no_work';
 return out;
}
function reconcileAttemptPatch(task,attempt,now=Date.now()){
 if(!['checked','skipped_dependency','query_failed'].includes(attempt?.disposition))throw Error('Invalid reconciliation disposition');
 const budget=recoveryBudget(task,new Date(now).toISOString()),previous=task.reconcileAttempt||{};
 const failures=attempt.disposition==='checked'?0:(Number(previous.queryFailures)||0)+(attempt.disposition==='query_failed'?1:0);
 if(attempt.disposition==='checked')budget.receiptQueries=Math.min(budget.limits.receiptQueries,budget.receiptQueries+1);
 const skips=attempt.disposition==='skipped_dependency'?(Number(previous.dependencySkips)||0)+1:0;
 const exhausted=budget.receiptQueries>=budget.limits.receiptQueries||failures>=6;
 const delay=attempt.disposition==='checked'?receiptReconcileDelay(budget.receiptQueries):[15000,30000,60000,180000,300000][Math.min(4,Math.max(failures,skips)-1)];
 return {recoveryBudget:budget,recoveryCheckedAt:attempt.disposition==='checked'?new Date(now).toISOString():task.recoveryCheckedAt||'',
  reconcileAttempt:{disposition:attempt.disposition,reason:String(attempt.reason||''),queryFailures:failures,dependencySkips:skips,
   checkedAt:attempt.disposition==='checked'?new Date(now).toISOString():previous.checkedAt||'',lastAttemptAt:new Date(now).toISOString(),
   nextCheckAt:exhausted?'':new Date(now+delay).toISOString(),exhausted}};
}
module.exports={classifyBatchClosure,reconcileAttemptPatch};
