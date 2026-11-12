package com.qxmatrix.edumanager.standalone

import java.net.URL

/** Public endpoint contract for the Alibaba Cloud deployment. Internal loopback ports never reach clients. */
object CloudServiceEndpoint {
    /**
     * The release build points at the production endpoint by default. Signed candidate builds
     * override the same validated BuildConfig value so private uploads and public content cannot
     * accidentally be split across production and candidate environments.
     */
    val OFFICIAL_BASE_URL: String = BuildConfig.PUBLIC_CONTENT_BASE_URL
    const val HEALTH_SERVICE_ID = "edu-cloud-documents"

    fun normalize(value: String): String {
        val raw = value.trim()
        require(!raw.contains('\\') && !Regex("%(?:2e|2f|5c)", RegexOption.IGNORE_CASE).containsMatchIn(raw)) {
            "云端路径不能包含目录跳转"
        }
        val url = URL(raw)
        val local = url.host in setOf("127.0.0.1", "localhost", "[::1]")
        require(url.protocol == "https" || (url.protocol == "http" && local)) {
            "云端地址须使用 HTTPS；仅本机测试允许 HTTP"
        }
        require(url.userInfo == null && url.query == null && url.ref == null &&
            Regex("^/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]*$").matches(url.path.ifBlank { "/" })) {
            "云端地址格式无效"
        }
        return "${url.protocol}://${url.authority}" + url.path.trimEnd('/')
    }

    fun isOfficial(value: String): Boolean = runCatching { normalize(value) == OFFICIAL_BASE_URL }.getOrDefault(false)
}
