package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Base64
import org.json.JSONObject
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

data class LocalLicenseStatus(
    val active: Boolean,
    val message: String,
    val licenseId: String = "",
    val edition: String = "",
    val maxActiveStudents: Int = 0,
    val expiresAt: String = "",
)

class LicenseManager(private val context: Context) {
    private val preferences = context.getSharedPreferences("standalone-license-v3", Context.MODE_PRIVATE)

    fun deviceId(): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        val signingDigest = signingCertificateDigest()
        val raw = "$PRODUCT_ID|${context.packageName}|$androidId|$signingDigest"
        val digest = sha256(raw.toByteArray()).take(16).uppercase()
        return "ANDROID-${digest.chunked(4).joinToString("-")}"
    }

    fun status(): LocalLicenseStatus {
        val token = preferences.getString(KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) return LocalLicenseStatus(false, "Android 单机版尚未激活。")
        return verify(token).getOrElse { LocalLicenseStatus(false, it.message ?: "License 验证失败。") }
    }

    fun activate(token: String): LocalLicenseStatus {
        val checked = verify(token.trim()).getOrThrow()
        preferences.edit().putString(KEY_TOKEN, token.trim()).apply()
        return checked
    }

    fun clear() {
        preferences.edit().remove(KEY_TOKEN).apply()
    }

    fun requireActive(): LocalLicenseStatus {
        val current = status()
        require(current.active) { current.message }
        return current
    }
    internal fun gatewayLicenseToken(): String { requireActive(); return preferences.getString(KEY_TOKEN, "").orEmpty().also { require(it.isNotBlank()) } }

    fun requireCanAddStudent(currentActiveStudents: Int) {
        val current = requireActive()
        require(currentActiveStudents < current.maxActiveStudents) {
            "当前授权最多管理 ${current.maxActiveStudents} 名活跃学生，现有 $currentActiveStudents 名。请归档暂不使用的学生或升级授权。"
        }
    }

    private fun verify(token: String): Result<LocalLicenseStatus> = runCatching {
        val parts = token.split('.')
        require(parts.size == 3 && parts[0] == "AIE3") { "激活码格式不正确。" }
        val payloadBytes = decodeUrl(parts[1])
        val payload = JSONObject(payloadBytes.toString(Charsets.UTF_8))
        require(payload.optString("schema") == "edu-manager.license.v3") { "激活码版本不受支持。" }
        require(payload.optString("productId") == PRODUCT_ID) { "该激活码不属于 Android 单机版。" }
        val keyId = payload.optString("keyId")
        val publicKey = trustedPublicKey(keyId)
        val signature = Signature.getInstance("SHA256withRSA")
        signature.initVerify(publicKey)
        signature.update("AIE3.${parts[1]}".toByteArray(Charsets.UTF_8))
        require(signature.verify(decodeUrl(parts[2]))) { "激活码签名校验失败。" }
        val boundDevice = payload.optString("deviceId").trim().uppercase()
        require(boundDevice.isNotBlank() && boundDevice == deviceId()) { "激活码与本机设备码不匹配。" }
        val issuedAt = payload.optString("issuedAt")
        require(issuedAt.isNotBlank()) { "激活码缺少签发时间。" }
        parseTimestamp(issuedAt)
        val expiresAt = payload.optString("expiresAt")
        if (expiresAt.isNotBlank()) require(System.currentTimeMillis() <= parseTimestamp(expiresAt)) { "激活码已过期。" }
        val maxStudents = payload.optInt("maxActiveStudents", 0)
        require(maxStudents in 1..9999) { "激活码学生席位无效。" }
        LocalLicenseStatus(
            active = true,
            message = "已激活",
            licenseId = payload.optString("licenseId"),
            edition = payload.optString("edition"),
            maxActiveStudents = maxStudents,
            expiresAt = expiresAt,
        )
    }

    private fun trustedPublicKey(keyId: String): java.security.PublicKey {
        val root = JSONObject(context.resources.openRawResource(R.raw.trusted_license_issuers).bufferedReader().use { it.readText() })
        val issuers = root.getJSONArray("issuers")
        for (index in 0 until issuers.length()) {
            val issuer = issuers.getJSONObject(index)
            if (issuer.optString("keyId") != keyId) continue
            val pem = issuer.getString("publicKey")
            val der = Base64.decode(pem.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replace("\n", "").trim(), Base64.DEFAULT)
            return KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
        }
        throw IllegalArgumentException("激活码签发密钥不受信任。")
    }

    @Suppress("DEPRECATION")
    private fun signingCertificateDigest(): String {
        val signatures = if (Build.VERSION.SDK_INT >= 28) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners.orEmpty()
        } else {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures.orEmpty()
        }
        return sha256(signatures.firstOrNull()?.toByteArray() ?: ByteArray(0)).take(24)
    }

    private fun decodeUrl(value: String): ByteArray = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private fun sha256(value: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
    private fun parseTimestamp(value: String): Long {
        val normalized = value.replace(Regex("([+-]\\d{2}):(\\d{2})$"), "$1$2")
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX")) {
            runCatching {
                val parser = SimpleDateFormat(pattern, Locale.US).apply { isLenient = false; timeZone = TimeZone.getTimeZone("UTC") }
                return requireNotNull(parser.parse(normalized)).time
            }
        }
        throw IllegalArgumentException("激活码时间格式无效。")
    }

    companion object {
        const val PRODUCT_ID = "ANDROID_STANDALONE"
        private const val KEY_TOKEN = "license-token"
    }
}
