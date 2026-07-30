const STATE_VERSION = 1;

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeEntry(input = {}) {
  return {
    studentId: String(input.studentId || ''),
    status: ['dirty', 'running', 'clean'].includes(String(input.status)) ? String(input.status) : 'clean',
    reasons: [...new Set((Array.isArray(input.reasons) ? input.reasons : []).map(String).filter(Boolean))].slice(-12),
    dirtyAt: String(input.dirtyAt || ''),
    claimedDirtyAt: String(input.claimedDirtyAt || ''),
    claimedAt: String(input.claimedAt || ''),
    generation: Math.max(0, Number(input.generation || 0)),
    nextAttemptAt: String(input.nextAttemptAt || ''),
    attempt: Math.max(0, Number(input.attempt || 0)),
    lastSuccessAt: String(input.lastSuccessAt || ''),
    lastFingerprint: String(input.lastFingerprint || ''),
    lastError: String(input.lastError || ''),
  };
}

function normalizeGrowthRefreshState(input = {}) {
  const entries = {};
  for (const [studentId, value] of Object.entries(input.entries || {})) {
    const normalized = normalizeEntry({ ...value, studentId });
    if (normalized.studentId) entries[normalized.studentId] = normalized;
  }
  return {
    version: STATE_VERSION,
    updatedAt: String(input.updatedAt || ''),
    entries,
  };
}

function markGrowthDirty(input, studentIds, reason = 'source_changed', now = new Date()) {
  const state = normalizeGrowthRefreshState(input);
  const markedAt = iso(now);
  for (const rawId of Array.isArray(studentIds) ? studentIds : [studentIds]) {
    const studentId = String(rawId || '');
    if (!studentId) continue;
    const current = normalizeEntry({ ...(state.entries[studentId] || {}), studentId });
    state.entries[studentId] = {
      ...current,
      status: current.status === 'running' ? 'running' : 'dirty',
      reasons: [...new Set([...current.reasons, String(reason || 'source_changed')])].slice(-12),
      dirtyAt: markedAt,
      generation: current.generation + 1,
      nextAttemptAt: current.status === 'running' ? current.nextAttemptAt : markedAt,
      lastError: current.status === 'running' ? current.lastError : '',
    };
  }
  state.updatedAt = markedAt;
  return state;
}

function claimDueGrowthRefreshes(input, options = {}) {
  const state = normalizeGrowthRefreshState(input);
  const now = iso(options.now || new Date());
  const nowMs = Date.parse(now);
  const limit = Math.max(1, Number(options.limit || 3));
  const staleRunningAfterMs = Math.max(60_000, Number(options.staleRunningAfterMs || 30 * 60_000));
  const due = [];

  for (const entry of Object.values(state.entries)) {
    const runningSince = Date.parse(entry.claimedAt || entry.dirtyAt || '');
    const runningIsStale = entry.status === 'running'
      && Number.isFinite(runningSince)
      && nowMs - runningSince >= staleRunningAfterMs;
    const retryAt = Date.parse(entry.nextAttemptAt || entry.dirtyAt || '');
    const ready = entry.status === 'dirty' && (!Number.isFinite(retryAt) || retryAt <= nowMs);
    if (!ready && !runningIsStale) continue;
    due.push(entry);
  }

  due.sort((left, right) => String(left.dirtyAt).localeCompare(String(right.dirtyAt)));
  const claimed = due.slice(0, limit).map((entry) => {
    const next = {
      ...entry,
      status: 'running',
      claimedDirtyAt: entry.dirtyAt || now,
      claimedAt: now,
      attempt: entry.attempt + 1,
    };
    state.entries[entry.studentId] = next;
    return { studentId: entry.studentId, claimedDirtyAt: next.claimedDirtyAt, generation: next.generation, attempt: next.attempt };
  });
  if (claimed.length) state.updatedAt = now;
  return { state, claimed };
}

function completeGrowthRefresh(input, claim, result = {}, now = new Date()) {
  const state = normalizeGrowthRefreshState(input);
  const completedAt = iso(now);
  const studentId = String(claim?.studentId || '');
  const current = state.entries[studentId];
  if (!current) return state;

  if (current.generation !== Number(claim?.generation || 0)) {
    state.entries[studentId] = {
      ...current,
      status: 'dirty',
      claimedDirtyAt: '',
      claimedAt: '',
      nextAttemptAt: completedAt,
    };
    state.updatedAt = completedAt;
    return state;
  }

  if (result.ok) {
    state.entries[studentId] = {
      ...current,
      status: 'clean',
      reasons: [],
      claimedDirtyAt: '',
      claimedAt: '',
      nextAttemptAt: '',
      attempt: 0,
      lastSuccessAt: completedAt,
      lastFingerprint: String(result.fingerprint || current.lastFingerprint || ''),
      lastError: '',
    };
  } else {
    const baseMs = Math.max(5_000, Number(result.backoffBaseMs || 30_000));
    const maxMs = Math.max(baseMs, Number(result.maxBackoffMs || 15 * 60_000));
    const delayMs = Math.min(maxMs, baseMs * (2 ** Math.max(0, current.attempt - 1)));
    state.entries[studentId] = {
      ...current,
      status: 'dirty',
      claimedDirtyAt: '',
      claimedAt: '',
      nextAttemptAt: new Date(Date.parse(completedAt) + delayMs).toISOString(),
      lastError: String(result.error || '成长模型更新失败。'),
    };
  }
  state.updatedAt = completedAt;
  return state;
}

function dirtyStudentIds(input) {
  const state = normalizeGrowthRefreshState(input);
  return Object.values(state.entries)
    .filter((entry) => entry.status === 'dirty' || entry.status === 'running')
    .map((entry) => entry.studentId);
}

module.exports = {
  STATE_VERSION,
  claimDueGrowthRefreshes,
  completeGrowthRefresh,
  dirtyStudentIds,
  markGrowthDirty,
  normalizeGrowthRefreshState,
};
