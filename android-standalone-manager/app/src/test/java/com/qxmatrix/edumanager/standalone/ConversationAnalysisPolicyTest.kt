package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationAnalysisPolicyTest {
    @Test fun extractsBoundedNavigationMetadataWithoutInventingKnowledge() {
        val result = ConversationAnalysisPolicy.analyze("""
            # 数学复习对话
            用户：我需要复习函数。
            助手：建议先整理错题。
            - [ ] 下一步完成三道函数题
        """.trimIndent())
        assertEquals("local-fallback", result.getString("mode"))
        assertTrue(result.getJSONArray("topics").strings().contains("数学"))
        assertTrue(result.getJSONArray("actionItems").length() >= 1)
        assertTrue(result.getString("summary").length <= 360)
    }
}
