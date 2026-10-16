'use strict';
const { taskResolution } = require('./task-resolution.cjs');
const { taskRetryEligible } = require('./task-recovery-policy.cjs');

const ACTIVE = new Set(['running', 'waiting_result', 'reviewing']);
const TERMINAL = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out', 'archived']);
const INDEXES = new WeakMap();
function taskPresentation(task) {
  const handoff = ['desktop_handoff', 'agent_handoff', 'manual'].includes(task.executionMode);
  const unknown = task.recoveryState === 'unknown' || task.result?.recoveryState === 'unknown';
  const awaiting = handoff && task.status === 'waiting_result' && !task.result?.claimedAt;
  const retryWait = taskRetryEligible(task, Infinity);
  const needs = unknown || awaiting || (!retryWait && ['failed', 'blocked', 'timed_out', 'draft', 'pending', 'approved'].includes(task.status));
  const statusGroup = task.status === 'archived' ? 'archived' : needs ? 'actionable' : ['succeeded', 'cancelled'].includes(task.status) ? 'completed'
    : ACTIVE.has(task.status) ? 'running' : 'scheduled';
  const phaseLabel = unknown ? '核对中' : awaiting ? '等待发送确认'
    : retryWait ? '稍后继续' : task.status === 'reviewing' ? '校验中'
      : task.status === 'succeeded' ? (task.result?.structuredOutput?.failures?.length ? '部分完成' : '已完成')
        : task.status === 'running' ? (task.result?.claimedAt ? '已领取' : '执行中')
          : ({ queued: '排队中', pending: '待处理', approved: '待处理', failed: '需要处理', blocked: '需要处理', timed_out: '需要处理', cancelled: '已取消', archived: '已归档' })[task.status] || '待处理';
  const hasResult = Boolean(task.result?.validation?.valid && (task.result?.resultFile || task.result?.importedFrom
    || task.result?.artifacts?.some(a => a?.path) || task.result?.fileChanges?.some(a => a?.path)
    || task.expectedOutput?.path || task.expectedOutput?.publishPath || task.expectedOutput?.draftPath));
  return { statusGroup, phaseLabel, awaitingSend: awaiting, hasResult, resolution: taskResolution(task),
    occupiesExecutionSlot: ACTIVE.has(task.status) && !handoff && !unknown,
    nextAction: unknown ? '请先核对外部执行状态，避免重复处理。' : awaiting ? '请在桌面工具检查任务内容并发送；未收到领取确认。'
      : retryWait ? '已保存安全重试计划，自动整理开启且授权有效时将按计划继续；无需重复点击。' : task.error?.message || '' };
}
const SUMMARY_FIELDS = ['id', 'title', 'kind', 'sourceType', 'sourceId', 'sourceName', 'status', 'trigger', 'executor', 'adapterId',
  'executionMode', 'scheduledAt', 'updatedAt', 'completedAt', 'detail', 'action', 'count', 'completionPolicy', 'executionId'];
function taskSummary(task) {
  const item = {};
  for (const key of SUMMARY_FIELDS) if (task[key] !== undefined) item[key] = typeof task[key] === 'string' ? task[key].slice(0, key === 'detail' ? 400 : 300) : task[key];
  return { ...item, ...taskPresentation(task) };
}
function taskReadIndex(store) {
  const cached = INDEXES.get(store);
  if (cached) return cached;
  const all = (store.tasks || []).map(taskSummary);
  const summary = { total: all.length, actionable: 0, running: 0, scheduled: 0, completed: 0, archived: 0 };
  let lastSuccessAt = '';
  for (const task of all) {
    summary[task.statusGroup]++;
    if (task.status === 'succeeded' && String(task.completedAt || '') > lastSuccessAt) lastSuccessAt = task.completedAt;
  }
  const order = { actionable: 0, running: 1, scheduled: 2, completed: 3, archived: 4 };
  const rows = all.sort((a, b) => order[a.statusGroup] - order[b.statusGroup]
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.id.localeCompare(b.id));
  const value = { rows, summary, lastSuccessAt, executors: [...new Set(all.map(task => task.executor).filter(Boolean))] };
  INDEXES.set(store, value);
  return value;
}
function queryTaskSnapshot(store, query = {}) {
  const index = taskReadIndex(store);
  const rows = index.rows.filter(task => (!query.status || query.status === 'all' || task.statusGroup === query.status)
    && (!query.source || query.source === 'all' || task.sourceType === query.source)
    && (!query.sourceId || task.sourceId === String(query.sourceId))
    && (!query.executor || query.executor === 'all' || task.executor === query.executor));
  const pageCount = Math.max(1, Math.ceil(rows.length / 20));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(query.page) || 1)));
  return { ok: true, ready: true, protocolVersion: store.protocolVersion, generatedAt: store.updatedAt || '', summary: index.summary, lastSuccessAt: index.lastSuccessAt,
    page, pageSize: 20, pageCount, filteredTotal: rows.length, tasks: rows.slice((page - 1) * 20, page * 20), history: [],
    executors: index.executors };
}
module.exports = { taskPresentation, taskSummary, taskReadIndex, queryTaskSnapshot, TERMINAL };
