package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProjectLegacyRecoveryPolicyTest {
    @Test fun onlyCompletedExactProjectAndWholeFixedBatchCanRestore() {
        val operation = "project-digest-" + "a".repeat(32)
        val frozen = JSONArray().put(JSONObject().put("materialId", "a")).put(JSONObject().put("materialId", "b"))
        val result = JSONObject().put("operationId", operation).put("processed", 2).put("artifactPath", "project/资料消化-$operation.md")
        val job = JSONObject().put("projectId", "p1").put("status", "completed").put("frozenMaterials", frozen).put("result", result)
        assertTrue(ProjectLegacyRecoveryPolicy.eligible(job, "p1", operation))
        assertFalse(ProjectLegacyRecoveryPolicy.eligible(job, "p2", operation))
        assertFalse(ProjectLegacyRecoveryPolicy.eligible(JSONObject(job.toString()).put("status", "running"), "p1", operation))
        assertFalse(ProjectLegacyRecoveryPolicy.eligible(JSONObject(job.toString()).put("result", JSONObject(result.toString()).put("processed", 1)), "p1", operation))
        assertFalse(ProjectLegacyRecoveryPolicy.eligible(JSONObject(job.toString()).put("result", JSONObject(result.toString()).put("artifactPath", "project/other.md")), "p1", operation))
        assertFalse(ProjectLegacyRecoveryPolicy.eligible(job, "p1", "project-digest-" + "b".repeat(32)))
    }
}
