package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StudioFeedbackPolicyTest {
    private fun row(note: String, hash: String = "hash"): ScopedContentEntity {
        val version = JSONObject().put("inputSnapshot", JSONObject().put("sources", JSONArray().put(JSONObject().put("id", "source").put("sha256", hash))))
        val payload = JSONObject().put("attemptId", "attempt").put("answerSnapshot", JSONObject().put("evidenceSnapshot", version).put("answer", "private-answer"))
            .put("outcome", "partial").put("note", note).put("reviewer", "private-reviewer")
        return ScopedContentEntity("review", "a", "review", "key", "review", "", "", "", ScopedContentPolicy.fingerprint(payload), "", "recorded", "today", "today", payload.toString())
    }
    @Test fun onlyCurrentSourcesLatestCorrectionAndNoIdentityOrAnswers() {
        val observations = StudioFeedbackPolicy.observations(listOf(row("张三在提示后完成"), row("旧评价内容")), "a", mapOf("source" to "hash"), "张三")
        assertEquals(1, observations.length())
        val json = observations.toString()
        assertFalse(json.contains("张三")); assertFalse(json.contains("private")); assertFalse(json.contains("旧评价"))
        assertEquals(0, StudioFeedbackPolicy.observations(listOf(row("新版资料作答", "changed")), "a", mapOf("source" to "hash"), "张三").length())
        assertThrows(IllegalArgumentException::class.java) { StudioFeedbackPolicy.observations(listOf(row("审核观察记录")), "b", mapOf("source" to "hash"), "") }
        assertThrows(IllegalArgumentException::class.java) { StudioFeedbackPolicy.observations(listOf(row("审核观察记录").copy(sourceSha256 = "tampered")), "a", mapOf("source" to "hash"), "") }
    }
}
