'use strict';

const AUTOMATIC_TASK_KINDS = new Set([
  'weekly_action', 'learning_profile', 'learning_changes', 'learning_stage',
  'openclaw_cron', 'maintenance_lint', 'topic_suggestion_refresh', 'student_digest', 'project_digest',
  'competition_research_check', 'guidance_research_check', 'guidance_plan_refresh',
  'growth_publish',
]);

const RECEIPT_RECONCILE_DELAYS_MS = Object.freeze([30_000, 60_000, 180_000, 300_000]);

function automaticWakeDelay({ requestedDelayMs = 0, executionPlaneReadyAt = 0, now = Date.now(), readyMarginMs = 50 } = {}) {
  const requested = Math.max(0, Number(requestedDelayMs) || 0);
  const readyAt = Number(executionPlaneReadyAt);
  if (!Number.isFinite(readyAt) || readyAt <= Number(now)) return requested;
  return Math.max(requested, Math.ceil(readyAt - Number(now)) + Math.max(0, Number(readyMarginMs) || 0));
}

function receiptReconcileSchedule() {
  return [...RECEIPT_RECONCILE_DELAYS_MS];
}

function receiptReconcileDelay(attempt = 0) {
  const index = Math.max(0, Math.min(RECEIPT_RECONCILE_DELAYS_MS.length - 1, Math.trunc(Number(attempt) || 0)));
  return RECEIPT_RECONCILE_DELAYS_MS[index];
}

function automaticWakeDecisionEvents({ taskId = '', workKey = '', phase = '', reason = '', version = 1 } = {}) {
  const normalizedPhase = String(phase || '').trim();
  if (!['queued', 'dispatched', 'blocked'].includes(normalizedPhase)) return [];
  const type = `auto_wake_${normalizedPhase}`;
  const identity = String(workKey || taskId || 'unknown');
  const normalizedReason = String(reason || normalizedPhase);
  return [{
    type,
    decisionKey: `${identity}:${normalizedPhase}:${normalizedReason}:v${Math.max(1, Math.trunc(Number(version) || 1))}`,
    detail: { phase: normalizedPhase, reason: normalizedReason, decisionVersion: Math.max(1, Math.trunc(Number(version) || 1)) },
  }];
}

function scheduledTimeReached(value, now = Date.now()) {
  const text = String(value || '').trim();
  const clock = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const current = new Date(now);
    return current.getHours() * 60 + current.getMinutes() >= Number(clock[1]) * 60 + Number(clock[2]);
  }
  const parsed = Date.parse(text);
  return !Number.isFinite(parsed) || parsed <= now;
}

function automaticTaskDispatchDecision(task, options = {}) {
  const now = Number(options.now ?? Date.now());
  const kinds = options.kinds || AUTOMATIC_TASK_KINDS;
  const status = String(task?.status || '');
  const blocked = (reason, nextDispatchAt = '') => ({ eligible: false, reason, nextDispatchAt });
  if (!task?.id || !kinds.has(String(task.kind || ''))) return blocked('not_automatic_kind');
  if (!['pending', 'approved', 'queued'].includes(status)) return blocked('not_waiting_dispatch');
  if(task.capabilityWait&&Date.parse(task.capabilityWait.nextRetryAt||'')>now)return blocked('capability_wait',task.capabilityWait.nextRetryAt);
  if (Number(task.attempt || 0) > 0) {
    const unresolved = options.executionUnresolved || Boolean(task.executionId&&!['not_sent','settled'].includes(task.executionPhase))
      || ['waiting_result', 'reviewing', 'committing', 'publishing'].includes(String(task.settlementState || task.status || ''));
    if (unresolved) return blocked('execution_unknown');
    const retryOwned = Boolean((task.nextRetryAt&&!task.capabilityWait) || task.resourceRetryAt || task.retryRecovery)
      || ['failed', 'blocked', 'timed_out'].includes(status);
    if (retryOwned) return blocked('retry_path_owned', String(task.nextRetryAt || task.resourceRetryAt || ''));
    // A waiting task with no execution identity, result, error, or retry owner
    // is an orphaned pre-send attempt. It is safe for the normal scheduler to
    // recover instead of remaining in the attempt>0 dead zone forever.
    if (task.result || task.error) return blocked('retry_path_owned');
  }
  if (task.recovery?.manualOnly || task.manualOnly) return blocked('manual_only');
  if (task.automationSuspended) return blocked(String(task.automationSuspendedAt || 'student_automation_paused'));
  if (task.trigger === 'manual' && task.automaticExecution !== true) return blocked('manual_only');
  if (options.studentPaused) return blocked('student_automation_paused');
  if (options.executionUnresolved) return blocked('execution_unknown');
  if (task.executionMode === 'desktop_handoff' || task.executionMode === 'agent_handoff') return blocked('manual_handoff');
  if (options.approvalRequired && task.approval?.status !== 'approved') return blocked('approval_required');
  if (options.autoPublish && !task.input?.growthFingerprint) return blocked('fingerprint_pending');
  const instant = ['student_digest', 'topic_suggestion_refresh'].includes(String(task.kind || ''))
    || task.trigger === 'event';
  const due = instant || scheduledTimeReached(task.scheduledAt, now);
  return due ? { eligible: true, reason: 'waiting_dispatch', nextDispatchAt: new Date(now).toISOString() }
    : blocked('scheduled', String(task.scheduledAt || ''));
}

module.exports = {
  AUTOMATIC_TASK_KINDS,
  RECEIPT_RECONCILE_DELAYS_MS,
  automaticWakeDelay,
  automaticTaskDispatchDecision,
  automaticWakeDecisionEvents,
  receiptReconcileDelay,
  receiptReconcileSchedule,
  scheduledTimeReached,
};
