'use strict';
const { agentBlockReason } = require('./agent-invocation-service.cjs');
const { recoveryPlan } = require('./task-recovery-experience.cjs');

// Explain failures without changing evidence, execution identity or authorizations.
function taskResolution(task = {}) {
  const message = String(task.error?.message || task.result?.validation?.message || '');
  const coded = task.error?.code ? agentBlockReason(task.error.code, message) : null;
  const plan = recoveryPlan(task);
  if (task.status === 'succeeded' || (task.status === 'cancelled' && task.recoveryState !== 'unknown')) return null;
  if (/executionId|执行批次不一致|执行批次.*不匹配/i.test(message)) return {
    kind: 'stale_result', title: '结果属于其他执行批次',
    instruction: '旧结果未应用。请核对当前批次后导入对应结果；不要修改结果中的批次编号，也不要重复启动仍在执行的任务。',
    retrySafe: false,
  };
  if (/观察项不能写成正式定论/.test(message)) return {
    kind: 'evidence_quality', title: '报告草稿需要修订，不是登录故障',
    instruction: '请让原 Agent 修订报告：将提示的观察项明确标为待观察，不得写成已经具备的能力。保留证据 ID 和来源版本，再执行校验。不要反复更换执行器。',
    retrySafe: false,
  };
  if (/未知内部操作.*topic_suggestion_refresh/.test(message)) return {
    kind: 'topic_handler', title: '旧版本缺少选题更新入口',
    instruction: '此版本已补齐入口。可点击重新执行更新选题建议；不会形成正式成长结论。已忽略的任务不会自动重跑。',
    retrySafe: true,
  };
  if (/authentication|required.*login|登录|unauthorized/i.test(message)) return {
    kind: 'authorization', title: '执行器需要重新登录',
    instruction: '资料已保留。请在对应 Agent 中登录后重新启动本次任务；系统会先自动安全校验，通过后才发送资料。',
    retrySafe: false,
  };
  if (coded && coded.code !== 'UNCLASSIFIED') return {
    kind: coded.category, title: ({ qualification: '等待自动安全校验', resource: '等待后台资源', source: '资料来源需要处理', security: '需要人工安全确认' })[coded.category] || '任务需要处理',
    instruction: coded.action, retrySafe: coded.automatic, owner: coded.automatic ? 'system' : 'user', plan,
  };
  if (task.recoveryState === 'unknown') return {
    kind: 'unknown',
    title: plan.state === 'automatic' ? '系统正在自动核对' : `需要在 ${plan.providerLabel} 确认一次`,
    instruction: [plan.summary, plan.nextAction].filter(Boolean).join(' '),
    retrySafe: false,
    owner: plan.owner,
    plan,
  };
  return null;
}

function resultIdentityFeedback(task, payload, identity) {
  const mismatch = task && payload && String(payload.executionId || '') !== String(task.executionId || '');
  return { ok: false, accepted: false, rejected: true, code: identity.code,
    message: mismatch
      ? `${identity.message} 这份结果未导入，粘贴内容已保留。请导入当前批次的结果；不要修改旧结果编号或重复启动任务。`
      : `${identity.message} 未更改任务状态，粘贴内容已保留。`,
    // Only return identifiers for the already-authorized task, not foreign payload details.
    expectedExecutionId: String(task?.executionId || ''),
  };
}

module.exports = { taskResolution, resultIdentityFeedback };
