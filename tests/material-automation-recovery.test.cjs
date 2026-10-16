const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createDigestOrchestrator } = require('../electron/digest-orchestrator.cjs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../electron/main.cjs'), 'utf8');
function load(name, context) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert(start >= 0);
  vm.createContext(context);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  return context[name];
}
test('repeat start preserves a live batch without a second dispatch', () => {
  let calls = 0;
  const orchestrator = createDigestOrchestrator({ prepare: () => ({ok:true,alreadyRunning:true,taskId:'t'}), execute: () => calls++ });
  assert.equal(orchestrator.start('project','p').alreadyRunning, true);
  assert.equal(calls, 0);
});
test('automatic digest stops if automation is disabled during capability detection', async () => {
  let enabled = true, starts = 0;
  const context = { taskAutomationEnabled: () => enabled, configuredDigestExecutor: () => 'codex',
    refreshCapabilitiesForExplicitExecution: async () => { enabled = false; }, startDigestWorkflow: () => starts++ };
  const start = load('startDigestWorkflowWithFreshCapabilities', context);
  assert.equal(JSON.parse(await start('project','p','auto',{automatic:true})).reason, 'automation_disabled');
  assert.equal(starts, 0);
});
test('resource queue waits through contention, then resumes once without another user action', () => {
  let callback, busy = true, calls = 0, enabled = true;
  const task = {id:'t',status:'approved',automaticExecution:true};
  const context = { heavyTaskRetryQueue:{schedule:(key,adapter)=>{callback=()=>context.resumeResourceDeferredTask(key,adapter);}},
    readTaskStore:()=>({tasks:[task]}), taskAutomationEnabled:()=>enabled, projectArchiveRuntime:{status:()=>({ready:true})},
    activeAdapterTask:()=>busy, captureHeavyWorkGate:{state:()=>[]}, adaptiveConcurrency:()=>1,
    captureTimelineResourceSnapshot:()=>({}), executeTaskByAdapter:()=>calls++ };
  const schedule = load('scheduleHeavyTaskRetry', context);
  load('resumeResourceDeferredTask', context);
  schedule('t','codex'); callback(); assert.equal(calls,0);
  busy=false; callback(); assert.equal(calls,1);
  schedule('t','codex'); enabled=false; callback(); assert.equal(calls,1);
});
test('gateway exit zero cannot hide a refused connection', () => {
  const healthy = load('openClawGatewayHealthy', {});
  assert.equal(healthy({ok:true,output:'Connectivity probe: failed\nconnect ECONNREFUSED'}),false);
  assert.equal(healthy({ok:true,output:'RPC probe: ok'}),true);
  assert.equal(healthy({ok:false,output:'RPC probe: ok'}),false);
});
