const { test } = require('node:test');
const assert = require('node:assert/strict');
const { circuitDecision, recordCircuitOutcome, completeCircuitProbe } = require('../electron/task-executor-circuit.cjs');
const { createTaskPowerRecovery, shiftExecutionDeadlines } = require('../electron/task-power-recovery.cjs');
const { taskTimeoutDecision } = require('../electron/task-runtime-policy.cjs');
const { createActiveDeadlines } = require('../electron/task-active-deadlines.cjs');

test('shared active deadlines exclude multiple sleeps and cancelled entries release timers', () => {
  let now=0, next=0, calls=0; const timers=new Map();
  const clock=createActiveDeadlines({now:()=>now,setTimer:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;},clearTimer:id=>timers.delete(id)});
  const tick=ms=>{now+=ms; for(const [id,t] of [...timers]) if(t.at<=now){timers.delete(id);t.fn();}};
  clock.schedule(()=>calls++,100); tick(40); clock.pause(); tick(3600000);
  assert.equal(calls,0); assert.equal(timers.size,0);
  const cancelled=clock.schedule(()=>assert.fail('cancelled'),10); cancelled.cancel();
  clock.resume(); tick(20); clock.pause(); tick(3600000); clock.resume(); tick(39);
  assert.equal(calls,0); tick(1); assert.equal(calls,1); assert.equal(clock.size,0); assert.equal(timers.size,0);
});
test('three transient failures trip once per execution; cooling only permits a probe', () => {
  let state;
  for(let i=0;i<3;i++) state=recordCircuitOutcome(state,{ executionId:`e${i}`,failure:{message:'ECONNRESET'} },1000);
  assert.equal(state.phase,'open'); assert.equal(circuitDecision(state,1000).allowed,false);
  assert.equal(circuitDecision(state,601001).probeDue,true);
  assert.equal(circuitDecision(state,601001).allowed,false);
  assert.equal(recordCircuitOutcome(state,{ executionId:'e2',success:true }),state);
  assert.equal(circuitDecision(completeCircuitProbe(state,true)).allowed,true);
});
test('authorization requires intervention, malformed evidence is not executor outage', () => {
  const auth=recordCircuitOutcome(null,{executionId:'a',failure:{message:'authentication required'}});
  assert.equal(circuitDecision(auth,Infinity).allowed,false);
  assert.equal(recordCircuitOutcome(null,{executionId:'b',failure:{category:'validation',message:'invalid result'}}),null);
});
test('resume is single-flight, persistence and reconciliation precede new starts', async () => {
  let time=1000, release; const events=[];
  const power=createTaskPowerRecovery({now:()=>time,persist:async s=>events.push(s.phase),reconcile:async()=>new Promise(r=>release=r)});
  await power.suspend(); time+=3600000;
  const work=power.resume(); assert.equal(power.resume(),work); assert.equal(power.canDispatch(),false);
  await new Promise(r=>setImmediate(r)); release(); await work;
  assert.deepEqual(events,['suspended','reconciling','ready']); assert.equal(power.canDispatch(),true);
});
test('failed resume remains blocked, second sleep cannot be unlocked by first recovery', async () => {
  let release; const power=createTaskPowerRecovery({persist:async()=>{},reconcile:()=>new Promise(r=>release=r)});
  await power.suspend(); const first=power.resume(); await new Promise(r=>setImmediate(r));
  await power.suspend(); release(); await first; assert.equal(power.canDispatch(),false);
  const broken=createTaskPowerRecovery({persist:async()=>{},reconcile:async()=>{throw Error('disk');}});
  await broken.suspend(); await broken.resume(); assert.equal(broken.state().phase,'blocked');
});
test('sleep does not fabricate heartbeat, but execution deadline excludes suspended time', () => {
  const start=Date.UTC(2026,0,1), original={status:'running',executionMode:'automatic',startedAt:new Date(start).toISOString(),lastHeartbeatAt:new Date(start).toISOString(),timeoutSeconds:900,heartbeatTimeoutSeconds:180};
  const task=shiftExecutionDeadlines(original,3600000,start+3600000);
  assert.equal(task.lastHeartbeatAt,original.lastHeartbeatAt);
  assert.equal(taskTimeoutDecision(task,start+3601000).kind,'resume_grace');
  assert.equal(taskTimeoutDecision(task,start+3661000).due,false);
  assert.equal(taskTimeoutDecision(task,start+3800000).due,true);
});
