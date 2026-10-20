package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ModelGatewaySessionClientTest {
    private fun response(student: String = "student-a") = JSONObject().put("schema", "edu-manager.model-gateway-session.v1")
        .put("studentId", student).put("deviceId", "device-a").put("token", "a".repeat(43))
        .put("issuedAt", System.currentTimeMillis()).put("expiresAt", System.currentTimeMillis() + 120_000).toString()
    @Test fun bootstrapSendsExplicitProofOnceWithoutApiKeyOrPersistentCredential() {
        var calls = 0
        val client = ModelGatewaySessionClient(ModelTransport { endpoint, key, payload, _ ->
            calls++; assertEquals("https://gateway.example/model-gateway/session", endpoint); assertEquals("", key)
            assertEquals("student-a", payload.getString("studentId")); assertTrue(payload.has("proof"))
            ModelHttpResponse(201, response(), "")
        })
        assertEquals("student-a", client.issue("https://gateway.example", "student-a", "device-a", JSONObject().put("synthetic", true), ModelCancellation()).studentId)
        assertEquals(1, calls)
    }
    @Test fun mismatchedScopeAndDeniedResponseFailWithoutFallbackOrRetry() {
        var calls = 0
        val client = ModelGatewaySessionClient(ModelTransport { _, _, _, _ -> calls++; ModelHttpResponse(201, response("student-b"), "") })
        assertThrows(IllegalArgumentException::class.java) { client.issue("https://gateway.example", "student-a", "device-a", JSONObject().put("synthetic", true), ModelCancellation()) }
        assertEquals(1, calls)
        val denied = ModelGatewaySessionClient(ModelTransport { _, _, _, _ -> ModelHttpResponse(403, "{}", "") })
        assertThrows(IllegalArgumentException::class.java) { denied.issue("https://gateway.example", "student-a", "device-a", JSONObject().put("synthetic", true), ModelCancellation()) }
    }
}
