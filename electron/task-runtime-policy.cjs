const ACTIVE_TASK_STATUSES = new Set(['running', 'waiting_result']);
const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out']);
const NOISY_EVENT_TYPES = new Set([
  'adapter_heartbeat',
  'task_heartbeat_lost',
  'runtime_fallback_prepared',
  'runtime_fallback',
  'manual_execution_prepared',
  'manual_packet_exported',
]);

function taskExecutionClass(task) {
  const adapterId = String(task?.adapterId || '');
  const mode = String(task?.executionMode || '');
  if (adapterId === 'manual' || mode === 'manual') return 'manual';
  if (adapterId === 'qclaw' || mode === 'inbox') return 'inbox';
  if (adapterId === 'internal' || mode === 'internal') return 'internal';
  return 'process';
}

function taskTimeoutDecision(task, nowValue = Date.now()) {
  if (!ACTIVE_TASK_STATUSES.has(String(task?.status || '')) || !task?.startedAt) {
    return { enabled: false, due: false, kind: 'inactive' };
  }
  const executionClass = taskExecutionClass(task);
  if (executionClass === 'manual') {
    return { enabled: false, due: false, kind: 'manual_wait' };
  }
  const now = Number(nowValue);
  const startedAt = Date.parse(task.startedAt);
  if (!Number.isFinite(startedAt)) {
    return { enabled: false, due: false, kind: 'orphan' };
  }
  if (executionClass === 'inbox') {
    const resultTimeoutSeconds = Math.max(900, Number(task.resultTimeoutSeconds || 24 * 60 * 60));
    const timeoutAt = startedAt + resultTimeoutSeconds * 1000;
    return {
      enabled: true,
      due: now > timeoutAt,
      kind: 'result_wait',
      timeoutAt,
      error: {
        code: 'RESULT_WAIT_TIMEOUT',
        message: `等待 Agent 结果超过 ${resultTimeoutSeconds} 秒。`,
      },
    };
  }
  const heartbeatAt = Date.parse(task.lastHeartbeatAt || task.startedAt);
  const timeoutSeconds = Math.max(30, Number(task.timeoutSeconds || 900));
  const heartbeatTimeoutSeconds = Math.max(30, Number(task.heartbeatTimeoutSeconds || Math.min(timeoutSeconds, 180)));
  const executionTimeoutAt = startedAt + timeoutSeconds * 1000;
  const heartbeatTimeoutAt = (Number.isFinite(heartbeatAt) ? heartbeatAt : startedAt) + heartbeatTimeoutSeconds * 1000;
  const timeoutAt = Math.min(executionTimeoutAt, heartbeatTimeoutAt);
  const heartbeatLost = heartbeatTimeoutAt <= executionTimeoutAt;
  return {
    enabled: true,
    due: now > timeoutAt,
    kind: heartbeatLost ? 'heartbeat' : 'execution',
    timeoutAt,
    error: {
      code: heartbeatLost ? 'HEARTBEAT_LOST' : 'TASK_TIMEOUT',
      message: heartbeatLost
        ? `任务超过 ${heartbeatTimeoutSeconds} 秒没有心跳。`
        : `任务超过 ${timeoutSeconds} 秒未完成。`,
    },
  };
}

function candidateRuntimeDecision(current, candidate) {
  const currentStatus = String(current?.status || '');
  const sourceStatus = String(candidate?.status || '');
  const currentCycle = String(current?.idempotencyKey || '');
  const candidateCycle = String(candidate?.idempotencyKey || '');
  const active = ACTIVE_TASK_STATUSES.has(currentStatus);
  const orphan = active && (!current?.executionId || !current?.startedAt);
  const preserveExecution = active && !orphan;
  const newCycle = Boolean(candidateCycle && candidateCycle !== currentCycle && !preserveExecution);
  const preserveTerminal = TERMINAL_TASK_STATUSES.has(currentStatus) && !newCycle;
  const safeSourceStatus = orphan && ACTIVE_TASK_STATUSES.has(sourceStatus) ? 'pending' : sourceStatus;
  return {
    newCycle,
    orphan,
    preserveExecution,
    preserveTerminal,
    resetExecution: newCycle || orphan,
    nextStatus: preserveExecution || preserveTerminal ? currentStatus : safeSourceStatus,
  };
}

function repairTaskRuntimeStore(store, now = new Date().toISOString()) {
  if (!store || !Array.isArray(store.tasks)) return { changed: false, repairs: [] };
  const repairs = [];
  for (const task of store.tasks) {
    const executionClass = taskExecutionClass(task);
    const maxAttempts = Math.max(1, Number(task.maxAttempts || 1));
    const attempt = Math.max(0, Number(task.attempt || 0));
    if (attempt > maxAttempts) {
      task.attempt = maxAttempts;
      task.autoRetry = false;
      task.nextRetryAt = '';
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: 'retry_limit_repaired', previousAttempt: attempt, attempt: maxAttempts });
    }
    if (ACTIVE_TASK_STATUSES.has(String(task.status || '')) && (!task.executionId || !task.startedAt)) {
      task.status = 'pending';
      task.statusGroup = 'actionable';
      task.executionId = '';
      task.adapterId = '';
      task.startedAt = '';
      task.lastHeartbeatAt = '';
      task.completedAt = '';
      task.nextRetryAt = '';
      task.error = null;
      task.autoRetry = false;
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: 'orphan_execution_recovered' });
      continue;
    }
    if (String(task.status || '') === 'timed_out'
      && String(task.error?.code || '') === 'HEARTBEAT_LOST'
      && ['manual', 'inbox'].includes(executionClass)
      && task.executionId) {
      task.status = 'waiting_result';
      task.statusGroup = 'running';
      task.completedAt = '';
      task.nextRetryAt = '';
      task.error = null;
      task.autoRetry = false;
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: `${executionClass}_wait_restored` });
    }
  }
  return { changed: repairs.length > 0, repairs };
}

function compactTaskEvents(events, options = {}) {
  const maxEvents = Math.max(500, Number(options.maxEvents || 5000));
  const windowMs = Math.max(60 * 1000, Number(options.windowMs || 10 * 60 * 1000));
  const compacted = [];
  const recentByKey = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;
    const type = String(event.type || 'updated');
    if (!NOISY_EVENT_TYPES.has(type)) {
      compacted.push(event);
      continue;
    }
    const key = `${String(event.taskId || '')}|${type}`;
    const eventAt = Date.parse(event.at || '') || 0;
    const previousIndex = recentByKey.get(key);
    const previous = Number.isInteger(previousIndex) ? compacted[previousIndex] : null;
    const previousAt = Date.parse(previous?.at || '') || 0;
    if (previous && eventAt && previousAt && eventAt - previousAt <= windowMs) {
      compacted[previousIndex] = {
        ...event,
        firstAt: previous.firstAt || previous.at || event.at,
        repeatCount: Number(previous.repeatCount || 1) + 1,
      };
      continue;
    }
    recentByKey.set(key, compacted.length);
    compacted.push(event);
  }
  return compacted.length > maxEvents ? compacted.slice(-maxEvents) : compacted;
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  candidateRuntimeDecision,
  compactTaskEvents,
  repairTaskRuntimeStore,
  taskExecutionClass,
  taskTimeoutDecision,
};
