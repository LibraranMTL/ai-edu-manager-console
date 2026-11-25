'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAutomationFeatureFlags } = require('../electron/automation-feature-flags.cjs');

test('automation phases are independently enabled by default and can be rolled back', () => {
  assert.deepEqual(resolveAutomationFeatureFlags({}), {
    workBuddyRuntimeStatusV2: true,
    routingDecisionV2: true,
    inboxAutomaticTriage: true,
    inboxEventRecovery: true,
    inboxLearnedRules: true,
    provisionalProjectInbox: true,
    backlogConvergence: true,
    digestArtifactRepair: true,
    projectHistoryBackfill: false,
  });
  assert.deepEqual(resolveAutomationFeatureFlags({
    EDU_DISABLE_WORKBUDDY_RUNTIME_STATUS_V2: '1',
    EDU_DISABLE_ROUTING_DECISION_V2: '0',
    EDU_DISABLE_PROVISIONAL_PROJECT_INBOX: '1',
    EDU_DISABLE_BACKLOG_CONVERGENCE: '1',
  }), {
    workBuddyRuntimeStatusV2: false,
    routingDecisionV2: true,
    inboxAutomaticTriage: true,
    inboxEventRecovery: true,
    inboxLearnedRules: true,
    provisionalProjectInbox: false,
    backlogConvergence: false,
    digestArtifactRepair: true,
    projectHistoryBackfill: false,
  });
  assert.equal(resolveAutomationFeatureFlags({ EDU_DISABLE_DIGEST_ARTIFACT_REPAIR: '1' }).digestArtifactRepair, false);
  assert.equal(resolveAutomationFeatureFlags({ EDU_ENABLE_PROJECT_HISTORY_BACKFILL: '1' }).projectHistoryBackfill, true);
});
