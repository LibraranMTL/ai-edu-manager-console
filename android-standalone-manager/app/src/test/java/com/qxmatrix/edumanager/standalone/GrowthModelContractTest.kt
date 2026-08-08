package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GrowthModelContractTest {
    @Test
    fun preservesFourWindowsReportDefinitionsAndPhysicalFileNames() {
        assertEquals(listOf("profile", "changes", "daily", "stage"), GrowthModelService.REPORTS.map { it.id })
        assertEquals(listOf("整体画像.md", "历史变化.md", "每日行动建议.md", "阶段总结.md"), GrowthModelService.REPORTS.map { it.fileName })
        assertEquals("每周行动建议", GrowthModelService.REPORTS.single { it.id == "daily" }.title)
    }

    @Test
    fun reportSectionsMatchTheWindowsPresentationContract() {
        val profile = GrowthModelService.REPORTS.single { it.id == "profile" }
        assertTrue(profile.sections.containsAll(listOf("一句话画像", "学习优势", "当前短板", "依据来源")))
        val weekly = GrowthModelService.REPORTS.single { it.id == "daily" }
        assertTrue(weekly.sections.containsAll(listOf("每周重点", "给学生", "给家长", "给老师", "观察点", "依据来源")))
    }

    @Test
    fun exposesTheFourAuthoritativeEvidenceReviewStates() {
        assertEquals(setOf("pending", "confirmed", "watching", "rejected"), GrowthModelService.EVIDENCE_STATUSES)
    }
}
