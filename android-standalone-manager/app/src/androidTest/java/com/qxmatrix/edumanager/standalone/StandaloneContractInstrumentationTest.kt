package com.qxmatrix.edumanager.standalone

import android.os.Bundle
import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StandaloneContractInstrumentationTest {
    @Test fun navigationAndNonSecretDraftStateSurviveRecreation() {
        val original = StandaloneUiStateViewModel(SavedStateHandle()).apply {
            section = AppSection.PROJECTS
            studentId = "student-a"
            projectId = "project-a"
            query = "检索词"
            sort = "updated_desc"
            scrollY = 640
            pendingOperation = "camera"
            pendingUri = "content://camera/pending"
            draftTitle = "草稿"
        }
        val bundle = Bundle().also(original::saveTo)
        val restored = StandaloneUiStateViewModel(SavedStateHandle(bundle.keySet().associateWith(bundle::get)))
        assertEquals(AppSection.PROJECTS, restored.section)
        assertEquals("student-a", restored.studentId)
        assertEquals("project-a", restored.projectId)
        assertEquals("检索词", restored.query)
        assertEquals(640, restored.scrollY)
        assertFalse(bundle.keySet().any { it.contains("key", true) || it.contains("license", true) || it.contains("credential", true) })
    }

    @Test fun attributionConflictCannotBecomeAnEffectiveAutomaticConclusion() {
        val assessment = GrowthEvidenceRiskPolicy.assess(org.json.JSONObject()
            .put("id", "attribution-1")
            .put("studentId", "student-a")
            .put("sourceStudentId", "student-b")
            .put("sourceUri", "content://material/1")
            .put("projectId", "project-1")
            .put("ability", "表达"))
        assertEquals(GrowthRiskLevel.HIGH, assessment.level)
        assertEquals("needs_attention", assessment.suggestedStatus)
    }
}
