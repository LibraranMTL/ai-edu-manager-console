'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CLASSIFICATION_PROFILE, DIGEST_PROFILE, LEARNING_CARD_PROFILE, providerSupportsProfile, agentProfileStatus,
  createAgentQualification, validAgentQualification, agentBlockReason } = require('../electron/agent-invocation-service.cjs');

test('task profiles only enable explicitly qualified providers', () => {
  assert.equal(providerSupportsProfile('workbuddy', CLASSIFICATION_PROFILE), true);
  assert.equal(providerSupportsProfile('workbuddy', DIGEST_PROFILE), true);
  assert.equal(providerSupportsProfile('workbuddy', LEARNING_CARD_PROFILE), true);
  assert.equal(providerSupportsProfile('llm-api', CLASSIFICATION_PROFILE), true);
  assert.equal(providerSupportsProfile('llm-api', DIGEST_PROFILE), true);
  assert.equal(providerSupportsProfile('llm-api', LEARNING_CARD_PROFILE), true);
  assert.equal(providerSupportsProfile('trae', DIGEST_PROFILE), true);
  assert.equal(providerSupportsProfile('qoder-work', LEARNING_CARD_PROFILE), true);
});

test('logged-in authorization circuit is explained as qualification, not another login', () => {
  const status = agentProfileStatus({ providerId: 'codex', profile: CLASSIFICATION_PROFILE,
    capability: { available: true, authorized: true, exePath: 'codex.exe', label: 'Codex' }, circuit: { phase: 'authorization' } });
  assert.equal(status.state, 'qualification_required');
  assert.equal(status.automaticReady, false);
  assert.match(status.message, /已登录/);
  assert.doesNotMatch(status.message, /重新登录/);
});

test('closed qualified providers expose only their registered task profiles', () => {
  assert.equal(agentProfileStatus({ providerId: 'workbuddy', profile: DIGEST_PROFILE,
    capability: { available: true, authorized: true, label: 'WorkBuddy' }, circuit: { phase: 'closed' }, qualification: { ready: true } }).state, 'ready');
  assert.equal(agentProfileStatus({ providerId: 'qoder-work', profile: DIGEST_PROFILE,
    capability: { available: true, authorized: true, label: 'Qoder' } }).state, 'ready');
  assert.equal(agentProfileStatus({ providerId: 'qoder-work', profile: 'research.v1',
    capability: { available: true, authorized: true, label: 'Qoder' } }).state, 'unsupported');
});

test('learning-card generation uses the same circuit and heavy-work admission', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const start = main.indexOf('async function generateLearningCardThroughControl(');
  const end = main.indexOf('let practiceTaskHost;', start);
  const body = main.slice(start, end);
  assert.match(body, /LEARNING_CARD_PROFILE/);
  assert.match(body, /runtime\?\.circuits\?\.codex/);
  assert.match(body, /captureHeavyWorkGate\.tryAcquire/);
  assert.match(body, /createLlmApiStructuredGenerator/);
  assert.match(body, /workBuddyQualification\.checkProfile\(connected\.runtime, LEARNING_CARD_PROFILE\)/);
  assert.match(body, /createWorkBuddyStructuredAdapter/);
  assert.match(body, /finally \{ release\(\); \}/);
});

test('qualification is bound to provider, profile, runtime hash and expiry', () => {
  const measuredAt = '2026-10-13T10:00:00.000Z';
  const value = createAgentQualification({ providerId: 'workbuddy', profile: DIGEST_PROFILE, runtimeHash: 'abc', ready: true, measuredAt, ttlMs: 60000 });
  assert.equal(validAgentQualification(value, { providerId: 'workbuddy', profile: DIGEST_PROFILE, runtimeHash: 'abc', now: Date.parse(measuredAt) + 59999 }), true);
  assert.equal(validAgentQualification(value, { providerId: 'workbuddy', profile: CLASSIFICATION_PROFILE, runtimeHash: 'abc', now: Date.parse(measuredAt) }), false);
  assert.equal(validAgentQualification(value, { providerId: 'workbuddy', profile: DIGEST_PROFILE, runtimeHash: 'changed', now: Date.parse(measuredAt) }), false);
  assert.equal(validAgentQualification(value, { providerId: 'workbuddy', profile: DIGEST_PROFILE, runtimeHash: 'abc', now: Date.parse(measuredAt) + 60001 }), false);
});

test('block reasons distinguish automatic recovery from required human safety decisions', () => {
  assert.equal(agentBlockReason('RESOURCE_BUSY').automatic, true);
  assert.equal(agentBlockReason('WORKBUDDY_QUALIFICATION_REQUIRED').category, 'qualification');
  assert.match(agentBlockReason('AUTHENTICATION_REQUIRED').action, /重新启动任务.*自动安全校验/);
  assert.equal(agentBlockReason('SENSITIVE_REVIEW_REQUIRED').automatic, false);
  assert.equal(agentBlockReason('EXECUTION_UNRESOLVED').category, 'unknown');
});
