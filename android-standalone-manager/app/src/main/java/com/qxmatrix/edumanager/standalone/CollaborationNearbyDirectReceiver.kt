package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.util.AtomicFile
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.security.MessageDigest

internal data class CollaborationDirectAuth(
    val map: CollaborationStudentMapEntity,
    val device: CollaborationDeviceEntity,
)

internal class CollaborationNearbyDirectReceiver(context: Context) {
    private val appContext = context.applicationContext
    private val dao = CollaborationDatabase.get(appContext).collaborationDao()
    private val cipher = CollaborationSecretCipher()
    private val node = CollaborationNodeIdentityStore(appContext).get()
    private val nearbyState = CollaborationNearbyStateStore(appContext)
    private val root = File(appContext.filesDir, "collaboration-nearby-inbound").apply { mkdirs() }

    init {
        cleanupStalePackages()
    }

    fun capabilities(): JSONObject = JSONObject().apply {
        put("ok", true); put("transportId", "lan_direct"); put("protocolVersion", "1.1")
        put("supportsStreaming", true); put("supportsResume", true)
        put("maxChunkBytes", MAX_CHUNK_BYTES); put("maxFileBytes", MAX_FILE_BYTES)
        put("peerType", "android_standalone")
    }

    fun noPullAvailable(
        studentMapId: String,
        method: String,
        pathname: String,
        headers: Map<String, String>,
    ): JSONObject {
        val auth = authenticate(method, pathname, headers, EMPTY_SHA256)
        require(auth.map.studentMapId == studentMapId) { "拉取请求超出当前精确学生映射范围" }
        return JSONObject().put("ok", true).put("available", false).put("transport", "android-nearby-direct")
    }

    @Synchronized
    fun initialize(method: String, pathname: String, headers: Map<String, String>, body: ByteArray): JSONObject {
        cleanupStalePackages()
        val auth = authenticate(method, pathname, headers, sha256(body.inputStream()))
        require(body.size <= MAX_JSON_BYTES) { "协作包清单过大" }
        val payload = JSONObject(body.toString(Charsets.UTF_8))
        require(payload.optString("protocolVersion", "1.0").substringBefore('.').toIntOrNull() in 1..1) { "直传协议版本不兼容" }
        val manifest = requireNotNull(payload.optJSONObject("manifest")) { "协作包缺少清单" }
        require(manifest.optString("schema") == "edu-manager.sync-manifest.v1") { "协作包清单版本无效" }
        require(manifest.optString("sourceNodeId") == auth.device.peerNodeId && manifest.optString("targetNodeId") == node.nodeId) {
            "协作包发送方或目标设备不匹配"
        }
        val manifestId = safeId(manifest.optString("manifestId"), "协作包编号")
        val files = manifest.optJSONArray("files").collaborationObjects()
        require(files.isNotEmpty() && files.size <= MAX_FILES) { "协作包清单文件数量无效" }
        var total = 0L
        files.forEach { descriptor ->
            val size = descriptor.optLong("size", -1)
            require(size in 0..MAX_FILE_BYTES) { "协作包包含超出限制的文件" }
            total = Math.addExact(total, size)
            require(total <= MAX_PACKAGE_BYTES) { "协作包总大小超出限制" }
            require(descriptor.optString("sha256").matches(Regex("^[a-f0-9]{64}$"))) { "协作文件摘要格式无效" }
            require(descriptor.optString("objectType") in ALLOWED_OBJECT_TYPES) { "协作包包含不允许的对象类型" }
            require(descriptor.optString("studentId") == auth.map.localStudentId) { "协作包超出当前精确学生映射范围" }
            safeRelativePath(descriptor.optString("relativePath"))
        }
        val checkpoint = runBlocking { dao.packageCheckpoint(manifestId) }
        if (checkpoint?.status in setOf("materialized", "acknowledged")) {
            return JSONObject().put("ok", true).put("duplicate", true).put("manifestId", manifestId)
        }
        val writing = writingRoot(manifestId).apply { mkdirs() }
        val content = File(writing, "content").apply { mkdirs() }
        val existing = File(writing, "manifest.json").takeIf(File::isFile)?.readText(Charsets.UTF_8)
        if (existing != null) require(JSONObject(existing).toString() == manifest.toString()) { "同名协作包清单发生冲突" }
        writeTextAtomically(File(writing, "manifest.json"), manifest.toString())
        writeTextAtomically(File(writing, "receiver.json"), JSONObject().apply {
            put("studentMapId", auth.map.studentMapId); put("deviceBindingId", auth.device.deviceBindingId)
            put("sourceNodeId", auth.device.peerNodeId); put("targetNodeId", node.nodeId)
        }.toString())
        val progress = org.json.JSONArray()
        var receivedTotal = 0L
        files.forEachIndexed { index, descriptor ->
            val target = packageFile(content, descriptor.optString("relativePath"))
            var received = target.takeIf(File::isFile)?.length()?.coerceAtMost(descriptor.optLong("size")) ?: 0L
            if (target.exists() && target.length() > descriptor.optLong("size")) { target.delete(); received = 0 }
            if (received == descriptor.optLong("size") && sha256(target.inputStream()) != descriptor.optString("sha256")) {
                target.delete(); received = 0
            }
            if (descriptor.optLong("size") == 0L && !target.exists()) { target.parentFile?.mkdirs(); target.createNewFile() }
            receivedTotal = Math.addExact(receivedTotal, received)
            progress.put(JSONObject().put("index", index).put("receivedBytes", received).put("size", descriptor.optLong("size")).put("complete", received == descriptor.optLong("size")))
        }
        val projectedReservation = runCatching { Math.addExact(reservedPayloadBytes(writing), total) }.getOrDefault(Long.MAX_VALUE)
        require(projectedReservation <= CollaborationNearbySecurityPolicy.MAX_STAGING_BYTES) { "附近协作未完成接收容量已达到上限，请完成或等待过期清理后重试" }
        require(stagingBytes() <= CollaborationNearbySecurityPolicy.MAX_STAGING_BYTES) { "附近协作暂存空间已达到上限，请先清理过期接收任务" }
        val remaining = (total - receivedTotal).coerceAtLeast(0L)
        require(CollaborationNearbySecurityPolicy.hasRequiredFreeSpace(writing.usableSpace, remaining)) { "Android 可用空间不足，未开始接收协作包" }
        writing.setLastModified(System.currentTimeMillis())
        return JSONObject().apply {
            put("ok", true); put("manifestId", manifestId); put("fileCount", files.size); put("protocolVersion", "1.1")
            put("supportsResume", true); put("maxChunkBytes", MAX_CHUNK_BYTES); put("files", progress)
        }
    }

    @Synchronized
    fun appendChunk(
        manifestIdValue: String,
        fileIndex: Int,
        offset: Long,
        method: String,
        pathname: String,
        headers: Map<String, String>,
        body: ByteArray,
    ): JSONObject {
        require(body.isNotEmpty() && body.size <= MAX_CHUNK_BYTES) { "协作文件分块大小无效" }
        val auth = authenticate(method, pathname, headers, sha256(body.inputStream()))
        val manifestId = safeId(manifestIdValue, "协作包编号")
        val session = loadSession(manifestId)
        require(session.mapId == auth.map.studentMapId && session.deviceBindingId == auth.device.deviceBindingId) { "协作包与当前学生映射不匹配" }
        val descriptor = session.manifest.optJSONArray("files").collaborationObjects().getOrNull(fileIndex) ?: error("协作包文件序号无效")
        require(headers["x-edu-file-sha256"] == descriptor.optString("sha256")) { "协作文件总摘要声明不匹配" }
        val size = descriptor.optLong("size")
        require(offset >= 0 && offset + body.size <= size) { "协作文件分块位置无效" }
        val target = packageFile(File(session.root, "content"), descriptor.optString("relativePath"))
        target.parentFile?.mkdirs()
        val current = target.takeIf(File::exists)?.length() ?: 0L
        if (offset < current) {
            require(offset + body.size <= current) { "协作文件分块与现有断点重叠" }
            val existing = ByteArray(body.size)
            RandomAccessFile(target, "r").use { it.seek(offset); it.readFully(existing) }
            require(MessageDigest.isEqual(existing, body)) { "重复分块内容与已接收数据不一致" }
            return JSONObject().put("ok", true).put("duplicate", true).put("manifestId", manifestId).put("fileIndex", fileIndex).put("receivedBytes", current)
        }
        require(offset == current) { "分块前仍有缺失数据" }
        require(
            CollaborationNearbySecurityPolicy.projectedAppendBytes(stagingBytes(), body.size.toLong()) <=
                CollaborationNearbySecurityPolicy.MAX_STAGING_BYTES,
        ) { "附近协作暂存空间已达到上限" }
        require(CollaborationNearbySecurityPolicy.hasRequiredFreeSpace(target.usableSpace, body.size.toLong())) {
            "Android 可用空间不足，已暂停接收协作文件"
        }
        if (current > 0) RandomAccessFile(target, "rw").use { file -> file.seek(current); file.write(body) }
        else target.outputStream().buffered().use { it.write(body) }
        session.root.setLastModified(System.currentTimeMillis())
        val received = current + body.size
        if (received == size && sha256(target.inputStream()) != descriptor.optString("sha256")) {
            target.delete()
            error("协作文件 SHA-256 校验失败，已清除错误断点")
        }
        return JSONObject().put("ok", true).put("manifestId", manifestId).put("fileIndex", fileIndex)
            .put("receivedBytes", received).put("complete", received == size)
    }

    @Synchronized
    fun commit(
        manifestIdValue: String,
        method: String,
        pathname: String,
        headers: Map<String, String>,
        body: ByteArray,
    ): JSONObject {
        val auth = authenticate(method, pathname, headers, sha256(body.inputStream()))
        val manifestId = safeId(manifestIdValue, "协作包编号")
        require(JSONObject(body.toString(Charsets.UTF_8)).optString("manifestId") == manifestId) { "协作包提交标识不匹配" }
        val session = loadSession(manifestId)
        require(session.mapId == auth.map.studentMapId && session.deviceBindingId == auth.device.deviceBindingId) { "协作包与当前学生映射不匹配" }
        session.manifest.optJSONArray("files").collaborationObjects().forEach { descriptor ->
            val file = packageFile(File(session.root, "content"), descriptor.optString("relativePath"))
            require(file.isFile && file.length() == descriptor.optLong("size")) { "协作文件尚未完整接收：${descriptor.optString("relativePath")}" }
            require(sha256(file.inputStream()) == descriptor.optString("sha256")) { "协作文件摘要校验失败：${descriptor.optString("relativePath")}" }
        }
        val summary = CollaborationSyncService(appContext).materializeIncomingPackage(
            deviceBindingId = auth.device.deviceBindingId,
            studentMapId = auth.map.studentMapId,
            manifest = session.manifest,
            packageRoot = session.root,
        )
        session.root.deleteRecursively()
        val reverseStatus = runCatching { CollaborationRepository(appContext).syncNow(auth.map.studentMapId) }
            .fold(
                onSuccess = {
                    nearbyState.clearError()
                    nearbyState.recordEvent("已接收协作内容，对端回传已排队")
                    "reverse_queued"
                },
                onFailure = { nearbyState.recordError("协作内容已接收，但回传排队失败：${it.message ?: "未知错误"}"); "reverse_failed" },
            )
        return JSONObject().apply {
            put("ok", true); put("manifestId", manifestId); put("imported", summary.pulledFiles)
            put("conflicts", summary.conflicts); put("tombstones", summary.tombstones)
            put("reverseSyncQueued", reverseStatus == "reverse_queued"); put("reverseSyncStatus", reverseStatus)
        }
    }

    @Synchronized
    fun clearForDevice(deviceBindingId: String): Int {
        var removed = 0
        root.listFiles().orEmpty().filter { it.isDirectory && it.name.endsWith(".writing") }.forEach { directory ->
            val receiver = runCatching { JSONObject(File(directory, "receiver.json").readText(Charsets.UTF_8)) }.getOrNull()
            if (receiver?.optString("deviceBindingId") == deviceBindingId && directory.deleteRecursively()) removed += 1
        }
        return removed
    }

    private fun authenticate(
        method: String,
        pathname: String,
        headers: Map<String, String>,
        actualContentSha256: String,
    ): CollaborationDirectAuth {
        val bindingId = headers["x-edu-binding-id"].orEmpty()
        val sourceNodeId = headers["x-edu-node-id"].orEmpty()
        val timestamp = headers["x-edu-timestamp"]?.toLongOrNull() ?: error("直传请求时间无效")
        require(kotlin.math.abs(System.currentTimeMillis() - timestamp) <= MAX_CLOCK_SKEW_MS) { "直传请求时间已失效" }
        val nonce = headers["x-edu-nonce"].orEmpty()
        require(nonce.matches(Regex("^[A-Za-z0-9._-]{12,160}$"))) { "直传请求缺少有效随机数" }
        require(headers["x-edu-content-sha256"] == actualContentSha256) { "直传内容摘要不匹配" }
        val map = runBlocking { dao.activeStudentMapForTransport(bindingId) } ?: error("没有找到有效的精确学生映射")
        val device = runBlocking { dao.device(map.deviceBindingId) } ?: error("学生映射缺少协作设备")
        require(device.status == "active" && device.peerNodeId == sourceNodeId && device.localNodeId == node.nodeId) { "协作设备身份未授权" }
        val secret = cipher.decrypt(device.encryptedSecret, device.deviceBindingId)
        val expected = CollaborationDirectProtocol.requestSignature(
            secret, method, pathname, bindingId, sourceNodeId, timestamp.toString(), nonce, actualContentSha256,
        )
        require(CollaborationCrypto.constantTimeEquals(headers["x-edu-signature"].orEmpty(), expected)) { "直传请求签名无效" }
        require(nearbyState.consumeNonce(bindingId, nonce, System.currentTimeMillis() + NONCE_TTL_MS)) { "检测到重复的直传请求" }
        return CollaborationDirectAuth(map, device)
    }

    private fun loadSession(manifestId: String): DirectSession {
        val writing = writingRoot(manifestId)
        val manifestFile = File(writing, "manifest.json")
        val receiverFile = File(writing, "receiver.json")
        require(manifestFile.isFile && receiverFile.isFile) { "协作包接收会话不存在" }
        val receiver = JSONObject(receiverFile.readText(Charsets.UTF_8))
        return DirectSession(
            root = writing,
            manifest = JSONObject(manifestFile.readText(Charsets.UTF_8)),
            mapId = receiver.getString("studentMapId"),
            deviceBindingId = receiver.getString("deviceBindingId"),
        )
    }

    private fun writingRoot(manifestId: String) = File(root, "$manifestId.writing")

    private fun packageFile(contentRoot: File, relativePath: String): File {
        val safe = safeRelativePath(relativePath)
        val target = File(contentRoot, safe)
        require(target.canonicalPath.startsWith(contentRoot.canonicalPath + File.separator)) { "协作包文件路径越界" }
        return target
    }

    private fun safeRelativePath(value: String): String {
        val clean = value.replace('\\', '/').trim().trimStart('/')
        require(clean.isNotBlank() && !clean.contains(Regex("(^|/)\\.\\.(/|$)")) && !Regex("^[A-Za-z]:").containsMatchIn(clean)) { "协作相对路径无效" }
        return clean.split('/').filter { it.isNotBlank() && it != "." }.joinToString("/")
    }

    private fun safeId(value: String, label: String): String = value.also {
        require(it.matches(Regex("^[A-Za-z0-9._-]{1,180}$"))) { "$label 无效" }
    }

    private fun writeTextAtomically(target: File, value: String) {
        target.parentFile?.mkdirs()
        val atomic = AtomicFile(target)
        val stream = atomic.startWrite()
        try {
            stream.write(value.toByteArray(Charsets.UTF_8))
            atomic.finishWrite(stream)
        } catch (error: Exception) {
            atomic.failWrite(stream)
            throw error
        }
    }

    private fun cleanupStalePackages(nowMillis: Long = System.currentTimeMillis()) {
        var removed = 0
        root.listFiles().orEmpty().filter { it.isDirectory && it.name.endsWith(".writing") }.forEach { directory ->
            if (CollaborationNearbySecurityPolicy.expiredInbound(directory.lastModified(), nowMillis) && directory.deleteRecursively()) removed += 1
        }
        if (removed > 0) nearbyState.recordEvent("已清理 $removed 个过期的附近协作暂存任务")
    }

    private fun stagingBytes(): Long = root.listFiles().orEmpty().fold(0L) { total, file -> Math.addExact(total, directoryBytes(file)) }

    private fun reservedPayloadBytes(excluding: File? = null): Long = root.listFiles().orEmpty()
        .filter { it.isDirectory && it.name.endsWith(".writing") && it != excluding }
        .fold(0L) { total, directory ->
            runCatching { Math.addExact(total, manifestPayloadBytes(directory)) }.getOrDefault(Long.MAX_VALUE)
        }

    private fun manifestPayloadBytes(directory: File): Long {
        val manifest = runCatching { JSONObject(File(directory, "manifest.json").readText(Charsets.UTF_8)) }.getOrNull()
            ?: return 0L
        var total = 0L
        manifest.optJSONArray("files").collaborationObjects().forEach { descriptor ->
            val size = descriptor.optLong("size", -1L)
            if (size !in 0..MAX_FILE_BYTES) return Long.MAX_VALUE
            total = runCatching { Math.addExact(total, size) }.getOrDefault(Long.MAX_VALUE)
            if (total > MAX_PACKAGE_BYTES) return Long.MAX_VALUE
        }
        return total
    }

    private fun directoryBytes(file: File): Long {
        if (file.isFile) return file.length()
        var total = 0L
        file.listFiles().orEmpty().forEach { child ->
            total = Math.addExact(total, directoryBytes(child))
        }
        return total
    }

    private data class DirectSession(
        val root: File,
        val manifest: JSONObject,
        val mapId: String,
        val deviceBindingId: String,
    )

    companion object {
        private const val MAX_JSON_BYTES = 2 * 1024 * 1024
        private const val MAX_FILES = 1_000
        private const val MAX_CHUNK_BYTES = 8 * 1024 * 1024
        private const val MAX_FILE_BYTES = 64L * 1024 * 1024
        private const val MAX_PACKAGE_BYTES = 2L * 1024 * 1024 * 1024
        private const val MAX_CLOCK_SKEW_MS = 5 * 60 * 1000L
        private const val NONCE_TTL_MS = 10 * 60 * 1000L
        private val ALLOWED_OBJECT_TYPES = setOf("student_archive_publication", "student_archive_asset_revision")
        private val EMPTY_SHA256 = sha256(ByteArray(0).inputStream())
    }
}

private fun sha256(input: InputStream): String = input.use { stream ->
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(128 * 1024)
    while (true) {
        val count = stream.read(buffer)
        if (count < 0) break
        if (count > 0) digest.update(buffer, 0, count)
    }
    digest.digest().joinToString("") { "%02x".format(it) }
}
