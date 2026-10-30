const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const policy = require('../electron/research-task-policy.cjs');
const { candidateRuntimeDecision } = require('../electron/task-runtime-policy.cjs');
const { validateTaskTransition } = require('../electron/task-protocol.cjs');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');

test('WorkBuddy queues a second desktop handoff before creating any packet', async () => {
  const ctx = { readTaskStore: () => ({ tasks: [{ id: 'other', title: 'existing', adapterId: 'workbuddy', executionMode: 'desktop_handoff', status: 'waiting_result' }] }) };
  vm.createContext(ctx);
  ctx.deferTaskForAdapter = (task, adapter, message) => ({ ok: true, deferred: true, adapter, message });
  const start = main.indexOf('async function submitWorkBuddyTask(');
  vm.runInContext(main.slice(start, main.indexOf('\n}', start) + 2), ctx);
  const result = await ctx.submitWorkBuddyTask({ id: 'new' }, 'command');
  assert.equal(result.ok, true);
  assert.equal(result.deferred, true);
  assert.equal(result.adapter, 'workbuddy');
});

function fixture(output) {
  const store = { tasks: [], history: [] }, events = [], timers = new Set();
  let calls = 0,claims=0,releases=0,sends=0,starts=0;
  const settlements = [], wakes = [], budgets = new Map();
  const ctx = {
    ...policy, crypto, AbortController, taskChildProcesses: new Map(),
    readTaskStore: () => structuredClone(store),
    writeTaskStoreDurably: async value => Object.assign(store, structuredClone(value)),
    taskNow: () => new Date().toISOString(), notify() {}, appendTaskEvent() {},
    setInterval: () => { const t = { unref() {} }; timers.add(t); return t; }, clearInterval: t => timers.delete(t), heartbeatTask() {},
    planningGuidanceService: () => ({ refreshCompetitionRecommendations: run, refreshGuidancePlan: run, getResearchCapabilityStatus: () => ({ available: true }) }),
    normalizeTaskStatus: s => s, normalizeTaskEnvelope: (t, old) => ({ ...old, ...t }),
    TASK_TERMINAL_STATUSES: new Set(['succeeded', 'failed', 'cancelled', 'timed_out']),
    validateTaskTransition,
    normalizeTaskResult: (t, r, v, defaults) => ({ ...defaults, ...r, validation: v }),
    persistReportIssue: () => '', isAutoPublishReportTask: () => false, shouldAutoAccept: () => false,
    findStudentByKey:()=>({id:'s1'}),agentControlPolicy:()=>({}),
    require:name=>name==='./agent-control-plane.cjs'?{providersFor:()=>['codex']}:require(name),
    ensureTaskDispatchReadiness:async()=>({decision:'dispatch',providerId:'codex'}),
    captureHeavyWorkGate:{tryAcquire:()=>()=>releases++,blockState:()=>({})},captureTimelineResourceSnapshot:()=>({}),
    deferTaskForAdapter:()=>({ok:true,deferred:true}),
    externalTaskDispatchBarrier:()=>({claim:async()=>{claims++;return {ok:true,claimed:true,executionId:'durable-execution'};},sendIntent:async()=>{sends++;return {ok:true};},started:async()=>{starts++;return {ok:true};}}),
    releaseUnstartedTaskClaim:async()=>{},settlePersistentTaskAttempt:async(id,options)=>settlements.push({id,options}),
    taskStoreGuard:{
      getExecutionBudget:async key=>({budget:budgets.get(key)||null}),
      recordExecutionBudget:async input=>{const attempts=Number(budgets.get(input.budgetKey)?.attempts||0)+1;const budget={attempts,terminal_state:attempts>=2?'failed_terminal':'',next_retry_at:input.nextRetryAt||''};budgets.set(input.budgetKey,budget);return {budget};},
    },
    executionBudgetKey:(task,code,input)=>`${task.workKey||task.id}:${code}:${input}`,
    automaticTaskWakeQueue:{schedule:(id,reason,delay)=>wakes.push({id,reason,delay})},
  };
  async function run(studentId, request) {
    await request.beforeExecute?.();await request.onStarted?.({processId:1234});
    calls++;
    const value = typeof output === 'function' ? await output(request) : output;
    return { ok: true, message: 'checked', ...value,
      receipt: { studentId, ...request.executionContext, ...value?.receipt } };
  }
  vm.createContext(ctx);
  for (const name of ['transitionTaskInStore', 'commitValidatedTaskResult', 'submitResearchTask']) {
    const start = new RegExp(`(?:async )?function ${name}\\(`).exec(main).index;
    vm.runInContext(main.slice(start, main.indexOf('\n}', start) + 2), ctx);
  }
  ctx.appendTaskEvent = (id, event) => events.push(event);
  function add(kind, status = 'approved') {
    const t = { id: kind, kind, sourceId: 's1', sourceType: 'student', status, attempt: 0, automaticExecution: true,
      workKey:`${kind}:s1`,sourceVersion:'v1' };
    store.tasks.push(t); return t;
  }
  return { store, ctx, add, events, timers, settlements, wakes, budgets, calls: () => calls,counts:()=>({claims,releases,sends,starts}) };
}

test('research shares durable claim/send barrier and unknown readiness does not call an Agent',async()=>{
 const f=fixture({receipt:{status:'succeeded'}}),task=f.add('competition_research_check');
 f.ctx.ensureTaskDispatchReadiness=async()=>({decision:'wait'});
 await f.ctx.submitResearchTask(task,'competition');assert.equal(f.calls(),0);assert.equal(f.counts().claims,0);
 f.ctx.ensureTaskDispatchReadiness=async()=>({decision:'dispatch',providerId:'codex'});
 await f.ctx.submitResearchTask(task,'competition');await f.ctx.taskChildProcesses.get(task.id)?.completion;
 assert.deepEqual(f.counts(),{claims:1,releases:1,sends:1,starts:1});
});

test('recover only an unexecuted research capability block, never general terminal failures', () => {
  const current = { kind: 'guidance_research_check', status: 'blocked', attempt: 0, idempotencyKey: 'month' };
  assert.equal(candidateRuntimeDecision(current, { ...current, status: 'pending' }).nextStatus, 'pending');
  assert.equal(policy.researchTaskDue(current), true);
  for (const patch of [{ kind: 'project_digest' }, { error: { code: 'PERMISSION_DENIED' } }, { attempt: 1 }, { executionId: 'run' }, { result: {} }, { status: 'failed' }]) {
    const t = { ...current, ...patch };
    assert.equal(candidateRuntimeDecision(t, { ...t, status: 'pending' }).nextStatus, t.status);
  }
});

for (const status of ['succeeded', 'unchanged', 'no_results']) test(`competition ${status} settles through reviewing without heartbeat timeout`, async () => {
  const f = fixture({ receipt: { status } }), task = f.add('competition_research_check');
  const submitted = await f.ctx.submitResearchTask(task, 'competition');
  assert.equal(submitted.ok, true);
  await f.ctx.taskChildProcesses.get(task.id).completion;
  assert.equal(f.store.tasks[0].status, 'succeeded');
  assert.deepEqual(f.store.history.map(h => h.status).reverse(), ['running', 'reviewing', 'succeeded']);
  assert.equal(f.ctx.taskChildProcesses.size, 0); assert.equal(f.timers.size, 0);
});

test('grounding failure remains failed; transport retry is bounded and delayed', async () => {
  const f = fixture({ ok: false, receipt: { status: 'failed', code: 'RESEARCH_WEB_EVIDENCE_MISSING' } });
  const task = f.add('competition_research_check'); await f.ctx.submitResearchTask(task, 'competition');
  await f.ctx.taskChildProcesses.get(task.id).completion;
  assert.equal(f.store.tasks[0].status, 'failed'); assert.equal(f.store.tasks[0].autoRetry, false);
  assert.equal(policy.researchRetryPatch({ attempt: 1 }, { code: 'ETIMEDOUT' }, 0).nextRetryAt, '1970-01-01T00:30:00.000Z');
  assert.equal(policy.researchRetryPatch({ attempt: 2 }, { code: 'ETIMEDOUT' }).autoRetry, false);
  assert.equal(policy.researchTaskDue({ kind: task.kind, status: 'failed', attempt: 3, autoRetry: true, nextRetryAt: '2000-01-01' }), false);
});

test('confirmed zero-effect research timeout settles the old attempt and schedules one automatic retry', async () => {
  const evidence = {
    executionId:'durable-execution',workKey:'competition_research_check:s1',sourceVersion:'v1',providerId:'codex',
    terminationState:'closed',terminationCause:'timeout_kill',stdoutDrained:true,stderrDrained:true,
    outputCheckedAfterClose:true,graceCompletedAt:new Date().toISOString(),completedWebEvents:0,completedToolEvents:0,
    outputPresent:false,outputSize:0,localReceiptPresent:false,businessWriteStarted:false,
    sideEffectClass:'read_only_research',identityMatches:true,
  };
  const f=fixture(async()=>{throw Object.assign(Error('timeout'),{code:'RESEARCH_TIMEOUT',timeoutEvidence:evidence});});
  const task=f.add('competition_research_check');await f.ctx.submitResearchTask(task,'competition');
  await f.ctx.taskChildProcesses.get(task.id).completion;
  assert.equal(f.store.tasks[0].status,'failed');
  assert.equal(f.store.tasks[0].businessOutcome,'failed_retryable');
  assert.equal(f.store.tasks[0].autoRetry,true);
  assert.ok(f.store.tasks[0].nextRetryAt);
  assert.equal(f.store.tasks[0].researchRecovery.nextProviderPolicy,'same_provider_once');
  assert.equal(f.settlements.at(-1).id,task.id);
  assert.equal(f.settlements.at(-1).options.knownResult,true);
  assert.equal(f.settlements.at(-1).options.resultKind,'safe_retry_no_output');
  assert.equal(f.wakes.length,1);
});

test('research timeout without confirmed close remains on the same execution for reconciliation', async () => {
  const evidence={terminationState:'unknown',completedWebEvents:0,completedToolEvents:0,outputPresent:false};
  const f=fixture(async()=>{throw Object.assign(Error('timeout'),{code:'RESEARCH_TIMEOUT',timeoutEvidence:evidence});});
  const task=f.add('competition_research_check');await f.ctx.submitResearchTask(task,'competition');
  await f.ctx.taskChildProcesses.get(task.id).completion;
  assert.equal(f.store.tasks[0].status,'waiting_result');
  assert.equal(f.store.tasks[0].businessOutcome,'execution_unknown');
  assert.ok(f.store.tasks[0].reconcileAttempt.nextCheckAt);
  assert.equal(f.store.tasks[0].autoRetry,false);
  assert.equal(f.wakes.length,0);
});

test('two guidance cards share one request and manual/concurrent submission deduplicates', async () => {
  let release; const f = fixture(() => new Promise(resolve => { release = resolve; }));
  const first = f.add('guidance_research_check'), second = f.add('guidance_plan_refresh', 'pending');
  await f.ctx.submitResearchTask(first, 'guidance');
  await f.ctx.submitResearchTask(second, 'guidance');
  const completion = f.ctx.taskChildProcesses.get(first.id).completion;
  await Promise.resolve(); release({ receipt: { status: 'unchanged' } }); await completion;
  assert.equal(f.calls(), 1); assert(f.store.tasks.every(t => t.status === 'succeeded'));
});

test('paired guidance failure marks every started task unknown after the shared request was sent', async () => {
  const f = fixture(async () => { throw Object.assign(Error('transport ended after start'), { code: 'ECONNRESET' }); });
  const first = f.add('guidance_research_check'), second = f.add('guidance_plan_refresh', 'pending');
  await f.ctx.submitResearchTask(first, 'guidance');
  await f.ctx.taskChildProcesses.get(first.id).completion;
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.store.tasks.map(task => task.status), ['failed', 'failed']);
  assert.deepEqual(f.store.tasks.map(task => task.executionPhase), ['unknown', 'unknown']);
  assert.equal(f.store.tasks[1].executionId, f.store.tasks[0].executionId);
});

test('cancelled or superseded execution never accepts a late result', async () => {
  for (const change of [{ status: 'cancelled' }, { executionId: 'new-run' }]) {
    let release; const f = fixture(() => new Promise(resolve => { release = resolve; }));
    const task = f.add('competition_research_check'); await f.ctx.submitResearchTask(task, 'competition');
    const completion = f.ctx.taskChildProcesses.get(task.id).completion;
    await new Promise(setImmediate); Object.assign(f.store.tasks[0], change);
    release({ receipt: { status: 'succeeded' } }); await completion;
    for (const [key, value] of Object.entries(change)) assert.equal(f.store.tasks[0][key], value);
    assert.notEqual(f.store.tasks[0].status, 'succeeded');
  }
});

test('wrong execution and missing receipt cannot produce successful research', async () => {
  const f = fixture({ receipt: { status: 'succeeded', executionId: 'foreign' } });
  const task = f.add('competition_research_check'); await f.ctx.submitResearchTask(task, 'competition');
  await f.ctx.taskChildProcesses.get(task.id).completion;
  assert.equal(f.store.tasks[0].status, 'failed');
  assert.equal(policy.researchResultValidation(task, { ok: true }).valid, false);
});

test('actual scheduler runs due planning and competitions serially, skips paused and duplicate work', async () => {
  const submitted = [], tasks = new Map(), runs = new Map();
  for (const [student, kind] of [['active','guidance_research_check'], ['paused','guidance_research_check'], ['active','competition_research_check'], ['done','guidance_research_check']]) {
    const id = `${kind}:${student}`; tasks.set(id, { id, sourceId: student, kind, status: student === 'done' ? 'succeeded' : 'pending', attempt: 0 });
  }
  const candidates = [...tasks.values()].map(t => ({ taskType: t.kind, studentId: t.sourceId, scheduledAt: '08:00' }));
  const ctx = { ...policy, competitionScheduleRunning: false, taskAutomationEnabled: () => true, publicLicenseStatus: () => ({ active: true }),
    refreshAdapterCapabilities: async () => {}, planningGuidanceService: () => ({ getResearchCapabilityStatus: () => ({ available: true }),
      competitionTaskCandidates: () => candidates.filter(c => c.taskType === 'competition_research_check'), taskCandidates: () => [...candidates, ...candidates],
      getCompetitionRecommendations: () => ({ preferences: {} }), getGuidancePlan: () => ({ preferences: {} }) }),
    reconcileTaskSourceVersions: async()=>{}, buildTaskCenterCandidates: () => [], upsertTaskCandidates: () => ({ tasks: [...tasks.values()] }),
    readTaskStore: () => ({ tasks: [...tasks.values()] }), findStudentByKey: id => ({ id, digestTime: '08:00' }),
    studentAutomaticTasksPaused: s => s.id === 'paused', scheduledTimeReached: () => true,
    taskStableId: (kind, type, student) => `${kind}:${student}`, taskChildProcesses: runs, taskDispatchPending: new Map(),
    executeTaskByAdapter(id) { submitted.push(id); runs.set(id, { completion: Promise.resolve().then(() => { tasks.get(id).status = 'succeeded'; }) }); },
    notify() {}, taskNow: () => '', appendHostTimeline: error => { throw Error(JSON.stringify(error)); } };
  vm.createContext(ctx); const start = main.indexOf('async function runCompetitionResearchSchedule(');
  vm.runInContext(main.slice(start, main.indexOf('\n}', start) + 2), ctx);
  await ctx.runCompetitionResearchSchedule();
  assert.deepEqual(submitted, ['competition_research_check:active', 'guidance_research_check:active']);
  await ctx.runCompetitionResearchSchedule(); assert.equal(submitted.length, 2);
  assert.equal(ctx.competitionScheduleRunning, false);
});

test('blocked capability stores the reason and does not launch research', async () => {
  const f = fixture({ receipt: { status: 'succeeded' } }); const task = f.add('guidance_research_check');
  f.ctx.planningGuidanceService = () => ({ getResearchCapabilityStatus: () => ({ available: false, message: 'not connected' }) });
  assert.equal((await f.ctx.submitResearchTask(task, 'guidance')).blocked, true);
  assert.equal(f.store.tasks[0].status, 'blocked'); assert.equal(f.store.tasks[0].error.code, 'RESEARCH_CAPABILITY_UNAVAILABLE');
  assert.equal(f.calls(), 0);
});
