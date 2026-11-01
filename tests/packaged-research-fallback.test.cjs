'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKBUDDY_PROCESS_GAP_MS,
  WORKBUDDY_RESEARCH_TIMEOUT_MS,
  fallbackDecision,
  minimalWorkBuddyFallbackProbe,
  readQualificationCache,
  resolvePackagedModuleRoot,
  summarizeFallbackRuns,
  waitForWorkBuddyProcessGap,
} = require('../scripts/verify-packaged-research-fallback.cjs');

test('model configuration failure is a verified not-sent fallback condition', () => {
  const decision = fallbackDecision({
    code: 'AGENT_MODEL_UNAVAILABLE', stage: 'not_sent', providerFailure: 'model_configuration',
  }, ['codex', 'workbuddy']);
  assert.deepEqual(decision, {
    safe: true,
    from: 'codex',
    to: 'workbuddy',
    reason: 'model_configuration',
  });
});

test('unknown or possibly sent failure never switches provider', () => {
  for (const failure of [
    { code: 'RESEARCH_TIMEOUT', stage: 'unknown' },
    { code: 'AGENT_MODEL_UNAVAILABLE', stage: 'possibly_sent' },
  ]) {
    assert.deepEqual(fallbackDecision(failure, ['codex', 'workbuddy']), {
      safe: false, from: 'codex', to: '', reason: failure.code,
    });
  }
});

test('packaged module root accepts the frozen staging tree used to build the candidate', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-packaged-module-root-'));
  fs.mkdirSync(path.join(root, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(root, 'electron', 'planning-research.cjs'), 'module.exports = {};\n');
  assert.equal(resolvePackagedModuleRoot(root), root);
});

test('packaged fallback honors the production WorkBuddy process recovery gap', async () => {
  const sleeps = [];
  assert.equal(WORKBUDDY_PROCESS_GAP_MS, 30_000);
  const waitedMs = await waitForWorkBuddyProcessGap(1_000, {
    gapMs: WORKBUDDY_PROCESS_GAP_MS,
    now: () => 6_000,
    sleep: async ms => sleeps.push(ms),
  });
  assert.equal(waitedMs, 25_000);
  assert.deepEqual(sleeps, [25_000]);
});

test('packaged fallback uses the production WorkBuddy research timeout', () => {
  assert.equal(WORKBUDDY_RESEARCH_TIMEOUT_MS, 300_000);
});

test('packaged fallback uses a bounded one-source WebSearch probe', () => {
  const probe = minimalWorkBuddyFallbackProbe();
  assert.match(probe.prompt, /IANA example domains/);
  assert.deepEqual(probe.schema.properties.sources.items.properties.url.enum,
    ['https://www.iana.org/help/example-domains']);
  assert.equal(probe.schema.properties.sources.minItems, 1);
  assert.equal(probe.schema.properties.sources.maxItems, 1);
});

test('packaged fallback reuses only a fresh research qualification cache', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-workbuddy-qualification-cache-'));
  const file = path.join(root, 'qualification.json');
  fs.writeFileSync(file, JSON.stringify({ ready: true, profile: 'research.v1', runtimeHash: 'abc',
    expiresAt: '2026-11-01T01:00:00.000Z' }));
  assert.equal(readQualificationCache(file, { now: () => Date.parse('2026-11-01T00:00:00.000Z') }).runtimeHash, 'abc');
  assert.equal(readQualificationCache(file, { now: () => Date.parse('2026-11-01T02:00:00.000Z') }), null);
});

test('C4 summary requires three runs and at least two verified fallback successes', () => {
  const success = { passed: true, syntheticOnly: true, studentDataRead: false,
    fallback: { safe: true, from: 'codex', to: 'workbuddy' }, resolution: 'fallback_succeeded' };
  const failed = { ...success, passed: false, resolution: '' };
  assert.equal(summarizeFallbackRuns([success, success, failed]).passed, true);
  assert.equal(summarizeFallbackRuns([success, failed, failed]).passed, false);
  assert.equal(summarizeFallbackRuns([success, success]).passed, false);
});
