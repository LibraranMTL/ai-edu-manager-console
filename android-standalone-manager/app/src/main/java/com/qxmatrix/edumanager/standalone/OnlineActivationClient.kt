package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.URL
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection

class OnlineActivationClient(private val context: Context) {
    private val prefs = context.getSharedPreferences("online-activation", Context.MODE_PRIVATE)
    private val store get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val proofAlias = "edu-activation-proof-v1"
    private val stateAlias = "edu-activation-state-v1"
    private val license = LicenseManager(context)
    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun sha(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun stateKey(): SecretKey {
        val existing = store.getKey(stateAlias, null)
        if (existing != null) return existing as SecretKey
        require(!prefs.contains("pending")) { "激活凭据已丢失，请联系售后核验。" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(stateAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun save(state: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, stateKey()) }
        val encrypted = cipher.doFinal(state.toString().toByteArray(Charsets.UTF_8))
        require(prefs.edit().putString("pending", b64(cipher.iv) + "." + b64(encrypted)).commit()) { "激活进度保存失败，请重试。" }
    }
    private fun read(): JSONObject? {
        val raw = prefs.getString("pending", null) ?: return null
        return runCatching {
            val parts = raw.split('.')
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, stateKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.DEFAULT))) }
            JSONObject(String(cipher.doFinal(Base64.decode(parts[1], Base64.DEFAULT)), Charsets.UTF_8))
        }.getOrElse { throw IllegalStateException("本机激活凭据不可读取，请联系售后核验。", it) }
    }
    private fun proofKey(): java.security.PrivateKey {
        if (!store.containsAlias(proofAlias)) {
            require(!prefs.contains("pending")) { "本机设备证明已丢失，请联系售后核验。" }
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(proofAlias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
            }.generateKeyPair()
        }
        return store.getKey(proofAlias, null) as java.security.PrivateKey
    }
    @Synchronized fun resume(): Boolean {
        val state = read() ?: return false
        if (state.optBoolean("completed")) return false
        exchange(state.optString("code"), false)
        return true
    }
    @Synchronized fun recover() { exchange("", true) }
    @Synchronized fun activate(raw: String) { exchange(raw, false) }
    private fun exchange(raw: String, recover: Boolean) {
        val code = if (raw.isNotBlank()) LicenseQrPayload.normalize(raw) else null
        require(raw.isBlank() || code?.startsWith("AEC1") == true) { "请输入完整的联网激活码。" }
        val signingKey = proofKey()
        val publicKey = b64(store.getCertificate(proofAlias).publicKey.encoded)
        var state = read()
        if (code != null && state?.optString("codeHash") != sha(code)) {
            state = JSONObject().put("code", code).put("codeHash", sha(code)).put("operationId", UUID.randomUUID().toString())
            save(state)
        }
        require(state != null) { "没有可恢复的激活记录，请输入激活码。" }
        val route = if (recover) "/v1/activations/recover" else "/v1/activations/redeem"
        val timestamp = System.currentTimeMillis()
        val nonce = ByteArray(24).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val fields = listOf(route, state.getString("operationId"), "ANDROID_STANDALONE", license.deviceId(), publicKey, state.getString("codeHash"), timestamp.toString(), nonce)
        val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(signingKey); update(fields.joinToString("\n").toByteArray(Charsets.UTF_8)) }.sign()
        val body = JSONObject().put("operationId", state.getString("operationId")).put("productId", "ANDROID_STANDALONE")
            .put("deviceId", license.deviceId()).put("publicKey", publicKey).put("codeHash", state.getString("codeHash"))
            .put("timestamp", timestamp).put("nonce", nonce).put("signature", b64(signature))
        if (!recover) body.put("code", state.getString("code"))
        val connection = URL("https://www.greatbg.com/edu-activation$route").openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"; connection.connectTimeout = 15000; connection.readTimeout = 20000
            connection.instanceFollowRedirects = false; connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = requireNotNull(stream) { "激活服务响应不可读取，请稍后重试。" }.use { source ->
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
                while (true) { val n = source.read(buffer); if (n < 0) break; require(output.size() + n <= 32768) { "激活响应过大。" }; output.write(buffer, 0, n) }
                output.toByteArray()
            }
            val result = JSONObject(String(bytes, Charsets.UTF_8))
            require(status in 200..299 && result.optBoolean("ok")) { result.optString("message", "激活服务暂不可用，请稍后重试。") }
            license.activate(result.getString("licenseToken"))
            state.put("operationId", result.getString("operationId")).put("completed", true)
            save(state)
        } finally { connection.disconnect() }
    }
}
