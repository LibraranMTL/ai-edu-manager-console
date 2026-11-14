package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownRendererTest {
    @Test fun reportReadingModeHidesOnlyCompleteFrontmatter() {
        val body = MarkdownRenderer.reportBody("\uFEFF---\r\nstatus: draft\r\n---\r\n\r\n# 画像\r\n\r\n> 观察草稿")
        assertTrue(body.startsWith("# 画像"))
        assertTrue(body.contains("观察草稿"))
        assertFalse(body.contains("status: draft"))
        assertTrue(MarkdownRenderer.reportBody("---\n未闭合\n# 原文").contains("未闭合"))
        assertTrue(MarkdownRenderer.reportBody("# 普通文档").startsWith("# 普通文档"))
    }
    @Test fun rendersHeadingsListsTablesAndEscapesHtml() {
        val html = MarkdownRenderer.html("# 标题\n\n- 条目\n\n| 列 | 值 |\n| --- | --- |\n| A | **B** |\n\n<script>alert(1)</script>")
        assertTrue(html.contains("<h1>标题</h1>"))
        assertTrue(html.contains("<li>条目</li>"))
        assertTrue(html.contains("<table>"))
        assertTrue(html.contains("<strong>B</strong>"))
        assertTrue(html.contains("&lt;script&gt;"))
        assertFalse(html.contains("<script>alert"))
    }
}
