package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReportDraftPolicyTest {
    private val evidence = listOf(JSONObject().put("id", "evidence-1").put("title", "完成三次订正"))

    @Test
    fun fillsMissingSectionsInsteadOfFailingTheWholeReport() {
        val completed = ReportDraftPolicy.complete(
            listOf("一句话画像", "学习优势", "依据来源"),
            JSONObject().put("学习优势", "能够持续订正 [依据:evidence-1]"),
            evidence,
        )
        assertEquals("资料不足。", completed.sections.getString("一句话画像"))
        assertEquals("能够持续订正 [依据:evidence-1]", completed.sections.getString("学习优势"))
        assertTrue(completed.sections.getString("依据来源").contains("evidence-1"))
        assertEquals(1, completed.adoptedModelSections)
        assertEquals(2, completed.fallbackSections)
    }

    @Test
    fun rejectsUnknownOrMissingCitationsButAcceptsConservativeText() {
        val completed = ReportDraftPolicy.complete(
            listOf("优势", "短板", "变化"),
            JSONObject().put("优势", "表现很好 [依据:fake]").put("短板", "需要努力").put("变化", "本周期无实质变化。"),
            evidence,
        )
        assertEquals("资料不足。", completed.sections.getString("优势"))
        assertEquals("资料不足。", completed.sections.getString("短板"))
        assertEquals("本周期无实质变化。", completed.sections.getString("变化"))
    }

    @Test
    fun acceptsNestedReportsAndMarkdownHeadingFallback() {
        val nested = ReportDraftPolicy.extractModelSections("{\"reports\":{\"profile\":{\"学习优势\":\"内容\"}}}", "profile")
        assertEquals("内容", nested.getString("学习优势"))
        val markdown = ReportDraftPolicy.extractModelSections("## 学习优势\n\n内容", "profile")
        assertEquals("内容", markdown.getString("学习优势"))
    }
}
