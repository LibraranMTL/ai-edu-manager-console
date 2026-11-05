package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipInputStream

internal object CourseCatalogCanonicalJson {
    fun canonicalize(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(separator = ",", prefix = "{", postfix = "}") { quote(it) + ":" + canonicalize(value.get(it)) }
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

internal fun catalogNullableText(value: JSONObject, key: String): String = if (value.isNull(key)) "" else value.optString(key)

private fun jsonStrings(array: JSONArray?): List<String> = buildList {
    if (array != null) for (index in 0 until array.length()) add(array.optString(index).trim())
}.filter { it.isNotBlank() }

internal fun verifyCoursePublisherSignature(context: Context, keyId: String, payload: ByteArray, encodedSignature: String): Boolean {
    require(keyId == CourseCatalogService.TRUSTED_COURSE_KEY_ID) { "课程发布密钥不受信任：$keyId" }
    val pem = context.resources.openRawResource(R.raw.course_catalog_public_key).bufferedReader().use { it.readText() }
    val der = Base64.decode(pem.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replace("\n", "").trim(), Base64.DEFAULT)
    val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
    return Signature.getInstance("SHA256withRSA").run {
        initVerify(publicKey); update(payload); verify(Base64.decode(encodedSignature, Base64.DEFAULT))
    }
}

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
    val type: String = "platform_standard",
    val subjects: List<String> = emptyList(),
    val gradeRange: List<String> = emptyList(),
    val languages: List<String> = emptyList(),
    val accountRequirement: String = "",
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("courseId", courseId); put("type", type); put("name", name); put("provider", provider)
        put("url", url); put("allowedHosts", JSONArray(allowedHosts)); put("coverAsset", coverAsset); put("summary", summary)
        put("legalNotice", legalNotice); put("status", status); put("effectiveAt", effectiveAt); put("expiresAt", expiresAt)
        put("subjects", JSONArray(subjects)); put("gradeRange", JSONArray(gradeRange)); put("languages", JSONArray(languages))
        put("accountRequirement", accountRequirement)
    }

    companion object {
        fun fromJson(value: JSONObject): PlatformCourse {
            val id = requiredText(value, "courseId")
            val type = value.optString("type", "platform_standard")
            require(type in setOf("platform_standard", "tenant_custom")) { "课程类型不受支持" }
            require((type == "platform_standard" && id.startsWith("platform:")) || (type == "tenant_custom" && id.startsWith("tenant:"))) { "课程 ID 与类型不匹配" }
            val hosts = jsonStrings(value.optJSONArray("allowedHosts")).map(::normalizeHost).distinct()
            require(hosts.isNotEmpty()) { "课程必须声明允许域名" }
            val cover = requiredText(value, "coverAsset")
            require(cover.matches(Regex("^(platform-assets|custom-assets|catalog-assets|offline-assets|cloud-assets)/[a-zA-Z0-9._-]+\\.(png|jpg|jpeg|webp)$"))) { if (type == "platform_standard") "平台课程封面路径无效" else "机构课程封面路径无效" }
            return PlatformCourse(
                courseId = id,
                name = requiredText(value, "name"),
                provider = requiredText(value, "provider"),
                url = normalizeUrl(requiredText(value, "url"), hosts),
                allowedHosts = hosts,
                coverAsset = cover,
                summary = requiredText(value, "summary"),
                legalNotice = if (type == "platform_standard") requiredText(value, "legalNotice") else value.optString("legalNotice"),
                status = value.optString("status", "active"),
                effectiveAt = value.optString("effectiveAt", "1970-01-01T00:00:00Z"),
                expiresAt = catalogNullableText(value, "expiresAt"),
                type = type,
                subjects = jsonStrings(value.optJSONArray("subjects")),
                gradeRange = jsonStrings(value.optJSONArray("gradeRange")),
                languages = jsonStrings(value.optJSONArray("languages")),
                accountRequirement = value.optString("accountRequirement"),
            )
        }

        private fun requiredText(value: JSONObject, key: String): String = value.getString(key).trim().also { require(it.isNotBlank()) { "课程缺少 $key" } }

        fun normalizeHost(value: String): String = value.trim().lowercase(Locale.US).removeSuffix(".").also {
            require(it.matches(Regex("^[a-z0-9.-]+$")) && !it.contains('/') && !it.contains(':')) { "无效课程域名" }
        }

        fun normalizeUrl(value: String, allowedHosts: List<String>): String {
            val uri = Uri.parse(value.trim())
            require(uri.scheme == "https" && uri.userInfo == null) { "课程链接必须是无账号信息的 HTTPS URL" }
            require(normalizeHost(uri.host ?: "") in allowedHosts) { "课程链接域名不在允许列表" }
            return uri.buildUpon().fragment(null).build().toString()
        }
    }
}

/** Keeps the signed platform catalog separate from exact-student offline course snapshots. */
class CourseCatalogService(private val context: Context) {
    private val state = PrivateStateStore(context)

    fun importPlatformPackage(uri: Uri): JSONObject {
        val descriptorLength = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        require(descriptorLength in 1..MAX_PACKAGE_BYTES || descriptorLength == -1L) { "课程包为空或超过 250 MB" }
        val entries = linkedMapOf<String, EntryDigest>()
        val coverPayloads = linkedMapOf<String, ByteArray>()
        var manifestBytes: ByteArray? = null
        var catalogBytes: ByteArray? = null
        var signatureBytes: ByteArray? = null
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
                    when {
                        name == "manifest.json" -> manifestBytes = bytes
                        name == "catalog.json" -> catalogBytes = bytes
                        name == "signature.json" -> signatureBytes = bytes
                        name.startsWith("assets/") -> {
                            require(coverPayloads.values.sumOf { it.size.toLong() } + bytes.size <= MAX_COVER_TOTAL_BYTES) { "课程封面合计不能超过 50 MB" }
                            coverPayloads[name] = bytes
                        }
                    }
                    zip.closeEntry()
                }
            }
        } ?: error("无法读取课程包")

        val manifest = JSONObject(requireNotNull(manifestBytes) { "课程包缺少 manifest.json" }.toString(Charsets.UTF_8))
        require(manifest.optString("schema") == ProtocolBaseline.COURSE_PACKAGE_SCHEMA) { "仅允许导入发布者签名的 v3 课程包" }
        val signatureRecord = JSONObject(requireNotNull(signatureBytes) { "v3 课程包缺少 signature.json" }.toString(Charsets.UTF_8))
        verifyPackageSignature(manifest, signatureRecord)
        val declared = manifest.getJSONArray("files")
        val declaredNames = linkedSetOf<String>()
        for (index in 0 until declared.length()) {
            val item = declared.getJSONObject(index)
            val name = safeEntry(item.getString("path"), false)
            require(name !in setOf("manifest.json", "signature.json") && declaredNames.add(name)) { "课程包清单包含非法或重复路径" }
            val actual = entries[name] ?: error("课程包缺少 $name")
            require(actual.bytes == item.getLong("bytes") && actual.sha256 == item.getString("sha256")) { "课程包文件校验失败：$name" }
        }
        require(declaredNames == entries.keys.filter { it !in setOf("manifest.json", "signature.json") }.toSet()) { "课程包文件清单与归档内容不一致" }
        val catalog = JSONObject(requireNotNull(catalogBytes) { "课程包缺少 catalog.json" }.toString(Charsets.UTF_8))
        validateCatalog(catalog, setOf("platform_standard"))
        require(catalog.getString("keyId") == signatureRecord.getString("keyId")) { "目录与课程包签名 keyId 不一致" }
        val courses = catalog.getJSONArray("courses")
        for (index in 0 until courses.length()) {
            val cover = courses.getJSONObject(index).getString("coverAsset").substringAfterLast('/')
            val asset = entries["assets/$cover"] ?: error("课程包缺少平台课程封面：$cover")
            require(asset.sha256 == cover.substringBefore('.').lowercase(Locale.US)) { "平台课程封面哈希与文件名不一致" }
            state.writeBytes("$COVER_ROOT/$cover", requireNotNull(coverPayloads["assets/$cover"]) { "课程封面读取失败：$cover" })
        }
        require(catalog.getString("catalogVersion") == manifest.getString("catalogVersion")) { "课程目录版本与课程包不一致" }
        val current = lastGoodCatalog()
        if (current != null) require(compareVersions(catalog.getString("catalogVersion"), current.getString("catalogVersion")) >= 0) { "较旧课程目录不能覆盖最后可用版本" }
        state.writeBytes(LAST_GOOD, catalog.toString(2).toByteArray())
        return JSONObject().put("schema", "edu-manager.course-import-audit.v1").put("catalogVersion", catalog.getString("catalogVersion"))
            .put("importedAt", utcTimestamp()).put("courseCount", courses.length()).put("sourceUri", uri.toString()).also {
                state.writeBytes(IMPORT_AUDIT, it.toString(2).toByteArray())
            }
    }

    fun importOfflineSnapshot(studentId: String, snapshot: JSONObject, coverPayloads: Map<String, ByteArray>): JSONObject {
        require(snapshot.getString("schema") == OFFLINE_SNAPSHOT_SCHEMA) { "课程快照版本不受支持" }
        require(snapshot.getString("studentId") == studentId) { "课程快照与学生不匹配" }
        val courses = snapshot.getJSONArray("courses")
        val normalized = JSONArray()
        val ids = linkedSetOf<String>()
        for (index in 0 until courses.length()) {
            val raw = JSONObject(courses.getJSONObject(index).toString())
            val original = raw.getString("coverAsset")
            val bytes = coverPayloads[original.substringAfterLast('/')] ?: error("迁移目录缺少课程封面：$original")
            require(bytes.size <= MAX_ENTRY_BYTES) { "课程封面过大" }
            val extension = original.substringAfterLast('.', "jpg").lowercase(Locale.US)
            val stored = "${sha256(bytes)}.$extension"
            state.writeBytes("$OFFLINE_COVER_ROOT/$stored", bytes)
            raw.put("coverAsset", "offline-assets/$stored")
            val course = PlatformCourse.fromJson(raw)
            require(ids.add(course.courseId)) { "课程 ID 重复" }
            normalized.put(course.toJson())
        }
        val saved = JSONObject().put("schema", OFFLINE_SNAPSHOT_SCHEMA).put("studentId", studentId)
            .put("catalogVersion", snapshot.optString("catalogVersion", "student-effective-snapshot"))
            .put("importedAt", utcTimestamp()).put("courses", normalized)
        state.writeBytes("$OFFLINE_ROOT/${safeStudentId(studentId)}.json", saved.toString(2).toByteArray())
        return JSONObject().put("studentId", studentId).put("courseCount", normalized.length())
            .put("platformCount", (0 until normalized.length()).count { normalized.getJSONObject(it).getString("type") == "platform_standard" })
            .put("tenantCount", (0 until normalized.length()).count { normalized.getJSONObject(it).getString("type") == "tenant_custom" })
    }

    fun lastGoodCatalog(): JSONObject? {
        val cloud = PublicCourseSyncService(context)
        if (cloud.hasCloudCache()) return cloud.cloudCatalog()
        return try { JSONObject(state.readBytes(LAST_GOOD).toString(Charsets.UTF_8)) } catch (_: Exception) { null }
    }
    fun offlineSnapshot(studentId: String): JSONObject? = try { JSONObject(state.readBytes("$OFFLINE_ROOT/${safeStudentId(studentId)}.json").toString(Charsets.UTF_8)) } catch (_: Exception) { null }

    fun effectiveCourses(studentId: String? = null, now: Date = Date()): List<PlatformCourse> {
        val merged = linkedMapOf<String, PlatformCourse>()
        val cloud = PublicCourseSyncService(context)
        val cloudManaged = cloud.hasCloudCache()
        val revoked = if (cloudManaged) cloud.revokedCourseIds() else emptySet()
        val arrays = buildList<Pair<JSONArray, Boolean>> {
            lastGoodCatalog()?.optJSONArray("courses")?.let { add(it to false) }
            if (!studentId.isNullOrBlank()) offlineSnapshot(studentId)?.optJSONArray("courses")?.let { add(it to true) }
        }
        for ((array, studentSnapshot) in arrays) for (index in 0 until array.length()) {
            val course = PlatformCourse.fromJson(array.getJSONObject(index))
            if (course.courseId in revoked || (cloudManaged && studentSnapshot && course.type == "platform_standard")) continue
            if (course.status != "active") continue
            if (parseDate(course.effectiveAt)?.after(now) == true) continue
            if (course.expiresAt.isNotBlank() && parseDate(course.expiresAt)?.before(now) != false) continue
            merged[course.courseId] = course
        }
        return merged.values.toList()
    }

    fun coverBytes(course: PlatformCourse): ByteArray = when {
        course.coverAsset.startsWith("offline-assets/") -> state.readBytes("$OFFLINE_COVER_ROOT/${course.coverAsset.substringAfterLast('/')}")
        course.coverAsset.startsWith("cloud-assets/") -> state.readBytes("${PublicCourseSyncService.CLOUD_ASSET_ROOT}/${course.coverAsset.substringAfterLast('/')}")
        else -> state.readBytes("$COVER_ROOT/${course.coverAsset.substringAfterLast('/')}")
    }

    private fun validateCatalog(catalog: JSONObject, allowedTypes: Set<String>) {
        require(catalog.getInt("schemaVersion") == 1) { "课程目录 Schema 版本不受支持" }
        require(catalog.getString("catalogVersion").isNotBlank()) { "课程目录缺少版本" }
        require(parseDate(catalog.getString("issuedAt")) != null) { "课程目录 issuedAt 无效" }
        require(compareVersions(APP_PROTOCOL_VERSION, catalog.optString("minHostVersion", "0.0.0")) >= 0) { "当前 APK 版本低于课程目录要求" }
        val expected = sha256(CourseCatalogCanonicalJson.canonicalize(unsignedCatalog(catalog)).toByteArray(Charsets.UTF_8))
        require(expected == catalog.getString("checksum")) { "课程目录校验值不匹配" }
        val keyId = catalog.getString("keyId")
        val signedPayload = "$expected\n${CourseCatalogCanonicalJson.canonicalize(unsignedCatalog(catalog))}".toByteArray(Charsets.UTF_8)
        require(verifyCoursePublisherSignature(context, keyId, signedPayload, catalog.getString("signature"))) { "课程目录发布者签名验证失败" }
        val ids = linkedSetOf<String>(); val courses = catalog.getJSONArray("courses")
        for (index in 0 until courses.length()) {
            val course = PlatformCourse.fromJson(courses.getJSONObject(index))
            require(course.type in allowedTypes) { "课程包包含不允许的课程类型" }
            require(ids.add(course.courseId)) { "课程 ID 重复" }
            require(course.status in setOf("active", "withdrawn")) { "课程状态不受支持" }
        }
    }

    private fun unsignedCatalog(value: JSONObject): JSONObject = JSONObject().also { output ->
        value.keys().forEach { key -> if (key !in setOf("checksum", "signature")) output.put(key, value.get(key)) }
    }

    private fun verifyPackageSignature(manifest: JSONObject, record: JSONObject) {
        require(record.getString("schema") == "edu-manager.course-package-signature.v1" && record.getString("algorithm") == "RSA-SHA256") { "课程包签名格式不受支持" }
        val canonical = CourseCatalogCanonicalJson.canonicalize(manifest).toByteArray(Charsets.UTF_8)
        require(sha256(canonical) == record.getString("manifestSha256")) { "课程包清单签名哈希不匹配" }
        require(verifyCoursePublisherSignature(context, record.getString("keyId"), canonical, record.getString("signature"))) { "课程包发布者签名验证失败" }
    }

    private fun safeEntry(input: String, directory: Boolean): String {
        val name = input.replace('\\', '/').removePrefix("./").removeSuffix(if (directory) "/" else "")
        if (directory && name == "assets") return name
        require(name.matches(Regex("^(manifest\\.json|catalog\\.json|signature\\.json|assets/[a-fA-F0-9]{64}\\.(png|jpg|jpeg|webp))$"))) { "课程包包含未知或越界文件" }
        return name
    }

    private fun readBounded(input: ZipInputStream, maximum: Int): ByteArray {
        val output = ByteArrayOutputStream(); val buffer = ByteArray(32 * 1024); var total = 0
        while (true) { val count = input.read(buffer); if (count < 0) break; total += count; require(total <= maximum) { "课程包单个文件超过 5 MB" }; output.write(buffer, 0, count) }
        return output.toByteArray()
    }

    private fun parseDate(value: String): Date? {
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX", "yyyy-MM-dd")) {
            runCatching { SimpleDateFormat(pattern, Locale.US).apply { isLenient = false }.parse(value) }.getOrNull()?.let { return it }
        }
        return null
    }

    private fun compareVersions(left: String, right: String): Int {
        val a = left.split(Regex("[.+-]")).map { it.toIntOrNull() ?: 0 }; val b = right.split(Regex("[.+-]")).map { it.toIntOrNull() ?: 0 }
        for (index in 0 until maxOf(a.size, b.size)) { val compared = (a.getOrNull(index) ?: 0).compareTo(b.getOrNull(index) ?: 0); if (compared != 0) return compared }
        return 0
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun safeStudentId(value: String): String = value.replace(Regex("[^A-Za-z0-9._-]"), "-").take(100).also { require(it.isNotBlank()) }
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
        const val OFFLINE_ROOT = "courses/offline"
        const val OFFLINE_COVER_ROOT = "courses/offline-covers"
        const val OFFLINE_SNAPSHOT_SCHEMA = "edu-manager.student-course-snapshot.v1"
        const val TRUSTED_COURSE_KEY_ID = "course-catalog-primary-2026"
    }
}
