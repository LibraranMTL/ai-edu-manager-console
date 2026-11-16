package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class GrowthProjectionDocumentsTest {
    @Test fun onlyCurrentStudentVerifiedObservationsAppear() {
        fun item(id: String, status: String, uri: String, project: String = "") = JSONObject()
            .put("id", id).put("status", status).put("sourceUri", uri).put("content", id)
            .put("ability", "表达").put("projectId", project).put("projectName", "项目甲")
        val index = JSONObject().put("studentId", "s1").put("updatedAt", "2026-11-15")
            .put("evidence", JSONArray().put(item("valid", "watching", "edu://student/s1/raw/m1", "p1"))
                .put(item("wrong_student", "confirmed", "edu://student/s2/raw/m2", "p1"))
                .put(item("changed", "needs_attention", "edu://student/s1/raw/m3", "p1")))
        val (profile, projects) = GrowthProjectionDocuments.render(index)
        assertTrue(profile.contains("观察中")); assertTrue(projects.contains("valid"))
        assertFalse(profile.contains("wrong_student")); assertFalse(projects.contains("changed"))
    }

    @Test fun projectMembershipAloneIsNotContribution() {
        val index = JSONObject().put("studentId", "s1").put("evidence", JSONArray())
        assertTrue(GrowthProjectionDocuments.render(index).second.contains("暂无可核验"))
    }
}
