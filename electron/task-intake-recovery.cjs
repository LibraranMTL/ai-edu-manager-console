'use strict';

const { classifyBatchClosure } = require('./task-closure-decision.cjs');

// Only restore the waiting view. No item is dispatched, delivered or marked
// successful here; the inbox retains ownership of its original receipts.
function intakeRecoveryPatch(task, items, now = new Date().toISOString()) {
  const ids = task.input?.itemIds;
  if (task.kind !== 'smart_material_intake' || task.status !== 'failed'
    || task.adapterId !== 'internal' || task.recoveryState !== 'host_confirmed_stopped'
    || task.error?.code !== 'INTERNAL_EXECUTION_INTERRUPTED' || !task.executionId
    || !task.input?.sourceId || !Array.isArray(ids) || !ids.length
    || new Set(ids.map(String)).size !== ids.length || !Array.isArray(items) || items.length !== ids.length) return null;
  const allowed = new Set(['review', 'execution_unknown', 'delivery_reconcile', 'delivered', 'ignored', 'skipped_unsupported']);
  if (items.some((item, i) => !item || String(item.id) !== String(ids[i])
    || String(item.sourceId) !== String(task.input.sourceId) || !allowed.has(item.status))) return null;
  const closure = classifyBatchClosure(items);
  // Completed batches need their own receipt validation; unfinished automatic
  // work must not be resumed implicitly by this recovery.
  if (!['receipt_pending', 'needs_user_action'].includes(closure.phase)) return null;
  const summary = `原批次待处理：需确认 ${closure.needsUserAction} 份，回执核对 ${closure.receiptPending} 份；已投递 ${closure.delivered} 份、忽略 ${closure.ignored} 份。`;
  return {
    status: 'reviewing', settlementState: closure.phase,
    businessOutcome: closure.receiptPending ? 'awaiting_receipt' : 'needs_user_action',
    recoveryState: 'intake_items_reconciled', recoveryReason: 'original_item_states_checked', recoveryCheckedAt: now,
    completedAt: '', nextRetryAt: '', autoRetry: false, retryRecovery: null,
    error: null,
    result: { ...(task.result || {}), summary, intakeRecovery: { previousError: task.error, executionId: task.executionId, checkedAt: now },
      structuredOutput: { ...(task.result?.structuredOutput || {}), closure },
      validation: { ...(task.result?.validation || {}), valid: false } }, updatedAt: now,
  };
}

module.exports = { intakeRecoveryPatch };
