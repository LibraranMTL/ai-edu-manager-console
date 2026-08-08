package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipInputStream

internal object CourseCatalogCanonicalJson {
    fun canonicalize(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(separator = ",", prefix = "{", postfix = "}") { key ->
            quote(key) + ":" + canonicalize(value.get(key))
        }
        is JSONArray -> (0 until value.length()).joinToString(separator = ",", prefix = "[", postfix = "]") { canonicalize(value.get(it)) }
        is String -> quote(value)
        is Boolean, is Number -> value.toString()
        else -> quote(value.toString())
    }

    fun quote(value: String): String = buildString(value.length + 2) {
        append('"')
        value.forEach { character ->
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) append("\\u%04x".format(character.code)) else append(character)
            }
        }
        append('"')
    }
}

internal fun catalogNullableText(value: JSONObject, key: String): String =
    if (value.isNull(key)) "" else value.optString(key)

data class PlatformCourse(
    val courseId: String,
    val name: String,
    val provider: String,
    val url: String,
    val allowedHosts: List<String>,
    val coverAsset: String,
    val summary: String,
    val legalNotice: String,
    val status: String,
    val effectiveAt: String,
    val expiresAt: String,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("courseId", courseId); put("type", "platform_standard"); put("name", name); put("provider", provider)
        put("url", url); put("allowedHosts", JSONArray(allowedHosts)); put("coverAsset", coverAsset); put("summary", summary)
        put("legalNotice", legalNotice); put("status", status)
        put("effectiveAt", effectiveAt); put("expiresAt", expiresAt)
    }

    companion object {
        fun fromJson(value: JSONObject): PlatformCourse {
            val id = value.getString("courseId").trim()
            require(value.getString("type") == "platform_standard" && id.startsWith("platform:")) {
                "独立家庭版只接受平台标准课程"
            }
            val hosts = value.getJSONArray("allowedHosts").let { array ->
                buildList { for (index in 0 until array.length()) add(normalizeHost(array.getString(index))) }.distinct()
            }
            require(hosts.isNotEmpty()) { "课程必须声明允许域名" }
            val url = normalizeUrl(value.getString("url"), hosts)
            return PlatformCourse(
                id, requiredText(value, "name"), requiredText(value, "provider"), url, hosts,
                requiredText(value, "coverAsset").also { require(it.matches(Regex("^platform-assets/[a-fA-F0-9]{64}\\.(png|jpg|jpeg|webp)$"))) { "平台课程封面路径无效" } },
                requiredText(value, "summary"), requiredText(value, "legalNotice"), value.optString("status", "active"),
                requiredText(value, "effectiveAt"), catalogNullableText(value, "expiresAt"),
            )
        }

        private fun requiredText(value: JSONObject, key: String): String =
            value.getString(key).trim().also { require(it.isNotBlank()) { "课程缺少 $key" } }

        fun normalizeHost(value: String): String = value.trim().lowercase(Locale.US).removeSuffix(".").also {
            require(it.matches(Regex("^[a-z0-9.-]+$")) && !it.contains('/') && !it.contains(':')) { "无效课程域名" }
        }

        fun normalizeUrl(value: String, allowedHosts: List<String>): String {
            val uri = Uri.parse(value.trim())
            require(uri.scheme in setOf("https", "http") && uri.userInfo == null) { "课程链接必须是无账号信息的 HTTP/HTTPS URL" }
            val host = normalizeHost(uri.host ?: "")
            require(host in allowedHosts) { "课程链接域名不在允许列表" }
            return uri.buildUpon().fragment(null).build().toString()
        }
    }
}

/** Imports the Windows platform course-package v3 and keeps a last-known-good catalog. */
class CourseCatalogService(private val context: Context) {
    private val state = PrivateStateStore(context)

    fun importPlatformPackage(uri: Uri): JSONObject {
        val descriptorLength = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        require(descriptorLength in 1..MAX_PACKAGE_BYTES || descriptorLength == -1L) { "课程包为空或超过 250 MB" }
        val entries = linkedMapOf<String, EntryDigest>()
        val coverPayloads = linkedMapOf<String, ByteArray>()
        var manifestBytes: ByteArray? = null
        var catalogBytes: ByteArray? = null
        var total = 0L
        context.contentResolver.openInputStream(uri)?.use { input ->
            ZipInputStream(input).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val name = safeEntry(entry.name, entry.isDirectory)
                    if (entry.isDirectory) { zip.closeEntry(); continue }
                    require(entries.put(name, EntryDigest(0, "")) == null) { "课程包包含重复文件" }
                    require(entries.size <= MAX_PACKAGE_FILES) { "课程包文件数量超过限制" }
                    val bytes = readBounded(zip, MAX_ENTRY_BYTES)
                    total += bytes.size
                    require(total <= MAX_PACKAGE_BYTES) { "课程包展开后超过 250 MB" }
                    entries[name] = EntryDigest(bytes.size.toLong(), sha256(bytes))
                    if (name == "manifest.json") manifestBytes = bytes
                    if (name == "catalog.json") catalogBytes = bytes
                    if (name.startsWith("assets/")) {
                        require(coverPayloads.values.sumOf { it.size.toLong() } + bytes.size <= MAX_COVER_TOTAL_BYTES) { "课程封面合计不能超过 50 MB" }
                        coverPayloads[name] = bytes
                    }
                    zip.closeEntry()
                }
            }
        } ?: error("无法读取课程包")

        val manifest = JSONObject(requireNotNull(manifestBytes) { "课程包缺少 manifest.json" }.toString(Charsets.UTF_8))
        require(manifest.optString("schema") in setOf(ProtocolBaseline.COURSE_PACKAGE_SCHEMA, "edu-manager.course-package.v2")) {
            "课程包 Schema 不受支持"
        }
        val declared = manifest.getJSONArray("files")
        val declaredNames = linkedSetOf<String>()
        for (index in 0 until declared.length()) {
            val item = declared.getJSONObject(index)
            val name = safeEntry(item.getString("path"), false)
            require(name !in setOf("manifest.json", "signature.json") && declaredNames.add(name)) { "课程包清单包含非法或重复路径" }
            val actual = entries[name] ?: error("课程包缺少 $name")
            require(actual.bytes == item.getLong("bytes") && actual.sha256 == item.getString("sha256")) { "课程包文件校验失败：$name" }
        }
        val archivedPayload = entries.keys.filter { it !in setOf("manifest.json", "signature.json") }.toSet()
        require(declaredNames == archivedPayload) { "课程包文件清单与归档内容不一致" }

        val catalog = JSONObject(requireNotNull(catalogBytes) { "课程包缺少 catalog.json" }.toString(Charsets.UTF_8))
        validateCatalog(catalog)
        val courses = catalog.getJSONArray("courses")
        for (index in 0 until courses.length()) {
            val cover = courses.getJSONObject(index).getString("coverAsset").removePrefix("platform-assets/")
            val asset = entries["assets/$cover"] ?: error("课程包缺少平台课程封面：$cover")
            require(asset.sha256 == cover.substringBefore('.').lowercase(Locale.US)) { "平台课程封面哈希与文件名不一致" }
            state.writeBytes("$COVER_ROOT/$cover", requireNotNull(coverPayloads["assets/$cover"]) { "课程封面读取失败：$cover" })
        }
        require(catalog.getString("catalogVersion") == manifest.getString("catalogVersion")) { "课程目录版本与课程包不一致" }
        val current = lastGoodCatalog()
        if (current != null) require(compareVersions(catalog.getString("catalogVersion"), current.getString("catalogVersion")) >= 0) {
            "较旧课程目录不能覆盖最后可用版本"
        }
        state.writeBytes(LAST_GOOD, catalog.toString(2).toByteArray())
        val result = JSONObject().put("schema", "edu-manager.course-import-audit.v1")
            .put("catalogVersion", catalog.getString("catalogVersion")).put("importedAt", utcTimestamp())
            .put("courseCount", catalog.getJSONArray("courses").length()).put("sourceUri", uri.toString())
        state.writeBytes(IMPORT_AUDIT, result.toString(2).toByteArray())
        return result
    }

    fun lastGoodCatalog(): JSONObject? = try { JSONObject(state.readBytes(LAST_GOOD).toString(Charsets.UTF_8)) } catch (_: Exception) { null }

    fun effectiveCourses(now: Date = Date()): List<PlatformCourse> {
        val catalog = lastGoodCatalog() ?: return emptyList()
        val array = catalog.getJSONArray("courses")
        return buildList {
            for (index in 0 until array.length()) {
                val course = PlatformCourse.fromJson(array.getJSONObject(index))
                if (course.status != "active") continue
                if (parseDate(course.effectiveAt)?.after(now) == true) continue
                if (course.expiresAt.isNotBlank() && parseDate(course.expiresAt)?.before(now) != false) continue
                add(course)
            }
        }
    }

    fun coverBytes(course: PlatformCourse): ByteArray = state.readBytes("$COVER_ROOT/${course.coverAsset.removePrefix("platform-assets/")}")

    private fun validateCatalog(catalog: JSONObject) {
        require(catalog.getInt("schemaVersion") == 1) { "课程目录 Schema 版本不受支持" }
        require(catalog.getString("catalogVersion").isNotBlank()) { "课程目录缺少版本" }
        require(parseDate(catalog.getString("issuedAt")) != null) { "课程目录 issuedAt 无效" }
        require(compareVersions(APP_PROTOCOL_VERSION, catalog.optString("minHostVersion", "0.0.0")) >= 0) { "当前 APK 版本低于课程目录要求" }
        val expected = sha256(CourseCatalogCanonicalJson.canonicalize(unsignedCatalog(catalog)).toByteArray(Charsets.UTF_8))
        require(expected == catalog.getString("checksum")) { "课程目录校验值不匹配" }
        val courses = catalog.getJSONArray("courses")
        val ids = linkedSetOf<String>()
        for (index in 0 until courses.length()) {
            val course = PlatformCourse.fromJson(courses.getJSONObject(index))
            require(ids.add(course.courseId)) { "课程 ID 重复" }
            require(course.status in setOf("active", "withdrawn")) { "课程状态不受支持" }
        }
    }

    private fun unsignedCatalog(value: JSONObject): JSONObject = JSONObject().also { output ->
        value.keys().forEach { key -> if (key !in setOf("checksum", "signature")) output.put(key, value.get(key)) }
    }

    private fun safeEntry(input: String, directory: Boolean): String {
        val name = input.replace('\\', '/').removePrefix("./").removeSuffix(if (directory) "/" else "")
        if (directory && name == "assets") return name
        require(name.matches(Regex("^(manifest\\.json|catalog\\.json|signature\\.json|assets/[a-fA-F0-9]{64}\\.(png|jpg|jpeg|webp))$"))) {
            "课程包包含未知或越界文件"
        }
        return name
    }

    private fun readBounded(input: ZipInputStream, maximum: Int): ByteArray {
        val output = ByteArrayOutputStream(); val buffer = ByteArray(32 * 1024); var total = 0
        while (true) {
            val count = input.read(buffer); if (count < 0) break
            total += count; require(total <= maximum) { "课程包单个文件超过 5 MB" }; output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun parseDate(value: String): Date? {
        val patterns = listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX", "yyyy-MM-dd")
        for (pattern in patterns) {
            val parsed = runCatching { SimpleDateFormat(pattern, Locale.US).apply { isLenient = false }.parse(value) }.getOrNull()
            if (parsed != null) return parsed
        }
        return null
    }

    private fun compareVersions(left: String, right: String): Int {
        val a = left.split(Regex("[.+-]")).map { it.toIntOrNull() ?: 0 }; val b = right.split(Regex("[.+-]")).map { it.toIntOrNull() ?: 0 }
        for (index in 0 until maxOf(a.size, b.size)) { val compared = (a.getOrNull(index) ?: 0).compareTo(b.getOrNull(index) ?: 0); if (compared != 0) return compared }
        return 0
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun utcTimestamp(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
    private data class EntryDigest(val bytes: Long, val sha256: String)

    companion object {
        const val APP_PROTOCOL_VERSION = "1.0.0"
        const val LAST_GOOD = "courses/last-good.json"
        const val IMPORT_AUDIT = "courses/import-audit.json"
        const val MAX_PACKAGE_BYTES = 250L * 1024 * 1024
        const val MAX_ENTRY_BYTES = 5 * 1024 * 1024
        const val MAX_PACKAGE_FILES = 1000
        const val MAX_COVER_TOTAL_BYTES = 50L * 1024 * 1024
        const val COVER_ROOT = "courses/covers"
    }
}
