const fs = require('fs');
const path = require('path');

const CODEX_HOOK_ONBOARDING_SCHEMA = 'edu-manager.codex-hook-onboarding.v1';

function readJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function isoTimestamp(value = new Date().toISOString()) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeCodexHookOnboarding(value = {}) {
  return {
    schema: CODEX_HOOK_ONBOARDING_SCHEMA,
    hookIdentity: String(value.hookIdentity || ''),
    hookPath: String(value.hookPath || ''),
    configuredAt: String(value.configuredAt || ''),
    reviewOpenedAt: String(value.reviewOpenedAt || ''),
    reviewOpenedIdentity: String(value.reviewOpenedIdentity || ''),
    verifiedAt: String(value.verifiedAt || ''),
    verifiedIdentity: String(value.verifiedIdentity || ''),
    lastVerifiedEventAt: String(value.lastVerifiedEventAt || ''),
  };
}

function configureCodexHookOnboarding(filePath, options = {}) {
  const hookIdentity = String(options.hookIdentity || '').trim();
  if (!hookIdentity) throw new Error('Codex Hook 缺少稳定身份。');
  const previous = normalizeCodexHookOnboarding(readJson(filePath, {}));
  const sameIdentity = previous.hookIdentity === hookIdentity;
  const next = normalizeCodexHookOnboarding({
    ...(sameIdentity ? previous : {}),
    hookIdentity,
    hookPath: String(options.hookPath || previous.hookPath || ''),
    configuredAt: sameIdentity && previous.configuredAt
      ? previous.configuredAt
      : isoTimestamp(options.configuredAt),
  });
  if (JSON.stringify(next) !== JSON.stringify(previous)) writeJsonAtomic(filePath, next);
  return next;
}

function markCodexHookReviewOpened(filePath, options = {}) {
  const hookIdentity = String(options.hookIdentity || '').trim();
  const current = normalizeCodexHookOnboarding(readJson(filePath, {}));
  if (!hookIdentity || current.hookIdentity !== hookIdentity) return current;
  const next = normalizeCodexHookOnboarding({
    ...current,
    reviewOpenedAt: isoTimestamp(options.openedAt),
    reviewOpenedIdentity: hookIdentity,
  });
  writeJsonAtomic(filePath, next);
  return next;
}

function markCodexHookVerified(filePath, options = {}) {
  const hookIdentity = String(options.hookIdentity || '').trim();
  const current = normalizeCodexHookOnboarding(readJson(filePath, {}));
  if (!hookIdentity || current.hookIdentity !== hookIdentity) return { changed: false, state: current };
  const rawEventAt = String(options.eventAt || '');
  const capturedAt = Date.parse(rawEventAt);
  if (!Number.isFinite(capturedAt)) return { changed: false, state: current };
  const eventAt = new Date(capturedAt).toISOString();
  const configuredAt = Date.parse(current.configuredAt || '');
  if (!Number.isFinite(configuredAt) || !Number.isFinite(capturedAt) || capturedAt < configuredAt) {
    return { changed: false, state: current };
  }
  const wasVerified = current.verifiedIdentity === hookIdentity && Boolean(current.verifiedAt);
  const next = normalizeCodexHookOnboarding({
    ...current,
    verifiedAt: wasVerified ? current.verifiedAt : eventAt,
    verifiedIdentity: hookIdentity,
    lastVerifiedEventAt: eventAt,
  });
  if (JSON.stringify(next) !== JSON.stringify(current)) writeJsonAtomic(filePath, next);
  return { changed: !wasVerified, state: next };
}

function publicCodexHookOnboarding(filePath, options = {}) {
  const hookIdentity = String(options.hookIdentity || '').trim();
  const current = normalizeCodexHookOnboarding(readJson(filePath, {}));
  const configured = Boolean(options.configured && hookIdentity && current.hookIdentity === hookIdentity);
  const verified = configured && current.verifiedIdentity === hookIdentity && Boolean(current.verifiedAt);
  const reviewOpened = configured && current.reviewOpenedIdentity === hookIdentity && Boolean(current.reviewOpenedAt);
  const status = !configured
    ? 'not_configured'
    : verified
      ? 'verified'
      : reviewOpened
        ? 'waiting_for_event'
        : 'needs_confirmation';
  return {
    status,
    configured,
    verified,
    requiresConfirmation: status === 'needs_confirmation',
    reviewCommand: '/hooks',
    canOpenReview: Boolean(options.cliAvailable),
    hookIdentity,
    hookPath: current.hookPath,
    configuredAt: current.configuredAt,
    reviewOpenedAt: current.reviewOpenedAt,
    verifiedAt: current.verifiedAt,
    lastVerifiedEventAt: current.lastVerifiedEventAt,
  };
}

function quotePowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function buildCodexHookReviewPowerShell(cliPath, workingDirectory) {
  if (!String(cliPath || '').trim()) throw new Error('未找到 Codex CLI。');
  const cwd = String(workingDirectory || '').trim();
  return [
    "$Host.UI.RawUI.WindowTitle = 'AI教育管家 - Codex Hook 审查'",
    "Write-Host 'AI教育管家已复制 /hooks。请在 Codex CLI 中粘贴并回车，只需信任 EDU-MANAGER-LIFECYCLE 一次。' -ForegroundColor Cyan",
    cwd ? `Set-Location -LiteralPath ${quotePowerShellLiteral(cwd)}` : '',
    `& ${quotePowerShellLiteral(cliPath)}`,
  ].filter(Boolean).join('; ');
}

module.exports = {
  CODEX_HOOK_ONBOARDING_SCHEMA,
  buildCodexHookReviewPowerShell,
  configureCodexHookOnboarding,
  markCodexHookReviewOpened,
  markCodexHookVerified,
  normalizeCodexHookOnboarding,
  publicCodexHookOnboarding,
};
