package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal object PublicCourseContract {
    const val CONTRACT_ID = "edu-manager.public-course-mvp.v1"
    const val MANIFEST_PATH = "v2/public-content/manifest"
    const val REVOCATIONS_PATH = "v2/public-content/revocations"
    const val DEFAULT_BASE_URL = "https://www.greatbg.com/edu-cloud"
    const val MAX_MANIFEST_BYTES = 2L * 1024 * 1024
    const val MAX_ASSET_BYTES = 5L * 1024 * 1024
    const val MAX_TOTAL_ASSET_BYTES = 50L * 1024 * 1024

    fun endpoint(baseUrl: String, relativePath: String, allowHttpForTests: Boolean = false): String {
        val base = URI(baseUrl.trim())
        require((base.scheme == "https" || (allowHttpForTests && base.scheme == "http")) && base.userInfo == null && base.host != null) {
            "公共课程地址必须是无账号信息的 HTTPS 地址"
        }
        require(base.query == null && base.fragment == null) { "公共课程基址不能包含查询或片段" }
        val prefix = base.path.orEmpty().trimEnd('/')
        val relative = relativePath.trim().removePrefix("/")
        require(relative.matches(Regex("^v2/public-content/(manifest|revocations|assets/asset-rev-[a-f0-9]{64})$"))) { "公共课程接口路径不受支持" }
        return URI(base.scheme, null, base.host, base.port, "$prefix/$relative", null, null).toString()
    }

    fun extension(mimeType: String): String = when (mimeType) {
        "image/png" -> "png"
        "image/jpeg" -> "jpg"
        "image/webp" -> "webp"
        else -> error("公共课程资源类型不受支持：$mimeType")
    }

    fun sniffImageMime(bytes: ByteArray): String = when {
        bytes.size >= 8 && bytes.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) -> "image/png"
        bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte() -> "image/jpeg"
        bytes.size >= 12 && bytes.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" && bytes.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP" -> "image/webp"
        else -> ""
    }
}

/** Signed public course synchronization. Student-private files never enter this cache. */
class PublicCourseSyncService(context: Context) {
    private val appContext = context.applicationContext
    private val state = PrivateStateStore(appContext)
    private val preferences = appContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun sync(baseUrl: String = PublicCourseContract.DEFAULT_BASE_URL, nowMillis: Long = System.currentTimeMillis()): JSONObject {
        val manifestResponse = UnifiedNetworkClient.execute(NetworkRequest(
            url = PublicCourseContract.endpoint(baseUrl, PublicCourseContract.MANIFEST_PATH),
            headers = preferences.getString(KEY_MANIFEST_ETAG, "").orEmpty().takeIf(String::isNotBlank)?.let { mapOf("If-None-Match" to it) }.orEmpty(),
            readTimeoutMs = 30_000,
            maxResponseBytes = PublicCourseContract.MAX_MANIFEST_BYTES,
        ))
        val active = when (manifestResponse.status) {
            200 -> adoptManifest(baseUrl, JSONObject(manifestResponse.body.toString(Charsets.UTF_8)), nowMillis)
            304 -> verifiedActive(nowMillis, requireLease = false) ?: error("服务端返回304但本机没有可验证的公共课程缓存")
            else -> error("公共课程清单读取失败：HTTP ${manifestResponse.status}")
        }
        val acceptedManifestEtag = header(manifestResponse, "etag")?.takeIf(String::isNotBlank)
        syncRevocations(baseUrl, nowMillis)
        active.put("lastCheckedAt", iso(nowMillis))
        state.writeBytes(CLOUD_ACTIVE, active.toString(2).toByteArray())
        acceptedManifestEtag?.let { preferences.edit().putString(KEY_MANIFEST_ETAG, it).apply() }
        val catalog = catalogFromActive(active, nowMillis)
        val result = JSONObject().put("ok", true).put("manifestRevision", active.getJSONObject("manifest").getString("manifestRevision"))
            .put("courseCount", catalog.getJSONArray("courses").length()).put("notModified", manifestResponse.status == 304)
            .put("synchronizedAt", iso(nowMillis))
        state.writeBytes(SYNC_STATUS, result.toString(2).toByteArray())
        return result
    }

    fun cloudCatalog(nowMillis: Long = System.currentTimeMillis()): JSONObject? =
        verifiedActive(nowMillis, requireLease = true)?.let { catalogFromActive(it, nowMillis) }

    fun hasCloudCache(): Boolean = state.readIfPresent(CLOUD_ACTIVE) != null

    fun revokedCourseIds(): Set<String> {
        val record = state.readIfPresent(CLOUD_REVOCATIONS) ?: return emptySet()
        val payload = JSONObject(record.toString(Charsets.UTF_8))
        verifySigned(payload)
        return jsonObjects(payload.optJSONArray("tombstones")).map { it.optString("courseId") }.filter(String::isNotBlank).toSet()
    }

    fun status(): JSONObject = state.readIfPresent(SYNC_STATUS)?.let { JSONObject(it.toString(Charsets.UTF_8)) }
        ?: JSONObject().put("ok", false).put("message", "尚未同步云端课程")

    private fun adoptManifest(baseUrl: String, manifest: JSONObject, nowMillis: Long): JSONObject {
        verifyManifest(manifest, nowMillis)
        val assets = jsonObjects(manifest.getJSONArray("assets"))
        require(assets.sumOf { it.getLong("bytes") } <= PublicCourseContract.MAX_TOTAL_ASSET_BYTES) { "公共课程资源合计超过50 MB" }
        val assetIds = assets.associateBy { it.getString("assetRevisionId") }
        val requiredAssetIds = jsonObjects(manifest.getJSONArray("courses")).map { it.getString("coverAssetRevisionId") }.toSet()
        require(requiredAssetIds.all(assetIds::containsKey)) { "公共课程封面引用不存在" }
        for (asset in assets) {
            val bytes = readCachedAsset(asset) ?: downloadAsset(baseUrl, asset)
            validateAsset(asset, bytes)
            state.writeBytes("$CLOUD_ASSET_ROOT/${asset.getString("sha256")}.${PublicCourseContract.extension(asset.getString("mimeType"))}", bytes)
        }
        val active = JSONObject().put("schema", "edu-manager.public-course-cache.v1").put("manifest", manifest)
            .put("lastCheckedAt", iso(nowMillis)).put("adoptedAt", iso(nowMillis))
        return active
    }

    private fun syncRevocations(baseUrl: String, nowMillis: Long) {
        val response = UnifiedNetworkClient.execute(NetworkRequest(
            url = PublicCourseContract.endpoint(baseUrl, PublicCourseContract.REVOCATIONS_PATH),
            headers = preferences.getString(KEY_REVOCATIONS_ETAG, "").orEmpty().takeIf(String::isNotBlank)?.let { mapOf("If-None-Match" to it) }.orEmpty(),
            readTimeoutMs = 20_000,
            maxResponseBytes = PublicCourseContract.MAX_MANIFEST_BYTES,
        ))
        when (response.status) {
            200 -> {
                val payload = JSONObject(response.body.toString(Charsets.UTF_8)); verifySigned(payload)
                require(payload.optString("revocationRevision").isNotBlank()) { "撤回增量缺少修订号" }
                state.writeBytes(CLOUD_REVOCATIONS, payload.toString(2).toByteArray())
                header(response, "etag")?.takeIf(String::isNotBlank)?.let { preferences.edit().putString(KEY_REVOCATIONS_ETAG, it).apply() }
            }
            304 -> require(state.readIfPresent(CLOUD_REVOCATIONS) != null) { "服务端返回304但本机没有撤回清单缓存" }
            404 -> Unit
            else -> error("公共课程撤回清单读取失败：HTTP ${response.status}")
        }
        state.writeBytes(REVOCATION_CHECK, JSONObject().put("checkedAt", iso(nowMillis)).toString().toByteArray())
    }

    private fun verifiedActive(nowMillis: Long, requireLease: Boolean): JSONObject? {
        val raw = state.readIfPresent(CLOUD_ACTIVE) ?: return null
        return runCatching {
            val active = JSONObject(raw.toString(Charsets.UTF_8)); require(active.getString("schema") == "edu-manager.public-course-cache.v1")
            val manifest = active.getJSONObject("manifest"); verifyManifest(manifest, nowMillis, requireLease)
            for (asset in jsonObjects(manifest.getJSONArray("assets"))) validateAsset(asset, requireNotNull(readCachedAsset(asset)) { "公共课程资源缓存缺失" })
            active
        }.getOrNull()
    }

    private fun verifyManifest(manifest: JSONObject, nowMillis: Long, requireLease: Boolean = true) {
        verifySigned(manifest)
        require(manifest.getInt("schemaVersion") == 1 && manifest.getString("manifestRevision").matches(Regex("^manifest-rev-[a-f0-9]{32}$"))) { "公共课程清单版本无效" }
        require(parseTime(manifest.getString("effectiveAt")) <= nowMillis) { "公共课程清单尚未生效" }
        if (requireLease) require(parseTime(manifest.getString("expiresAt")) > nowMillis) { "公共课程清单离线租约已到期" }
        val ids = linkedSetOf<String>()
        for (course in jsonObjects(manifest.getJSONArray("courses"))) {
            require(ids.add(course.getString("courseId"))) { "公共课程ID重复" }
            require(course.getString("locale") in SUPPORTED_LOCALES) { "公共课程语言不受支持" }
            require(course.getString("launchUrl").startsWith("https://")) { "公共课程入口必须使用HTTPS" }
            require(course.getInt("offlineOpenTtlSeconds") in 0..21_600) { "公共课程离线租约不受支持" }
        }
    }

    private fun verifySigned(payload: JSONObject) {
        require(payload.getString("contractId") == PublicCourseContract.CONTRACT_ID && payload.getString("signatureAlgorithm") == "RSA-SHA256") { "公共课程签名合同无效" }
        val signature = payload.getString("signature")
        val unsigned = JSONObject(payload.toString()).also { it.remove("signature") }
        require(verifyCoursePublisherSignature(appContext, payload.getString("keyId"), CourseCatalogCanonicalJson.canonicalize(unsigned).toByteArray(), signature)) {
            "公共课程发布者签名验证失败"
        }
    }

    private fun catalogFromActive(active: JSONObject, nowMillis: Long): JSONObject {
        val manifest = active.getJSONObject("manifest")
        val checkedAt = parseTime(active.getString("lastCheckedAt"))
        val manifestExpiry = parseTime(manifest.getString("expiresAt"))
        val assets = jsonObjects(manifest.getJSONArray("assets")).associateBy { it.getString("assetRevisionId") }
        val revoked = revokedCourseIds() + jsonObjects(manifest.optJSONArray("tombstones")).map { it.optString("courseId") }
        val courses = JSONArray()
        for (source in jsonObjects(manifest.getJSONArray("courses"))) {
            if (!source.optBoolean("defaultEnabled", true) || source.getString("courseId") in revoked) continue
            val asset = requireNotNull(assets[source.getString("coverAssetRevisionId")])
            val openUntil = minOf(manifestExpiry, checkedAt + source.getLong("offlineOpenTtlSeconds") * 1000L)
            if (openUntil <= nowMillis) continue
            courses.put(JSONObject().put("courseId", source.getString("courseId"))
                .put("type", if (source.getString("courseId").startsWith("tenant:")) "tenant_custom" else "platform_standard")
                .put("name", source.getString("title")).put("provider", source.getString("provider"))
                .put("url", source.getString("launchUrl")).put("allowedHosts", source.getJSONArray("allowedHosts"))
                .put("coverAsset", "cloud-assets/${asset.getString("sha256")}.${PublicCourseContract.extension(asset.getString("mimeType"))}")
                .put("summary", source.getString("summary")).put("legalNotice", source.getString("legalNotice"))
                .put("status", "active").put("effectiveAt", manifest.getString("effectiveAt")).put("expiresAt", iso(openUntil))
                .put("subjects", JSONArray()).put("gradeRange", source.getJSONArray("gradeBands"))
                .put("languages", JSONArray().put(source.getString("locale"))).put("accountRequirement", source.optString("accountRequirement")))
        }
        return JSONObject().put("schemaVersion", 1).put("catalogVersion", manifest.getString("manifestRevision"))
            .put("manifestRevision", manifest.getString("manifestRevision")).put("issuedAt", manifest.getString("issuedAt"))
            .put("courses", courses).put("source", "cloud-public-content").put("cloudFreshUntil", manifest.getString("expiresAt"))
    }

    private fun readCachedAsset(asset: JSONObject): ByteArray? = state.readIfPresent("$CLOUD_ASSET_ROOT/${asset.getString("sha256")}.${PublicCourseContract.extension(asset.getString("mimeType"))}")

    private fun downloadAsset(baseUrl: String, asset: JSONObject): ByteArray {
        require(asset.getLong("bytes") in 1..PublicCourseContract.MAX_ASSET_BYTES) { "公共课程资源大小无效" }
        val response = UnifiedNetworkClient.execute(NetworkRequest(
            url = PublicCourseContract.endpoint(baseUrl, asset.getString("downloadPath")),
            readTimeoutMs = 60_000,
            maxResponseBytes = PublicCourseContract.MAX_ASSET_BYTES,
        ))
        require(response.status == 200) { "公共课程资源读取失败：HTTP ${response.status}" }
        return response.body
    }

    private fun validateAsset(asset: JSONObject, bytes: ByteArray) {
        require(bytes.size.toLong() == asset.getLong("bytes") && sha256(bytes) == asset.getString("sha256")) { "公共课程资源哈希不匹配" }
        require(PublicCourseContract.sniffImageMime(bytes) == asset.getString("mimeType")) { "公共课程资源内容类型不匹配" }
    }

    private fun header(response: NetworkResponse, name: String): String? = response.headers.entries.firstOrNull { it.key.equals(name, true) }?.value?.firstOrNull()
    private fun jsonObjects(array: JSONArray?): List<JSONObject> = if (array == null) emptyList() else (0 until array.length()).map { array.getJSONObject(it) }
    private fun parseTime(value: String): Long {
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX")) {
            runCatching { SimpleDateFormat(pattern, Locale.US).apply { isLenient = false; timeZone = TimeZone.getTimeZone("UTC") }.parse(value)?.time }
                .getOrNull()?.let { return it }
        }
        error("公共课程时间格式无效")
    }
    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun iso(value: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(value))

    companion object {
        const val CLOUD_ACTIVE = "courses/cloud/active.json"
        const val CLOUD_REVOCATIONS = "courses/cloud/revocations.json"
        const val CLOUD_ASSET_ROOT = "courses/cloud/assets"
        const val SYNC_STATUS = "courses/cloud/sync-status.json"
        const val REVOCATION_CHECK = "courses/cloud/revocation-check.json"
        private const val PREFERENCES = "public-course-sync-v1"
        private const val KEY_MANIFEST_ETAG = "manifest-etag"
        private const val KEY_REVOCATIONS_ETAG = "revocations-etag"
        private val SUPPORTED_LOCALES = setOf("zh-CN", "zh-TW", "en-US", "en-GB", "fr", "es", "es-419", "ja", "ko", "vi", "ms")
    }
}
