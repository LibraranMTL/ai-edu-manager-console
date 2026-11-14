'use strict';
const {createHash}=require('node:crypto');
const {executionSourceVersion}=require('./task-execution-ledger.cjs');
function policyRevision(value){return createHash('sha256').update(JSON.stringify(value||{})).digest('hex');}
function createTaskDispatchBarrier({store,readTask,readPolicy,canSend,sessionRunId}){
 async function claim(taskId,providerId,dispatchOrigin,profileId){
  const task=readTask(taskId);if(!task)return {ok:false,code:'TASK_NOT_FOUND',stage:'not_sent'};
  const authorization=await canSend(task,dispatchOrigin);
  if(!authorization.ok)return {...authorization,stage:'not_sent'};
  const revision=policyRevision(readPolicy(task));
  const result=await store.claimTaskExecution({taskId,workKey:task.workKey,sourceVersion:executionSourceVersion(task),providerId,profileId:profileId||task.kind||'legacy',
    dispatchOrigin:dispatchOrigin==='user'?'user':'automatic',sessionRunId,policyRevision:revision});
  return {...result,ok:result.claimed===true,policyRevision:revision,taskId,dispatchOrigin,
    ...(result.claimed?{}:{code:result.reason==='active_execution'||result.reason?.includes('unresolved')?'EXECUTION_UNRESOLVED':'TASK_CLAIM_REJECTED',stage:'not_sent'})};
 }
 async function sendIntent(claim,providerId){
  if(!claim?.executionId||!claim.claimed)return {ok:false,code:'TASK_CLAIM_REQUIRED',stage:'not_sent'};
  const task=readTask(claim.taskId);
  const authorization=task?await canSend(task,claim.dispatchOrigin):{ok:false,code:'TASK_NOT_FOUND'};
  if(!authorization.ok||policyRevision(readPolicy(task))!==claim.policyRevision){
    await store.advanceTaskExecution({executionId:claim.executionId,expectedPhase:'claimed',nextPhase:'not_sent',evidence:{notSentVerified:true,reason:'authorization_changed'}});
    return {...authorization,ok:false,code:authorization.code||'AGENT_POLICY_CHANGED',stage:'not_sent'};
  }
  return store.advanceTaskExecution({executionId:claim.executionId,expectedPhase:'claimed',nextPhase:'send_intent',policyRevision:claim.policyRevision,providerId});
 }
 async function started(claim,evidence){
  const current=readTask(claim.taskId);
  const authorization=current?await canSend(current,claim.dispatchOrigin):{ok:false};
  if(!authorization.ok||policyRevision(readPolicy(current))!==claim.policyRevision)throw Object.assign(Error('启动时授权或来源已变化，停止发送任务输入'),{code:'EXECUTION_UNRESOLVED',stage:'unknown'});
  if(current?.executionId===claim.executionId&&current.executionPhase==='started')return {ok:true,alreadyStarted:true};
  const result=await store.advanceTaskExecution({executionId:claim.executionId,expectedPhase:'send_intent',nextPhase:'started',evidence});
  if(!result.ok)throw Object.assign(Error('启动确认未持久化，停止发送任务输入'),{code:'EXECUTION_UNRESOLVED',stage:'unknown'});
  return result;
 }
 return {claim,sendIntent,started};
}
module.exports={createTaskDispatchBarrier,policyRevision};
