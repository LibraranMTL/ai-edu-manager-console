'use strict';

function resolveAutomationFeatureFlags(env = process.env) {
  return Object.freeze({
    workBuddyRuntimeStatusV2: env.EDU_DISABLE_WORKBUDDY_RUNTIME_STATUS_V2 !== '1',
    routingDecisionV2: env.EDU_DISABLE_ROUTING_DECISION_V2 !== '1',
    provisionalProjectInbox: env.EDU_DISABLE_PROVISIONAL_PROJECT_INBOX !== '1',
    backlogConvergence: env.EDU_DISABLE_BACKLOG_CONVERGENCE !== '1',
    digestArtifactRepair: env.EDU_DISABLE_DIGEST_ARTIFACT_REPAIR !== '1',
    // Historical originals are never scanned implicitly. This separate opt-in
    // keeps the helper contract available without turning a corrective update
    // into an unbounded backfill run.
    projectHistoryBackfill: env.EDU_ENABLE_PROJECT_HISTORY_BACKFILL === '1',
  });
}

module.exports = { resolveAutomationFeatureFlags };
