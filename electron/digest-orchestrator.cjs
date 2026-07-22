const AUTO_DIGEST_KINDS = new Set(['student_digest', 'project_digest']);

function isDigestTask(task) {
  return AUTO_DIGEST_KINDS.has(String(task?.kind || ''));
}

function shouldAutoAccept(task, validation) {
  return isDigestTask(task)
    && String(task?.completionPolicy || '') === 'auto_after_validation'
    && Boolean(validation?.valid);
}

function digestUserStatus(taskStatus, businessStatus, pendingCount = 0) {
  const task = String(taskStatus || '');
  const business = String(businessStatus || '');
  const pending = Number(pendingCount || 0);
  // The material ledger is the source of truth. A stale task left in running or
  // reviewing must never hide a completed/partial business result or lock the UI.
  if (business === 'partial') return 'partial';
  if (business === 'completed' && pending <= 0) return 'completed';
  if (['failed', 'timeout'].includes(business)) return 'needs_help';
  if (['failed', 'blocked', 'timed_out', 'cancelled'].includes(task)) return 'needs_help';
  if (task === 'waiting_result' || ['submitted', 'digesting'].includes(business)) return 'waiting_result';
  if (['running', 'reviewing', 'validating'].includes(task) || business === 'validating') return 'processing';
  if (pending <= 0 && (task === 'succeeded' || business === 'idle')) return 'completed';
  return 'pending';
}

function userStatusLabel(status) {
  return ({ pending: '待处理', waiting_result: '等待 Agent 回执', processing: '处理中', partial: '部分完成', completed: '已完成', needs_help: '需要帮助' })[String(status)] || '待处理';
}

function createDigestOrchestrator(dependencies = {}) {
  const requireFn = (name) => {
    const fn = dependencies[name];
    if (typeof fn !== 'function') throw new Error(`DigestOrchestrator 缺少依赖：${name}`);
    return fn;
  };
  return {
    start(scopeType, scopeId, requestedExecutor = 'auto') {
      const prepare = requireFn('prepare');
      const execute = requireFn('execute');
      const prepared = prepare(scopeType, scopeId);
      if (!prepared?.ok) return prepared;
      return execute(prepared.taskId, requestedExecutor);
    },
    status(scopeType, scopeId) {
      return requireFn('status')(scopeType, scopeId);
    },
    retry(scopeType, scopeId, requestedExecutor = 'auto') {
      const reset = requireFn('reset');
      const execute = requireFn('execute');
      const prepared = reset(scopeType, scopeId);
      if (!prepared?.ok) return prepared;
      return execute(prepared.taskId, requestedExecutor);
    },
    reconcile() {
      return requireFn('reconcile')();
    },
  };
}

module.exports = {
  AUTO_DIGEST_KINDS,
  createDigestOrchestrator,
  digestUserStatus,
  isDigestTask,
  shouldAutoAccept,
  userStatusLabel,
};
