package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.net.SocketTimeoutException
import java.net.URI
import java.util.UUID
import java.util.concurrent.CancellationException

object ModelEndpointPolicy {
    fun normalize(endpoint: String): String = endpoint.trim().trimEnd('/').also {
        val uri = URI(it)
        require(!uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) { "模型地址必须包含主机且不能含凭据、查询或片段" }
        require(uri.scheme == "https" || (uri.scheme == "http" && uri.host in setOf("localhost", "127.0.0.1"))) { "模型接口必须使用 HTTPS（本机回环地址除外）" }
    }
    fun isBailian(endpoint: String): Boolean {
        val host = URI(normalize(endpoint)).host.lowercase()
        return host == "dashscope.aliyuncs.com" || host == "dashscope-intl.aliyuncs.com" ||
            host.endsWith(".maas.aliyuncs.com")
    }
    fun mayReuseCredential(previous: String, next: String): Boolean = normalize(previous) == normalize(next)
}

class ModelCancellation {
    @Volatile var cancelled = false; private set
    private var disconnect: (() -> Unit)? = null
    @Synchronized fun cancel() { cancelled = true; disconnect?.invoke() }
    @Synchronized fun attach(action: () -> Unit) { disconnect = action; if (cancelled) action() }
    @Synchronized fun detach() { disconnect = null }
    fun check() { if (cancelled) throw CancellationException("模型请求已取消；已发送请求的服务端费用仍可能产生") }
}

data class ModelRequest(
    val model: String, val messages: JSONArray,
    val studentId: String = "", val taskId: String = "",
    val promptVersion: String = "legacy-v1", val schemaVersion: String = "",
    val jsonSchema: JSONObject? = null, val webResearch: Boolean = false,
    val cancellation: ModelCancellation = ModelCancellation(),
    val maxOutputTokens: Int = 4096,
)
data class ModelUsage(val inputTokens: Long?, val outputTokens: Long?, val totalTokens: Long?)
data class ResearchSource(val title: String, val url: String)
data class ModelResponse(val text: String, val requestId: String, val usage: ModelUsage, val sources: List<ResearchSource>)
data class ModelCallReceipt(
    val callId: String, val studentId: String, val taskId: String, val provider: String, val model: String,
    val endpointHost: String, val promptVersion: String, val schemaVersion: String, val startedAt: Long,
    val elapsedMs: Long = 0, val state: String = "running", val requestId: String = "",
    val usage: ModelUsage = ModelUsage(null, null, null), val errorCode: String = "",
    val region: String = "unspecified", val thinkingMode: String = "provider_default", val searchEnabled: Boolean = false,
    val sourceCount: Int = 0,
)
interface ModelReceiptSink { fun record(receipt: ModelCallReceipt) }
interface ModelProvider { fun generate(request: ModelRequest): ModelResponse }
data class ModelHttpResponse(val status: Int, val body: String, val requestId: String)
fun interface ModelTransport { fun post(endpoint: String, apiKey: String, payload: JSONObject, cancellation: ModelCancellation): ModelHttpResponse }

class UrlConnectionModelTransport : ModelTransport {
    override fun post(endpoint: String, apiKey: String, payload: JSONObject, cancellation: ModelCancellation): ModelHttpResponse {
        cancellation.check()
        val response = UnifiedNetworkClient.execute(NetworkRequest(
            url = endpoint,
            method = "POST",
            headers = mapOf("Content-Type" to "application/json; charset=utf-8", "Authorization" to "Bearer $apiKey"),
            body = payload.toString().toByteArray(Charsets.UTF_8),
            connectTimeoutMs = 30_000,
            readTimeoutMs = 180_000,
            maxResponseBytes = 4L * 1024 * 1024,
            followRedirects = false,
        ), cancellation)
        return ModelHttpResponse(response.status, response.body.toString(Charsets.UTF_8), response.headers["x-request-id"]?.firstOrNull().orEmpty())
    }
}

/** JSON Object mode + application schema validation. Search provenance ONLY comes from search_info. */
class CompatibleModelProvider(
    private val endpoint: String, private val apiKey: String,
    private val transport: ModelTransport = UrlConnectionModelTransport(),
    private val receipts: ModelReceiptSink? = null,
) : ModelProvider {
    override fun generate(request: ModelRequest): ModelResponse {
        val normalized = ModelEndpointPolicy.normalize(endpoint)
        require(request.model.isNotBlank() && apiKey.isNotBlank()) { "模型和凭据尚未配置" }
        require(request.maxOutputTokens in 1..16384) { "输出额度无效" }
        val bailian = ModelEndpointPolicy.isBailian(normalized)
        require(!request.webResearch || bailian) { "此供应商未接入真实搜索来源合同" }
        val payload = JSONObject().put("model", request.model).put("temperature", 0.2)
            .put("messages", request.messages).put("max_tokens", request.maxOutputTokens).put("stream", false)
        // A non-streaming, non-thinking baseline is explicit for Qwen hybrid-thinking models.
        if (bailian && (request.model.startsWith("qwen3") || request.jsonSchema != null)) payload.put("enable_thinking", false)
        request.jsonSchema?.let { schema ->
            ModelJsonSchema.validateDefinition(schema)
            require(schema.getString("type") == "object") { "结构化结果根节点须为对象" }
            payload.put("response_format", JSONObject().put("type", "json_object"))
            val messages = JSONArray(request.messages.toString())
            messages.put(JSONObject().put("role", "user").put("content", "只返回符合以下结构的 JSON，不要 Markdown：$schema"))
            payload.put("messages", messages)
        }
        if (request.webResearch) payload.put("enable_search", true).put("search_options",
            JSONObject().put("enable_source", true).put("forced_search", true))
        val started = System.currentTimeMillis(); val clock = System.nanoTime()
        val host = URI(normalized).host
        val region = when {
            host == "dashscope.aliyuncs.com" || host.endsWith(".cn-beijing.maas.aliyuncs.com") -> "cn-beijing"
            host == "dashscope-intl.aliyuncs.com" || host.endsWith(".ap-southeast-1.maas.aliyuncs.com") -> "ap-southeast-1"
            else -> "unspecified"
        }
        var receipt = ModelCallReceipt(UUID.randomUUID().toString(), request.studentId, request.taskId,
            if (bailian) "bailian-compatible" else "openai-compatible", request.model, URI(normalized).host,
            request.promptVersion, request.schemaVersion, started, region = region,
            thinkingMode = if (payload.has("enable_thinking")) "disabled" else "provider_default", searchEnabled = request.webResearch)
        receipts?.record(receipt) // Persist intent before sending; failure here sends no request.
        var responded = false
        var httpStatus = 0
        try {
            request.cancellation.check()
            val target = if (normalized.endsWith("/chat/completions")) normalized else "$normalized/chat/completions"
            val http = transport.post(target, apiKey, payload, request.cancellation)
            responded = true; httpStatus = http.status
            receipt = receipt.copy(requestId = safeId(http.requestId))
            require(http.status in 200..299) { "模型服务返回 HTTP ${http.status}，请查看任务诊断；未自动重试。" }
            val json = JSONObject(http.body)
            val usage = json.optJSONObject("usage")
            fun count(key: String): Long? = usage?.opt(key)?.let { value ->
                if (value is Number && value.toLong() >= 0) value.toLong() else null
            }
            receipt = receipt.copy(usage = ModelUsage(count("prompt_tokens"), count("completion_tokens"), count("total_tokens")))
            val choice = json.getJSONArray("choices").getJSONObject(0)
            require(choice.optString("finish_reason") !in setOf("length", "content_filter", "tool_calls")) { "模型输出未完整结束，不能采用部分结果" }
            val content = choice.getJSONObject("message").getString("content")
            require(content.isNotBlank()) { "模型没有返回可用内容" }
            request.jsonSchema?.let { ModelJsonSchema.validate(JSONObject(content), it) }
            val sources = mutableListOf<ResearchSource>()
            val search = json.optJSONObject("search_info")?.optJSONArray("search_results")
            if (search != null) for (index in 0 until search.length()) {
                val item = search.getJSONObject(index); val url = item.optString("url")
                val uri = runCatching { URI(url) }.getOrNull()
                if (uri?.scheme in setOf("https", "http") && !uri?.host.isNullOrBlank() && uri?.rawUserInfo == null)
                    sources += ResearchSource(item.optString("title"), url)
            }
            require(!request.webResearch || sources.isNotEmpty()) { "供应商未返回真实搜索来源；不能把模型回答标为联网研究" }
            request.cancellation.check()
            receipt = receipt.copy(state = "succeeded", requestId = receipt.requestId.ifBlank { safeId(json.optString("request_id")) },
                sourceCount = sources.distinctBy { it.url }.size,
                elapsedMs = (System.nanoTime() - clock) / 1_000_000)
            receipts?.record(receipt)
            return ModelResponse(content, receipt.requestId, receipt.usage, sources.distinctBy { it.url })
        } catch (error: Exception) {
            val cancelled = request.cancellation.cancelled || error is CancellationException
            val unknown = !responded && !cancelled
            receipt = receipt.copy(state = if (cancelled) "cancelled" else if (unknown) "unknown" else "failed",
                elapsedMs = (System.nanoTime() - clock) / 1_000_000,
                errorCode = when { cancelled -> "cancelled"; error is SocketTimeoutException -> "timeout_unknown";
                    unknown -> "transport_unknown"; httpStatus !in 200..299 -> "http_$httpStatus"; else -> "invalid_response" })
            receipts?.record(receipt)
            if (cancelled) throw CancellationException("模型请求已取消；服务端费用可能已产生")
            if (unknown) throw IllegalStateException("模型请求结果未知，未自动重试；请检查联网和任务诊断。", error)
            throw error
        }
    }
    private fun safeId(value: String) = value.filter { it.isLetterOrDigit() || it in "-_." }.take(128)
}

/** Deliberately bounded schema subset. Unsupported constraints fail before calling the model. */
object ModelJsonSchema {
    private val supported = setOf("type", "properties", "required", "additionalProperties", "items", "enum", "description", "minItems", "maxItems", "minimum", "maximum")
    fun validateDefinition(schema: JSONObject) {
        require(schema.keys().asSequence().all { it in supported }) { "不支持的 Schema 约束" }
        require(schema.optString("type") in setOf("object", "array", "string", "integer", "number", "boolean")) { "Schema 类型无效" }
        if (schema.has("additionalProperties")) require(schema.get("additionalProperties") is Boolean) { "仅支持布尔 additionalProperties" }
        if (schema.has("properties")) require(schema.get("properties") is JSONObject) { "properties 须为对象" }
        if (schema.has("required")) require(schema.get("required") is JSONArray) { "required 须为数组" }
        if (schema.has("enum")) require(schema.get("enum") is JSONArray && schema.getJSONArray("enum").length() > 0) { "enum 须为非空数组" }
        schema.optJSONObject("properties")?.let { props -> props.keys().forEach { validateDefinition(props.getJSONObject(it)) } }
        if (schema.optString("type") == "array") validateDefinition(schema.getJSONObject("items"))
        schema.optJSONArray("required")?.let { required -> for (i in 0 until required.length())
            require(schema.optJSONObject("properties")?.has(required.getString(i)) == true) { "Schema 必填字段未定义" } }
    }
    fun validate(value: Any?, schema: JSONObject, path: String = "$") {
        val valid = when (schema.getString("type")) {
            "object" -> value is JSONObject; "array" -> value is JSONArray; "string" -> value is String
            "boolean" -> value is Boolean; "number" -> value is Number
            "integer" -> value is Number && value.toDouble() % 1.0 == 0.0; else -> false
        }
        require(valid) { "$path 字段类型不符" }
        schema.optJSONArray("enum")?.let { enums -> require((0 until enums.length()).any { enums.get(it) == value }) { "$path 不在允许值中" } }
        if (value is JSONObject) {
            val props = schema.optJSONObject("properties") ?: JSONObject()
            schema.optJSONArray("required")?.let { keys -> for (i in 0 until keys.length()) require(value.has(keys.getString(i))) { "$path 缺少必填字段" } }
            value.keys().forEach { key ->
                if (props.has(key)) validate(value.get(key), props.getJSONObject(key), "$path.$key")
                else require(schema.optBoolean("additionalProperties", true)) { "$path 含未声明字段" }
            }
        }
        if (value is JSONArray) {
            require(value.length() >= schema.optInt("minItems", 0) && value.length() <= schema.optInt("maxItems", Int.MAX_VALUE)) { "$path 数组长度不符" }
            for (i in 0 until value.length()) validate(value.get(i), schema.getJSONObject("items"), "$path[$i]")
        }
        if (value is Number) require(value.toDouble().isFinite() && value.toDouble() >= schema.optDouble("minimum", Double.NEGATIVE_INFINITY)
            && value.toDouble() <= schema.optDouble("maximum", Double.POSITIVE_INFINITY)) { "$path 数值范围不符" }
    }
}
