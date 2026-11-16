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
  const awaitingManual = task.executionMode === 'manual' && task.status === 'waiting_result';
  const awaiting = handoff && !awaitingManual && task.status === 'waiting_result' && !task.result?.claimedAt;
  const awaitingReceipt = String(task.businessOutcome || '') === 'awaiting_receipt';
  const businessManual = ['needs_user_action', 'manual_required'].includes(String(task.businessOutcome || ''));
  const retryWait = taskRetryEligible(task, Infinity);
  const approvalRequired = Boolean(task.approval?.required && task.approval?.status !== 'approved');
  const resourceWait = ['pending', 'approved', 'queued'].includes(task.status)
    && Boolean(task.resourceDeferredAt || task.resourceRetryAt || task.resourceBlock?.reason);
  const dependencyWait = ['pending', 'approved', 'queued'].includes(task.status)
    && Boolean(task.dispatchBlock?.signature);
  const waitingStatus = ['pending', 'approved', 'queued'].includes(task.status);
  const reconcileExhausted=Boolean(task.reconcileAttempt?.exhausted)&&!['succeeded','archived','cancelled'].includes(task.status);
  const capabilityWait = waitingStatus && Boolean(task.capabilityWait);
  const projectMaterialPaused = task.automationSuspendedAt === 'project_material_processing_paused';
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
  else if (reconcileExhausted) automationState='execution_unknown';
  else if(task.kind==='smart_material_intake'&&['automatic_pending','receipt_pending'].includes(task.settlementState))automationState=task.settlementState==='automatic_pending'?'waiting_dispatch':'running';
  else if (awaitingReceipt) automationState = 'running';
  else if (capabilityWait) automationState = task.capabilityWait.exhausted?'environment_help':'waiting_dispatch';
  else if (businessManual || awaiting || explicitManual) automationState = 'manual_handoff';
  else if (task.status === 'running' || task.status === 'reviewing' || task.status === 'waiting_result') automationState = 'running';
  else if (retryWait) automationState = 'retry_scheduled';
  else if (dependencyWait) automationState = 'waiting_dependency';
  else if (resourceWait) automationState = 'waiting_resource';
  else if (['pending', 'approved', 'queued'].includes(task.status)) automationState = 'waiting_dispatch';
  const requiresUserAction = automationState === 'manual_handoff' || automationState === 'approval_required'
    || automationState === 'blocked' || automationState === 'environment_help' || (automationState === 'execution_unknown' && (reconcileExhausted||plan.owner !== 'system'));
  const needs = requiresUserAction;
  const statusGroup = task.status === 'archived' ? 'archived' : needs ? 'actionable' : ['succeeded', 'cancelled'].includes(task.status) ? 'completed'
    : ACTIVE.has(task.status) ? 'running' : 'scheduled';
  const userGroup = automationState === 'completed' ? 'history' : requiresUserAction ? 'needs_help' : 'automatic';
  const phaseLabel = reconcileExhausted?'需要核对原批次':unknown ? (plan.owner === 'system' ? '自动核对中' : '需要你帮助')
    : awaitingReceipt ? '正在核对已提交批次' : capabilityWait ? (task.capabilityWait.exhausted?'需要检查执行器连接':'正在复核执行器连接') : businessManual ? '等待批量核对' : awaitingManual ? '等待手工结果' : awaiting ? '等待发送确认'
    : approvalRequired ? '等待批准' : dependencyWait ? '正在核对关联执行' : resourceWait ? '等待后台资源' : retryWait ? '稍后继续' : futureScheduled ? '按计划开始' : task.status === 'reviewing' ? '校验中'
      : task.status === 'succeeded' ? (task.businessOutcome === 'no_work' ? '无需处理' : task.result?.structuredOutput?.failures?.length ? '部分完成' : '已完成')
        : task.status === 'running' ? (task.result?.claimedAt ? '已领取' : '执行中')
          : automationState === 'suspended' ? (projectMaterialPaused ? '资料处理已暂停' : '学生已暂停')
          : ({ queued: '等待自动调度', pending: explicitManual ? '需要你帮助' : '等待自动调度', approved: explicitManual ? '需要你帮助' : '等待自动调度', failed: '需要处理', blocked: '需要处理', timed_out: '需要处理', cancelled: '已取消', archived: '已归档' })[task.status] || '待处理';
  const hasResult = Boolean(task.result?.validation?.valid && (task.result?.resultFile || task.result?.importedFrom
    || task.result?.structuredOutput || task.result?.artifacts?.some(a => a?.path) || task.result?.fileChanges?.some(a => a?.path)));
  const nextDispatchAt = capabilityWait ? String(task.capabilityWait.nextRetryAt||'') : dependencyWait ? String(task.dispatchBlock?.nextCheckAt || '')
    : resourceWait ? String(task.resourceRetryAt || '') : retryWait ? String(task.nextRetryAt || '')
    : futureScheduled ? String(task.scheduledAt || '') : automationState === 'waiting_dispatch' ? '即将自动开始' : '';
  const automationReason = reconcileExhausted?'自动核对已达本轮上限；请核对原批次回执，未知结果不会重新发送给 Agent':capabilityWait ? (task.capabilityWait.exhausted?'连接自动复核已达本轮上限，请检查登录或连接；任务未发送，也未创建手工包':'正在复核已授权执行器，完成后自动继续，不消耗任务执行次数') : awaitingReceipt ? '正在核对已提交批次；不会重复调用 Agent'
    : businessManual ? String(task.result?.summary || '自动步骤已完成，剩余异常项等待批量核对')
    : awaitingManual ? '手工指令已准备，请执行后导入结果' : awaiting ? '等待桌面 Agent 的发送确认' : approvalRequired ? '高风险任务等待用户批准'
    : dependencyWait ? `正在核对关联任务 ${String(task.dispatchBlock?.blockerTaskId || '')} 的外部执行结果；不会重复调用 Agent`
    : resourceWait ? String(task.resourceBlock?.message || task.resourceBlock?.reason || '等待磁盘、CPU或同一资料范围的后台资源') : retryWait ? '已安排安全重试'
      : automationState === 'suspended' ? (projectMaterialPaused
        ? '此项目已暂停资料处理；恢复后才会继续自动分类、采用和 Agent 消化'
        : '学生已暂停自动周期任务；恢复后只生成当前周期任务')
      : futureScheduled ? '尚未到计划执行时间' : automationState === 'waiting_dispatch' ? '已进入自动调度队列'
        : task.error?.message || plan.nextAction || '';
  return { statusGroup, userGroup, phaseLabel, requiresUserAction, automationState, automationReason, nextDispatchAt,
    awaitingSend: awaiting, hasResult, resolution: taskResolution(task),
    recoveryPlan: plan, executionProvenance: executionProvenance(task), recoveryBudget: recoveryBudget(task),
    occupiesExecutionSlot: ACTIVE.has(task.status) && !handoff && !unknown,
    nextAction: unknown ? plan.nextAction : awaitingManual ? '请执行本次指令并导入结果，系统将核对后处理。' : awaiting ? '请在桌面工具检查任务内容并发送；未收到领取确认。'
      : retryWait ? '已保存安全重试计划，自动整理开启且授权有效时将按计划继续；无需重复点击。' : task.error?.message || '' };
}
const SUMMARY_FIELDS = ['id', 'title', 'kind', 'sourceType', 'sourceId', 'sourceName', 'status', 'trigger', 'executor', 'adapterId',
  'requestedExecutor', 'executorLocked', 'executionMode', 'automaticExecution', 'automationSuspended', 'automationSuspendedAt', 'scheduledAt', 'nextRetryAt', 'resourceRetryAt',
  'resourceDeferredAt', 'updatedAt', 'completedAt', 'detail', 'action', 'count', 'completionPolicy', 'executionId', 'approval',
  'attempt', 'maxAttempts', 'routeRound', 'routeAttempts', 'lastHeartbeatAt', 'progressSource',
  'workKey', 'sourceVersion', 'pipelineVersion', 'settlementState', 'businessOutcome', 'priorityClass',
  'priorityBoostUntil', 'queuedAt', 'resourceBlock', 'dispatchBlock', 'requestOrigin'];
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
  // Disabled project automation is a durable audit outcome, not a user task.
  // Keep it in SQLite/history while omitting it from every task-center group.
  const visibleTasks = (store.tasks || []).filter((task) => String(task.businessOutcome || '') !== 'automation_disabled');
  const all = visibleTasks.map(taskSummary);
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
  const deadlines = visibleTasks.map(task => Date.parse(task.scheduledAt)).filter(at => at > now);
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
