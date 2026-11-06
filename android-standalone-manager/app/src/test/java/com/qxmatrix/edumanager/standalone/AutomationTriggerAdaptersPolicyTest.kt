package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AutomationTriggerAdaptersPolicyTest {
    @Test fun importedMaterialRunsClassificationBeforeLocalParsing() {
        assertEquals(
            listOf(AutomationAction.CLASSIFY_MATERIAL, AutomationAction.OCR_MATERIAL),
            AutomationTriggerPolicy.actions(AutomationEventType.MATERIAL_IMPORTED, AutomationMode.CONSERVATIVE),
        )
        assertFalse(AutomationAction.OCR_MATERIAL.remote)
        assertFalse(AutomationAction.REPAIR_OUTPUT.remote)
        assertFalse(AutomationAction.GENERATE_PROJECT_OUTPUTS.remote)
    }

    @Test fun sourceConflictRequiresExplicitFlagOrKnownCode() {
        assertTrue(AutomationMaterialPolicy.sourceConflict(JSONObject().put("sourceConflict", true)))
        assertTrue(AutomationMaterialPolicy.sourceConflict(JSONObject().put("conflictType", "source_hash_mismatch")))
        assertTrue(AutomationMaterialPolicy.sourceConflict(JSONObject().put("digestError", "原件哈希不一致，需要核对")))
        assertFalse(AutomationMaterialPolicy.sourceConflict(JSONObject().put("conflictType", "project_attribution_conflict")))
    }

    @Test fun privacyProjectionRedactsIdentityAndNeverCopiesLocalPath() {
        val material = JSONObject().put("id", "material-1").put("fileName", "王同学-报告.pdf")
            .put("sourceName", "家长 13812345678").put("absolutePath", "学生档案/王同学/raw.pdf")
            .put("studentId", "student-secret").put("sourceSha256", "abc")
        val projection = AutomationPrivacyPolicy.projection(
            material,
            "王同学 邮箱 pupil@example.com 身份证 11010519491231002X\n诊断：不应进入投影",
            "王同学",
        )
        val text = projection.toString()
        assertFalse(text.contains("王同学")); assertFalse(text.contains("13812345678"))
        assertFalse(text.contains("pupil@example.com")); assertFalse(text.contains("11010519491231002X"))
        assertFalse(text.contains("不应进入投影"))
        assertFalse(text.contains("absolutePath")); assertFalse(text.contains("student-secret"))
        assertTrue(text.contains("[电话已隐藏]")); assertTrue(text.contains("[敏感内容已隐藏]"))
    }

    @Test fun projectFingerprintIgnoresRevisionAndTimestampButChangesWithMaterialState() {
        fun registry(revision: Int, updatedAt: String, state: String) = JSONObject()
            .put("projectId", "project-1").put("revision", revision).put("updatedAt", updatedAt)
            .put("materials", JSONArray().put(JSONObject().put("materialId", "m1").put("sha256", "hash")
                .put("availability", "available").put("processing", JSONObject().put("state", state))))
        val first = AutomationMaterialPolicy.projectFingerprint(registry(1, "2026-01-01T00:00:00Z", "pending"))
        val replay = AutomationMaterialPolicy.projectFingerprint(registry(99, "2026-11-06T00:00:00Z", "pending"))
        val changed = AutomationMaterialPolicy.projectFingerprint(registry(100, "2026-11-06T00:01:00Z", "completed"))
        assertEquals(first, replay)
        assertNotEquals(first, changed)
    }
}
