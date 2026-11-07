'use strict';

const SAFE_ACTIONS = new Set(['settle_existing', 'requeue_proven_not_sent', 'reconcile_original']);
const SCHEMA = 'edu-manager.backlog-convergence.v1';

function planConvergenceSlice(preview, checkpoint = {}, now = new Date().toISOString()) {
  const rows = Array.isArray(preview?.rows) ? preview.rows.slice(0, 20) : [];
  const safeRows = rows.filter((row) => SAFE_ACTIONS.has(String(row.action || '')));
  const untouched = rows.filter((row) => !SAFE_ACTIONS.has(String(row.action || '')));
  const cursor = String(preview?.cursor || '');
  return {
    safeRows,
    untouched,
    checkpoint: {
      schema: SCHEMA,
      jobId: String(checkpoint.jobId || `backlog-convergence-${String(now).slice(0, 10)}`),
      cursor,
      scanned: Math.max(0, Number(checkpoint.scanned || 0)) + rows.length,
      applied: Math.max(0, Number(checkpoint.applied || 0)),
      conflicts: Math.max(0, Number(checkpoint.conflicts || 0)),
      updatedAt: now,
      completedAt: rows.length ? '' : now,
    },
  };
}

function finishConvergenceSlice(plan, results = [], now = new Date().toISOString()) {
  const applied = results.filter((result) => result?.applied).length;
  const conflicts = results.filter((result) => result?.code === 'TASK_EXECUTION_CONFLICT').length;
  return {
    ...plan.checkpoint,
    applied: plan.checkpoint.applied + applied,
    conflicts: plan.checkpoint.conflicts + conflicts,
    updatedAt: now,
  };
}

module.exports = { SAFE_ACTIONS, SCHEMA, planConvergenceSlice, finishConvergenceSlice };
