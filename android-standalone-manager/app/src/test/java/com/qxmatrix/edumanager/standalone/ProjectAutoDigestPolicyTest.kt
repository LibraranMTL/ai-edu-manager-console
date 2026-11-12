package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class ProjectAutoDigestPolicyTest {
    @Test fun singleRetryTicketBindsJobStudentProjectAndFrozenBytes() {
        val frozen = JSONArray().put(JSONObject().put("materialId", "m1").put("version", 1).put("sha256", "a".repeat(64)))
        val ticket = JSONObject().put("state", "authorized").put("jobId", "j1").put("projectId", "p1").put("studentId", "s1")
            .put("frozenFingerprint", ScopedContentPolicy.fingerprint(JSONObject().put("frozen", frozen)))
        assertTrue(ProjectRetryPolicy.matches(ticket, "j1", "p1", "s1", frozen))
        assertFalse(ProjectRetryPolicy.matches(ticket, "j2", "p1", "s1", frozen))
        assertFalse(ProjectRetryPolicy.matches(ticket, "j1", "p2", "s1", frozen))
        assertFalse(ProjectRetryPolicy.matches(ticket, "j1", "p1", "s2", frozen))
        assertFalse(ProjectRetryPolicy.matches(JSONObject(ticket.toString()).put("state", "consumed"), "j1", "p1", "s1", frozen))
        assertFalse(ProjectRetryPolicy.matches(ticket, "j1", "p1", "s1", JSONArray().put(JSONObject().put("materialId", "other"))))
    }
    @Test fun unknownResultRequiresExactCachedSourcesAndSummary() {
        val hash = "a".repeat(64)
        val frozen = JSONArray().put(JSONObject().put("materialId", "m1").put("version", 1).put("sha256", hash))
        val cache = JSONObject().put("key", "key1").put("result", JSONObject().put("summary", "记录原型测试"))
            .put("markdown", "记录原型测试\n- file · m1 v1 · $hash")
        assertTrue(ProjectCheckpointRecoveryPolicy.matches(cache, "key1", frozen))
        assertFalse(ProjectCheckpointRecoveryPolicy.matches(cache, "other", frozen))
        assertFalse(ProjectCheckpointRecoveryPolicy.matches(JSONObject(cache.toString()).put("markdown", "unrelated"), "key1", frozen))
        assertFalse(ProjectCheckpointRecoveryPolicy.matches(cache, "key1", JSONArray().put(JSONObject(frozen.getJSONObject(0).toString()).put("version", 2))))
        assertFalse(ProjectCheckpointRecoveryPolicy.matches(cache, "key1", JSONArray()))
    }
    @Test fun automaticQueueRequiresKnownSingleStudentAndNoUnsafePriorAttempt() {
        fun permitted(mode: Boolean = true, license: Boolean = true, model: Boolean = true,
            students: Int = 1, project: String = "active", last: String = "completed") =
            ProjectAutoDigestPolicy.permitted(mode, license, model, students, project, last)
        assertTrue(permitted())
        assertFalse(permitted(mode = false)); assertFalse(permitted(license = false)); assertFalse(permitted(model = false))
        assertFalse(permitted(students = 0)); assertTrue(permitted(students = 2)); assertFalse(permitted(project = "sealed"))
        for (last in listOf("queued", "running", "failed", "needs_user")) assertFalse(permitted(last = last))
        assertEquals("", ProjectAutoDigestPolicy.scope(true, listOf("s1", "s2"), "s1"))
        assertEquals("s1", ProjectAutoDigestPolicy.scope(true, listOf("s1"), "s2"))
        assertEquals("s2", ProjectAutoDigestPolicy.scope(false, listOf("s1", "s2"), "s2"))
        assertTrue(ProjectAutoDigestPolicy.sameMembership(listOf("s1", "s2"), listOf("s2", "s1")))
        assertFalse(ProjectAutoDigestPolicy.sameMembership(listOf("s1", "s2"), listOf("s1")))
        assertFalse(ProjectAutoDigestPolicy.sameMembership(listOf("s1", "s1"), listOf("s1", "s1")))
    }

    @Test fun onlyAvailableAcceptedPendingTextIsAutomaticallyFrozen() {
        val row = JSONObject().put("title", "source.txt").put("adoption", "accepted").put("availability", "available")
            .put("processing", JSONObject().put("state", "pending"))
        assertTrue(ProjectAutoDigestPolicy.eligibleMaterial(row))
        assertFalse(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("availability", "missing")))
        assertFalse(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("adoption", "pending")))
        assertTrue(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("title", "image.png")))
        assertTrue(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("title", "document.pdf")))
        assertFalse(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("title", "script.html")))
        assertFalse(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("processing", JSONObject().put("state", "completed"))))
    }
}
