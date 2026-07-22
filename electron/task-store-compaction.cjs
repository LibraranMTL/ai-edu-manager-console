function compactDigestState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const strictValidation = state.strictValidation && typeof state.strictValidation === 'object'
    ? {
        ok: Boolean(state.strictValidation.ok),
        code: String(state.strictValidation.code || ''),
        message: String(state.strictValidation.message || ''),
        checkedAt: String(state.strictValidation.checkedAt || ''),
      }
    : null;
  return {
    status: String(state.status || ''),
    message: String(state.message || ''),
    digestBatchId: String(state.digestBatchId || state.batchId || ''),
    pendingCount: Number(state.pendingCount || 0),
    submittedCount: Number(state.submittedCount || 0),
    processedCount: Number(state.processedCount || 0),
    failedCount: Number(state.failedCount || 0),
    lastDigestAt: String(state.lastDigestAt || ''),
    submittedAt: String(state.submittedAt || ''),
    completedAt: String(state.completedAt || ''),
    updatedAt: String(state.updatedAt || ''),
    strictValidation,
  };
}

function compactDigestDomainSync(sync) {
  if (!sync || typeof sync !== 'object' || Array.isArray(sync)) return sync ?? null;
  const state = compactDigestState(sync.digestState || sync.state);
  return {
    ok: Boolean(sync.ok),
    strict: Boolean(sync.strict),
    message: String(sync.message || state?.message || ''),
    scopeType: String(sync.scopeType || ''),
    scopeId: String(sync.scopeId || sync.projectId || sync.studentId || ''),
    scopeName: String(sync.scopeName || sync.projectName || sync.studentName || ''),
    pendingCount: Number(sync.pendingCount ?? state?.pendingCount ?? 0),
    submittedCount: Number(sync.submittedCount ?? state?.submittedCount ?? 0),
    processedCount: Number(sync.processedCount ?? state?.processedCount ?? 0),
    lastDigestAt: String(sync.lastDigestAt || state?.lastDigestAt || ''),
    state,
  };
}

function compactDigestTaskResult(task) {
  if (!task || !['project_digest', 'student_digest'].includes(String(task.kind || '')) || !task.result || typeof task.result !== 'object') return false;
  let changed = false;
  const result = task.result;
  if (result.structuredOutput && typeof result.structuredOutput === 'object') {
    const compacted = compactDigestDomainSync(result.structuredOutput);
    if (JSON.stringify(result.structuredOutput) !== JSON.stringify(compacted)) {
      result.structuredOutput = compacted;
      changed = true;
    }
  }
  if (result.validation?.domainSync && typeof result.validation.domainSync === 'object') {
    const compacted = compactDigestDomainSync(result.validation.domainSync);
    if (JSON.stringify(result.validation.domainSync) !== JSON.stringify(compacted)) {
      result.validation = { ...result.validation, domainSync: compacted };
      changed = true;
    }
  }
  return changed;
}

function compactDigestHistoryEntry(entry) {
  if (!entry || !['project_digest', 'student_digest'].includes(String(entry.kind || ''))) return false;
  if (!entry.validation?.domainSync || typeof entry.validation.domainSync !== 'object') return false;
  const compacted = compactDigestDomainSync(entry.validation.domainSync);
  if (JSON.stringify(entry.validation.domainSync) === JSON.stringify(compacted)) return false;
  entry.validation = { ...entry.validation, domainSync: compacted };
  return true;
}

function compactDigestTaskStore(store) {
  if (!store || typeof store !== 'object') return false;
  const tasksChanged = Array.isArray(store.tasks)
    ? store.tasks.reduce((changed, task) => compactDigestTaskResult(task) || changed, false)
    : false;
  const historyChanged = Array.isArray(store.history)
    ? store.history.reduce((changed, entry) => compactDigestHistoryEntry(entry) || changed, false)
    : false;
  return tasksChanged || historyChanged;
}

module.exports = {
  compactDigestDomainSync,
  compactDigestHistoryEntry,
  compactDigestTaskResult,
  compactDigestTaskStore,
};
