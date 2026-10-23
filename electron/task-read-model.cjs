'use strict';
const { taskResolution } = require('./task-resolution.cjs');
const { taskRetryEligible, taskExecutionUnresolved } = require('./task-recovery-policy.cjs');
const { executionProvenance, recoveryBudget, recoveryPlan } = require('./task-recovery-experience.cjs');
const { AUTOMATIC_TASK_KINDS } = require('./task-auto-dispatch.cjs');

const ACTIVE = new Set(['running', 'waiting_result', 'reviewing']);
const TERMINAL = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out', 'archived']);
const INDEXES = new WeakMap();
function scheduledAtTime(value, now = Date.now()) {
  const text = String(value || '').trim();
  const clock = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const at = new Date(now);
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    return at.getTime();
  }
  return Date.parse(text);
}
function taskPresentation(task) {
  const handoff = ['desktop_handoff', 'agent_handoff', 'manual'].includes(task.executionMode);
  const unknown = taskExecutionUnresolved(task);
  const futureScheduled = ['pending', 'approved', 'queued'].includes(task.status)
    && ['schedule', 'scheduled'].includes(task.trigger) && scheduledAtTime(task.scheduledAt) > Date.now();
  const awaiting = handoff && task.status === 'waiting_result' && !task.result?.claimedAt;
  const retryWait = taskRetryEligible(task, Infinity);
  const approvalRequired = Boolean(task.approval?.required && task.approval?.status !== 'approved');
  const resourceWait = ['pending', 'approved', 'queued'].includes(task.status)
    && Boolean(task.resourceDeferredAt || task.resourceRetryAt);
  const waitingStatus = ['pending', 'approved', 'queued'].includes(task.status);
  const explicitManual = Boolean(task.recovery?.manualOnly || task.manualOnly
    || (handoff && !['running', 'reviewing'].includes(task.status))
    || (task.trigger === 'manual' && task.automaticExecution !== true)
    || (waitingStatus && !futureScheduled && task.automaticExecution !== true && !AUTOMATIC_TASK_KINDS.has(String(task.kind || ''))));
  const plan = recoveryPlan(task);
  let automationState = 'blocked';
  if (['succeeded', 'archived'].includes(task.status)) automationState = 'completed';
  else if (unknown) automationState = 'execution_unknown';
  else if (task.status === 'cancelled') automationState = 'completed';
  else if (task.automationSuspended && waitingStatus) automationState = 'suspended';
  else if (approvalRequired) automationState = 'approval_required';
  else if (awaiting || explicitManual) automationState = 'manual_handoff';
  else if (task.status === 'running' || task.status === 'reviewing' || task.status === 'waiting_result') automationState = 'running';
  else if (retryWait) automationState = 'retry_scheduled';
  else if (resourceWait) automationState = 'waiting_resource';
  else if (['pending', 'approved', 'queued'].includes(task.status)) automationState = 'waiting_dispatch';
  const requiresUserAction = automationState === 'manual_handoff' || automationState === 'approval_required'
    || automationState === 'blocked' || (automationState === 'execution_unknown' && plan.owner !== 'system');
  const needs = requiresUserAction;
  const statusGroup = task.status === 'archived' ? 'archived' : needs ? 'actionable' : ['succeeded', 'cancelled'].includes(task.status) ? 'completed'
    : ACTIVE.has(task.status) ? 'running' : 'scheduled';
  const userGroup = automationState === 'completed' ? 'history' : requiresUserAction ? 'needs_help' : 'automatic';
  const phaseLabel = unknown ? (plan.owner === 'system' ? '自动核对中' : '需要你帮助') : awaiting ? '等待发送确认'
    : approvalRequired ? '等待批准' : resourceWait ? '等待后台资源' : retryWait ? '稍后继续' : futureScheduled ? '按计划开始' : task.status === 'reviewing' ? '校验中'
      : task.status === 'succeeded' ? (task.result?.structuredOutput?.failures?.length ? '部分完成' : '已完成')
        : task.status === 'running' ? (task.result?.claimedAt ? '已领取' : '执行中')
          : automationState === 'suspended' ? '学生已暂停'
          : ({ queued: '等待自动调度', pending: explicitManual ? '需要你帮助' : '等待自动调度', approved: explicitManual ? '需要你帮助' : '等待自动调度', failed: '需要处理', blocked: '需要处理', timed_out: '需要处理', cancelled: '已取消', archived: '已归档' })[task.status] || '待处理';
  const hasResult = Boolean(task.result?.validation?.valid && (task.result?.resultFile || task.result?.importedFrom
    || task.result?.structuredOutput || task.result?.artifacts?.some(a => a?.path) || task.result?.fileChanges?.some(a => a?.path)));
  const nextDispatchAt = resourceWait ? String(task.resourceRetryAt || '') : retryWait ? String(task.nextRetryAt || '')
    : futureScheduled ? String(task.scheduledAt || '') : automationState === 'waiting_dispatch' ? '即将自动开始' : '';
  const automationReason = awaiting ? '等待桌面 Agent 的发送确认' : approvalRequired ? '高风险任务等待用户批准'
    : resourceWait ? '等待磁盘、CPU或同一资料范围的后台资源' : retryWait ? '已安排安全重试'
      : automationState === 'suspended' ? '学生已暂停自动周期任务；恢复后只生成当前周期任务'
      : futureScheduled ? '尚未到计划执行时间' : automationState === 'waiting_dispatch' ? '已进入自动调度队列'
        : task.error?.message || plan.nextAction || '';
  return { statusGroup, userGroup, phaseLabel, requiresUserAction, automationState, automationReason, nextDispatchAt,
    awaitingSend: awaiting, hasResult, resolution: taskResolution(task),
    recoveryPlan: plan, executionProvenance: executionProvenance(task), recoveryBudget: recoveryBudget(task),
    occupiesExecutionSlot: ACTIVE.has(task.status) && !handoff && !unknown,
    nextAction: unknown ? plan.nextAction : awaiting ? '请在桌面工具检查任务内容并发送；未收到领取确认。'
      : retryWait ? '已保存安全重试计划，自动整理开启且授权有效时将按计划继续；无需重复点击。' : task.error?.message || '' };
}
const SUMMARY_FIELDS = ['id', 'title', 'kind', 'sourceType', 'sourceId', 'sourceName', 'status', 'trigger', 'executor', 'adapterId',
  'requestedExecutor', 'executorLocked', 'executionMode', 'automaticExecution', 'automationSuspended', 'scheduledAt', 'nextRetryAt', 'resourceRetryAt',
  'resourceDeferredAt', 'updatedAt', 'completedAt', 'detail', 'action', 'count', 'completionPolicy', 'executionId', 'approval',
  'attempt', 'maxAttempts', 'routeRound', 'routeAttempts', 'lastHeartbeatAt', 'progressSource'];
function taskSummary(task) {
  const item = {};
  for (const key of SUMMARY_FIELDS) if (task[key] !== undefined) item[key] = typeof task[key] === 'string' ? task[key].slice(0, key === 'detail' ? 400 : 300) : task[key];
  const { recoveryBudget: _budget, executionProvenance: _provenance, recoveryPlan: _plan, ...presentation } = taskPresentation(task);
  return { ...item, ...presentation,
    currentAgent: String(task.adapterId || task.executor || task.routeDecision?.selectedAdapter || ''),
    attemptedToolCount: new Set(Array.isArray(task.routeAttempts) ? task.routeAttempts.map(String).filter(Boolean) : []).size };
}
function taskReadIndex(store) {
  const now = Date.now();
  const cached = INDEXES.get(store);
  if (cached && now < cached.expiresAt) return cached;
  const all = (store.tasks || []).map(taskSummary);
  const summary = { total: all.length, actionable: 0, running: 0, scheduled: 0, completed: 0, archived: 0 };
  const userSummary = { automatic: 0, needs_help: 0, history: 0 };
  let lastSuccessAt = '';
  for (const task of all) {
    summary[task.statusGroup]++;
    userSummary[task.userGroup]++;
    if (task.status === 'succeeded' && String(task.completedAt || '') > lastSuccessAt) lastSuccessAt = task.completedAt;
  }
  const order = { actionable: 0, running: 1, scheduled: 2, completed: 3, archived: 4 };
  const rows = all.sort((a, b) => order[a.statusGroup] - order[b.statusGroup]
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.id.localeCompare(b.id));
  const deadlines = (store.tasks || []).map(task => Date.parse(task.scheduledAt)).filter(at => at > now);
  const value = { rows, summary, userSummary, lastSuccessAt, expiresAt: Math.min(now + 60000, ...deadlines), executors: [...new Set(all.map(task => task.executor).filter(Boolean))] };
  INDEXES.set(store, value);
  return value;
}
function queryTaskSnapshot(store, query = {}) {
  const index = taskReadIndex(store);
  const rows = index.rows.filter(task => (!query.status || query.status === 'all' || task.statusGroup === query.status || task.userGroup === query.status)
    && (!query.source || query.source === 'all' || task.sourceType === query.source)
    && (!query.sourceId || task.sourceId === String(query.sourceId))
    && (!query.executor || query.executor === 'all' || task.executor === query.executor));
  const pageCount = Math.max(1, Math.ceil(rows.length / 20));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(query.page) || 1)));
  return { ok: true, ready: true, protocolVersion: store.protocolVersion, generatedAt: store.updatedAt || '', summary: index.summary, userSummary: index.userSummary, lastSuccessAt: index.lastSuccessAt,
    page, pageSize: 20, pageCount, filteredTotal: rows.length, tasks: rows.slice((page - 1) * 20, page * 20), history: [],
    executors: index.executors };
}
module.exports = { taskPresentation, taskSummary, taskReadIndex, queryTaskSnapshot, scheduledAtTime, TERMINAL };
