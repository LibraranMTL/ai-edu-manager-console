const CAPTURE_PROTOCOL_VERSION = 1;

const CAPTURE_POLICIES = Object.freeze({
  interval: {
    id: 'interval',
    name: '固定间隔',
    description: '按设定间隔保存，仍会跳过完全相同的画面。',
    sampleIntervalMs: 10000,
    minimumSaveIntervalMs: 5000,
    maximumSaveIntervalMs: 60000,
    visualChangeThreshold: 0,
  },
  change: {
    id: 'change',
    name: '内容变化',
    description: '检测到明显翻页、滚动或窗口内容变化后保存。',
    sampleIntervalMs: 2000,
    minimumSaveIntervalMs: 5000,
    maximumSaveIntervalMs: 120000,
    visualChangeThreshold: 0.16,
  },
  smart: {
    id: 'smart',
    name: '智能混合',
    description: '内容变化优先，并以最长间隔兜底，适合网课、PPT、教材和网页。',
    sampleIntervalMs: 2000,
    minimumSaveIntervalMs: 5000,
    maximumSaveIntervalMs: 90000,
    visualChangeThreshold: 0.12,
  },
});

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeCaptureOptions(input = {}) {
  const policy = CAPTURE_POLICIES[input.mode] || CAPTURE_POLICIES.smart;
  const sampleIntervalMs = clampNumber(input.sampleIntervalMs, 1000, 300000, policy.sampleIntervalMs);
  const minimumSaveIntervalMs = clampNumber(input.minimumSaveIntervalMs, 1000, 300000, Math.max(policy.minimumSaveIntervalMs, sampleIntervalMs));
  const maximumSaveIntervalMs = clampNumber(input.maximumSaveIntervalMs, minimumSaveIntervalMs, 30 * 60 * 1000, policy.maximumSaveIntervalMs);
  return {
    protocolVersion: CAPTURE_PROTOCOL_VERSION,
    mode: policy.id,
    policyName: policy.name,
    sampleIntervalMs,
    minimumSaveIntervalMs,
    maximumSaveIntervalMs,
    visualChangeThreshold: clampNumber(input.visualChangeThreshold, 0, 1, policy.visualChangeThreshold),
    durationMinutes: clampNumber(input.durationMinutes, 1, 8 * 60, 30),
    retainOriginal: input.retainOriginal !== false,
    autoRegisterAsset: input.autoRegisterAsset !== false,
  };
}

function signatureDifference(previous, current) {
  if (!previous || !current || previous.length !== current.length || !previous.length) return 1;
  let total = 0;
  for (let index = 0; index < previous.length; index += 1) {
    total += Math.abs(Number(previous[index]) - Number(current[index])) / 255;
  }
  return total / previous.length;
}

function captureSaveDecision(state = {}, input = {}) {
  const options = normalizeCaptureOptions(input.options || {});
  const now = Number(input.now || Date.now());
  const lastSavedAt = Number(state.lastSavedAt || 0);
  const elapsed = lastSavedAt ? now - lastSavedAt : Number.POSITIVE_INFINITY;
  const difference = signatureDifference(state.lastSavedSignature, input.signature);
  if (input.force) return { save: true, reason: input.highlight ? 'highlight' : 'manual', difference };
  if (elapsed < options.minimumSaveIntervalMs) return { save: false, reason: 'minimum_interval', difference };
  if (difference <= 0.003) return { save: false, reason: 'duplicate', difference };
  if (options.mode === 'interval') return { save: true, reason: 'interval', difference };
  if (difference >= options.visualChangeThreshold) return { save: true, reason: 'visual_change', difference };
  if (elapsed >= options.maximumSaveIntervalMs) return { save: true, reason: 'maximum_interval', difference };
  return { save: false, reason: 'below_threshold', difference };
}

module.exports = {
  CAPTURE_POLICIES,
  CAPTURE_PROTOCOL_VERSION,
  captureSaveDecision,
  normalizeCaptureOptions,
  signatureDifference,
};
