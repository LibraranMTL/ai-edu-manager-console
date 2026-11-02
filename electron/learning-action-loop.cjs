'use strict';

const crypto = require('node:crypto');
const { stableActionKey } = require('./learning-state-store.cjs');

function text(value) { return String(value ?? '').trim(); }

function commitKey(prefix, parts) {
  return `${prefix}-${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

function suppressionDecision(gates = {}) {
  if (gates.automationEnabled === false) return ['automation_disabled', '全局自动化已关闭'];
  if (gates.studentPaused === true) return ['student_paused', '学生自动行动已暂停'];
  if (gates.capacityAvailable === false) return ['capacity_full', '当前任务或学习卡容量已满'];
  if (gates.executorAvailable === false) return ['executor_offline', '执行器当前不可用'];
  return null;
}

function publicResult(intent, binding, extra = {}) {
  return {
    actionId: intent.actionId, actionKey: intent.actionKey,
    status: binding?.status || intent.status, round: binding?.round || intent.currentRound || 0,
    entityType: binding?.entityType || '', entityId: binding?.entityId || '',
    receiptId: binding?.receiptId || '', ...extra,
  };
}

function createLearningActionLoop({
  store,
  gateState = async () => ({ automationEnabled: true, capacityAvailable: true, executorAvailable: true }),
  dispatchTask,
  dispatchPractice,
  reconcileBinding,
} = {}) {
  if (!store) throw new Error('Learning action store is required');

  async function reconcile(scope, intent) {
    const binding = intent.binding;
    if (!binding || !['dispatching', 'unknown'].includes(binding.status)) return publicResult(intent, binding);
    if (typeof reconcileBinding !== 'function') {
      if (binding.status === 'dispatching') {
        const unknown = store.settleActionDispatch(scope, intent.actionKey, {
          round: binding.round, status: 'unknown', entityId: binding.entityId,
          commitKey: commitKey('learning-action-unknown', [intent.actionKey, binding.round]),
        });
        return publicResult(intent, unknown);
      }
      return publicResult(intent, binding);
    }
    const result = await reconcileBinding({ ...binding, actionId: intent.actionId, actionKey: intent.actionKey, payload: intent.payload });
    if (!result) return publicResult(intent, binding);
    const settled = store.settleActionDispatch(scope, intent.actionKey, {
      round: binding.round, status: text(result.status) || 'unknown', entityId: result.entityId,
      receiptId: result.receiptId, commitKey: commitKey('learning-action-reconcile', [intent.actionKey, binding.round, result.receiptId || '', result.status || 'unknown']),
    });
    return publicResult(intent, settled);
  }

  async function dispatch(scope, input = {}) {
    const key = stableActionKey(input);
    let intent = store.ensureActionIntent(scope, input, commitKey('learning-action-intent', [key]));
    if (intent.binding && ['dispatched', 'completed'].includes(intent.binding.status)) return publicResult(intent, intent.binding, { reused: true });
    if (intent.binding && ['dispatching', 'unknown'].includes(intent.binding.status)) return reconcile(scope, intent);

    const round = Math.max(1, Number(intent.currentRound || 0) + (intent.binding ? 1 : 0));
    const gates = await gateState({ ...input, actionId: intent.actionId, actionKey: intent.actionKey, currentRound: intent.currentRound });
    const blocked = suppressionDecision(gates);
    if (blocked) {
      return store.suppressAction(scope, intent.actionKey, {
        reason: blocked[0], detail: blocked[1],
        round, gateKey: `${intent.actionKey}:${round}:${blocked[0]}`,
      });
    }

    const entityType = input.actionType === 'targeted_practice' ? 'practice_card' : 'task';
    const binding = store.beginActionDispatch(scope, intent.actionKey, {
      entityType, round, commitKey: commitKey('learning-action-begin', [intent.actionKey, round]),
    });
    const adapter = entityType === 'practice_card' ? dispatchPractice : dispatchTask;
    if (typeof adapter !== 'function') {
      const failed = store.settleActionDispatch(scope, intent.actionKey, {
        round, status: 'failed', commitKey: commitKey('learning-action-no-adapter', [intent.actionKey, round]),
      });
      return publicResult(intent, failed, { reason: 'adapter_unavailable' });
    }
    try {
      const result = await adapter({
        ...input, actionId: intent.actionId, actionKey: intent.actionKey, round,
        idempotencyKey: binding.idempotencyKey,
      });
      const settled = store.settleActionDispatch(scope, intent.actionKey, {
        round, status: text(result?.status) || 'dispatched', entityId: result?.entityId,
        receiptId: result?.receiptId, commitKey: commitKey('learning-action-settle', [intent.actionKey, round, result?.receiptId || '', result?.entityId || '']),
      });
      return publicResult(intent, settled);
    } catch (error) {
      const status = error?.resultUnknown === true || ['ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(error?.code) ? 'unknown' : 'failed';
      const settled = store.settleActionDispatch(scope, intent.actionKey, {
        round, status, receiptId: text(error?.receiptId),
        commitKey: commitKey('learning-action-error', [intent.actionKey, round, status, error?.code || error?.message || 'failed']),
      });
      return publicResult(intent, settled, { message: text(error?.message) });
    }
  }

  return { dispatch, reconcile };
}

module.exports = { createLearningActionLoop, stableActionKey, suppressionDecision };
