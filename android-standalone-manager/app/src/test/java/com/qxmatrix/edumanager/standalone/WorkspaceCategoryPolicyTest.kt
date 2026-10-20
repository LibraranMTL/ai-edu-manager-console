package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorkspaceCategoryPolicyTest {
    @Test fun actualFoldersAndStableIdsReplaceTemplateCategories() {
        val actual = WorkspaceCategoryPolicy.categories(listOf("资料", "工作日志", "方案设计", "研究暂存", "收件箱", ".edu-manager"))
        assertEquals(setOf("资料", "工作日志", "方案设计"), actual.values.toSet())
        assertEquals("资料", actual["reference"])
        val original = WorkspaceCategoryPolicy.categories(listOf("参考资料")).keys.single()
        assertTrue(WorkspaceCategoryPolicy.categories(listOf("资料", "参考资料")).containsKey(original))
        assertEquals(actual.keys.size, actual.values.distinct().size)
    }
    @Test fun explicitDirectoryIsAuthoritativeWithoutDigestOrRepeatedConfirmation() {
        val categories = WorkspaceCategoryPolicy.categories(listOf("工作日志"))
        val key = categories.keys.single()
        assertEquals(key, WorkspaceCategoryPolicy.categoryAt("项目/工作空间/工作日志/二月/实验.md", "项目/工作空间", categories))
        assertNull(WorkspaceCategoryPolicy.categoryAt("项目/工作空间/收件箱/实验.md", "项目/工作空间", categories))
        val item = JSONObject().put("adoption", "accepted").put("classification", JSONObject())
            .put("processing", JSONObject().put("state", "pending"))
        assertTrue(WorkspaceCategoryPolicy.adoptExplicitDirectory(item, key))
        assertEquals("user_classified", item.getJSONObject("classification").getString("status"))
        assertFalse(WorkspaceCategoryPolicy.needsOrganization(item))
        assertEquals("pending", item.getJSONObject("processing").getString("state"))
        assertFalse(WorkspaceCategoryPolicy.adoptExplicitDirectory(item, key))
    }
    @Test fun explicitManualOverrideIsNeverOverwrittenByScan() {
        val classification = JSONObject().put("manualLocked", true).put("source", "human").put("categoryId", "custom")
        val item = JSONObject().put("classification", classification)
        assertFalse(WorkspaceCategoryPolicy.adoptExplicitDirectory(item, "reference")); assertEquals("custom", classification.getString("categoryId"))
    }
    @Test fun customCategoryOrganizesOnlyDirectSafeInboxFiles() {
        assertTrue(LocalProjectMaterialPolicy.canAutoOrganize("自定义工作空间/收件箱/a.pdf", "accepted", "custom", true,
            setOf("custom"), "自定义工作空间/收件箱/"))
        assertFalse(LocalProjectMaterialPolicy.canAutoOrganize("自定义工作空间/收件箱/附件/a.pdf", "accepted", "custom", true,
            setOf("custom"), "自定义工作空间/收件箱/"))
        assertFalse(LocalProjectMaterialPolicy.canAutoOrganize("自定义工作空间/收件箱/a.dwg", "accepted", "custom", true,
            setOf("custom"), "自定义工作空间/收件箱/"))
    }
}
