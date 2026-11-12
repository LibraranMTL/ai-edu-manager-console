package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class ProjectAutoDigestPolicyTest {
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
        assertFalse(permitted(students = 0)); assertFalse(permitted(students = 2)); assertFalse(permitted(project = "sealed"))
        for (last in listOf("queued", "running", "failed", "needs_user")) assertFalse(permitted(last = last))
    }

    @Test fun onlyAvailableAcceptedPendingTextIsAutomaticallyFrozen() {
        val row = JSONObject().put("title", "source.txt").put("adoption", "accepted").put("availability", "available")
            .put("processing", JSONObject().put("state", "pending"))
        assertTrue(ProjectAutoDigestPolicy.eligibleMaterial(row))
        assertFalse(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("availability", "missing")))
        assertFalse(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("adoption", "pending")))
        assertFalse(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("title", "image.png")))
        assertFalse(ProjectAutoDigestPolicy.eligibleMaterial(JSONObject(row.toString()).put("processing", JSONObject().put("state", "completed"))))
    }
}
