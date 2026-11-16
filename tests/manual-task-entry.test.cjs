'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const start = source.indexOf('async function executeTaskByAdapterCore(');
const end = source.indexOf('\n}\n', start) + 2;
assert(start >= 0 && end > start);

function fixture(kind, status = 'approved') {
  const task = { id: 'task-1', kind, sourceType: 'student', sourceId: 'student-1', status,
    input: {}, approval: { status: 'not_required' }, permissions: {}, executionPhase: 'settled' };
  const store = { tasks: [task] };
  const calls = [];
  const context = vm.createContext({
    taskPowerRecovery: { canDispatch: () => true }, projectArchiveRuntime: { assertAccess() {} }, RESEARCH_KINDS: new Set(['guidance_research_check','guidance_plan_refresh','competition_research_check']),
    readTaskStore: () => store, findStudentByKey: () => ({ id: 'student-1' }),
    agentControlStore: () => ({ read: () => ({ global: { enabled: true } }) }),
    taskExecutionUnresolved: () => false, findUnresolvedDispatchConflict: () => null,
    validateTaskPermissionDeclaration: () => ({ ok: true }), taskRequiresApproval: () => false,
    writeTaskStoreDurably: async () => {},
    directReportExecutionCommand: (_task, command) => command,
    taskCommandFor: item => `完整任务 ${item.kind}`,
    submitManualTask: async (item, command) => { calls.push({ item, command }); return { ok: true, command }; },
  });
  vm.runInContext(source.slice(start, end), context);
  return { task, calls, run: async () => JSON.parse(await context.executeTaskByAdapterCore(task.id, 'manual_copy', { dispatchOrigin: 'user' })) };
}

for (const kind of ['weekly_action', 'learning_profile', 'learning_changes', 'learning_stage', 'maintenance_lint']) {
  test(`${kind}: explicit manual request reaches the manual packet path`, async () => {
    const f = fixture(kind);
    const result = await f.run();
    assert.equal(result.ok, true);
    assert.equal(result.command, `完整任务 ${kind}`);
    assert.equal(f.calls.length, 1);
  });
}

for (const status of ['running', 'waiting_result', 'reviewing', 'succeeded', 'cancelled', 'archived']) {
  test(`${status}: manual request cannot replace an existing batch`, async () => {
    const f = fixture('weekly_action', status);
    assert.equal((await f.run()).code, 'MANUAL_TASK_STATE');
    assert.equal(f.calls.length, 0);
    assert.equal(f.task.status, status);
  });
}

test('task without an external result contract is rejected before changing its state', async () => {
  const f = fixture('smart_material_intake', 'pending');
  assert.equal((await f.run()).code, 'MANUAL_CONTRACT_UNAVAILABLE');
  assert.equal(f.task.status, 'pending');
  assert.equal(f.calls.length, 0);
});


test('manual topic results settle through the topic service only for the active batch', async () => {
  const task = { id:'topic', kind:'topic_suggestion_refresh', executionMode:'manual', status:'waiting_result', executionId:'e1', sourceId:'s1', input:{manualTopicFingerprint:'fp'} };
  const stored = structuredClone(task); let calls = 0;
  const context = vm.createContext({ RESEARCH_KINDS:new Set(), readTaskStore:()=>({tasks:[stored]}), taskNow:()=> 'now',
    planningGuidanceService:()=>({acceptManualTopic:(student, fingerprint, value, execution)=>{
      calls++; assert.equal(student,'s1'); assert.equal(fingerprint,'fp'); assert.equal(execution,'e1'); assert.equal(value.candidates.length,2);
      return {message:'saved',current:{id:'v1'}};
    }}) });
  const a=source.indexOf('async function validateImportedTaskCompletion('), b=source.indexOf('\n}',a)+2;
  vm.runInContext(source.slice(a,b),context);
  const payload={status:'completed',data:{candidates:[{},{}]}};
  const ok=await context.validateImportedTaskCompletion(task,payload);
  assert.equal(ok.valid,true); assert.equal(ok.structuredOutput.versionId,'v1');
  stored.executionId='e2'; const stale=await context.validateImportedTaskCompletion(task,payload);
  assert.equal(stale.valid,false); assert.equal(calls,1);
});
