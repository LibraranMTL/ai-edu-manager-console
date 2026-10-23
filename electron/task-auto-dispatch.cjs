'use strict';

const AUTOMATIC_TASK_KINDS = new Set([
  'weekly_action', 'learning_profile', 'learning_changes', 'learning_stage',
  'openclaw_cron', 'maintenance_lint', 'topic_suggestion_refresh', 'student_digest', 'project_digest',
  'competition_research_check', 'guidance_research_check', 'guidance_plan_refresh',
  'growth_publish',
]);

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
  if (Number(task.attempt || 0) > 0) return blocked('retry_path_owned');
  if (task.recovery?.manualOnly || task.manualOnly) return blocked('manual_only');
  if (task.automationSuspended) return blocked('student_automation_paused');
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

module.exports = { AUTOMATIC_TASK_KINDS, automaticTaskDispatchDecision, scheduledTimeReached };
