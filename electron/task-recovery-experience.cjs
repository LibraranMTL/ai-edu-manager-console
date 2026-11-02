'use strict';

const VERSION = 1;
const DEFAULT_BUDGET = Object.freeze({
  executionAttempts: 3,
  correctionAttempts: 2,
  providerSwitches: 2,
  receiptQueries: 6,
  windowMinutes: 30,
});

const PROVIDER_LABELS = Object.freeze({
  internal: 'AI 教育管家内置流程',
  codex: 'Codex',
  workbuddy: 'WorkBuddy',
  openclaw: 'OpenClaw',
  qclaw: 'QClaw',
  trae: 'Trae',
  'qoder-work': 'Qoder Work',
  manual: '人工处理',
});

function taskExecutionClass(task = {}) {
  const adapterId = String(task.adapterId || task.executor || '');
  const mode = String(task.executionMode || '');
  const executionId = String(task.executionId || '');
  if (adapterId === 'internal' || mode === 'internal' || /^(?:research|internal)-/.test(executionId)) return 'internal';
  if (adapterId === 'qclaw' || mode === 'inbox') return 'inbox';
  if (adapterId === 'manual' || ['manual', 'desktop_handoff', 'agent_handoff'].includes(mode)) return 'manual';
  return 'process';
}

function providerLabel(task = {}) {
  const id = String(task.adapterId || task.executor || '');
  const savedLabel = String(task.executionProvenance?.providerLabel || '');
  // A persisted label is descriptive metadata, not execution identity. Prefer
  // the live adapter for built-ins so an old WorkBuddy label cannot instruct a
  // Codex task to be checked in the wrong tool. A manual packet is the one
  // exception: its saved label names the actual tool that received the packet.
  if (id === 'manual' && savedLabel && savedLabel !== PROVIDER_LABELS.manual) return savedLabel;
  return String(PROVIDER_LABELS[id]
    || task.routeDecision?.candidates?.find(candidate => candidate.adapterId === id)?.label
    || savedLabel || id || '外部执行工具');
}

function executionProvenance(task = {}) {
  const executionClass = taskExecutionClass(task);
  const internal = executionClass === 'internal';
  const inbox = executionClass === 'inbox';
  const manual = executionClass === 'manual';
  return {
    version: VERSION,
    executionClass,
    providerId: String(task.adapterId || task.executor || (internal ? 'internal' : '')),
    providerLabel: providerLabel(task),
    externalRunRef: String(task.executionProvenance?.externalRunRef || ''),
    querySupport: Boolean(task.executionProvenance?.querySupport || internal || inbox),
    cancelSupport: Boolean(task.executionProvenance?.cancelSupport || internal || (!manual && !inbox)),
    openSupport: Boolean(task.executionProvenance?.openSupport || manual),
    dispatchStage: String(task.executionProvenance?.dispatchStage || (task.executionId ? 'accepted' : 'not_sent')),
  };
}

function recoveryBudget(task = {}, now = new Date().toISOString()) {
  const saved = task.recoveryBudget && typeof task.recoveryBudget === 'object' ? task.recoveryBudget : {};
  const startedAt = String(saved.startedAt || task.startedAt || now);
  const startMs = Date.parse(startedAt);
  const windowMinutes = Math.max(5, Math.min(24 * 60, Number(saved.windowMinutes || DEFAULT_BUDGET.windowMinutes)));
  return {
    version: VERSION,
    cycleKey: String(saved.cycleKey || task.idempotencyKey || task.id || ''),
    startedAt,
    deadlineAt: String(saved.deadlineAt || (Number.isFinite(startMs) ? new Date(startMs + windowMinutes * 60000).toISOString() : '')),
    windowMinutes,
    executionAttempts: Math.max(0, Number(saved.executionAttempts ?? task.attempt ?? 0)),
    correctionAttempts: Math.max(0, Number(saved.correctionAttempts || 0)),
    providerSwitches: Math.max(0, Number(saved.providerSwitches || 0)),
    receiptQueries: Math.max(0, Number(saved.receiptQueries || 0)),
    limits: {
      executionAttempts: Math.max(1, Number(saved.limits?.executionAttempts || DEFAULT_BUDGET.executionAttempts)),
      correctionAttempts: Math.max(0, Number(saved.limits?.correctionAttempts ?? DEFAULT_BUDGET.correctionAttempts)),
      providerSwitches: Math.max(0, Number(saved.limits?.providerSwitches ?? DEFAULT_BUDGET.providerSwitches)),
      receiptQueries: Math.max(1, Number(saved.limits?.receiptQueries || DEFAULT_BUDGET.receiptQueries)),
    },
  };
}

function classifyRecoveryCause(task = {}) {
  const code = String(task.error?.code || '');
  const message = String(task.error?.message || task.result?.validation?.message || '');
  const text = `${code} ${message}`;
  if (/ENOSPC|EACCES|EPERM|read.?only|storage|磁盘|写入|保存失败|存储/i.test(text)) return 'storage';
  if (/429\b|rate.?limit|resource|busy|overload|503\b|502\b|资源|排队|繁忙|限流/i.test(text)) return 'resource';
  if (/DISPATCH_STATE_CHANGED|not.?sent|尚未发送|未发送|等待发送/i.test(text)) return 'not_sent';
  if (task.recoveryState === 'unknown' || /UNRESOLVED|UNCONFIRMED|尚未确认|状态不明/i.test(text)) return 'sent_unknown';
  if (/validation|schema|format|execution.id|批次.*不匹配|结构|格式|校验/i.test(text)) return 'structure';
  if (/evidence|观察项|证据|来源.*冲突|正式定论/i.test(text)) return 'evidence';
  if (/ECONN|ENET|EAI_AGAIN|ETIMEDOUT|network|断网|网络/i.test(text)) return 'network';
  if (/auth|login|401\b|403\b|权限|登录/i.test(text)) return 'authorization';
  if (/cancel/i.test(code) || task.status === 'cancelled') return 'cancelled';
  return 'other';
}

function recoveryPlan(task = {}, now = new Date().toISOString()) {
  const provenance = executionProvenance(task);
  const budget = recoveryBudget(task, now);
  const cause = classifyRecoveryCause(task);
  const unknown = task.recoveryState === 'unknown';
  const terminal = ['succeeded', 'cancelled', 'archived'].includes(String(task.status || '')) && !unknown;
  if (terminal) return {
    version: VERSION, state: 'resolved', owner: 'system', cause,
    action: 'none', summary: task.status === 'cancelled'
      ? '本次任务已停止，未采用不完整结果。'
      : '任务已完成处理。',
    nextAction: '', lastCheckedAt: String(task.recoveryCheckedAt || now), nextWakeAt: '',
    providerLabel: provenance.providerLabel, userSteps: [], canOpen: false,
    canConfirmStopped: false, canRetry: task.status === 'cancelled', budget,
  };
  if (unknown && provenance.executionClass === 'internal') return {
    version: VERSION, state: 'automatic', owner: 'system', cause: 'sent_unknown',
    action: 'confirm_internal_stopped', summary: '系统正在确认内置任务已经停止，不需要前往其他工具。',
    nextAction: '确认完成后，本次不完整结果将保持隔离，已有有效版本不会被覆盖。',
    lastCheckedAt: String(task.recoveryCheckedAt || now), nextWakeAt: now,
    providerLabel: provenance.providerLabel, userSteps: [], canOpen: false,
    canConfirmStopped: false, canRetry: false, budget,
  };
  if (unknown) {
    const runHint = provenance.externalRunRef || task.executionId || '当前批次';
    const queryAvailable = provenance.querySupport && budget.receiptQueries < budget.limits.receiptQueries;
    return {
      version: VERSION, state: queryAvailable ? 'automatic' : 'needs_user',
      owner: queryAvailable ? 'system' : 'user', cause: 'sent_unknown',
      action: queryAvailable ? 'query_receipt' : 'confirm_external_stopped',
      summary: queryAvailable
        ? `系统正在向 ${provenance.providerLabel} 查询任务回执。`
        : provenance.querySupport
          ? `系统已完成 ${budget.receiptQueries} 次回执查询，仍无法确认 ${provenance.providerLabel} 的停止状态。`
          : `系统已检查本机记录和回执，但 ${provenance.providerLabel} 不支持自动查询停止状态。`,
      nextAction: queryAvailable
        ? '查询期间不会重复发送资料，也不会采用迟到结果。'
        : `请打开 ${provenance.providerLabel}，查找批次“${runHint}”，确认它未发送或已经停止；然后回到这里点击“已确认停止”。`,
      lastCheckedAt: String(task.recoveryCheckedAt || now), nextWakeAt: queryAvailable
        ? new Date((Date.parse(task.recoveryCheckedAt || now) || Date.parse(now)) + 60000).toISOString() : '',
      providerLabel: provenance.providerLabel,
      userSteps: queryAvailable ? [] : [
        `打开 ${provenance.providerLabel}`,
        `查找批次“${runHint}”`,
        '确认任务未发送或已经停止',
        '回到任务中心点击“已确认停止”',
      ],
      canOpen: provenance.openSupport, canConfirmStopped: !queryAvailable,
      canRetry: false, budget,
    };
  }
  if (provenance.executionClass === 'manual' && ['running', 'waiting_result'].includes(String(task.status || ''))) {
    const runHint = provenance.externalRunRef || task.executionId || '当前任务包';
    return {
      version: VERSION, state: 'needs_user', owner: 'user', cause,
      action: 'complete_manual_handoff',
      summary: `任务包已经准备好，正在等待 ${provenance.providerLabel} 返回结果。`,
      nextAction: `请打开 ${provenance.providerLabel}，完成批次“${runHint}”；完成后按任务包说明回传结果，本页会自动更新。`,
      lastCheckedAt: String(task.recoveryCheckedAt || now), nextWakeAt: '',
      providerLabel: provenance.providerLabel,
      userSteps: [
        `打开 ${provenance.providerLabel}`,
        `找到批次“${runHint}”并完成任务`,
        '按任务包说明提交结果',
        '回到任务中心查看自动校验结果',
      ],
      canOpen: provenance.openSupport, canConfirmStopped: false, canRetry: false, budget,
    };
  }
  if (['draft', 'pending'].includes(String(task.status || ''))) return {
    version: VERSION, state: 'needs_user', owner: 'user', cause,
    action: 'start', summary: '任务已准备好，尚未开始。',
    nextAction: '点击“开始处理”，系统会自动选择已授权且适合此任务的工具；发送前仍会再次核对权限和任务范围。',
    lastCheckedAt: String(task.recoveryCheckedAt || now), nextWakeAt: '',
    providerLabel: provenance.providerLabel, userSteps: [], canOpen: false,
    canConfirmStopped: false, canRetry: true, budget,
  };
  const automatic = Boolean(task.nextRetryAt || ['running', 'waiting_result', 'reviewing', 'queued'].includes(task.status));
  return {
    version: VERSION, state: automatic ? 'automatic' : 'needs_user', owner: automatic ? 'system' : 'user', cause,
    action: task.nextRetryAt ? 'bounded_retry' : automatic ? 'continue' : 'review',
    summary: automatic ? '系统正在按安全边界继续处理。' : '自动处理已完成，仍需要你的决定。',
    nextAction: automatic ? '无需重复点击；系统会保留原批次并在状态变化时更新。'
      : String(task.error?.message || '请查看任务资料后选择继续处理或保留现状。'),
    lastCheckedAt: String(task.recoveryCheckedAt || now), nextWakeAt: String(task.nextRetryAt || ''),
    providerLabel: provenance.providerLabel, userSteps: [], canOpen: false,
    canConfirmStopped: false, canRetry: ['failed', 'blocked', 'timed_out'].includes(task.status), budget,
  };
}

function internalStoppedPatch(task = {}, now = new Date().toISOString()) {
  const cancelled = String(task.status) === 'cancelled';
  const nextStatus = cancelled ? 'cancelled' : 'failed';
  const error = cancelled
    ? { code: 'CANCELLED', message: '本次内置任务已停止；未采用不完整结果，上一有效版本保持不变。' }
    : { code: 'INTERNAL_EXECUTION_INTERRUPTED', message: '上次内置任务因程序退出而停止；未采用不完整结果，上一有效版本保持不变。' };
  const next = { ...task, status: nextStatus, executor: 'internal', executionMode: 'internal', adapterId: 'internal',
    recoveryState: 'host_confirmed_stopped', recoveryReason: 'internal_runtime_not_present',
    recoveryCheckedAt: now, completedAt: cancelled ? task.completedAt || now : now, nextRetryAt: '', autoRetry: false,
    retryRecovery: null, error, executionProvenance: null, updatedAt: now };
  return { ...next, executionProvenance: executionProvenance(next), recoveryBudget: recoveryBudget(next, now), recoveryPlan: recoveryPlan(next, now) };
}

function closedManualPacketPatch(task = {}, now = new Date().toISOString()) {
  const next = { ...task, status: 'cancelled', recoveryState: 'manual_packet_closed', recoveryReason: 'manual_packet_not_claimed',
    recoveryCheckedAt: now, completedAt: task.completedAt || now, nextRetryAt: '', autoRetry: false, retryRecovery: null,
    error: { code: 'CANCELLED', message: '本次人工任务包已取消；系统未采用任何外部结果，已有有效版本保持不变。' }, updatedAt: now };
  return { ...next, executionProvenance: executionProvenance(next), recoveryBudget: recoveryBudget(next, now), recoveryPlan: recoveryPlan(next, now) };
}

function unknownRecoveryPlan(task = {}, now = new Date().toISOString()) {
  const plan = recoveryPlan(task, now);
  const budget = recoveryBudget(task, now);
  return {
    owner: plan.owner,
    attempt: budget.receiptQueries,
    maxAttempts: budget.limits.receiptQueries,
    nextCheckAt: plan.nextWakeAt || '',
    nextAction: plan.action,
  };
}

function confirmedStoppedPatch(task = {}, now = new Date().toISOString()) {
  const next = {
    ...task,
    status: 'cancelled',
    recoveryState: 'user_confirmed_stopped',
    recoveryReason: 'explicit_external_stop_confirmation',
    recoveryCheckedAt: now,
    completedAt: task.completedAt || now,
    nextRetryAt: '',
    autoRetry: false,
    retryRecovery: null,
    dispatchBlock: null,
    error: { code: 'CANCELLED', message: '已确认外部执行未发送或已经停止；不会采用迟到的不完整结果。' },
    updatedAt: now,
  };
  return { ...next, executionProvenance: executionProvenance(next), recoveryBudget: recoveryBudget(next, now), recoveryPlan: recoveryPlan(next, now) };
}

function lateReceiptPatch(task = {}, receipt = {}, now = new Date().toISOString()) {
  const executionId = String(receipt.executionId || '');
  if (!executionId || executionId !== String(task.executionId || '')) {
    throw Object.assign(new Error('迟到回执的执行批次与任务不一致。'), { code: 'EXECUTION_ID_MISMATCH' });
  }
  if (receipt.validation?.valid !== true && receipt.validation?.passed !== true) {
    throw Object.assign(new Error('迟到回执尚未通过业务校验。'), { code: 'LATE_RECEIPT_NOT_VALIDATED' });
  }
  const result = { ...(task.result || {}), ...receipt, executionId, status: 'succeeded', settledAt: now };
  const next = {
    ...task,
    status: 'succeeded',
    settlementState: 'settled',
    businessOutcome: 'completed',
    recoveryState: 'receipt_confirmed',
    recoveryReason: 'validated_late_receipt',
    recoveryCheckedAt: now,
    completedAt: task.completedAt || now,
    nextRetryAt: '',
    autoRetry: false,
    retryRecovery: null,
    dispatchBlock: null,
    error: null,
    result,
    updatedAt: now,
  };
  return { ...next, executionProvenance: executionProvenance(next), recoveryBudget: recoveryBudget(next, now), recoveryPlan: recoveryPlan(next, now) };
}

module.exports = {
  VERSION,
  DEFAULT_BUDGET,
  classifyRecoveryCause,
  closedManualPacketPatch,
  confirmedStoppedPatch,
  executionProvenance,
  internalStoppedPatch,
  lateReceiptPatch,
  providerLabel,
  recoveryBudget,
  recoveryPlan,
  taskExecutionClass,
  unknownRecoveryPlan,
};
