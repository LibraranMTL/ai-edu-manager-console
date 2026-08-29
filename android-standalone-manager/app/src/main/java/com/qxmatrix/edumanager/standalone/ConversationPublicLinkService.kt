package com.qxmatrix.edumanager.standalone

import java.net.HttpURLConnection
import java.net.IDN
import java.net.InetAddress
import java.net.URI

/** Fetches only a user-entered public HTTPS conversation page; it never authenticates or follows redirects. */
object ConversationPublicLinkService {
    fun fetch(value: String): String {
        val uri = URI(value.trim())
        require(uri.scheme.equals("https", true)) { "只支持 HTTPS 链接" }
        require(uri.userInfo == null && (uri.port == -1 || uri.port == 443)) { "链接不能包含账号信息或非标准端口" }
        val host = IDN.toASCII(uri.host.orEmpty()).lowercase(); require(host.isNotBlank() && isPublicHost(host)) { "只允许公开互联网主机" }
        require(InetAddress.getAllByName(host).all(::isPublicAddress)) { "链接解析到本机或局域网地址，已拒绝读取" }
        val connection = uri.toURL().openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false; connection.connectTimeout = 10_000; connection.readTimeout = 20_000
        connection.setRequestProperty("Accept", "text/plain,text/markdown,application/json,text/html;q=0.8")
        connection.setRequestProperty("User-Agent", "AI-Education-Manager-Android/1.2")
        try {
            val code = connection.responseCode
            require(code in 200..299) { if (code in 300..399) "公开链接发生跳转，请粘贴跳转后的最终 HTTPS 地址" else "公开链接请求失败：HTTP $code" }
            val mediaType = connection.contentType.orEmpty().substringBefore(';').trim().lowercase()
            require(mediaType.isBlank() || mediaType in ALLOWED_MEDIA_TYPES || mediaType.endsWith("+json")) { "公开链接不是文本、Markdown、JSON 或 HTML" }
            val length = connection.contentLength; require(length < 0 || length <= MAX_BYTES) { "公开对话超过 5 MB" }
            val bytes = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(16 * 1024); var total = 0
                while (true) { val read = input.read(buffer); if (read < 0) break; total += read; require(total <= MAX_BYTES) { "公开对话超过 5 MB" }; output.write(buffer, 0, read) }
                output.toByteArray()
            }
            val raw = bytes.toString(Charsets.UTF_8).trim(); require(raw.isNotBlank()) { "公开链接没有可导入文字" }
            return if (connection.contentType.orEmpty().contains("text/html", true)) htmlToText(raw) else raw
        } finally { connection.disconnect() }
    }

    internal fun isPublicHost(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false
        val ipv4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$").matchEntire(host) ?: return !host.contains(':')
        val parts = ipv4.groupValues.drop(1).map(String::toInt); if (parts.any { it !in 0..255 }) return false
        val a = parts[0]; val b = parts[1]
        return !(a == 10 || a == 127 || a == 0 || (a == 169 && b == 254) || (a == 172 && b in 16..31) || (a == 192 && b == 168) || a >= 224)
    }

    private fun isPublicAddress(address: InetAddress): Boolean = !address.isAnyLocalAddress && !address.isLoopbackAddress &&
        !address.isLinkLocalAddress && !address.isSiteLocalAddress && !address.isMulticastAddress

    internal fun htmlToText(value: String): String = value
        .replace(Regex("(?is)<(script|style)[^>]*>.*?</\\1>"), " ")
        .replace(Regex("(?i)<br\\s*/?>|</p>|</div>|</li>|</h[1-6]>") , "\n")
        .replace(Regex("<[^>]+>"), " ")
        .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
        .lineSequence().map { it.replace(Regex("\\s+"), " ").trim() }.filter(String::isNotBlank).joinToString("\n").trim()

    private const val MAX_BYTES = 5 * 1024 * 1024
    private val ALLOWED_MEDIA_TYPES = setOf("text/plain", "text/markdown", "text/html", "application/xhtml+xml", "application/json")
}
