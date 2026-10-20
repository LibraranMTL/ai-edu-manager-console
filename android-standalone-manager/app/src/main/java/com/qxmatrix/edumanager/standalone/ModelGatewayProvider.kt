package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.UUID

/** Short gateway credentials are memory-only, bound to exact device/student, never backed up. */
data class ModelGatewaySession(val baseUrl: String, val token: String, val deviceId: String, val studentId: String, val issuedAt: Long, val expiresAt: Long) {
    fun requireCurrent(student: String, device: String, now: Long = System.currentTimeMillis()) {
        require(student == studentId && device == deviceId && student.isNotBlank() && device.isNotBlank()) { "网关作用域不匹配" }
        require(issuedAt <= now + 60_000 && expiresAt > now && expiresAt - issuedAt in 1..300_000) { "网关短时凭据已过期或无效" }
        require(Regex("^[A-Za-z0-9_-]{32,128}$").matches(token))
        ModelEndpointPolicy.normalize(baseUrl)
    }
    companion object {
        fun fromJson(baseUrl: String, value: JSONObject, studentId: String, deviceId: String, now: Long = System.currentTimeMillis()): ModelGatewaySession {
            require(value.getString("schema") == "edu-manager.model-gateway-session.v1")
            return ModelGatewaySession(ModelEndpointPolicy.normalize(baseUrl), value.getString("token"), value.getString("deviceId"), value.getString("studentId"), value.getLong("issuedAt"), value.getLong("expiresAt"))
                .also { it.requireCurrent(studentId, deviceId, now) }
        }
    }
}

/** Opt-in pilot adapter; no fallback to a personal/shared provider key and no automatic retry. */
class ModelGatewayProvider(private val session: ModelGatewaySession, private val transport: ModelTransport = UrlConnectionModelTransport(),
    private val receipts: ModelReceiptSink? = null) : ModelProvider {
    override fun generate(request: ModelRequest): ModelResponse {
        session.requireCurrent(request.studentId, session.deviceId); request.cancellation.check()
        val messages = JSONArray(request.messages.toString())
        request.jsonSchema?.let { ModelJsonSchema.validateDefinition(it); messages.put(JSONObject().put("role", "user").put("content", "仅输出符合此JSON Schema的对象：$it")) }
        val payload = JSONObject().put("studentId", request.studentId).put("deviceId", session.deviceId).put("token", session.token)
            .put("model", request.model).put("messages", messages).put("webResearch", request.webResearch).put("maxOutputTokens", request.maxOutputTokens)
            .put("idempotencyKey", ScopedContentPolicy.hash("${request.taskId}:${request.promptVersion}:${request.schemaVersion}:${messages}".toByteArray()))
        val receipt = ModelCallReceipt(UUID.randomUUID().toString(), request.studentId, request.taskId, "controlled-gateway", request.model,
            URI(session.baseUrl).host, request.promptVersion, request.schemaVersion, System.currentTimeMillis(), searchEnabled = request.webResearch)
        receipts?.record(receipt)
        var failureState = "unknown"
        try {
            val response = transport.post("${session.baseUrl}/model-gateway/generate", session.token, payload, request.cancellation)
            if (response.status in setOf(400, 401, 403, 429)) failureState = "failed"
            require(response.status in 200..299) { "网关拒绝或结果需核对（HTTP ${response.status}）；未自动重试" }
            val json = JSONObject(response.body); val text = json.getString("text"); require(text.isNotBlank())
            request.jsonSchema?.let { ModelJsonSchema.validate(JSONObject(text), it) }
            val sources = json.getJSONArray("sources").let { array -> List(array.length()) {
                val source = array.getJSONObject(it); val uri = URI(source.getString("url"))
                require(uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.rawUserInfo == null)
                ResearchSource(source.getString("title"), source.getString("url"))
            } }
            if (request.webResearch) require(sources.isNotEmpty()) { "研究没有网关供应商来源回执" }
            val usage = json.optJSONObject("usage")
            fun tokens(key: String): Long? = usage?.opt(key)?.takeIf { it is Number }?.let { (it as Number).toLong().takeIf { count -> count >= 0 } }
            val result = ModelResponse(text, json.optString("providerRequestId").ifBlank { json.getString("requestId") }, ModelUsage(tokens("inputTokens"), tokens("outputTokens"), tokens("totalTokens")), sources)
            request.cancellation.check()
            receipts?.record(receipt.copy(state = "succeeded", requestId = result.requestId, usage = result.usage, sourceCount = sources.size, elapsedMs = System.currentTimeMillis() - receipt.startedAt))
            return result
        } catch (error: Throwable) {
            receipts?.record(receipt.copy(state = failureState, errorCode = if (failureState == "unknown") "gateway_needs_verification" else "gateway_rejected", elapsedMs = System.currentTimeMillis() - receipt.startedAt))
            throw error
        }
    }
}
