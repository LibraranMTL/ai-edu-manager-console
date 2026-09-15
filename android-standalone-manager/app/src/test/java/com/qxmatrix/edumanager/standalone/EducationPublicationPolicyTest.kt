package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EducationPublicationPolicyTest {
    private val source = """---
type: learning_profile
student_id: student-1
status: active
---

# 整体画像

## 学习优势

本周按计划完成了数学错题整理，复盘习惯正在形成。

## 当前短板

英语长句阅读仍需关注，建议每天完成一次精读练习。
"""

    @Test fun `published report is student-bound and normalized`() {
        val validated = EducationPublicationPolicy.validatePublishedReport("student-1", "整体画像", source)
        assertEquals("整体画像", validated.title)
        assertFalse(validated.markdown.startsWith("---"))
        assertEquals(64, validated.sourceHash.length)
    }

    @Test fun `formal cross platform statuses remain publishable`() {
        for (status in listOf("published", "current", "updated", "active")) {
            val candidate = source.replace("status: active", "status: $status")
            assertEquals("整体画像", EducationPublicationPolicy.validatePublishedReport("student-1", "整体画像", candidate).title)
        }
        assertFalse(EducationPublicationPolicy.isPublishableStatus("generated"))
        assertFalse(EducationPublicationPolicy.isPublishableStatus("pending_review"))
    }

    @Test fun `utf8 bom does not hide published frontmatter`() {
        val validated = EducationPublicationPolicy.validatePublishedReport("student-1", "整体画像", "\uFEFF$source")
        assertEquals("整体画像", validated.title)
        assertFalse(validated.markdown.startsWith("\uFEFF"))
    }

    @Test fun `meaningful body distinguishes an existing report from a template`() {
        assertTrue(EducationPublicationPolicy.hasMeaningfulBody(source))
        assertFalse(EducationPublicationPolicy.hasMeaningfulBody("---\nstatus: draft\n---\n\n# 整体画像\n\n## 一句话画像\n\n待生成。\n\n## 优势\n\n- 待补充。"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `pending review report cannot be published`() {
        EducationPublicationPolicy.validatePublishedReport("student-1", "整体画像", source.replace("status: active", "status: pending_review"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `cross student report fails closed`() {
        EducationPublicationPolicy.validatePublishedReport("student-2", "整体画像", source)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `placeholder report cannot be published`() {
        EducationPublicationPolicy.validatePublishedReport("student-1", "整体画像", "---\nstatus: active\nstudent_id: student-1\n---\n\n# 整体画像\n\n## 一句话画像\n\n待生成。\n\n## 优势\n\n- 待补充。")
    }

    @Test fun `templates preserve Windows ids and output contracts`() {
        assertEquals(listOf("formal", "concise", "growth-card"), EducationPublicationPolicy.TEMPLATES.map { it.id })
        val validated = EducationPublicationPolicy.validatePublishedReport("student-1", "整体画像", source)
        val formal = EducationPublicationPolicy.buildDraft(validated, "formal")
        val concise = EducationPublicationPolicy.buildDraft(validated, "concise")
        val card = EducationPublicationPolicy.buildDraft(validated, "growth-card")
        assertEquals("edu-manager.education-publication-draft.v2", formal.schema)
        assertEquals("document", formal.mode)
        assertTrue(concise.sections.flatMap { it.items }.all { source.contains(it.text) })
        assertTrue(card.sections.flatMap { it.items }.all { source.contains(it.text) })
    }

    @Test fun `agent may select verbatim source only`() {
        val validated = EducationPublicationPolicy.validatePublishedReport("student-1", "整体画像", source)
        val base = EducationPublicationPolicy.buildDraft(validated, "concise")
        val exact = "英语长句阅读仍需关注，建议每天完成一次精读练习。"
        val selected = EducationPublicationPolicy.buildAgentSelectedDraft(base, source, listOf(exact))
        assertEquals("agent", selected.generationMethod)
        assertEquals(exact, selected.sections.single().items.single().text)
        val invented = runCatching { EducationPublicationPolicy.buildAgentSelectedDraft(base, source, listOf("学生已经完全掌握英语长句阅读。")) }
        assertTrue(invented.isFailure)
    }

    @Test fun `table based reports can produce concise and card outputs`() {
        val tableReport = """---
status: published
student_id: student-1
---

# 学情报告

| 科目 | 当前表现 | 下一步行动 |
| --- | --- | --- |
| 数学 | 能够稳定完成错题复盘 | 每天整理一道典型错题 |
| 英语 | 长句阅读仍需关注 | 每天完成一次精读练习 |
"""
        val validated = EducationPublicationPolicy.validatePublishedReport("student-1", "学情报告", tableReport)
        val concise = EducationPublicationPolicy.buildDraft(validated, "concise")
        assertTrue(concise.sections.isNotEmpty())
        assertFalse(concise.sections.flatMap { it.items }.any { it.text.startsWith("科目；") })
        assertTrue(EducationPublicationPolicy.buildDraft(validated, "growth-card").sections.isNotEmpty())
    }
}
