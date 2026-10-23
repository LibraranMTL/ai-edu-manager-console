package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StudentArchiveCompatibilityTest {
    private val student = StudentRecord.create("张三", "", "", "", "standard", "content://tree/root")
    private val adopted = StudentRecord.create("张三", "", "", "", "adopted", "content://tree/imported")

    @Test
    fun reportLookupIncludesCurrentAndLegacyReadOnlyLocations() {
        val paths = StudentArchiveCompatibility.reportDocumentPaths(student, "整体画像.md")
        assertTrue(paths.first() == "张三学情分析汇总/学情报告/整体画像.md")
        assertTrue(paths.contains("张三知识库/张三学情分析汇总/学情报告/整体画像.md"))
        assertTrue(paths.contains("张三知识库/张三学情分析汇总/整体画像.md"))
        assertTrue(paths.contains("张三知识库/教育档案/整体画像.md"))
    }

    @Test
    fun growthBrowserIncludesCurrentAndLegacyArchiveLocations() {
        val roots = StudentArchiveCompatibility.archiveRoots(student, "成长模型")
        assertTrue(roots.first() == "张三学情分析汇总/成长模型")
        assertTrue(roots.contains("张三知识库/张三学情分析汇总/成长模型"))
        assertTrue(roots.contains("张三知识库/张三学情分析汇总/能力画像.md"))
        assertTrue(roots.contains("张三知识库/教育档案/成长模型"))
    }

    @Test
    fun adoptedArchiveCanSearchItsExactTreeAndRecognizeLegacyReportAliases() {
        assertTrue(StudentArchiveCompatibility.fallbackSearchRoots(adopted).contains(""))
        assertTrue(StudentArchiveCompatibility.reportSearchRoots(adopted).none(String::isBlank))
        assertTrue(StudentArchiveCompatibility.reportNames("每日行动建议.md").contains("每周行动建议.md"))
        assertTrue(StudentArchiveCompatibility.isReportDocumentPath("张三知识库/张三学情分析汇总/学情报告/每周行动建议.md"))
        assertTrue(StudentArchiveCompatibility.isGrowthDocumentPath("张三知识库/张三学情分析汇总/成长模型/能力画像.md"))
    }

    @Test
    fun broadAdoptedRootIsNotPartOfOrdinaryRecursiveArchiveRoots() {
        assertTrue(StudentArchiveCompatibility.archiveRoots(adopted, "学情报告").none(String::isBlank))
        assertTrue(StudentArchiveCompatibility.archivePathTerms("学情报告").contains("学情报告"))
        assertTrue(StudentArchiveCompatibility.archivePreferredTerms(adopted, "学情报告").contains("张三"))
    }

    @Test
    fun educationArchiveDocumentsDefaultToNewestModifiedDate() {
        val files = listOf(
            SafWorkspaceStore.MarkdownFile("older.md", "报告/older.md", 1_000L),
            SafWorkspaceStore.MarkdownFile("newer.md", "报告/newer.md", 3_000L),
            SafWorkspaceStore.MarkdownFile("middle.md", "报告/middle.md", 2_000L),
        )

        assertEquals(
            listOf("newer.md", "middle.md", "older.md"),
            StudentArchiveCompatibility.newestFirst(files).map { it.name },
        )
    }

    @Test
    fun legacyArchiveDateInPathOrdersFilesWhoseProviderHasNoModifiedTime() {
        val files = listOf(
            SafWorkspaceStore.MarkdownFile("旧报告.md", "教育档案/2024-02-03-旧报告.md"),
            SafWorkspaceStore.MarkdownFile("新报告.md", "教育档案/20251021_新报告.md"),
            SafWorkspaceStore.MarkdownFile("日期未知.md", "教育档案/日期未知.md"),
        )

        assertEquals(
            listOf("新报告.md", "旧报告.md", "日期未知.md"),
            StudentArchiveCompatibility.newestFirst(files).map { it.name },
        )
    }
}
