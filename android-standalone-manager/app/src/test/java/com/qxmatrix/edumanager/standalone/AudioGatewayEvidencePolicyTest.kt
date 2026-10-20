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
    @Test fun shortGatewayCredentialsRequireExactScopeAndExpiry() {
        val session = ModelGatewaySession("https://example.com/edu-cloud", "a".repeat(43), "device-a", "student-a", 1000, 301000)
        session.requireCurrent("student-a", "device-a", 2000)
        assertThrows(IllegalArgumentException::class.java) { session.requireCurrent("student-b", "device-a", 2000) }
        assertThrows(IllegalArgumentException::class.java) { session.requireCurrent("student-a", "device-b", 2000) }
        assertThrows(IllegalArgumentException::class.java) { session.requireCurrent("student-a", "device-a", 301000) }
        assertThrows(IllegalArgumentException::class.java) { session.copy(expiresAt = 500000).requireCurrent("student-a", "device-a", 2000) }
    }
    @Test fun schemaAndEndpointCannotBeReplacedByServerPayload() {
        val payload = JSONObject().put("schema", "edu-manager.model-gateway-session.v1").put("token", "a".repeat(43))
            .put("deviceId", "device-a").put("studentId", "student-a").put("issuedAt", 1000).put("expiresAt", 301000).put("baseUrl", "https://evil.example")
        assertEquals("https://example.com", ModelGatewaySession.fromJson("https://example.com", payload, "student-a", "device-a", 2000).baseUrl)
        assertThrows(IllegalArgumentException::class.java) { ModelGatewaySession.fromJson("http://remote.example", payload, "student-a", "device-a", 2000) }
    }
    @Test fun evidenceMustUseExactKnownSourceAndRealExcerptBeforeWrites() {
        fun result(id: String, excerpt: String) = JSONObject().put("summary", "summary").put("claims", JSONArray().put(JSONObject()
            .put("predicate", "observation").put("value", "candidate").put("sourceMaterialId", id).put("excerpt", excerpt)))
        DigestEvidencePolicy.validate(result("material-a", "真实摘录"), mapOf("material-a" to "这是真实摘录。"))
        assertThrows(IllegalArgumentException::class.java) { DigestEvidencePolicy.validate(result("material-b", "真实摘录"), mapOf("material-a" to "真实摘录")) }
        assertThrows(IllegalArgumentException::class.java) { DigestEvidencePolicy.validate(result("material-a", "编造摘录"), mapOf("material-a" to "真实摘录")) }
        assertThrows(IllegalArgumentException::class.java) { DigestEvidencePolicy.validate(result("material-a", ""), mapOf("material-a" to "真实摘录")) }
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
