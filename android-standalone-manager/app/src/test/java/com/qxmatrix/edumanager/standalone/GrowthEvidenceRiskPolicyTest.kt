package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GrowthEvidenceRiskPolicyTest {
    @Test fun traceableProjectEvidenceIsAutomaticallyConfirmed() {
        val result = GrowthEvidenceRiskPolicy.assess(base())
        assertEquals(GrowthRiskLevel.LOW, result.level)
        assertEquals("confirmed", result.suggestedStatus)
        assertEquals(listOf("traceable_project_evidence"), result.reasons)
    }

    @Test fun incompleteContextIsObservedRatherThanConfirmed() {
        val result = GrowthEvidenceRiskPolicy.assess(base().put("projectId", ""))
        assertEquals(GrowthRiskLevel.MEDIUM, result.level)
        assertEquals("watching", result.suggestedStatus)
        assertTrue("no_project_context" in result.reasons)
    }

    @Test fun missingSourceConflictSensitiveOrAgentInferenceNeedsAttention() {
        val fixtures = listOf(
            base().put("sourceUri", ""),
            base().put("conflictWith", JSONArray().put("evidence-2")),
            base().put("content", "包含健康诊断内容"),
            base().put("sourceType", "agent_inference"),
        )
        fixtures.forEach { fixture ->
            val result = GrowthEvidenceRiskPolicy.assess(fixture)
            assertEquals(GrowthRiskLevel.HIGH, result.level)
            assertEquals("needs_attention", result.suggestedStatus)
            assertTrue(result.requiresIndividualAttention)
        }
    }

    private fun base() = JSONObject()
        .put("id", "evidence-1")
        .put("sourceUri", "content://student/material-1")
        .put("sourceType", "practice_attempt")
        .put("projectId", "project-1")
        .put("ability", "信息整理")
        .put("confidence", "high")
        .put("content", "在两次任务中完成了资料归类")
}
