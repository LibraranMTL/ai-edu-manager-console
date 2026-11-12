package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningFiveDimensionPolicyTest {
    @Test fun onlyConfirmedSourcedEvidenceAppearsInProjection() {
        val index = JSONObject().put("evidence", JSONArray()
            .put(evidence("confirmed-method", "confirmed", "学习方法", "分步练习", "edu://student/s/raw/m1"))
            .put(evidence("pending-problem", "pending", "学习问题", "公式困难", "edu://student/s/raw/m2"))
            .put(evidence("confirmed-efficiency-no-source", "confirmed", "学习效率", "提高效率", "")))
        val rows = LearningFiveDimensionPolicy.project(index).associateBy { it.id }
        assertEquals("分步练习", rows.getValue("method").summary)
        assertEquals("confirmed_evidence", rows.getValue("method").source)
        assertEquals("资料不足", rows.getValue("problem").summary)
        assertEquals("资料不足", rows.getValue("efficiency").summary)
        assertTrue(rows.getValue("method").evidenceIds.contains("confirmed-method"))
    }

    @Test fun emptyProjectionKeepsAllFiveDimensionsExplicitlyInsufficient() {
        val rows = LearningFiveDimensionPolicy.project(null)
        assertEquals(listOf("goal", "mindset", "problem", "method", "efficiency"), rows.map { it.id })
        assertTrue(rows.all { it.summary == "资料不足" && it.evidenceIds.isEmpty() })
    }

    private fun evidence(id: String, status: String, ability: String, title: String, source: String) = JSONObject()
        .put("id", id).put("status", status).put("ability", ability).put("title", title).put("content", title)
        .put("sourceUri", source).put("updatedAt", "2026-11-12T00:00:00Z")
}
