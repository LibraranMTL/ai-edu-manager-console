'use strict';
const { createTaskStateStore } = require('./task-state-store.cjs');
function createTaskStoreWriter({ createStore = file => createTaskStateStore({ legacyPath:file }) } = {}) {
  const files = new Map();
  function get(file) {
    if (!files.has(file)) { const store=createStore(file);store.open();files.set(file,store); }
    return files.get(file);
  }
  async function request(file, op, query = {}) {
    if (op === 'store_close') { for(const store of files.values())store.close();files.clear();return {ok:true}; }
    const store=get(file);
    switch(op) {
      case 'store_open': return store.info();
      case 'store_tick': store.refreshPresentation();return {ok:true};
      case 'store_delta': return store.applyDelta(query);
      case 'store_patch': return store.patchTask(query.id,query.patch,query.expectedTaskRevision);
      case 'store_claim_execution': return store.claimTaskExecution(query);
      case 'store_advance_execution': return store.advanceTaskExecution(query);
      case 'store_archive': return store.archiveTaskBatch(query.ids || []);
      case 'store_history': return store.appendTaskHistoryBatch(query.entries || []);
      case 'store_meta': return store.patchTaskMeta(query.patch || {});
      case 'store_event': store.appendEvent(query.event);return {ok:true};
      case 'budget_get': return store.budget('get',query);
      case 'store_budget_record': return store.budget('record',query);
      case 'store_budget_reset': return store.budget('reset',query);
      case 'store_source_dirty': return store.source('dirty',query);
      case 'store_source_projection': return store.source('projection',query);
      case 'sources': return store.source('list',query);
      case 'source_versions': return store.source('versions',query);
      case 'source': return store.source('get',query);
      case 'records': return store.readTasks(query);
      case 'runnable': return store.listRunnableTasks(query);
      case 'capability_waits': return store.listCapabilityWaitTasks(query);
      case 'digest_closure_repairs':return store.listDigestClosureRepairs(query);
      case 'recovery_preview':return store.previewTaskRecovery(query);
      case 'store_recovery_apply':return store.applyTaskRecovery(query);
      case 'run_summary':return store.getTaskSessionSummary(query.sessionRunId);
      case 'store_run_outcome':return store.recordTaskRunOutcome(query);
      case 'detail': return store.detail(query.id);
      case 'statuses': return {ok:true,tasks:(query.ids||[]).slice(0,32).map(id=>store.detail(id)).filter(row=>row.ok).map(({task})=>({id:task.id,status:task.status,updatedAt:task.updatedAt,completedAt:task.completedAt,error:task.error,result:task.result?{summary:task.result.summary,message:task.result.message}:null}))};
      case 'store_write': return store.writeSnapshot(query.value);
      default: return store.list(query);
    }
  }
  return { request,has:file=>files.has(file),close(){for(const store of files.values())store.close();files.clear();} };
}
module.exports={createTaskStoreWriter};
