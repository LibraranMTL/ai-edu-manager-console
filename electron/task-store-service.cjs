'use strict';
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createTaskDraft, finishTaskDraft } = require('./task-draft.cjs');
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function createTaskStoreService({ request, onFault=()=>{}, onCommitted=()=>{}, normalizeTask=value=>value }) {
  let initialized=false;
  let file,value,revision=0,durableRevision=0,fault=null,sequence=0,pendingWrites=0;
  let tail=Promise.resolve(),events=[],eventScheduled=false;
  const versions=new WeakMap(), scopes=new WeakMap();
  let byId=new Map();const taskRevisions=new Map();
  const bySource=new Map();
  const executionTaskIds=new Map(),executionLocks=new Map();
  const sourceKey=task=>String(task.sourceType||'')+':'+String(task.sourceId||'');
  function indexTask(task,previous){
    if(previous?.executionId)executionTaskIds.delete(previous.executionId);
    if(task.executionId)executionTaskIds.set(task.executionId,String(task.id));
    if(previous)bySource.get(sourceKey(previous))?.delete(String(previous.id));
    const key=sourceKey(task);if(!bySource.has(key))bySource.set(key,new Set());bySource.get(key).add(String(task.id));
  }
  function record(error){if(!fault){fault={code:error.code||'TASK_STORAGE_FAILURE',message:error.message,at:new Date().toISOString()};onFault(fault);}return error;}
  function assertHealthy(){if(!initialized||fault)throw Object.assign(new Error(fault?'任务存储已暂停派发：'+fault.message:'任务存储尚未就绪'),{code:'TASK_STORAGE_UNAVAILABLE'});}
  async function checked(op,query){const result=await request(file,op,query);if(!result?.ok)throw Object.assign(new Error(result?.message||'任务存储未确认保存'),{code:result?.code});return result;}
  function enqueue(delta) {
    pendingWrites++;sequence++;
    const work=tail.then(async()=>{
      assertHealthy();
      const result=await checked('store_delta',{...delta,expectedRevision:durableRevision});
      durableRevision=result.revision;
      onCommitted({revision:durableRevision,changedTaskIds:result.changedTaskIds||[],summaryChanged:!!result.summaryChanged});
      return result;
    }).catch(error=>{throw record(error);}).finally(()=>pendingWrites--);
    tail=work;void work.catch(()=>{});return work;
  }
  function flushEvents(){if(events.length){const captured=events;events=[];enqueue({events:captured,mutationId:randomUUID()});}}
  function executionMutation(op,input){
    assertHealthy();flushEvents();
    const id=String(input.taskId||executionTaskIds.get(input.executionId)||'');
    if(!id)return Promise.resolve({ok:false,code:'TASK_EXECUTION_CONFLICT',reason:'task_not_found'});
    const query={...input,taskId:id,...(op==='store_claim_execution'?{expectedTaskRevision:input.expectedTaskRevision??taskRevisions.get(id)}:{})};
    executionLocks.set(id,(executionLocks.get(id)||0)+1);pendingWrites++;sequence++;
    const work=tail.then(async()=>{
      assertHealthy();const result=await request(file,op,query);
      if(!result||(!result.ok&&result.code!=='TASK_EXECUTION_CONFLICT'))throw Object.assign(Error(result?.message||'执行认领未确认保存'),{code:result?.code});
      if(result.revision!=null)durableRevision=result.revision;
      if(result.task){
        const {taskRevision:ignored,...task}=result.task,previous=byId.get(id);
        indexTask(task,previous);if(previous){for(const key of Object.keys(previous))delete previous[key];Object.assign(previous,task);}else{value.tasks.push(task);byId.set(id,task);}
        taskRevisions.set(id,result.taskRevision);revision++;
        onCommitted({revision:durableRevision,changedTaskIds:[id],summaryChanged:true});
      }
      return result;
    }).catch(error=>{throw record(error);}).finally(()=>{pendingWrites--;const n=executionLocks.get(id)-1;if(n)executionLocks.set(id,n);else executionLocks.delete(id);});
    tail=work;void work.catch(()=>{});return work;
  }
  const api={
    async initialize(target){
      if(value){if(file!==target)throw new Error('运行中不能切换任务账本');return;}
      file=target;
      try{
        const opened=await checked('store_open',{});value=opened.value;durableRevision=opened.revision;revision=opened.revision;
        // Bounded messages avoid a giant structured clone at the IPC boundary.
        let cursor='';
        for(;;){const page=await checked('records',{cursor,limit:100});for(const task of page.tasks){value.tasks.push(normalizeTask(task,task));taskRevisions.set(String(task.id),page.revisions?.[task.id]||0);}if(page.tasks.length<100)break;cursor=page.cursor;await new Promise(setImmediate);}
        byId=new Map(value.tasks.map(task=>[String(task.id),task]));for(const task of value.tasks)indexTask(task);initialized=true;
      }catch(error){value=null;throw record(error);}
    },
    read(target,selection){assertHealthy();if(target!==file)throw new Error('任务目录发生变化');
      const ids=selection?.sourceId ? new Set(bySource.get(selection.sourceType+':'+selection.sourceId)||[]) : selection?.taskIds ? new Set(selection.taskIds.map(String)) : null;
      const draft=createTaskDraft(ids?{...value,tasks:[...ids].map(id=>byId.get(id)).filter(Boolean)}:value);
      versions.set(draft,revision);if(ids)scopes.set(draft,ids);return {value:draft,revision,selection:ids};},
    track(store,rev,selection){versions.set(store,rev);if(selection)scopes.set(store,selection);return store;},
    write(target,store,normalized=store){
      assertHealthy();if(target!==file||versions.get(store)!==revision)throw Object.assign(new Error('任务账本已变化，拒绝旧状态覆盖'),{code:'TASK_STORE_CONFLICT'});
      const next=finishTaskDraft(normalized),upserts=[],deletes=[],seen=new Set();
      let tasks=(finishTaskDraft(next.tasks)||[]).map(task=>{
        task=finishTaskDraft(task);const id=String(task.id),previous=byId.get(id);seen.add(id);
        if(task===previous)return previous;
        const captured=plain(task);const normalizedTask=normalizeTask(captured,captured);
        if(previous&&isDeepStrictEqual(previous,normalizedTask))return previous;
        if(executionLocks.has(String(task.id)))throw Object.assign(Error('任务执行状态正在提交，请刷新后重试'),{code:'TASK_EXECUTION_PENDING',retryable:true});
        upserts.push(normalizedTask);return normalizedTask;
      });
      const scope=scopes.get(store);
      for(const id of scope||byId.keys())if(!seen.has(id)){
        if(executionLocks.has(String(id)))throw Object.assign(Error('任务执行状态正在提交，请刷新后重试'),{code:'TASK_EXECUTION_PENDING',retryable:true});
        deletes.push(id);
      }
      const meta={};
      for(const key of ['protocolVersion','runtime','deletedTasks'])if(!isDeepStrictEqual(finishTaskDraft(next[key]),value[key]))meta[key]=plain(next[key]);
      const oldHistory=new Set((value.history||[]).map(entry=>entry.id||JSON.stringify(entry)));
      const history=(next.history||[]).filter(entry=>!oldHistory.has(entry.id||JSON.stringify(entry))).map(plain);
      const capturedEvents=events;events=[];
      const changed=upserts.length||deletes.length||history.length||capturedEvents.length||Object.keys(meta).length;
      if(!changed)return normalized;
      meta.updatedAt=new Date().toISOString();
      if(scope){const changedById=new Map(upserts.map(task=>[String(task.id),task])),removed=new Set(deletes);
        tasks=value.tasks.filter(task=>!removed.has(String(task.id))).map(task=>changedById.get(String(task.id))||task);
        for(const task of upserts)if(!byId.has(String(task.id)))tasks.push(task);}
      value={...next,...meta,runtime:plain(next.runtime||{}),deletedTasks:plain(next.deletedTasks||[]),
        tasks,history:(next.history||[]).slice(0,500).map(plain)};
      for(const task of upserts){indexTask(task,byId.get(String(task.id)));byId.set(String(task.id),task);taskRevisions.set(String(task.id),(taskRevisions.get(String(task.id))||0)+1);}
      for(const id of deletes){const task=byId.get(id);if(task)bySource.get(sourceKey(task))?.delete(id);byId.delete(id);taskRevisions.delete(id);}
      revision++;versions.set(store,revision);versions.set(normalized,revision);
      const operations=[...upserts.map(task=>({task})),...deletes.map(id=>({id}))];
      for(let offset=0;offset<Math.max(1,operations.length);offset+=100){
        const batch=operations.slice(offset,offset+100),last=offset+100>=operations.length;
        enqueue({upserts:batch.filter(e=>e.task).map(e=>e.task),deletes:batch.filter(e=>e.id).map(e=>e.id),
          ...(last?{meta,history,events:capturedEvents}:{}),mutationId:randomUUID()});
      }
      return normalized;
    },
    upsertTaskBatch(tasks,expectedRevision=revision){if(tasks.length>100)throw new Error('TASK_BATCH_TOO_LARGE');const got=api.read(file,{taskIds:tasks.map(task=>task.id)});if(expectedRevision!==got.revision)throw Object.assign(new Error('TASK_STORE_CONFLICT'),{code:'TASK_STORE_CONFLICT'});const draft=got.value;const indexes=new Map(draft.tasks.map((t,i)=>[t.id,i]));for(const task of tasks){const i=indexes.get(task.id);if(i==null)draft.tasks.push(task);else draft.tasks[i]=task;}api.write(file,draft);return api.flush();},
    patchTask(id,patch,expectedTaskRevision=taskRevisions.get(String(id))){const draft=api.read(file,{taskIds:[id]}).value;if(expectedTaskRevision!==taskRevisions.get(String(id)))throw Object.assign(new Error('TASK_STORE_CONFLICT'),{code:'TASK_STORE_CONFLICT'});const task=draft.tasks.find(t=>t.id===id);if(!task)throw new Error('TASK_NOT_FOUND');Object.assign(task,patch);api.write(file,draft);return api.flush();},
    archiveTaskBatch(ids){return api.upsertTaskBatch(ids.map(id=>({...byId.get(String(id)),id:String(id),status:'archived',updatedAt:new Date().toISOString()})));},
    appendTaskHistoryBatch(entries){const draft=api.read(file).value;draft.history.unshift(...entries);api.write(file,draft);return api.flush();},
    patchTaskMeta(patch){const draft=api.read(file).value;Object.assign(draft,patch);api.write(file,draft);return api.flush();},
    async listRunnableTasks(query={}){await api.flush();return checked('runnable',query);},
    async listCapabilityWaitTasks(query={}){await api.flush();return checked('capability_waits',query);},
    async previewTaskRecovery(query={}){await api.flush();return checked('recovery_preview',query);},
    applyTaskRecovery:query=>executionMutation('store_recovery_apply',query),
    async getTaskSessionSummary(sessionRunId){await api.flush();return checked('run_summary',{sessionRunId});},
    recordTaskRunOutcome:query=>executionMutation('store_run_outcome',query),
    claimTaskExecution:query=>executionMutation('store_claim_execution',query),
    advanceTaskExecution:query=>executionMutation('store_advance_execution',query),
    async getExecutionBudget(budgetKey){await api.flush();return checked('budget_get',{budgetKey});},
    async recordExecutionBudget(input){await api.flush();return checked('store_budget_record',input);},
    async resetExecutionBudget(budgetKey){await api.flush();return checked('store_budget_reset',{budgetKey});},
    writeProgress(target,entries=[]){
      assertHealthy();if(target!==file)throw new Error('任务目录发生变化');
      let accepted=0;
      // Collapse repeated heartbeat entries for the same execution before any
      // persistence work. Progress fields cannot change task identity/routing.
      const merged=new Map();
      for(const patch of entries){
        const id=String(patch.taskId||''),task=byId.get(id);
        if(executionLocks.has(id))continue;
        if(!task||task.executionId!==patch.executionId||!['running','waiting_result'].includes(task.status))continue;
        const fields={};
        for(const key of ['lastHeartbeatAt','lastProgressAt','progressSource'])if(Object.hasOwn(patch,key))fields[key]=plain(patch[key]);
        merged.set(id,{...(merged.get(id)||{}),...plain(fields)});accepted++;
      }
      const changes=[];
      for(const [id,fields] of merged){
        const task=byId.get(id);if(!task)continue;
        const changed=Object.entries(fields).some(([key,next])=>!isDeepStrictEqual(task[key],next));
        if(!changed)continue;
        const expected=taskRevisions.get(id)||0;
        // The internal task object is the row cache. Updating it in place avoids
        // cloning/scanning the full task snapshot; stale drafts are rejected by
        // the service revision below.
        Object.assign(task,fields);
        taskRevisions.set(id,expected+1);
        changes.push({task:plain(task),expected});
      }
      for(let offset=0;offset<changes.length;offset+=100){
        const batch=changes.slice(offset,offset+100),revisions={};
        for(const entry of batch)revisions[entry.task.id]=entry.expected;
        revision++;
        enqueue({upserts:batch.map(entry=>entry.task),taskRevisions:revisions,mutationId:randomUUID()});
      }
      return {accepted,revision};
    },
    async flush(){flushEvents();await tail;assertHealthy();},
    appendEvent(event){assertHealthy();events.push(plain(event));if(!eventScheduled){eventScheduled=true;queueMicrotask(()=>{eventScheduled=false;flushEvents();});}},
    assertHealthy,status:()=>fault,pending:()=>pendingWrites>0||events.length>0,ready:()=>initialized,sequence:()=>sequence,
    revision:()=>revision,durableRevision:()=>durableRevision,
  };
  return api;
}
module.exports={createTaskStoreService};
