package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalProjectMaterialPolicyTest {
    @Test
    fun keepsStableCategoryIdsAndSanitizesProviderNames() {
        assertEquals(
            listOf("reference", "design", "progress", "deliverable", "team", "other"),
            LocalProjectMaterialPolicy.categories.keys.toList(),
        )
        assertEquals("结题_报告_.pdf", LocalProjectMaterialPolicy.safeFilename(" 结题:报告?.pdf "))
        assertEquals("项目资料", LocalProjectMaterialPolicy.safeFilename("   "))
    }

    @Test
    fun suggestionsStayConservativeAndDoNotInventAClass() {
        assertEquals("reference", LocalProjectMaterialPolicy.suggestedCategory("项目工作空间/收件箱/参考文献.pdf"))
        assertEquals("design", LocalProjectMaterialPolicy.suggestedCategory("项目工作空间/收件箱/proposal.docx"))
        assertEquals("deliverable", LocalProjectMaterialPolicy.suggestedCategory("项目工作空间/收件箱/final-report.pdf"))
        assertNull(LocalProjectMaterialPolicy.suggestedCategory("项目工作空间/收件箱/IMG_0001.jpg"))
    }

    @Test
    fun autoOrganizationOnlyMovesDirectSafeInboxFilesWithAcceptedClassification() {
        assertTrue(LocalProjectMaterialPolicy.canAutoOrganize(
            "项目工作空间/收件箱/参考资料.pdf", "accepted", "reference", manualLocked = true,
        ))
        assertFalse(LocalProjectMaterialPolicy.canAutoOrganize(
            "项目工作空间/收件箱/子目录/参考资料.pdf", "accepted", "reference", manualLocked = true,
        ))
        assertFalse(LocalProjectMaterialPolicy.canAutoOrganize(
            "项目工作空间/收件箱/site.html", "accepted", "reference", manualLocked = true,
        ))
        assertFalse(LocalProjectMaterialPolicy.canAutoOrganize(
            "项目工作空间/收件箱/参考资料.pdf", "candidate", "reference", manualLocked = true,
        ))
        assertFalse(LocalProjectMaterialPolicy.canAutoOrganize(
            "项目工作空间/收件箱/IMG_0001.jpg", "accepted", "reference", manualLocked = false,
        ))
    }

    @Test
    fun migrationPreservesExternalDependenciesAndConflicts() {
        assertEquals("associate", LocalProjectMaterialPolicy.migrationDisposition("workspace", "项目工作空间/a.pdf", false))
        assertEquals("preserve_external", LocalProjectMaterialPolicy.migrationDisposition("adopted_external", "项目原始资料库/a.pdf", false))
        assertEquals("preserve_dependency", LocalProjectMaterialPolicy.migrationDisposition("legacy_raw", "网页/index.html", false))
        assertEquals("preserve_conflict", LocalProjectMaterialPolicy.migrationDisposition("legacy_raw", "a.pdf", true))
        assertEquals("migrate", LocalProjectMaterialPolicy.migrationDisposition("legacy_raw", "a.pdf", false))
    }
}
