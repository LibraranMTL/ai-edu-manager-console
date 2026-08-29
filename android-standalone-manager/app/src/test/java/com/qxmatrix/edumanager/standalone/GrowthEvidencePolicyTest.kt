package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GrowthEvidencePolicyTest {
    @Test
    fun mapsLegacyWindowsPathButKeepsHistoricalReportPendingPrimarySource() {
        val normalized = GrowthEvidencePolicy.normalizeCandidate("student-1", JSONObject()
            .put("id", "legacy-1")
            .put("title", "历史学情报告待核验：阶段总结")
            .put("sourcePath", "D:\\学生资料\\阶段总结.md")
            .put("migrationKind", "learning_report_candidate"))

        assertEquals("student-1", normalized.getString("studentId"))
        assertTrue(normalized.getString("sourceUri").startsWith("file:///D:/"))
        assertTrue(GrowthEvidencePolicy.requiresPrimarySource(normalized))
    }

    @Test
    fun explicitlyAttachedRawMaterialCanBeConfirmed() {
        val attached = GrowthEvidencePolicy.normalizeCandidate("student-1", JSONObject()
            .put("id", "legacy-1")
            .put("title", "历史学情报告待核验：阶段总结")
            .put("migrationKind", "learning_report_candidate")
            .put("sourceUri", "edu://student/student-1/raw/material-1")
            .put("sourceVerification", "provided_by_local_user")
            .put("primarySourceStatus", "provided"))

        assertFalse(GrowthEvidencePolicy.requiresPrimarySource(attached))
    }

    @Test
    fun automaticEvidenceIdIsStableAndContentBound() {
        val first = GrowthEvidencePolicy.automaticId("s1", "edu://s1/raw/m1", "持续订正", "能够根据反馈修正答案")
        val second = GrowthEvidencePolicy.automaticId("s1", "edu://s1/raw/m1", "持续订正", "能够根据反馈修正答案")
        val changed = GrowthEvidencePolicy.automaticId("s1", "edu://s1/raw/m1", "持续订正", "内容不同")
        assertEquals(first, second)
        assertTrue(first != changed)
    }
}
