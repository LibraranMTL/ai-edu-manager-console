'use strict';

const MAX_ROUTE_ATTEMPTS = 8;
const QUALIFICATION_TTL_MS = 7 * 24 * 60 * 60_000;

function normalizeCaptureVisionConsent(value = {}) {
  const enabled = value.enabled === true && ['automatic', 'codex'].includes(String(value.provider || ''));
  return {
    enabled,
    provider: enabled ? 'automatic' : '',
    processingLocation: enabled ? '按 AI 接入与调度中心顺序选择，并记录实际处理位置' : '',
    authorizedAt: enabled ? String(value.authorizedAt || '') : '',
    epoch: enabled ? String(value.epoch || '') : '',
  };
}

function currentQualification(value, providerId, nowMs) {
  if (!value || value.providerId !== providerId || value.status !== 'passed'
    || value.readOnlyIsolation !== 'verified' || value.supportsImageAttachments !== true
    || !value.processingLocation || value.processingLocation === 'unknown') return null;
  const verifiedAt = Date.parse(value.verifiedAt || '');
  if (!Number.isFinite(verifiedAt) || verifiedAt > nowMs || nowMs - verifiedAt > QUALIFICATION_TTL_MS) return null;
  return value;
}

function selectCaptureVisionRoute({ orderedProviders = [], capabilities = {}, qualifications = {}, llmApi = null, now = Date.now() } = {}) {
  const order = [...new Set([...orderedProviders.map(String), ...Object.keys(capabilities)])];
  const routes = [];
  for (const providerId of order) {
    const capability = capabilities[providerId] || {};
    if (!capability.available || !capability.authorized || capability.automatic === false) continue;
    if (providerId === 'llm-api') {
      const checked = llmApi?.configured === true && llmApi.lastCheck?.ok === true
        && llmApi.runtimeHash && llmApi.lastCheck.runtimeHash === llmApi.runtimeHash;
      if (!checked) continue;
      routes.push({ providerId, mode: 'llm-api', processingLocation: 'configured_llm_api' });
      continue;
    }
    if (providerId === 'codex') {
      if (!capability.exePath) continue;
      routes.push({ providerId, mode: 'codex-cli', processingLocation: 'codex_service' });
      continue;
    }
    const qualification = currentQualification(qualifications[providerId], providerId, Number(now));
    if (!qualification) continue;
    routes.push({ providerId, mode: 'qualified-agent', processingLocation: qualification.processingLocation });
  }
  return routes;
}

function attemptRecord(route, stage, error = null) {
  return {
    providerId: String(route.providerId || ''),
    mode: String(route.mode || ''),
    processingLocation: String(route.processingLocation || ''),
    stage,
    ...(error ? { code: String(error.code || 'VISION_ROUTE_FAILED').slice(0, 100) } : {}),
  };
}

async function executeCaptureVisionRoute(routes, execute) {
  const attempts = [];
  for (const route of Array.isArray(routes) ? routes : []) {
    try {
      const result = await execute(route);
      attempts.push(attemptRecord(route, 'result_received'));
      return {
        ...result,
        providerId: route.providerId,
        processingLocation: route.processingLocation,
        routeAttempts: attempts.slice(-MAX_ROUTE_ATTEMPTS),
      };
    } catch (error) {
      const stage = String(error.stage || 'possibly_sent');
      attempts.push(attemptRecord(route, stage, error));
      error.routeAttempts = attempts.slice(-MAX_ROUTE_ATTEMPTS);
      error.providerId = route.providerId;
      error.processingLocation = route.processingLocation;
      if (stage !== 'not_sent') throw error;
    }
  }
  const error = Object.assign(Error('没有已联通且通过视觉只读合同的 Agent 或 LLM API'), {
    code: 'VISION_PROVIDER_UNAVAILABLE', stage: 'not_sent', routeAttempts: attempts.slice(-MAX_ROUTE_ATTEMPTS),
  });
  throw error;
}

module.exports = {
  MAX_ROUTE_ATTEMPTS,
  QUALIFICATION_TTL_MS,
  executeCaptureVisionRoute,
  normalizeCaptureVisionConsent,
  selectCaptureVisionRoute,
};
