package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ResearchAndCloudPolicyTest {
    @Test fun unknownOrInterruptedResearchNeverAutomaticallyRetriesChangedInputs() {
        assertTrue(ResearchUpdatePolicy.due(null, "new"))
        assertFalse(ResearchUpdatePolicy.due(JSONObject().put("state", "unknown").put("fingerprint", "old"), "new"))
        assertFalse(ResearchUpdatePolicy.due(JSONObject().put("state", "waiting_receipt").put("fingerprint", "old"), "new"))
        assertTrue(ResearchUpdatePolicy.due(JSONObject().put("state", "queued").put("fingerprint", "old"), "new"))
        assertFalse(ResearchUpdatePolicy.due(JSONObject().put("state", "succeeded").put("fingerprint", "same"), "same"))
        assertTrue(ResearchUpdatePolicy.due(JSONObject().put("state", "succeeded").put("fingerprint", "old"), "new"))
    }
    @Test fun expiredCompetitionIsLabelledNotDeletedAndDeadlineDayIsNotExpired() {
        val payload = JSONObject().put("module", "competitions").put("result", JSONObject().put("items", JSONArray()
            .put(JSONObject().put("deadline", "2026-10-01")).put(JSONObject().put("deadline", "2026-10-02"))))
        assertTrue(ResearchUpdatePolicy.expiryLabel(payload, "2026-10-02").startsWith("1 项"))
        assertEquals(2, payload.getJSONObject("result").getJSONArray("items").length())
    }
    private fun payload() = JSONObject().put("module", "topics").put("profile", "SECRET_PROFILE")
        .put("sources", JSONArray().put("SECRET_SOURCE")).put("answer", "SECRET_ANSWER")
        .put("result", JSONObject().put("items", JSONArray().put(JSONObject().also { item ->
            LearningStudioPolicy.fields.getValue("topics").forEach { item.put(it, "普通参考字段") }
            item.put("title", "张同学 13812345678 a@example.com")
        })))
    @Test fun cloudSummaryContainsOnlyReferenceFieldsAndRedactsBasicIdentifiers() {
        val text = CloudSummaryPolicy.summary(payload(), "张同学")
        assertFalse(text.contains("SECRET")); assertFalse(text.contains("张同学"))
        assertFalse(text.contains("13812345678")); assertFalse(text.contains("a@example.com"))
        assertTrue(text.contains("仅供参考"))
    }
    @Test fun localPathsAndLargeSummariesAreRejectedBeforeUpload() {
        val value = payload(); value.getJSONObject("result").getJSONArray("items").getJSONObject(0).put("title", "D:\\private\\student.txt")
        assertThrows(IllegalArgumentException::class.java) { CloudSummaryPolicy.summary(value, "") }
        val huge = payload(); huge.getJSONObject("result").getJSONArray("items").getJSONObject(0).put("title", "资料".repeat(20_000))
        assertThrows(IllegalArgumentException::class.java) { CloudSummaryPolicy.summary(huge, "") }
    }
    @Test fun validHttpsSourcesAreNotMistakenForWindowsDrivePaths() {
        val value = payload(); val item = value.getJSONObject("result").getJSONArray("items").getJSONObject(0)
        item.put("fieldSources", JSONObject().put("title", "https://official.example/storage/competition"))
        assertTrue(CloudSummaryPolicy.summary(value, "张同学").contains("https://official.example/storage/competition"))
        item.put("title", "原件路径：/storage/emulated/0/private.txt")
        assertThrows(IllegalArgumentException::class.java) { CloudSummaryPolicy.summary(value, "") }
    }
    @Test fun remoteReceiptMustMatchStudentScopedListNameHashAndSourceDevice() {
        val document = JSONObject().put("displayName", "planning.md").put("contentSha256", "abc").put("originDeviceId", "device-a")
        assertTrue(CloudSummaryPolicy.matches(document, "planning.md", "abc", "device-a"))
        assertFalse(CloudSummaryPolicy.matches(document, "planning.md", "abc", "device-b"))
        assertFalse(CloudSummaryPolicy.matches(document, "other.md", "abc", "device-a"))
    }
}
