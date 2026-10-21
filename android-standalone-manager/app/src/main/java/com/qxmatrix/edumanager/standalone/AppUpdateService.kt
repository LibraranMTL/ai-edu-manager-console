package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.security.MessageDigest

data class StandaloneUpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val notes: String,
)

class AppUpdateService(private val context: Context) {
    fun check(currentVersionCode: Int): StandaloneUpdateInfo? {
        val manifest = readJson(UPDATE_MANIFEST_URL)
        val versionCode = manifest.optInt("standaloneVersionCode", 0)
        val versionName = manifest.optString("standaloneVersionName")
        val apkUrl = manifest.optString("standaloneApkUrl")
        val sha256 = manifest.optString("standaloneSha256")
        val notes = manifest.optString("standaloneNotes")
        require(versionCode > 0 && versionName.isNotBlank()) { "更新清单缺少 Android 单机版版本信息" }
        if (versionCode <= currentVersionCode) return null
        requireAllowedDownload(apkUrl)
        require(sha256.isBlank() || sha256.matches(Regex("[a-fA-F0-9]{64}"))) { "更新清单 SHA-256 格式无效" }
        return StandaloneUpdateInfo(versionCode, versionName, apkUrl, sha256.uppercase(), notes)
    }

    fun download(update: StandaloneUpdateInfo, progress: (Int) -> Unit): File {
        requireAllowedDownload(update.apkUrl)
        val directory = File(context.cacheDir, "updates").apply { mkdirs() }
        val temporary = File(directory, "standalone-${update.versionCode}.apk.part")
        val target = File(directory, "standalone-${update.versionCode}.apk")
        temporary.delete(); target.delete()
        val connection = UnifiedNetworkClient.openConnection(NetworkRequest(update.apkUrl,
            headers = mapOf("Accept" to "application/vnd.android.package-archive, application/octet-stream"),
            connectTimeoutMs = 10_000, readTimeoutMs = 60_000, maxResponseBytes = MAX_APK_BYTES, followRedirects = true))
        try {
            val code = connection.responseCode
            require(code in 200..299) { "下载新版 APK 失败：HTTP $code" }
            requireAllowedDownload(connection.url.toString())
            val declared = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
            require(declared in 1..MAX_APK_BYTES) { "新版 APK 大小无效或超过限制" }
            connection.inputStream.use { input -> temporary.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024); var total = 0L; var last = -1
                while (true) {
                    val read = input.read(buffer); if (read < 0) break
                    total += read; require(total <= MAX_APK_BYTES) { "新版 APK 超过限制" }
                    output.write(buffer, 0, read)
                    val percent = (total * 100 / declared).toInt().coerceIn(0, 100)
                    if (percent >= last + 5 || percent == 100) { last = percent; progress(percent) }
                }
                require(total == declared) { "新版 APK 下载不完整" }
            } }
            if (update.sha256.isNotBlank()) require(sha256(temporary) == update.sha256) { "新版 APK SHA-256 校验失败" }
            require(temporary.renameTo(target)) { "无法固定新版 APK 文件" }
            return target
        } finally {
            connection.disconnect()
            if (!target.exists()) temporary.delete()
        }
    }

    private fun readJson(url: String): JSONObject {
        val response = UnifiedNetworkClient.execute(NetworkRequest(url, headers = mapOf("Accept" to "application/json"),
            connectTimeoutMs = 8_000, readTimeoutMs = 15_000, maxResponseBytes = 1_000_000))
        require(response.status in 200..299) { "检查更新失败：HTTP ${response.status}" }
        return JSONObject(response.body.toString(Charsets.UTF_8))
    }

    private fun requireAllowedDownload(value: String) {
        val url = URL(value)
        require(url.protocol == "https" && url.host.equals("www.greatbg.com", true) && url.path.startsWith("/download/")) {
            "更新下载地址不在官方 HTTPS 白名单"
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read) }
        }
        return digest.digest().joinToString("") { "%02X".format(it) }
    }

    companion object {
        const val UPDATE_MANIFEST_URL = "https://www.greatbg.com/download/edu-manager-version.json"
        private const val MAX_APK_BYTES = 500L * 1024 * 1024
    }
}
