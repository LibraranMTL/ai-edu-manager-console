'use strict';

const CLASSIFICATION_PROFILE = 'classification_readonly.v1';
const DIGEST_PROFILE = 'digest_host_mediated.v1';
const LEARNING_CARD_PROFILE = 'learning_card_generation.v1';
const crypto = require('node:crypto');

function classificationRoute(student) {
  const primary = String(student?.agentTool || '');
  const policy = student?.classificationFallback || {};
  const providers = [primary];
  if (policy.enabled === true && ['codex', 'workbuddy'].includes(policy.providerId) && policy.providerId !== primary) providers.push(policy.providerId);
  return { providers, policyVersion: Number(policy.version || 0) };
}

function classificationIdentity(adapter, runtimeHash) {
  return crypto.createHash('sha256').update(JSON.stringify({ provider: adapter.id, profile: CLASSIFICATION_PROFILE,
    runtimeHash, executable: adapter.executable || adapter.runtime?.cliPath, node: adapter.runtime?.nodePath,
    product: adapter.runtime?.productConfigPath, authScope: adapter.authScope || adapter.runtime?.configDir || '',
    authVersion: adapter.authVersion || 0, providerRuntime: adapter.runtimeHash || '',
    contract: 'routing-recovery-v2', isolation: 'host-mediated-no-tools' })).digest('hex');
}

function classificationBlock(error, execution = {}) {
  const code = error.code || 'AGENT_QUALIFICATION_REQUIRED';
  return { code, category: execution.stage === 'possibly_sent' ? 'unknown'
    : code === 'SENSITIVE_REVIEW_REQUIRED' ? 'security' : ['EXECUTOR_CIRCUIT_OPEN', 'RESOURCE_BUSY', 'ECONNRESET', 'ETIMEDOUT', '429', '503'].includes(code) ? 'resource' : 'agent',
    providerId: execution.providerId || error.providerId || '', stage: execution.stage || 'qualifying',
    recoverable: execution.stage !== 'possibly_sent' && code !== 'SENSITIVE_REVIEW_REQUIRED',
    attemptId: execution.attemptId || '', message: error.message || 'Agent 暂不可用', at: new Date().toISOString() };
}
function classificationSavedStatus(status, adapter, saved, now = Date.now()) {
  if (!adapter || adapter.unavailable || saved?.runtimeScope !== classificationIdentity(adapter, '')) return status;
  if (Date.parse(saved.expiresAt) <= now && saved.ready === true) return { ...status, state: 'channel_ready', automaticReady: false,
    message: '连接仍有效；执行前自动复核任务合同，无需重新登录。' };
  if (Date.parse(saved.expiresAt) <= now) return { ...status, state: saved.code === 'AUTHENTICATION_REQUIRED' ? 'login_required' : 'qualification_required', automaticReady: false,
    message: saved.message || '执行前将自动复核任务合同。' };
  return { ...status, state: saved.ready ? 'ready' : saved.code === 'AUTHENTICATION_REQUIRED' ? 'login_required' : 'qualification_required',
    automaticReady: saved.ready === true, message: saved.ready ? '本机分类通道可用，已授权学生共用登录，无需重复授权。' : saved.message };
}
function classificationRouteStatus(primary, fallback) {
  if (!primary.fallback?.enabled || !fallback || !['ready', 'channel_ready', 'qualification_required'].includes(fallback.state)
    || primary.state === 'ready') return { ...primary, fallbackStatus: fallback || null, effectiveProviderId: primary.providerId };
  return { ...primary, primaryState: primary.state, fallbackStatus: fallback, effectiveProviderId: fallback.providerId,
    state: fallback.state, automaticReady: fallback.automaticReady,
    message: `${fallback.label}备用${fallback.state === 'ready' ? '可用' : fallback.state === 'channel_ready' ? '连接有效，执行前自动复核' : '将在分析时自动校验'}，无需切换学生后重新登录。主Agent恢复后可继续使用。` };
}

function providerSupportsProfile(providerId, profile, registry) {
  return require('./ai-executor-registry.cjs').supportsProfile(String(providerId || ''), profile, registry);
}

function createAgentQualification({ providerId, profile, runtimeHash, ready, mode = '', message = '', measuredAt = new Date().toISOString(), ttlMs = 30 * 60 * 1000 } = {}) {
  const measured = Date.parse(measuredAt);
  return {
    providerId: String(providerId || ''), profile: String(profile || ''), runtimeHash: String(runtimeHash || ''),
    ready: ready === true, mode: String(mode || ''), message: String(message || ''), measuredAt,
    expiresAt: new Date((Number.isFinite(measured) ? measured : Date.now()) + Math.max(60_000, Number(ttlMs || 0))).toISOString(),
  };
}

function validAgentQualification(record, { providerId, profile, runtimeHash, now = Date.now() } = {}) {
  return Boolean(record && record.ready === true
    && String(record.providerId || '') === String(providerId || '')
    && String(record.profile || '') === String(profile || '')
    && String(record.runtimeHash || '') === String(runtimeHash || '')
    && Date.parse(record.expiresAt || '') > Number(now));
}

const BLOCK_REASONS = Object.freeze({
  AUTHENTICATION_REQUIRED: { category: 'authorization', automatic: false, action: '请在对应 Agent 完成后台登录后重新启动任务；系统会自动安全校验。' },
  WORKBUDDY_QUALIFICATION_REQUIRED: { category: 'qualification', automatic: true, action: '系统将在资源空闲时使用合成资料重新检测；不会发送学生正文。' },
  EXECUTOR_CIRCUIT_OPEN: { category: 'resource', automatic: true, action: '系统冷却后自动恢复，不需要重复点击。' },
  RESOURCE_BUSY: { category: 'resource', automatic: true, action: '已保留队列位置，后台空闲后继续。' },
  MATERIAL_PREFLIGHT_BLOCKED: { category: 'source', automatic: false, action: '请恢复原件或在资料路径预检中重新选择文件。' },
  SENSITIVE_REVIEW_REQUIRED: { category: 'security', automatic: false, action: '敏感资料必须人工确认，不会自动重试或降低隔离。' },
  EXECUTION_UNRESOLVED: { category: 'unknown', automatic: false, action: '先核对原执行和回执，不能重复派发同一批资料。' },
});

function agentBlockReason(code, fallback = '') {
  const normalized = String(code || '').toUpperCase();
  const rule = BLOCK_REASONS[normalized] || { category: 'business', automatic: false, action: String(fallback || '请查看任务详情后处理。') };
  return { code: normalized || 'UNCLASSIFIED', ...rule };
}

function agentProfileStatus({ providerId, profile, capability = {}, circuit = null, qualification = null } = {}) {
  providerId = String(providerId || '');
  const label = String(capability.label || providerId || 'Agent');
  const supported = providerSupportsProfile(providerId, profile);
  const installed = Boolean(capability.available && (providerId !== 'codex' || capability.exePath));
  const authorized = Boolean(capability.authorized);
  const circuitPhase = String(circuit?.phase || 'closed');
  const base = { providerId, profile, label, supported, installed, authorized, circuitPhase, automaticReady: false };
  if (!supported) return { ...base, state: 'unsupported', message: `${label} 尚未通过此类受控任务验证；资料会保留，不会自动交给该 Agent。` };
  if (!installed) return { ...base, state: 'unavailable', message: `未找到可用的 ${label} 受控执行器。` };
  if (!authorized) return { ...base, state: 'login_required', message: `${label} 后台尚未登录；请在官方 Agent 中登录，重新执行资料任务时系统会自动检查。` };
  if (circuitPhase === 'authorization') return { ...base, state: 'qualification_required', message: `${label} 已登录；下次分析前系统会自动使用合成资料完成安全校验，无需单独检测。` };
  if (['open', 'half_open'].includes(circuitPhase)) return { ...base, state: 'cooldown', message: circuitPhase === 'half_open' ? `${label} 正在核对健康状态。` : `${label} 暂时冷却，资料已保留，稍后可重新检测。` };
  if (providerId === 'workbuddy' && qualification?.ready === true && Date.parse(qualification.expiresAt || '') <= Date.now()) {
    return { ...base, state: 'channel_ready', message: 'WorkBuddy 连接仍有效；执行前自动复核任务合同，无需重新登录。' };
  }
  if (providerId === 'workbuddy' && (!qualification || qualification.ready !== true)) {
    return { ...base, state: 'qualification_required', message: qualification?.message || 'WorkBuddy 已登录；下次资料任务会自动完成受控能力校验。' };
  }
  return { ...base, state: 'ready', automaticReady: true, message: `${label} 已登录且受控能力可用。` };
}

module.exports = {
  classificationRoute, classificationIdentity, classificationBlock, classificationSavedStatus, classificationRouteStatus,
  CLASSIFICATION_PROFILE,
  DIGEST_PROFILE,
  LEARNING_CARD_PROFILE,
  providerSupportsProfile,
  agentProfileStatus,
  createAgentQualification,
  validAgentQualification,
  agentBlockReason,
};
