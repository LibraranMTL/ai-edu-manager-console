package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class AgentConfiguration(
    val endpoint: String,
    val model: String,
    val apiKey: String,
    val visionModel: String = "",
)

data class AgentPublicConfiguration(
    val endpoint: String,
    val model: String,
    val visionModel: String = "",
) {
    fun toJson(): JSONObject = JSONObject().put("endpoint", endpoint).put("model", model).put("visionModel", visionModel)

    companion object {
        fun fromJson(value: JSONObject) = AgentPublicConfiguration(
            value.optString("endpoint"), value.optString("model"), value.optString("visionModel"),
        )
    }
}

data class AgentConfigurationSnapshot(
    val endpoint: String,
    val model: String,
    val visionModel: String,
    val encryptedCredential: String,
)

class AgentConfigurationStore(context: Context, namespace: String = "local_agent") {
    init { require(namespace in setOf("local_agent", "local_asr")) }
    private val preferences = context.applicationContext.getSharedPreferences(namespace, Context.MODE_PRIVATE)
    private val keyAlias = if (namespace == "local_agent") KEY_ALIAS else "edu_manager_asr_api_key_v1"

    fun save(endpoint: String, model: String, apiKey: String) {
        saveOrUpdate(endpoint, model, apiKey)
    }

    fun saveOrUpdate(endpoint: String, model: String, apiKey: String?, visionModel: String = "") {
        val normalized = ModelEndpointPolicy.normalize(endpoint)
        require(model.isNotBlank()) { "模型名称不能为空" }
        val provided = apiKey?.trim().takeUnless { it.isNullOrBlank() }
        val previous = if (provided == null) load() else null
        val credential = provided ?: previous?.takeIf {
            ModelEndpointPolicy.mayReuseCredential(it.endpoint, normalized)
        }?.apiKey
        require(!credential.isNullOrBlank()) { "API Key 不能为空" }
        preferences.edit().putString("endpoint", normalized).putString("model", model.trim())
            .putString("vision_model", visionModel.trim()).putString("credential", encrypt(credential)).commit().also { check(it) }
    }

    fun load(): AgentConfiguration? {
        val endpoint = preferences.getString("endpoint", "").orEmpty(); val model = preferences.getString("model", "").orEmpty(); val encrypted = preferences.getString("credential", "").orEmpty()
        if (endpoint.isBlank() || model.isBlank() || encrypted.isBlank()) return null
        return AgentConfiguration(endpoint, model, decrypt(encrypted), preferences.getString("vision_model", "").orEmpty())
    }

    fun publicProfile(): AgentPublicConfiguration? {
        val endpoint = preferences.getString("endpoint", "").orEmpty()
        val model = preferences.getString("model", "").orEmpty()
        if (endpoint.isBlank() || model.isBlank()) return null
        return AgentPublicConfiguration(endpoint, model, preferences.getString("vision_model", "").orEmpty())
    }

    /** Migrates only non-secret routing metadata. A new device must enter its own API key. */
    fun restorePublicProfile(profile: AgentPublicConfiguration?) {
        if (profile == null) return
        val normalized = ModelEndpointPolicy.normalize(profile.endpoint)
        require(profile.model.isNotBlank()) { "模型名称不能为空" }
        check(preferences.edit().putString("endpoint", normalized).putString("model", profile.model.trim())
            .putString("vision_model", profile.visionModel.trim()).remove("credential").commit())
    }

    fun snapshotForRollback() = AgentConfigurationSnapshot(
        preferences.getString("endpoint", "").orEmpty(),
        preferences.getString("model", "").orEmpty(),
        preferences.getString("vision_model", "").orEmpty(),
        preferences.getString("credential", "").orEmpty(),
    )

    fun restoreSnapshot(snapshot: AgentConfigurationSnapshot) {
        val editor = preferences.edit().clear()
        if (snapshot.endpoint.isNotBlank()) editor.putString("endpoint", snapshot.endpoint)
        if (snapshot.model.isNotBlank()) editor.putString("model", snapshot.model)
        if (snapshot.visionModel.isNotBlank()) editor.putString("vision_model", snapshot.visionModel)
        if (snapshot.encryptedCredential.isNotBlank()) editor.putString("credential", snapshot.encryptedCredential)
        check(editor.commit())
    }

    fun summary(): String = load()?.let {
        "已配置 ${URI(it.endpoint).host} · 文本 ${it.model}" + if (it.visionModel.isBlank()) " · 视觉未单独配置" else " · 视觉 ${it.visionModel}"
    } ?: publicProfile()?.let {
        "已迁移 ${URI(it.endpoint).host} · 文本 ${it.model} · 需要重新填写 API Key"
    } ?: "尚未配置 Agent 模型"

    fun clear() {
        check(preferences.edit().clear().commit())
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keyStore.containsAlias(keyAlias)) keyStore.deleteEntry(keyAlias)
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP); val iv = bytes.copyOfRange(0, 12); val encrypted = bytes.copyOfRange(12, bytes.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }

    companion object { private const val KEY_ALIAS = "edu_manager_agent_api_key_v1" }
}

interface AgentAdapter {
    fun execute(systemPrompt: String, userPrompt: String): String
}

class OpenAiCompatibleAgentAdapter(
    private val configuration: AgentConfiguration,
    context: Context? = null,
    private val studentId: String = "",
    private val taskId: String = "",
) : AgentAdapter {
    private val provider: ModelProvider = context?.let { ModelRuntime.provider(it, configuration) }
        ?: CompatibleModelProvider(configuration.endpoint, configuration.apiKey)
    override fun execute(systemPrompt: String, userPrompt: String): String {
        return request(JSONArray().put(JSONObject().put("role", "system").put("content", systemPrompt)).put(JSONObject().put("role", "user").put("content", userPrompt)), configuration.model)
    }

    fun executeWithCheckpoint(systemPrompt: String, userPrompt: String, commit: (String) -> Unit): String {
        val messages = JSONArray().put(JSONObject().put("role", "system").put("content", systemPrompt))
            .put(JSONObject().put("role", "user").put("content", userPrompt))
        return provider.generate(ModelRequest(configuration.model, messages, studentId, taskId,
            commitValidatedResponse = commit)).text
    }

    fun testConnection(): String = execute("你是连接测试工具。只回复 OK。", "连接测试").also {
        require(it.trim() == "OK") { "文本测试返回内容未符合预期；不能标记为通过" }
    }

    fun testVisionConnection(): String {
        require(configuration.visionModel.isNotBlank()) { "尚未配置视觉模型" }
        val count = java.security.SecureRandom().nextInt(3) + 2
        val image = generatedTestImage(count)
        return executeVision(
            "你是视觉模型连接测试工具。不要推断任何个人信息。",
            "统计图片中红色正方形的个数，只输出一个阿拉伯数字，不要解释。",
            image,
            "image/png",
        ).also { require(it.trim() == count.toString()) { "视觉测试未正确读取随机图片内容；不能标记为通过" } }
    }

    fun executeVision(systemPrompt: String, prompt: String, imageBytes: ByteArray, mimeType: String): String {
        val dataUrl = "data:$mimeType;base64,${Base64.encodeToString(imageBytes, Base64.NO_WRAP)}"
        val userContent = JSONArray().put(JSONObject().put("type", "text").put("text", prompt))
            .put(JSONObject().put("type", "image_url").put("image_url", JSONObject().put("url", dataUrl)))
        val model = configuration.visionModel.ifBlank { configuration.model }
        return request(JSONArray().put(JSONObject().put("role", "system").put("content", systemPrompt)).put(JSONObject().put("role", "user").put("content", userContent)), model)
    }

    private fun request(messages: JSONArray, model: String): String {
        return provider.generate(ModelRequest(model, messages, studentId, taskId)).text
    }

    fun executeStructured(systemPrompt: String, userPrompt: String, schema: JSONObject, schemaVersion: String,
                          cancellation: ModelCancellation = ModelCancellation()): ModelResponse {
        val messages = JSONArray().put(JSONObject().put("role", "system").put("content", systemPrompt))
            .put(JSONObject().put("role", "user").put("content", userPrompt))
        return provider.generate(ModelRequest(configuration.model, messages, studentId, taskId,
            promptVersion = "structured-v1", schemaVersion = schemaVersion, jsonSchema = schema, cancellation = cancellation))
    }

    fun webResearch(publicQuery: String, cancellation: ModelCancellation = ModelCancellation()): ModelResponse {
        val messages = JSONArray().put(JSONObject().put("role", "system").put("content", "查询公开信息，区分来源事实与推断；不要编造来源。"))
            .put(JSONObject().put("role", "user").put("content", publicQuery))
        return provider.generate(ModelRequest(configuration.model, messages, studentId, taskId,
            promptVersion = "research-v1", webResearch = true, cancellation = cancellation))
    }

    companion object {
        /** 128x128 application-generated PNG; large enough for common vision-model limits and contains no user data. */
        private fun generatedTestImage(count: Int): ByteArray {
            val bitmap = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            val canvas = android.graphics.Canvas(bitmap); val paint = android.graphics.Paint().apply { color = Color.RED }
            for (index in 0 until count) { val y = (index + 1) * 128f / (count + 1); canvas.drawRect(52f, y - 8f, 68f, y + 8f, paint) }
            val output = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            bitmap.recycle()
            return output.toByteArray()
        }

        fun resolveChatCompletionsUrl(endpoint: String): String {
            val normalized = endpoint.trim().trimEnd('/')
            return if (normalized.endsWith("/chat/completions", ignoreCase = true)) normalized else "$normalized/chat/completions"
        }
    }
}
