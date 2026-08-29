package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

data class CollaborationNodeIdentity(
    val nodeId: String,
    val displayName: String,
    val machineCode: String,
    val createdAt: String,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("schema", CollaborationPairingProtocol.NODE_SCHEMA)
        put("protocolVersion", CollaborationPairingProtocol.PROTOCOL_VERSION)
        put("nodeId", nodeId)
        put("displayName", displayName)
        put("machineCode", machineCode)
        put("ownerIdentityId", "")
        put("publicKey", "")
        put("capabilities", JSONArray(listOf(
            "device-trust-v1",
            "student-mapping-v1",
            "revision-manifest-v1",
            "persistent-queue-v1",
            "android-nearby-v1",
            "lan-direct-v1",
        )))
        put("transportOffers", JSONArray())
        put("createdAt", createdAt)
        put("revokedAt", "")
    }
}

class CollaborationNodeIdentityStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("collaboration_node", Context.MODE_PRIVATE)

    fun get(): CollaborationNodeIdentity {
        val existing = preferences.getString("node_id", "").orEmpty()
        if (existing.isNotBlank()) return identity(existing)
        val nodeId = "node-android-${UUID.randomUUID()}"
        check(preferences.edit().putString("node_id", nodeId).putString("created_at", utcNow()).commit()) {
            "无法保存本机协作身份"
        }
        return identity(nodeId)
    }

    private fun identity(nodeId: String): CollaborationNodeIdentity {
        val model = listOf(Build.MANUFACTURER, Build.MODEL).map { it.trim() }.filter { it.isNotBlank() }.distinct().joinToString(" ")
        return CollaborationNodeIdentity(
            nodeId = nodeId,
            displayName = (model.ifBlank { "Android 单机版" } + " · AI教育管家").take(80),
            machineCode = CollaborationCrypto.sha256(nodeId).take(16).uppercase(),
            createdAt = preferences.getString("created_at", "").orEmpty().ifBlank { utcNow() },
        )
    }
}

class CollaborationSecretCipher {
    fun encrypt(value: String, deviceBindingId: String): String {
        require(value.isNotBlank()) { "协作密钥不能为空" }
        require(deviceBindingId.isNotBlank()) { "协作设备标识不能为空" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        cipher.updateAAD(deviceBindingId.toByteArray(Charsets.UTF_8))
        return "v2:" + Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    fun decrypt(value: String, deviceBindingId: String): String {
        require(value.isNotBlank()) { "本机没有保存该协作设备的可信凭据" }
        require(deviceBindingId.isNotBlank()) { "协作设备标识不能为空" }
        val usesDeviceBinding = value.startsWith("v2:")
        val bytes = Base64.decode(if (usesDeviceBinding) value.removePrefix("v2:") else value, Base64.NO_WRAP)
        require(bytes.size > 12) { "协作凭据已损坏" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        if (usesDeviceBinding) cipher.updateAAD(deviceBindingId.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    companion object { private const val KEY_ALIAS = "edu_manager_collaboration_peer_secret_v1" }
}

internal object CollaborationCrypto {
    fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    fun hmac(secret: String, values: List<String>): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(values.joinToString("\u001f").toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    fun constantTimeEquals(left: String, right: String): Boolean = MessageDigest.isEqual(
        left.toByteArray(Charsets.UTF_8),
        right.toByteArray(Charsets.UTF_8),
    )
}

internal fun utcAt(epochMillis: Long): String = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
    timeZone = java.util.TimeZone.getTimeZone("UTC")
}.format(java.util.Date(epochMillis))

internal fun utcNow(): String = utcAt(System.currentTimeMillis())

internal fun parseUtcMillis(value: String): Long {
    val patterns = listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX")
    return patterns.firstNotNullOfOrNull { pattern ->
        runCatching {
            java.text.SimpleDateFormat(pattern, java.util.Locale.US).apply {
                isLenient = false
                timeZone = java.util.TimeZone.getTimeZone("UTC")
            }.parse(value)?.time
        }.getOrNull()
    } ?: 0L
}
