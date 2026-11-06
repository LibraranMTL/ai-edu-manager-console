package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class AutomationOrchestrationPolicyTest {
    @Test fun triggerMatrixSeparatesOffConservativeAndFullModes() {
        assertTrue(AutomationTriggerPolicy.actions(AutomationEventType.DIGEST_COMPLETED, AutomationMode.OFF).isEmpty())
        assertEquals(
            listOf(AutomationAction.VALIDATE_FACTS, AutomationAction.GENERATE_LEARNING_OUTPUTS),
            AutomationTriggerPolicy.actions(AutomationEventType.DIGEST_COMPLETED, AutomationMode.CONSERVATIVE),
        )
        assertEquals(
            listOf(AutomationAction.VALIDATE_FACTS, AutomationAction.GENERATE_LEARNING_OUTPUTS, AutomationAction.GENERATE_REPORTS),
            AutomationTriggerPolicy.actions(AutomationEventType.DIGEST_COMPLETED, AutomationMode.FULL),
        )
        assertEquals(listOf(AutomationAction.GENERATE_PROJECT_OUTPUTS),
            AutomationTriggerPolicy.actions(AutomationEventType.PROJECT_SNAPSHOT_CHANGED, AutomationMode.FULL))
        assertEquals(listOf(AutomationAction.RECONCILE_ALL),
            AutomationTriggerPolicy.actions(AutomationEventType.DAILY_RECONCILIATION, AutomationMode.OFF))
    }

    @Test fun transientFailuresUseBoundedFiveThirtyAndTwoHourBackoff() {
        val now = 1_800_000_000_000L
        val first = AutomationFailurePolicy.decide(IOException("offline"), 1, 4, now)
        val second = AutomationFailurePolicy.decide(IOException("offline"), 2, 4, now)
        val third = AutomationFailurePolicy.decide(IOException("offline"), 3, 4, now)
        assertEquals(AutomationFailureClass.TRANSIENT, first.classification)
        assertEquals(java.time.Instant.ofEpochMilli(now + 5 * 60_000).toString(), first.nextRetryAt)
        assertEquals(java.time.Instant.ofEpochMilli(now + 30 * 60_000).toString(), second.nextRetryAt)
        assertEquals(java.time.Instant.ofEpochMilli(now + 2 * 60 * 60_000).toString(), third.nextRetryAt)
        assertTrue(first.autoRetry); assertFalse(first.attentionRequired)
    }

    @Test fun unknownResultsAreProbedButNeverBlindlyRetried() {
        val failure = AutomationFailurePolicy.decide(IllegalStateException("模型请求结果未知，可能已计费"), 1, 4)
        assertEquals(AutomationFailureClass.EXECUTION_UNKNOWN, failure.classification)
        assertTrue(failure.resultUnknown); assertFalse(failure.autoRetry); assertFalse(failure.attentionRequired)
        val task = automationTask("waiting_result", false, 1, 4, "")
            .put("startedAt", "2999-01-01T00:00:00Z")
        assertEquals(AutomationReconciliationDecision.PROBE_UNKNOWN, AutomationReconciliationPolicy.decide(task))
        task.put("startedAt", "2000-01-01T00:00:00Z")
        assertEquals(AutomationReconciliationDecision.NEEDS_ATTENTION, AutomationReconciliationPolicy.decide(task))
    }

    @Test fun onlyExhaustedOrUnrecoverableFailuresNeedAttention() {
        val inputFirst = AutomationFailurePolicy.decide(IllegalArgumentException("文件损坏"), 1, 4)
        val inputSecond = AutomationFailurePolicy.decide(IllegalArgumentException("文件损坏"), 2, 4)
        assertTrue(inputFirst.autoRetry); assertFalse(inputFirst.attentionRequired)
        assertFalse(inputSecond.autoRetry); assertTrue(inputSecond.attentionRequired)
        assertEquals(AutomationReconciliationDecision.NEEDS_ATTENTION,
            AutomationReconciliationPolicy.decide(automationTask("failed", true, 4, 4, "")))
        assertEquals(AutomationReconciliationDecision.NONE,
            AutomationReconciliationPolicy.decide(automationTask("failed", true, 1, 4, "2999-01-01T00:00:00Z")))
        assertEquals(AutomationReconciliationDecision.REQUEUE,
            AutomationReconciliationPolicy.decide(automationTask("failed", true, 1, 4, "2000-01-01T00:00:00Z")))
    }

    private fun automationTask(status: String, retry: Boolean, attempt: Int, max: Int, next: String) = JSONObject()
        .put("kind", "automation_generate_learning_outputs").put("status", status).put("autoRetry", retry)
        .put("attempt", attempt).put("maxAttempts", max).put("nextRetryAt", next).put("error", JSONObject())
}
