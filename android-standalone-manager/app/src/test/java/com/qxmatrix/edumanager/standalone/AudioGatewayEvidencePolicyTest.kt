package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AudioGatewayEvidencePolicyTest {
    @Test fun audioMagicNotExtensionControlsAcceptance() {
        assertEquals("wav", AudioSourcePolicy.validate("recording.wav", "RIFFxxxxWAVEdata".toByteArray()))
        assertEquals("m4a", AudioSourcePolicy.validate("recording.m4a", "xxxxftypM4A ".toByteArray()))
        assertThrows(IllegalArgumentException::class.java) { AudioSourcePolicy.validate("recording.wav", "not-wave-data".toByteArray()) }
        assertThrows(IllegalArgumentException::class.java) { AudioSourcePolicy.validate("recording.exe", "xxxxftypM4A ".toByteArray()) }
    }
    @Test fun evidenceMustUseExactKnownSourceAndRealExcerptBeforeWrites() {
        fun result(id: String, excerpt: String) = JSONObject().put("summary", "summary").put("claims", JSONArray().put(JSONObject()
            .put("predicate", "observation").put("value", "candidate").put("sourceMaterialId", id).put("excerpt", excerpt)))
        DigestEvidencePolicy.validate(result("material-a", "真实摘录"), mapOf("material-a" to "这是真实摘录。"))
        assertThrows(IllegalArgumentException::class.java) { DigestEvidencePolicy.validate(result("material-b", "真实摘录"), mapOf("material-a" to "真实摘录")) }
        assertThrows(IllegalArgumentException::class.java) { DigestEvidencePolicy.validate(result("material-a", "编造摘录"), mapOf("material-a" to "真实摘录")) }
        assertThrows(IllegalArgumentException::class.java) { DigestEvidencePolicy.validate(result("material-a", ""), mapOf("material-a" to "真实摘录")) }
    }
    @Test fun ocrLineWrapsAreEquivalentButInventedCandidatesAreDropped() {
        val source = "第一行学习记录\n第二行订正结果"
        assertTrue(DigestEvidencePolicy.matchesExcerpt(source, "第一行学习记录第二行订正结果"))
        val result = JSONObject().put("summary", "OCR 内容已完成消化").put("claims", JSONArray()
            .put(JSONObject().put("predicate", "observation").put("value", "valid")
                .put("sourceMaterialId", "material-a").put("excerpt", "第一行学习记录 第二行订正结果"))
            .put(JSONObject().put("predicate", "observation").put("value", "invented")
                .put("sourceMaterialId", "material-a").put("excerpt", "原文中不存在的摘录")))
        val sanitized = DigestEvidencePolicy.sanitized(result, mapOf("material-a" to source))
        assertEquals(1, sanitized.getJSONArray("claims").length())
        assertEquals(1, sanitized.getJSONObject("evidenceValidation").getInt("droppedCount"))
    }
    @Test fun collaborationHistoryCannotCloneNestedCredentials() {
        val raw = JSONObject().put("encryptedSecret", "cipher").put("payload", JSONObject().put("token", "secret").put("path", "source.md"))
            .put("array", JSONArray().put(JSONObject().put("apiKey", "secret").put("objectId", "retained")))
        val clean = CollaborationArchiveSnapshot.sanitize(raw) as JSONObject
        assertEquals("", clean.getString("encryptedSecret")); assertEquals("", clean.getJSONObject("payload").getString("token"))
        assertEquals("source.md", clean.getJSONObject("payload").getString("path"))
        assertEquals("", clean.getJSONArray("array").getJSONObject(0).getString("apiKey"))
        assertEquals("retained", clean.getJSONArray("array").getJSONObject(0).getString("objectId"))
    }
}
