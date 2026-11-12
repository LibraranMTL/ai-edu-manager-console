package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProjectAutoDigestPolicyTest {
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
