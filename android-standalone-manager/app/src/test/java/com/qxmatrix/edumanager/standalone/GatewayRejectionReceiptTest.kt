package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GatewayRejectionReceiptTest {
    @Test fun knownRejectionIsNotConfusedWithUnknownBillingAndNoRetry() {
        val now = System.currentTimeMillis()
        val session = ModelGatewaySession("https://example.org", "a".repeat(40), "device", "student", now, now + 300000)
        for (status in listOf(400, 401, 403, 429, 409, 502)) {
            val receipts = mutableListOf<ModelCallReceipt>(); var calls = 0
            val provider = ModelGatewayProvider(session, ModelTransport { _, _, _, _ -> calls++; ModelHttpResponse(status, "{}", "") }, object : ModelReceiptSink {
                override fun record(receipt: ModelCallReceipt) { receipts += receipt }
            })
            assertThrows(IllegalArgumentException::class.java) { provider.generate(ModelRequest("model", JSONArray().put(JSONObject().put("role", "user").put("content", "synthetic")), "student", "task")) }
            assertEquals(1, calls)
            assertEquals(if (status in listOf(409, 502)) "unknown" else "failed", receipts.last().state)
        }
    }
}
