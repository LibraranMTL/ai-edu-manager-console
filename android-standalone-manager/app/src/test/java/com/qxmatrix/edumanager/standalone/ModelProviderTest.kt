package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.SocketTimeoutException
import java.util.concurrent.CancellationException

class ModelProviderTest {
    private val endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    private val messages = JSONArray().put(JSONObject().put("role", "user").put("content", "synthetic sample"))
    private val schema = JSONObject("""{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}""")
    private fun reply(text: String = "OK", finish: String = "stop", sources: Boolean = false): String = JSONObject()
        .put("choices", JSONArray().put(JSONObject().put("finish_reason", finish)
            .put("message", JSONObject().put("content", text))))
        .put("usage", JSONObject().put("prompt_tokens", 11).put("completion_tokens", 3).put("total_tokens", 14))
        .also { if (sources) it.put("search_info", JSONObject().put("search_results", JSONArray()
            .put(JSONObject().put("title", "Official").put("url", "https://example.org/source")))) }.toString()
    private class Sink : ModelReceiptSink {
        val values = mutableListOf<ModelCallReceipt>()
        override fun record(receipt: ModelCallReceipt) { values += receipt }
    }
    @Test fun actualUsageAndRoutingMetadataAreRecordedWithoutPromptOrKey() {
        val sink = Sink()
        val provider = CompatibleModelProvider(endpoint, "secret", ModelTransport { _, _, payload, _ ->
            assertFalse(payload.getBoolean("enable_thinking")); assertFalse(payload.getBoolean("stream"))
            ModelHttpResponse(200, reply(), "real-request-id")
        }, sink)
        val result = provider.generate(ModelRequest("qwen3.6-flash-2026-04-16", messages, "student-a", "task-a"))
        assertEquals(11L, result.usage.inputTokens); assertEquals("real-request-id", result.requestId)
        assertEquals(listOf("running", "succeeded"), sink.values.map { it.state })
        assertEquals("student-a", sink.values.last().studentId)
        assertEquals("cn-beijing", sink.values.last().region); assertEquals("disabled", sink.values.last().thinkingMode)
        assertFalse(sink.values.last().toString().contains("secret")); assertFalse(sink.values.last().toString().contains("synthetic sample"))
    }
    @Test fun missingUsageRemainsUnknownRatherThanZero() {
        val body = JSONObject(reply()).apply { remove("usage") }
        val result = CompatibleModelProvider(endpoint, "x", ModelTransport { _, _, _, _ -> ModelHttpResponse(200, body.toString(), "") })
            .generate(ModelRequest("qwen3.6-flash", messages))
        assertNull(result.usage.totalTokens)
    }
    @Test fun schemaOutputIsLocallyValidatedAndIncompleteOutputIsRejected() {
        val provider = CompatibleModelProvider(endpoint, "x", ModelTransport { _, _, payload, _ ->
            assertEquals("json_object", payload.getJSONObject("response_format").getString("type"))
            ModelHttpResponse(200, reply("{\"ok\":true}"), "")
        })
        assertEquals("{\"ok\":true}", provider.generate(ModelRequest("qwen3.6-flash", messages, jsonSchema = schema)).text)
        listOf(reply("{\"ok\":\"yes\"}"), reply("{\"ok\":true,\"rogue\":1}"), reply("partial", "length")).forEach { body ->
            val bad = CompatibleModelProvider(endpoint, "x", ModelTransport { _, _, _, _ -> ModelHttpResponse(200, body, "") })
            try { bad.generate(ModelRequest("qwen3.6-flash", messages, jsonSchema = schema)); fail() } catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun proseUrlIsNotAcceptedAsSearchProvenance() {
        val sink = Sink()
        val bad = CompatibleModelProvider(endpoint, "x", ModelTransport { _, _, _, _ ->
            ModelHttpResponse(200, reply("See https://example.org/invented"), "r")
        }, sink)
        try { bad.generate(ModelRequest("qwen3.6-flash", messages, webResearch = true)); fail() } catch (_: IllegalArgumentException) { }
        assertEquals("failed", sink.values.last().state)
        val good = CompatibleModelProvider(endpoint, "x", ModelTransport { _, _, payload, _ ->
            assertTrue(payload.getBoolean("enable_search")); assertTrue(payload.getJSONObject("search_options").getBoolean("enable_source"))
            ModelHttpResponse(200, reply(sources = true), "r")
        })
        assertEquals("https://example.org/source", good.generate(ModelRequest("qwen3.6-flash", messages, webResearch = true)).sources.single().url)
    }
    @Test fun timeoutIsUnknownAndNotRetried() {
        var calls = 0; val sink = Sink()
        val provider = CompatibleModelProvider(endpoint, "x", ModelTransport { _, _, _, _ -> calls++; throw SocketTimeoutException() }, sink)
        try { provider.generate(ModelRequest("qwen3.6-flash", messages)); fail() } catch (_: IllegalStateException) { }
        assertEquals(1, calls); assertEquals("unknown", sink.values.last().state); assertNull(sink.values.last().usage.totalTokens)
    }
    @Test fun cancellationNeverCommitsSuccessfulResult() {
        val token = ModelCancellation(); val sink = Sink(); var disconnected = false
        val provider = CompatibleModelProvider(endpoint, "x", ModelTransport { _, _, _, cancellation ->
            cancellation.attach { disconnected = true }; cancellation.cancel(); cancellation.detach()
            ModelHttpResponse(200, reply(), "r")
        }, sink)
        try { provider.generate(ModelRequest("qwen3.6-flash", messages, cancellation = token)); fail() } catch (_: CancellationException) { }
        assertTrue(disconnected); assertEquals("cancelled", sink.values.last().state)
    }
    @Test fun endpointCredentialReuseIsExactAndUnsafeEndpointsFail() {
        assertTrue(ModelEndpointPolicy.mayReuseCredential(endpoint, "$endpoint/"))
        assertFalse(ModelEndpointPolicy.mayReuseCredential(endpoint, "https://other.example/v1"))
        assertFalse(ModelEndpointPolicy.mayReuseCredential(endpoint, "https://dashscope.aliyuncs.com/other-path"))
        listOf("https:///missing", "https://user:password@example.org/v1", "http://example.org/v1", "https://example.org/v1?key=x").forEach {
            try { ModelEndpointPolicy.normalize(it); fail() } catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun unsupportedSchemaFailsBeforeNetwork() {
        var called = false
        val provider = CompatibleModelProvider(endpoint, "x", ModelTransport { _, _, _, _ -> called = true; error("never") })
        try { provider.generate(ModelRequest("qwen3.6-flash", messages, jsonSchema = JSONObject("""{"type":"string","pattern":"x"}"""))); fail() }
        catch (_: IllegalArgumentException) { }
        assertFalse(called)
    }
}
