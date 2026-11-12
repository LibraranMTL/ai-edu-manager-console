package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AutomationEventRecoveryPolicyTest {
    @Test fun supersededFailureKeepsHistoryAndLeavesAttentionQueue() {
        val task = TaskProtocol.envelope(JSONObject().put("status", "archived")
            .put("error", JSONObject().put("attentionRequired", true).put("message", "old failure"))
            .put("result", JSONObject().put("supersededReceipt", JSONObject().put("replacementFingerprint", "batch"))))
        assertEquals("superseded", TaskCenterPolicy.viewState(task))
        assertEquals("old failure", task.getJSONObject("error").getString("message"))
    }
    @Test fun observationDraftRequiresSameStudentOriginalHashAndVerbatimExcerpt() {
        val evidence = JSONObject().put("studentId", "s1").put("status", "watching")
            .put("sourceUri", "edu://student/s1/raw/m1").put("content", "观察\n\n原文摘录：2/4 equals 1/2")
        val row = JSONObject().put("id", "m1").put("studentId", "s1").put("sourceSha256", "hash1")
        fun checked(e: JSONObject = evidence, r: JSONObject = row, hash: String = "hash1", text: String = "student said 2/4 equals 1/2") =
            ObservationDraftPolicy.verifiedExcerpt("s1", e, r, hash, text)
        assertEquals("2/4 equals 1/2", checked())
        assertNull(checked(hash = "changed"))
        assertNull(checked(text = "different source"))
        assertNull(checked(e = JSONObject(evidence.toString()).put("studentId", "s2")))
        assertNull(checked(e = JSONObject(evidence.toString()).put("status", "rejected")))
        assertNull(checked(r = JSONObject(row.toString()).put("studentId", "s2")))
        assertNull(checked(r = JSONObject(row.toString()).put("attributionConflict", true)))
        assertThrows(IllegalArgumentException::class.java) {
            EducationPublicationPolicy.validatePublishedReport("s1", "整体画像",
                "---\nstatus: draft\nstudent_id: s1\n---\n\n# 整体画像\n\n观察草稿：2/4 equals 1/2")
        }
    }
    @Test fun missingModelRecoveryRequiresExactHistoricalParentRun() {
        val parent = JSONObject().put("id", "parent").put("kind", "automation_digest_material")
            .put("input", JSONObject().put("studentId", "s1")).put("executionId", "later")
            .put("status", "failed").put("autoRetry", false)
        val event = JSONObject().put("taskId", "parent").put("executionId", "original")
            .put("type", "status_changed").put("detail", JSONObject().put("to", "running"))
        assertTrue(MissingModelParentPolicy.matches(parent, "s1", "original", listOf(event)))
        assertFalse(MissingModelParentPolicy.matches(parent, "s2", "original", listOf(event)))
        assertFalse(MissingModelParentPolicy.matches(parent, "s1", "other", listOf(event)))
        assertFalse(MissingModelParentPolicy.matches(parent, "s1", "original", emptyList()))
        assertFalse(MissingModelParentPolicy.matches(JSONObject(parent.toString()).put("status", "cancelled"), "s1", "original", listOf(event)))
        assertFalse(MissingModelParentPolicy.matches(JSONObject(parent.toString()).put("status", "running"), "s1", "original", listOf(event)))
        assertFalse(MissingModelParentPolicy.matches(JSONObject(parent.toString()).put("autoRetry", true), "s1", "original", listOf(event)))
    }
    private fun material(id: String, status: String, fingerprint: String = "batch-v1", ids: List<String> = listOf("a", "b")) =
        JSONObject().put("id", id).put("status", status).put("automationDigestFingerprint", fingerprint)
            .put("automationDigestSourceIds", JSONArray(ids))

    @Test fun onlyCompleteMatchingBatchIsReplayedOnce() {
        val a = material("a", "processed")
        val b = material("b", "processed")
        assertEquals(listOf(RecoverableDigestEvent("batch-v1", listOf("a", "b"))),
            AutomationEventRecoveryPolicy.digestEvents(listOf(a, b)))
        assertTrue(AutomationEventRecoveryPolicy.digestEvents(listOf(a)).isEmpty())
        assertTrue(AutomationEventRecoveryPolicy.digestEvents(listOf(a, material("b", "digesting"))).isEmpty())
        assertTrue(AutomationEventRecoveryPolicy.digestEvents(listOf(a, material("b", "processed", "batch-v2"))).isEmpty())
        assertTrue(AutomationEventRecoveryPolicy.digestEvents(listOf(a, material("b", "processed", ids = listOf("b", "a")))).isEmpty())
    }

    @Test fun legacyAndInvalidRecordsAreNotInferredAsCompletedBatches() {
        assertTrue(AutomationEventRecoveryPolicy.digestEvents(listOf(JSONObject().put("id", "a").put("status", "processed"))).isEmpty())
        assertTrue(AutomationEventRecoveryPolicy.digestEvents(listOf(material("a", "processed", ids = listOf("a", "a")))).isEmpty())
    }

    @Test fun completionReceiptRequiresSameStudentTaskAndExecution() {
        val task = JSONObject().put("id", "t1").put("executionId", "e1")
            .put("input", JSONObject().put("studentId", "s1"))
        val receipt = JSONObject().put("schema", "digest-completion-v1").put("state", "completed")
            .put("studentId", "s1").put("automationTaskId", "t1").put("automationExecutionId", "e1")
        assertTrue(DigestCompletionReceiptPolicy.matches(task, receipt))
        assertFalse(DigestCompletionReceiptPolicy.matches(task, JSONObject(receipt.toString()).put("studentId", "s2")))
        assertFalse(DigestCompletionReceiptPolicy.matches(task, JSONObject(receipt.toString()).put("automationExecutionId", "e2")))
        assertFalse(DigestCompletionReceiptPolicy.matches(task, JSONObject(receipt.toString()).put("state", "ready")))
    }

    @Test fun interruptedSourceRequiresMatchingScopeExecutionAndBothHashes() {
        val row = JSONObject().put("studentId", "s1").put("digestBatchId", "batch-1").put("status", "digesting")
        val evidence = JSONObject().put("id", "a").put("sha256", "raw-hash").put("textSha256", "text-hash")
        fun matches(student: String = "s1", batch: String = "batch-1", raw: String = "raw-hash", text: String = "text-hash") =
            DigestCompletionReceiptPolicy.sourceMatches(student, batch, "a", row, evidence, raw, text)
        assertTrue(matches())
        assertFalse(matches(student = "s2")); assertFalse(matches(batch = "batch-2"))
        assertFalse(matches(raw = "different")); assertFalse(matches(text = "different"))
        row.put("status", "removed"); assertFalse(matches())
    }
}
