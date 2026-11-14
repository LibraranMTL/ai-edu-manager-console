'use strict';

const ACTIVE_TASK_STATUSES = new Set(['running', 'waiting_result', 'reviewing', 'committing', 'publishing']);

// The shared gate already accounts for entries that own a resource permit.
// Only a genuinely active legacy/untracked operation must stop new heavy work;
// a stale map entry for a terminal task must never hold the global queue.
function hasUntrackedExternalHeavyWork(runningEntries, tasks) {
  const taskStatus = new Map((Array.isArray(tasks) ? tasks : [])
    .map(task => [String(task?.id || ''), String(task?.status || '')]));
  for (const [taskId, entry] of runningEntries || []) {
    if (typeof entry?.releaseHeavyPermit === 'function') continue;
    if (ACTIVE_TASK_STATUSES.has(taskStatus.get(String(taskId)))) return true;
  }
  return false;
}

module.exports = { ACTIVE_TASK_STATUSES, hasUntrackedExternalHeavyWork };
