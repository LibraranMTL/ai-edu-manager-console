'use strict';

// Resuming the OS is not proof of Agent progress. This controller pauses new
// starts until receipts/ownership have been reconciled, and never re-dispatches.
function createTaskPowerRecovery({ now = Date.now, reconcile, persist, onError = () => {}, onReady = () => {} }) {
  let phase = 'ready', suspendedAt = null, inFlight = null, generation = 0, resumeAgain = false;
  function suspend() {
    generation++; phase = 'suspended'; suspendedAt = now();
    return Promise.resolve().then(() => persist({ phase, suspendedAt })).catch(error => { onError(error); });
  }
  function resume() {
    if (inFlight) { if (phase === 'suspended') resumeAgain = true; return inFlight; }
    if (phase === 'ready') return Promise.resolve();
    const epoch = generation, elapsed = suspendedAt == null ? 0 : Math.max(0, now() - suspendedAt);
    phase = 'reconciling';
    inFlight = Promise.resolve().then(async () => {
      await persist({ phase, suspendedAt, resumedAt: now() });
      await reconcile({ elapsed, stillCurrent: () => epoch === generation });
      if (epoch !== generation) return;
      await persist({ phase: 'ready', suspendedAt: null, resumedAt: now() });
      phase = 'ready'; suspendedAt = null; onReady();
    }).catch(error => { if (epoch === generation) phase = 'blocked'; onError(error); }).finally(() => {
      inFlight = null;
      if (resumeAgain) { resumeAgain = false; return resume(); }
    });
    return inFlight;
  }
  return { suspend, resume, canDispatch: () => phase === 'ready', state: () => ({ phase, suspendedAt }) };
}
// Freeze timeout accounting only; never fabricate a heartbeat/actual progress.
function shiftExecutionDeadlines(task, elapsed, now = Date.now()) {
  if (!['running', 'waiting_result'].includes(task.status) || task.executionMode === 'desktop_handoff') return task;
  return { ...task, suspendedDurationMs: (Number(task.suspendedDurationMs) || 0) + elapsed,
    resumedAt: new Date(now).toISOString() };
}
module.exports = { createTaskPowerRecovery, shiftExecutionDeadlines };
