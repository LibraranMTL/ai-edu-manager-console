'use strict';
const { classifyTaskFailure } = require('./task-recovery-policy.cjs');
const COOLDOWN_MS = 10 * 60 * 1000;
function circuitDecision(state, now = Date.now()) {
  if (!state) return { allowed: true };
  if (state.phase === 'authorization') return { allowed: false, category: 'authorization', automaticProbe: true,
    reason: '后台授权需要恢复；下次执行前系统会先用合成资料自动检查' };
  if (state.phase === 'open' || state.phase === 'half_open') return { allowed: false,
    category: 'resource', automaticProbe: true,
    probeDue: state.phase === 'open' && Number.isFinite(Date.parse(state.until)) && Date.parse(state.until) <= now,
    reason: state.phase === 'half_open' ? '正在核对执行器健康状态' : '执行器暂时故障，已冷却，其他执行器可继续工作' };
  return { allowed: true };
}
function recordCircuitOutcome(state, { success, failure, executionId }, now = Date.now()) {
  if (!executionId || state?.lastExecutionId === executionId) return state;
  const base = { version: 1, lastExecutionId: executionId, updatedAt: new Date(now).toISOString() };
  if (success) return { ...base, phase: 'closed', failures: 0 };
  const category = classifyTaskFailure(failure || {});
  if (category === 'authorization') return { ...base, phase: 'authorization', failures: 0 };
  if (!['network', 'busy', 'rate_limit'].includes(category)) return state;
  const failures = Math.min(3, (Number(state?.failures) || 0) + 1);
  return { ...base, failures, phase: failures >= 3 ? 'open' : 'closed',
    until: failures >= 3 ? new Date(now + COOLDOWN_MS).toISOString() : '' };
}
function completeCircuitProbe(state, passed, now = Date.now()) {
  return { ...state, version: 1, phase: passed ? 'closed' : 'open', failures: passed ? 0 : 3,
    until: passed ? '' : new Date(now + COOLDOWN_MS).toISOString(), updatedAt: new Date(now).toISOString() };
}
module.exports = { circuitDecision, recordCircuitOutcome, completeCircuitProbe, COOLDOWN_MS };
