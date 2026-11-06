package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class LearningReportPublicationPolicyTest {
    @Test fun evidence_fingerprint_is_order_independent_and_content_sensitive() {
        val first = JSONObject().put("id", "e1").put("status", "confirmed").put("content", "A").put("sourceUri", "material:1")
        val second = JSONObject().put("id", "e2").put("status", "confirmed").put("content", "B").put("sourceUri", "material:2")
        assertEquals(LearningReportPublicationPolicy.evidenceFingerprint(listOf(first, second)),
            LearningReportPublicationPolicy.evidenceFingerprint(listOf(second, first)))
        assertNotEquals(LearningReportPublicationPolicy.evidenceFingerprint(listOf(first, second)),
            LearningReportPublicationPolicy.evidenceFingerprint(listOf(first, JSONObject(second.toString()).put("content", "changed"))))
    }

    @Test fun pointer_requires_complete_four_report_set() {
        val paths = GrowthModelService.REPORTS.associate { it.id to "${GrowthModelService.REPORT_SET_DIRECTORY}/release-1/${it.fileName}" }
        val contents = GrowthModelService.REPORTS.associate { it.id to "content-${it.id}" }
        val pointer = LearningReportPublicationPolicy.pointer("student-1", "release-1", "fingerprint", paths, contents, "2026-11-06T00:00:00Z")
        GrowthModelService.REPORTS.forEach { definition ->
            assertEquals(paths.getValue(definition.id), LearningReportPublicationPolicy.requireEntry(pointer, "student-1", definition.id).getString("path"))
        }
    }
}
