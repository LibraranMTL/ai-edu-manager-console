package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
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

class AgentConfigurationStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("local_agent", Context.MODE_PRIVATE)

    fun save(endpoint: String, model: String, apiKey: String) {
        saveOrUpdate(endpoint, model, apiKey)
    }

    fun saveOrUpdate(endpoint: String, model: String, apiKey: String?, visionModel: String = "") {
        val normalized = endpoint.trim().trimEnd('/')
        val uri = URI(normalized)
        require(uri.scheme == "https" || (uri.scheme == "http" && uri.host in setOf("127.0.0.1", "localhost"))) { "Agent 接口必须使用 HTTPS（本机回环地址除外）" }
        require(uri.rawQuery == null && uri.rawFragment == null) { "Agent 接口不能包含查询参数或片段" }
        require(model.isNotBlank()) { "模型名称不能为空" }
        val credential = apiKey?.trim().takeUnless { it.isNullOrBlank() } ?: load()?.apiKey
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
        val normalized = profile.endpoint.trim().trimEnd('/')
        val uri = URI(normalized)
        require(uri.scheme == "https" || (uri.scheme == "http" && uri.host in setOf("127.0.0.1", "localhost"))) { "Agent 接口必须使用 HTTPS（本机回环地址除外）" }
        require(uri.rawQuery == null && uri.rawFragment == null) { "Agent 接口不能包含查询参数或片段" }
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
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
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
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }

    companion object { private const val KEY_ALIAS = "edu_manager_agent_api_key_v1" }
}

interface AgentAdapter {
    fun execute(systemPrompt: String, userPrompt: String): String
}

class OpenAiCompatibleAgentAdapter(private val configuration: AgentConfiguration) : AgentAdapter {
    override fun execute(systemPrompt: String, userPrompt: String): String {
        return request(JSONArray().put(JSONObject().put("role", "system").put("content", systemPrompt)).put(JSONObject().put("role", "user").put("content", userPrompt)), configuration.model)
    }

    fun testConnection(): String = execute("你是连接测试工具。只回复 OK。", "连接测试")

    fun testVisionConnection(): String {
        require(configuration.visionModel.isNotBlank()) { "尚未配置视觉模型" }
        val image = generatedTestImage()
        return executeVision(
            "你是视觉模型连接测试工具。不要推断任何个人信息。",
            "这是一张应用生成的测试图片。只回复 VISION_OK。",
            image,
            "image/png",
        )
    }

    fun executeVision(systemPrompt: String, prompt: String, imageBytes: ByteArray, mimeType: String): String {
        val dataUrl = "data:$mimeType;base64,${Base64.encodeToString(imageBytes, Base64.NO_WRAP)}"
        val userContent = JSONArray().put(JSONObject().put("type", "text").put("text", prompt))
            .put(JSONObject().put("type", "image_url").put("image_url", JSONObject().put("url", dataUrl)))
        val model = configuration.visionModel.ifBlank { configuration.model }
        return request(JSONArray().put(JSONObject().put("role", "system").put("content", systemPrompt)).put(JSONObject().put("role", "user").put("content", userContent)), model)
    }

    private fun request(messages: JSONArray, model: String): String {
        val url = URL(resolveChatCompletionsUrl(configuration.endpoint))
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 30_000; readTimeout = 180_000; doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8"); setRequestProperty("Authorization", "Bearer ${configuration.apiKey}")
        }
        val payload = JSONObject().put("model", model).put("temperature", 0.2)
            .put("messages", messages)
        connection.outputStream.use { it.write(payload.toString().toByteArray()) }
        val status = connection.responseCode
        val response = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (status !in 200..299) {
            val requestId = connection.getHeaderField("x-request-id").orEmpty().ifBlank { connection.getHeaderField("x-tt-logid").orEmpty() }
            error("Agent 服务请求失败（HTTP $status）：${safeErrorDetail(response)}${if (requestId.isBlank()) "" else "；请求 ID $requestId"}")
        }
        return JSONObject(response).getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
    }

    private fun safeErrorDetail(response: String): String {
        val parsed = runCatching { JSONObject(response) }.getOrNull()
        val error = parsed?.optJSONObject("error")
        val code = error?.optString("code").orEmpty().ifBlank { parsed?.optString("code").orEmpty() }
        val message = error?.optString("message").orEmpty().ifBlank { parsed?.optString("message").orEmpty() }
        return listOf(code, message).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "服务未返回可读错误信息" }.take(600)
    }

    companion object {
        /** 128x128 application-generated PNG; large enough for common vision-model limits and contains no user data. */
        private fun generatedTestImage(): ByteArray {
            val bitmap = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.rgb(36, 150, 150))
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
