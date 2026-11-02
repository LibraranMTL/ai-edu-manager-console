'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  executeCaptureVisionRoute,
  normalizeCaptureVisionConsent,
  selectCaptureVisionRoute,
} = require('../electron/capture-vision-routing.cjs');

function verified(providerId, processingLocation = `${providerId}_service`) {
  return {
    providerId,
    status: 'passed',
    readOnlyIsolation: 'verified',
    supportsImageAttachments: true,
    processingLocation,
    verifiedAt: new Date().toISOString(),
  };
}

test('screen capture follows configured order for connected vision-capable providers', () => {
  const routes = selectCaptureVisionRoute({
    orderedProviders: ['workbuddy', 'llm-api', 'codex'],
    capabilities: {
      workbuddy: { available: true, authorized: true },
      'llm-api': { available: true, authorized: true },
      codex: { available: true, authorized: true, exePath: 'codex.exe' },
    },
    qualifications: { workbuddy: verified('workbuddy', 'workbuddy_desktop') },
    llmApi: { configured: true, runtimeHash: 'abc', lastCheck: { ok: true, runtimeHash: 'abc' } },
  });
  assert.deepEqual(routes.map((item) => item.providerId), ['workbuddy', 'llm-api', 'codex']);
});

test('provider without a current explicit image contract is skipped', () => {
  const routes = selectCaptureVisionRoute({
    orderedProviders: ['workbuddy', 'llm-api', 'codex'],
    capabilities: {
      workbuddy: { available: true, authorized: true },
      'llm-api': { available: true, authorized: true },
      codex: { available: true, authorized: true, exePath: 'codex.exe' },
    },
    qualifications: { workbuddy: { ...verified('workbuddy'), supportsImageAttachments: false } },
    llmApi: { configured: true, runtimeHash: 'abc', lastCheck: { ok: true, runtimeHash: 'abc' } },
  });
  assert.deepEqual(routes.map((item) => item.providerId), ['llm-api', 'codex']);
});

test('legacy codex consent becomes automatic without changing the consent boundary', () => {
  const previous = { enabled: true, provider: 'codex', authorizedAt: '2026-10-01T01:02:03.000Z', epoch: 'epoch-1' };
  const consent = normalizeCaptureVisionConsent(previous);
  assert.equal(consent.provider, 'automatic');
  assert.equal(consent.authorizedAt, previous.authorizedAt);
  assert.equal(consent.epoch, previous.epoch);
});

test('route falls through only when the prior provider proves nothing was sent', async () => {
  const routes = [{ providerId: 'workbuddy' }, { providerId: 'llm-api' }];
  const result = await executeCaptureVisionRoute(routes, async (route) => {
    if (route.providerId === 'workbuddy') throw Object.assign(Error('not ready'), { code: 'NOT_READY', stage: 'not_sent' });
    return { output: '{"ok":true}' };
  });
  assert.equal(result.providerId, 'llm-api');
  assert.deepEqual(result.routeAttempts.map((item) => [item.providerId, item.stage]), [
    ['workbuddy', 'not_sent'], ['llm-api', 'result_received'],
  ]);
});

test('possibly sent visual request never falls through to another provider', async () => {
  const calls = [];
  await assert.rejects(executeCaptureVisionRoute([
    { providerId: 'workbuddy' }, { providerId: 'llm-api' },
  ], async (route) => {
    calls.push(route.providerId);
    throw Object.assign(Error('timeout after send'), { code: 'VISION_TIMEOUT_UNKNOWN', stage: 'possibly_sent' });
  }), (error) => {
    assert.equal(error.code, 'VISION_TIMEOUT_UNKNOWN');
    assert.deepEqual(error.routeAttempts.map((item) => item.providerId), ['workbuddy']);
    return true;
  });
  assert.deepEqual(calls, ['workbuddy']);
});
