package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

data class CollaborationSyncSummary(
    val pulledFiles: Int,
    val pushedFiles: Int,
    val conflicts: Int,
    val tombstones: Int,
)

internal object CollaborationDirectProtocol {
    fun requestSignature(
        secret: String,
        method: String,
        pathname: String,
        bindingId: String,
        nodeId: String,
        timestamp: String,
        nonce: String,
        contentSha256: String,
    ): String = hmac(secret, listOf(method.uppercase(), pathname, bindingId, nodeId, timestamp, nonce, contentSha256).joinToString("\n"))

    fun manifestProof(secret: String, manifestId: String, manifestSha256: String): String =
        hmac(secret, "$manifestId\u001f$manifestSha256")

    fun lineageId(transportBindingId: String, participants: List<Pair<String, String>>): String =
        "$transportBindingId:student-archive:${participants.map { "${it.first}:${it.second}" }.sorted().joinToString("|")}".also {
            require(transportBindingId.isNotBlank() && participants.size == 2 && participants.map { part -> part.first }.distinct().size == 2)
        }

    fun objectId(lineageId: String, kind: String, relativePath: String): String =
        "student-archive:${CollaborationCrypto.sha256("$lineageId\u001f$kind\u001f${relativePath.lowercase()}").take(40)}"
}

private data class GovernedWorkspaceFile(
    val kind: String,
    val relativePath: String,
    val workspacePath: String,
    val size: Long,
    val modifiedAt: String,
    val sha256: String,
)

private data class GovernedWorkspaceCandidate(
    val kind: String,
    val relativePath: String,
    val workspacePath: String,
    val size: Long,
    val lastModified: Long,
)

internal object CollaborationSyncPolicy {
    const val MAX_FILES_PER_SCOPE = 20_000
    const val INVENTORY_REVERIFY_MS = 60L * 60 * 1000

    fun requireCompleteScope(fileCount: Int, scope: String) {
        require(fileCount <= MAX_FILES_PER_SCOPE) { "$scope 超过 $MAX_FILES_PER_SCOPE 个可同步文本文件，请拆分目录或清理历史副本后重试" }
    }

    fun mayReuseInventory(previous: CollaborationFileInventoryEntity?, size: Long, lastModified: Long, now: Long): Boolean =
        previous != null && lastModified > 0 && previous.sizeBytes == size && previous.lastModified == lastModified &&
            now - previous.verifiedAtMillis in 0 until INVENTORY_REVERIFY_MS && previous.contentSha256.isNotBlank()
}

internal object CollaborationStreamPolicy {
    fun skipFully(input: InputStream, offset: Long) {
        var remaining = offset
        while (remaining > 0) {
            val skipped = input.skip(remaining)
            if (skipped > 0) remaining -= skipped else if (input.read() >= 0) remaining -= 1 else error("SAF 文件断点超出范围")
        }
    }

    fun readExactly(input: InputStream, length: Int): ByteArray {
        val output = ByteArray(length)
        var read = 0
        while (read < length) {
            val count = input.read(output, read, length - read)
            if (count < 0) error("读取 SAF 协作文件分块不完整")
            read += count
        }
        return output
    }
}

private data class OutboundPayload(
    val descriptor: JSONObject,
    val bytes: ByteArray? = null,
    val workspacePath: String = "",
)

internal data class DownloadedCollaborationPackage(
    val endpoint: String,
    val manifest: JSONObject,
    val root: File,
    val files: Map<String, File>,
)

internal data class PullMaterialization(val available: Boolean, val imported: Int = 0, val conflicts: Int = 0, val tombstones: Int = 0)

class CollaborationSyncService(private val context: Context) {
    private val appContext = context.applicationContext
    private val dao = CollaborationDatabase.get(appContext).collaborationDao()
    private val students = StudentIndexRepository(appContext)
    private val cipher = CollaborationSecretCipher()
    private val node = CollaborationNodeIdentityStore(appContext).get()
    private val client = CollaborationDirectHttpClient(appContext)

    fun synchronize(studentMapId: String): CollaborationSyncSummary {
        val map = runBlocking { dao.studentMap(studentMapId) } ?: error("没有找到学生协作映射")
        require(map.status == "active") { "学生协作映射当前未启用" }
        require(map.transportBindingId.isNotBlank()) { "该学生映射来自早期测试版本，请删除后重新建立映射" }
        val device = runBlocking { dao.device(map.deviceBindingId) } ?: error("学生映射缺少协作设备")
        require(device.status == "active") { "协作设备当前未启用" }
        val student = students.requireExact(map.localStudentId)
        requireStudentScope(student)
        val secret = cipher.decrypt(device.encryptedSecret, device.deviceBindingId)
        val discovered = runCatching { CollaborationLanDiscovery.discover().firstOrNull { it.nodeId == device.peerNodeId } }.getOrNull()
        val endpoints = (discovered?.endpoints.orEmpty() + JSONArray(device.endpointsJson).collaborationStrings()).distinct().take(8)
        require(endpoints.isNotEmpty()) { "协作设备没有可用的连接地址" }
        if (discovered != null) runBlocking {
            val now = utcNow()
            dao.updateDeviceEndpoints(device.deviceBindingId, JSONArray(endpoints).toString(), now, now)
        }
        val store = SafWorkspaceStore(appContext, Uri.parse(student.storageRootUri))

        var lastError = "协作设备当前不可达"
        for (endpoint in endpoints.mapNotNull(CollaborationPairingProtocol::normalizeEndpoint).distinct().take(8)) {
            try {
                var pulledFiles = 0
                var conflicts = 0
                var tombstones = 0
                var remainingPulls = MAX_PULL_PACKAGES_PER_RUN
                while (remainingPulls > 0) {
                    val pulled = pullFromWindows(endpoint, device, map, student, store, secret)
                    if (!pulled.available) break
                    pulledFiles += pulled.imported
                    conflicts += pulled.conflicts
                    tombstones += pulled.tombstones
                    remainingPulls -= 1
                }
                val pushed = pushToWindows(endpoint, device, map, student, store, secret)
                return CollaborationSyncSummary(pulledFiles, pushed, conflicts, tombstones)
            } catch (error: Exception) {
                lastError = error.message ?: "连接 $endpoint 失败"
            }
        }
        error(lastError)
    }

    fun materializeIncomingPackage(
        deviceBindingId: String,
        studentMapId: String,
        manifest: JSONObject,
        packageRoot: File,
    ): CollaborationSyncSummary {
        val map = runBlocking { dao.studentMap(studentMapId) } ?: error("没有找到学生协作映射")
        require(map.status == "active" && map.deviceBindingId == deviceBindingId) { "协作包超出当前学生映射范围" }
        val device = runBlocking { dao.device(deviceBindingId) } ?: error("学生映射缺少协作设备")
        require(device.status == "active") { "协作设备当前未启用" }
        val student = students.requireExact(map.localStudentId)
        requireStudentScope(student)
        require(manifest.optString("targetNodeId") == node.nodeId && manifest.optString("sourceNodeId") == device.peerNodeId) {
            "协作包发送方或目标设备不匹配"
        }
        val files = manifest.optJSONArray("files").collaborationObjects().associate { descriptor ->
            val relativePath = safeRelativePath(descriptor.optString("relativePath"))
            relativePath to File(packageRoot, "content/$relativePath").also { candidate ->
                require(candidate.canonicalPath.startsWith(File(packageRoot, "content").canonicalPath + File.separator)) { "协作包文件路径越界" }
            }
        }
        val downloaded = DownloadedCollaborationPackage("nearby", manifest, packageRoot, files)
        val result = materializeDownloadedPackage(downloaded, device, map, student, SafWorkspaceStore(appContext, Uri.parse(student.storageRootUri)))
        val checkpoint = runBlocking { dao.packageCheckpoint(manifest.getString("manifestId")) }
        if (checkpoint != null) runBlocking {
            dao.upsertPackageCheckpoint(checkpoint.copy(status = "acknowledged", acknowledgedAt = utcNow()))
        }
        return CollaborationSyncSummary(result.imported, 0, result.conflicts, result.tombstones)
    }

    private fun requireStudentScope(student: StudentRecord) {
        val mapping = runBlocking { dao.safMapping(student.id) } ?: error("学生知识库尚未建立 SAF 映射")
        require(mapping.localStudentId == student.id && mapping.treeUri == student.storageRootUri) { "学生知识库目录映射与当前档案不一致" }
        require(mapping.hasReadWriteGrant && appContext.contentResolver.persistedUriPermissions.any {
            it.uri == Uri.parse(mapping.treeUri) && it.isReadPermission && it.isWritePermission
        }) { "学生知识库 SAF 读写授权已失效" }
    }

    /** Returns whether a package was available plus imported files, conflicts and tombstones. */
    private fun pullFromWindows(
        endpoint: String,
        device: CollaborationDeviceEntity,
        map: CollaborationStudentMapEntity,
        student: StudentRecord,
        store: SafWorkspaceStore,
        secret: String,
    ): PullMaterialization {
        val downloaded = client.pullNext(endpoint, device, map, node.nodeId, secret) ?: return PullMaterialization(false)
        val result = materializeDownloadedPackage(downloaded, device, map, student, store)
        val manifestId = downloaded.manifest.getString("manifestId")
        client.ackPull(endpoint, device, map, node.nodeId, secret, manifestId)
        val checkpoint = runBlocking { dao.packageCheckpoint(manifestId) }
        if (checkpoint != null) runBlocking {
            dao.upsertPackageCheckpoint(checkpoint.copy(status = "acknowledged", acknowledgedAt = utcNow()))
        }
        downloaded.root.deleteRecursively()
        return result
    }

    private fun materializeDownloadedPackage(
        downloaded: DownloadedCollaborationPackage,
        device: CollaborationDeviceEntity,
        map: CollaborationStudentMapEntity,
        student: StudentRecord,
        store: SafWorkspaceStore,
    ): PullMaterialization {
        val publicationDescriptor = downloaded.manifest.getJSONArray("files").collaborationObjects()
            .singleOrNull { it.optString("objectType") == "student_archive_publication" }
            ?: error("协作包缺少学生档案清单")
        val publicationFile = downloaded.files[publicationDescriptor.getString("relativePath")]
            ?: error("协作包缺少学生档案清单文件")
        val publication = JSONObject(publicationFile.readText(Charsets.UTF_8))
        require(publication.optString("schema") == "edu-manager.student-archive-sync.v1") { "学生档案清单版本不兼容" }
        require(publication.optString("targetNodeId") == node.nodeId && publication.optString("targetStudentId") == student.id) { "学生档案清单目标与本机学生不一致" }
        require(publication.optString("sourceNodeId") == device.peerNodeId && publication.optString("sourceStudentId") == map.peerStudentId) { "学生档案清单来源与精确学生映射不一致" }
        require(publication.optString("lineageId") == lineageId(device, map)) { "学生档案版本谱系与双方映射不一致" }

        val manifestId = downloaded.manifest.getString("manifestId")
        val checkpoint = runBlocking { dao.packageCheckpoint(manifestId) }
        if (checkpoint?.status in setOf("materialized", "acknowledged")) {
            return PullMaterialization(true)
        }

        var imported = 0
        var conflicts = 0
        var tombstones = 0
        val entries = publication.optJSONArray("entries").collaborationObjects()
        for (entry in entries) {
            val objectId = entry.optString("objectId")
            val kind = entry.optString("kind")
            val relativePath = safeRelativePath(entry.optString("relativePath"))
            require(objectId.isNotBlank() && kind in SYNC_KINDS && relativePath.isNotBlank()) { "学生档案条目范围无效" }
            val target = targetPath(student, kind, relativePath, publication)
            val previous = runBlocking { dao.revision(map.studentMapId, objectId) }
            val localHash = if (store.exists(target)) sha256(store.openInputStream(target)) else ""
            if (entry.optBoolean("tombstone")) {
                if (localHash.isBlank()) {
                    saveRevision(map, entry, student.id, device.peerNodeId, false)
                    continue
                }
                if (previous != null && localHash == previous.contentSha256 && !previous.locallyModified) {
                    val trash = recoverablePath(student, "协作回收站", kind, relativePath, publication.optString("createdAt"))
                    store.writeStreamSafely(trash, mimeFor(relativePath)) { output -> store.openInputStream(target).use { it.copyTo(output) } }
                    store.deleteFileIfExists(target)
                    saveRevision(map, entry, student.id, device.peerNodeId, false)
                    tombstones += 1
                } else {
                    recordConflict(map, student.id, entry, target, localHash, "remote_delete_local_modified")
                    conflicts += 1
                }
                continue
            }
            val packagePath = "student-archives/${publication.getString("publicationId")}/$kind/$relativePath"
            val remote = downloaded.files[packagePath] ?: error("学生档案正文缺失：$relativePath")
            val remoteHash = entry.optString("sha256")
            require(remoteHash.matches(Regex("^[a-f0-9]{64}$")) && sha256(remote.inputStream()) == remoteHash) { "学生档案正文摘要不匹配：$relativePath" }
            when {
                localHash == remoteHash -> saveRevision(map, entry, student.id, device.peerNodeId, false)
                localHash.isBlank() || (previous != null && localHash == previous.contentSha256 && !previous.locallyModified) -> {
                    store.writeStreamSafely(target, mimeFor(relativePath)) { output -> remote.inputStream().use { it.copyTo(output) } }
                    saveRevision(map, entry, student.id, device.peerNodeId, false)
                    imported += 1
                }
                else -> {
                    val conflictPath = recoverablePath(student, "协作冲突", kind, relativePath, publication.optString("createdAt"))
                    store.writeStreamSafely(conflictPath, mimeFor(relativePath)) { output -> remote.inputStream().use { it.copyTo(output) } }
                    recordConflict(map, student.id, entry, conflictPath, localHash, "concurrent_revision")
                    conflicts += 1
                }
            }
        }
        val materializedAt = utcNow()
        runBlocking {
            dao.upsertPackageCheckpoint(
                CollaborationPackageCheckpointEntity(
                    manifestId = manifestId,
                    studentMapId = map.studentMapId,
                    status = "materialized",
                    materializedAt = materializedAt,
                    acknowledgedAt = "",
                ),
            )
        }
        return PullMaterialization(true, imported, conflicts, tombstones)
    }

    private fun pushToWindows(
        endpoint: String,
        device: CollaborationDeviceEntity,
        map: CollaborationStudentMapEntity,
        student: StudentRecord,
        store: SafWorkspaceStore,
        secret: String,
    ): Int {
        val collected = collectGovernedFiles(student, store)
        val previous = runBlocking { dao.revisions(map.studentMapId) }.associateBy { it.objectId }
        val lineage = lineageId(device, map)
        val currentObjectIds = collected.associateBy { objectId(lineage, it.kind, it.relativePath) }
        val entries = mutableListOf<JSONObject>()
        val sources = linkedMapOf<String, GovernedWorkspaceFile>()
        for ((objectId, file) in currentObjectIds) {
            val old = previous[objectId]
            if (old != null && old.originNodeId != node.nodeId && old.contentSha256 == file.sha256 && !old.locallyModified) continue
            val version = if (old?.contentSha256 == file.sha256) old.revision.coerceAtLeast(1) else (old?.revision ?: 0) + 1
            val entry = JSONObject().apply {
                put("objectId", objectId); put("kind", file.kind); put("relativePath", file.relativePath); put("sha256", file.sha256)
                put("size", file.size); put("revisionId", "revision:${file.sha256}"); put("version", version)
                put("parentRevisionIds", JSONArray(if (old?.contentSha256?.isNotBlank() == true && old.contentSha256 != file.sha256) listOf("revision:${old.contentSha256}") else emptyList<String>()))
                put("sourceModifiedAt", file.modifiedAt); put("tombstone", false)
            }
            entries += entry
            sources["${file.kind}|${file.relativePath}"] = file
        }
        for ((objectId, old) in previous) {
            if (currentObjectIds.containsKey(objectId) || old.originNodeId != node.nodeId || !old.locallyModified) continue
            entries += JSONObject().apply {
                put("objectId", objectId); put("kind", kindFromStoredPath(old.relativePath)); put("relativePath", pathFromStoredPath(old.relativePath))
                put("sha256", old.contentSha256); put("size", 0); put("revisionId", "tombstone:${CollaborationCrypto.sha256("$objectId\u001f${old.contentSha256}\u001f${old.revision + 1}").take(40)}")
                put("version", old.revision + 1); put("parentRevisionIds", JSONArray(listOf("revision:${old.contentSha256}")))
                put("sourceModifiedAt", ""); put("tombstone", true)
            }
        }
        entries.sortBy { "${it.optString("kind")}|${it.optString("relativePath").lowercase()}" }
        if (entries.isEmpty()) return 0
        val createdAt = entries.map { it.optString("sourceModifiedAt") }.filter(String::isNotBlank).maxOrNull()
            ?: previous.values.map { it.updatedAt }.filter(String::isNotBlank).maxOrNull()
            ?: utcNow()
        val collectionFingerprint = CollaborationCrypto.sha256("$lineage\u001f${entries.joinToString("|") { "${it.optString("objectId")}:${it.optString("revisionId")}" }}")
        val batches = entries.chunked(MAX_PUBLICATION_ENTRIES)
        var pushed = 0
        for ((batchIndex, batchEntries) in batches.withIndex()) {
            val fingerprint = if (batches.size == 1) collectionFingerprint else CollaborationCrypto.sha256(
                "$lineage\u001f${batchEntries.joinToString("|") { "${it.optString("objectId")}:${it.optString("revisionId")}" }}",
            )
            val publicationId = "student-archive-${CollaborationCrypto.sha256("$lineage\u001f${node.nodeId}\u001f$fingerprint").take(32)}"
            val publication = JSONObject().apply {
                put("schema", "edu-manager.student-archive-sync.v1"); put("protocolVersion", 1); put("publicationId", publicationId)
                put("lineageId", lineage); put("sourceNodeId", node.nodeId); put("targetNodeId", device.peerNodeId)
                put("sourceStudentId", student.id); put("sourceStudentName", student.name); put("targetStudentId", map.peerStudentId)
                put("createdAt", createdAt); put("entries", JSONArray(batchEntries)); put("fingerprint", fingerprint)
                if (batches.size > 1) {
                    put("collectionFingerprint", collectionFingerprint); put("batchIndex", batchIndex + 1); put("batchCount", batches.size)
                }
            }
            val publicationBytes = (publication.toString(2) + "\n").toByteArray(Charsets.UTF_8)
            val payloads = mutableListOf<OutboundPayload>()
            val publicationRelative = "student-archives/$publicationId/publication.json"
            payloads += OutboundPayload(JSONObject().apply {
                put("objectId", "student-archive-publication:$publicationId"); put("objectType", "student_archive_publication")
                put("relativePath", publicationRelative); put("sha256", sha256(publicationBytes.inputStream())); put("size", publicationBytes.size)
                put("version", 1); put("studentId", map.peerStudentId); put("projectId", "")
            }, bytes = publicationBytes)
            for (entry in batchEntries.filterNot { it.optBoolean("tombstone") }) {
                val file = sources["${entry.getString("kind")}|${entry.getString("relativePath")}"] ?: continue
                val relative = "student-archives/$publicationId/${file.kind}/${file.relativePath}"
                payloads += OutboundPayload(JSONObject().apply {
                    put("objectId", "${entry.getString("objectId")}@${entry.getString("revisionId")}"); put("objectType", "student_archive_asset_revision")
                    put("relativePath", relative); put("sha256", file.sha256); put("size", file.size); put("version", entry.getLong("version"))
                    put("studentId", map.peerStudentId); put("projectId", "")
                }, workspacePath = file.workspacePath)
            }
            require(payloads.size <= 1_000) { "学生档案分包超过直传文件数量限制" }
            val manifestId = "manifest-android-${CollaborationCrypto.sha256("${map.studentMapId}\u001f$fingerprint").take(32)}"
            val manifest = JSONObject().apply {
                put("schema", "edu-manager.sync-manifest.v1"); put("protocolVersion", "1.0"); put("manifestId", manifestId)
                put("sourceNodeId", node.nodeId); put("targetNodeId", device.peerNodeId); put("createdAt", createdAt); put("completedAt", createdAt)
                put("files", JSONArray(payloads.map { it.descriptor }))
            }
            client.pushPackage(endpoint, map, node.nodeId, secret, manifest, payloads, store)
            for (entry in batchEntries) {
                saveRevision(map, entry, student.id, node.nodeId, !entry.optBoolean("tombstone"))
            }
            pushed += batchEntries.count { !it.optBoolean("tombstone") }
        }
        return pushed
    }

    private fun collectGovernedFiles(student: StudentRecord, store: SafWorkspaceStore): List<GovernedWorkspaceFile> {
        val growthRoot = "${student.paths.summaryPath}/成长模型"
        val reportRoot = "${student.paths.summaryPath}/学情报告"
        val archiveRoot = "${student.paths.summaryPath}/教育档案"
        val results = mutableListOf<Pair<String, SafWorkspaceStore.WorkspaceFile>>()
        val internalRoots = listOf(growthRoot, reportRoot, archiveRoot, "${student.paths.summaryPath}/协作冲突", "${student.paths.summaryPath}/协作回收站")
        fun scan(scope: String, root: String, excluded: List<String> = emptyList()): List<SafWorkspaceStore.WorkspaceFile> {
            val files = store.listTextFiles(root, excluded, maximum = CollaborationSyncPolicy.MAX_FILES_PER_SCOPE + 1)
            CollaborationSyncPolicy.requireCompleteScope(files.size, scope)
            return files
        }
        results += scan("已确认知识", student.paths.summaryPath, internalRoots)
            .filterNot { statusPrefix(store, it.relativePath) in setOf("draft", "pending", "pending_review", "rejected", "template") }
            .map { "confirmed_knowledge" to it }
        results += scan("成长模型", growthRoot)
            .filterNot { it.name.contains("草稿") || it.name.contains("draft", true) || it.name == "成长证据审核.json" }
            .map { "growth_model" to it }
        results += scan("已发布学情报告", reportRoot).filter { statusPrefix(store, it.relativePath) in setOf("active", "published") }.map { "learning_report" to it }
        results += scan("教育档案", archiveRoot)
            .filterNot { it.relativePath.removePrefix(archiveRoot).trimStart('/').substringBefore('/').startsWith("remote-") }
            .map { "education_archive" to it }
        val candidates = results.distinctBy { "${it.first}|${it.second.relativePath}" }.mapNotNull { (kind, file) ->
            val base = when (kind) {
                "confirmed_knowledge" -> student.paths.summaryPath
                "growth_model" -> growthRoot
                "learning_report" -> reportRoot
                else -> archiveRoot
            }
            val relative = safeRelativePath(file.relativePath.removePrefix(base).trimStart('/'))
            if (relative.isBlank()) null else {
                require(file.size <= MAX_SYNC_FILE_BYTES) { "${file.relativePath} 超过 64 MB 协作上限，未静默跳过该文件" }
                GovernedWorkspaceCandidate(kind, relative, file.relativePath, file.size, file.lastModified)
            }
        }.sortedBy { "${it.kind}|${it.relativePath.lowercase()}" }
        val now = System.currentTimeMillis()
        val previous = runBlocking { dao.fileInventory(student.id) }.associateBy { "${it.kind}|${it.relativePath}" }
        val observed = mutableSetOf<String>()
        val updates = mutableListOf<CollaborationFileInventoryEntity>()
        val files = candidates.map { candidate ->
            val key = "${candidate.kind}|${candidate.relativePath}"
            observed += key
            val old = previous[key]
            val contentSha = if (CollaborationSyncPolicy.mayReuseInventory(old, candidate.size, candidate.lastModified, now)) {
                requireNotNull(old).contentSha256
            } else {
                sha256(store.openInputStream(candidate.workspacePath)).also { digest ->
                    updates += CollaborationFileInventoryEntity(
                        localStudentId = student.id,
                        kind = candidate.kind,
                        relativePath = candidate.relativePath,
                        sizeBytes = candidate.size,
                        lastModified = candidate.lastModified,
                        contentSha256 = digest,
                        verifiedAtMillis = now,
                    )
                }
            }
            GovernedWorkspaceFile(
                candidate.kind, candidate.relativePath, candidate.workspacePath, candidate.size,
                utcAt(candidate.lastModified.coerceAtLeast(0)), contentSha,
            )
        }
        runBlocking {
            if (updates.isNotEmpty()) dao.upsertFileInventory(updates)
            previous.filterKeys { it !in observed }.values.forEach { stale ->
                dao.deleteFileInventory(stale.localStudentId, stale.kind, stale.relativePath)
            }
        }
        return files
    }

    private fun statusPrefix(store: SafWorkspaceStore, path: String): String = runCatching {
        store.openInputStream(path).use { input ->
            val bytes = ByteArray(8192)
            val count = input.read(bytes).coerceAtLeast(0)
            Regex("(?im)^status:\\s*([^\\r\\n]+)").find(String(bytes, 0, count, Charsets.UTF_8))?.groupValues?.get(1)?.trim()?.lowercase().orEmpty()
        }
    }.getOrDefault("")

    private fun lineageId(device: CollaborationDeviceEntity, map: CollaborationStudentMapEntity): String {
        return CollaborationDirectProtocol.lineageId(map.transportBindingId, listOf(node.nodeId to map.localStudentId, device.peerNodeId to map.peerStudentId))
    }

    private fun objectId(lineage: String, kind: String, relativePath: String) =
        CollaborationDirectProtocol.objectId(lineage, kind, relativePath)

    private fun targetPath(student: StudentRecord, kind: String, relativePath: String, publication: JSONObject): String = when (kind) {
        "confirmed_knowledge" -> "${student.paths.summaryPath}/$relativePath"
        "growth_model" -> "${student.paths.summaryPath}/成长模型/$relativePath"
        "learning_report" -> "${student.paths.summaryPath}/学情报告/$relativePath"
        "education_archive" -> "${student.paths.summaryPath}/教育档案/remote-${safeName(publication.optString("sourceNodeId"))}-${safeName(publication.optString("publicationId"))}/$relativePath"
        else -> error("不支持的学生档案类型")
    }

    private fun recoverablePath(student: StudentRecord, group: String, kind: String, relativePath: String, stamp: String): String {
        val parsedName = relativePath.substringAfterLast('/')
        val directory = relativePath.substringBeforeLast('/', "")
        val base = parsedName.substringBeforeLast('.', parsedName)
        val extension = parsedName.substringAfterLast('.', "").let { if (it.isBlank()) "" else ".$it" }
        val suffix = stamp.replace(Regex("[^0-9]"), "").take(14).ifBlank { System.currentTimeMillis().toString() }
        return listOf(student.paths.summaryPath, group, kind, directory, "$base ($suffix)$extension").filter(String::isNotBlank).joinToString("/")
    }

    private fun recordConflict(map: CollaborationStudentMapEntity, studentId: String, entry: JSONObject, conflictPath: String, localHash: String, type: String) {
        runBlocking {
            dao.upsertConflict(CollaborationConflictEntity(
                conflictId = "conflict-${CollaborationCrypto.sha256("${map.studentMapId}\u001f${entry.optString("objectId")}\u001f${entry.optString("sha256")}\u001f$type").take(40)}",
                studentMapId = map.studentMapId, localStudentId = studentId,
                objectId = entry.optString("objectId"), relativePath = entry.optString("relativePath"), conflictCopyPath = conflictPath,
                localSha256 = localHash, remoteSha256 = entry.optString("sha256"), conflictType = type, createdAt = utcNow(), resolvedAt = "",
            ))
        }
    }

    private fun saveRevision(map: CollaborationStudentMapEntity, entry: JSONObject, studentId: String, originNodeId: String, locallyModified: Boolean) {
        val storedPath = "${entry.optString("kind")}\u001f${entry.optString("relativePath")}"
        val previous = runBlocking { dao.revision(map.studentMapId, entry.optString("objectId")) }
        runBlocking {
            dao.upsertRevision(CollaborationRevisionEntity(
                studentMapId = map.studentMapId, objectId = entry.optString("objectId"), localStudentId = studentId,
                relativePath = storedPath, contentSha256 = entry.optString("sha256"), revision = entry.optLong("version", 1),
                parentRevision = previous?.revision ?: 0, sizeBytes = entry.optLong("size", 0), originNodeId = originNodeId,
                locallyModified = locallyModified, updatedAt = utcNow(),
            ))
        }
    }

    private fun kindFromStoredPath(value: String) = value.substringBefore('\u001f')
    private fun pathFromStoredPath(value: String) = value.substringAfter('\u001f', value)
    private fun safeName(value: String) = value.replace(Regex("[^A-Za-z0-9._-]"), "-").take(100)
    private fun safeRelativePath(value: String): String {
        val clean = value.replace('\\', '/').trim().trimStart('/')
        require(clean.isNotBlank() && !clean.contains(Regex("(^|/)\\.\\.(/|$)")) && !Regex("^[A-Za-z]:").containsMatchIn(clean)) { "协作相对路径无效" }
        return clean.split('/').filter { it.isNotBlank() && it != "." }.joinToString("/")
    }

    private fun mimeFor(path: String) = when (path.substringAfterLast('.', "").lowercase()) {
        "md", "markdown" -> "text/markdown"
        "json" -> "application/json"
        "csv" -> "text/csv"
        else -> "text/plain"
    }

    companion object {
        private val SYNC_KINDS = setOf("confirmed_knowledge", "growth_model", "learning_report", "education_archive")
        private const val MAX_SYNC_FILE_BYTES = 64L * 1024 * 1024
        private const val MAX_PULL_PACKAGES_PER_RUN = 20
        private const val MAX_PUBLICATION_ENTRIES = 999
    }
}

private class CollaborationDirectHttpClient(private val context: Context) {
    fun pullNext(
        endpoint: String,
        device: CollaborationDeviceEntity,
        map: CollaborationStudentMapEntity,
        nodeId: String,
        secret: String,
    ): DownloadedCollaborationPackage? {
        val path = "/api/collaboration/android/pull/${map.studentMapId}"
        val response = jsonRequest(endpoint, "GET", path, map.transportBindingId, nodeId, secret)
        if (!response.optBoolean("available")) return null
        val manifestJson = response.getString("manifestJson")
        val digest = sha256(manifestJson.byteInputStream())
        require(digest == response.getString("manifestSha256")) { "Windows 协作清单摘要不匹配" }
        val manifest = JSONObject(manifestJson)
        val expectedProof = CollaborationDirectProtocol.manifestProof(secret, manifest.getString("manifestId"), digest)
        require(MessageDigest.isEqual(expectedProof.toByteArray(), response.getString("proof").toByteArray())) { "Windows 协作清单未通过设备信任校验" }
        require(manifest.optString("targetNodeId") == nodeId && manifest.optString("sourceNodeId") == device.peerNodeId) { "Windows 协作清单设备范围不匹配" }
        val root = File(context.filesDir, "collaboration-transfers/${safeFileName(manifest.getString("manifestId"))}")
        root.mkdirs()
        val downloaded = linkedMapOf<String, File>()
        val files = manifest.getJSONArray("files").collaborationObjects()
        require(files.isNotEmpty() && files.size <= 1_000) { "Windows 协作清单文件数量无效" }
        val sizes = files.map { descriptor ->
            descriptor.optLong("size", -1).also { size ->
                require(size in 0..MAX_TOTAL_FILE_BYTES) { "协作文件大小超出限制" }
            }
        }
        val totalBytes = sizes.fold(0L) { total, size -> Math.addExact(total, size) }
        require(totalBytes in 0..MAX_PACKAGE_BYTES) { "Windows 协作包总大小超出限制" }
        val alreadyReceived = files.indices.sumOf { index -> File(root, "$index.part").takeIf(File::exists)?.length()?.coerceAtMost(sizes[index]) ?: 0 }
        require(root.usableSpace >= totalBytes - alreadyReceived + MIN_FREE_BYTES) { "Android 可用空间不足，未开始下载协作包" }
        for ((index, descriptor) in files.withIndex()) {
            val expectedSize = sizes[index]
            val target = File(root, "$index.part")
            if (target.exists() && target.length() > expectedSize) target.delete()
            if (target.exists() && target.length() == expectedSize && sha256(target.inputStream()) != descriptor.getString("sha256")) target.delete()
            if (expectedSize == 0L) target.createNewFile()
            while (target.length() < expectedSize) {
                val offset = target.length()
                val length = minOf(CHUNK_BYTES.toLong(), expectedSize - offset).toInt()
                val filePath = "/api/collaboration/android/pull/${map.studentMapId}/packages/${manifest.getString("manifestId")}/files/$index"
                val connection = open(endpoint, "GET", "$filePath?offset=$offset&length=$length", filePath, map.transportBindingId, nodeId, secret, ByteArray(0))
                val status = connection.responseCode
                require(status in 200..299) { errorMessage(connection, status) }
                val bytes = readBounded(connection.inputStream, length)
                require(bytes.size == length && sha256(bytes.inputStream()) == connection.getHeaderField("X-Edu-Chunk-Sha256")) { "协作文件分块摘要不匹配" }
                RandomAccessFile(target, "rw").use { file -> file.seek(offset); file.write(bytes) }
                connection.disconnect()
            }
            require(target.length() == expectedSize && sha256(target.inputStream()) == descriptor.getString("sha256")) { "协作文件完整性校验失败" }
            downloaded[descriptor.getString("relativePath")] = target
        }
        return DownloadedCollaborationPackage(endpoint, manifest, root, downloaded)
    }

    fun ackPull(endpoint: String, device: CollaborationDeviceEntity, map: CollaborationStudentMapEntity, nodeId: String, secret: String, manifestId: String) {
        val path = "/api/collaboration/android/pull/${map.studentMapId}/packages/$manifestId/ack"
        val body = JSONObject().put("manifestId", manifestId).put("status", "materialized").toString().toByteArray(Charsets.UTF_8)
        val response = jsonRequest(endpoint, "POST", path, map.transportBindingId, nodeId, secret, body)
        require(response.optBoolean("ok")) { response.optString("message").ifBlank { "Windows 未确认协作包" } }
    }

    fun pushPackage(
        endpoint: String,
        map: CollaborationStudentMapEntity,
        nodeId: String,
        secret: String,
        manifest: JSONObject,
        payloads: List<OutboundPayload>,
        store: SafWorkspaceStore,
    ) {
        val initPath = "/api/collaboration/direct/packages"
        val initBody = JSONObject().put("manifest", manifest).put("protocolVersion", "1.1").toString().toByteArray(Charsets.UTF_8)
        val initialized = jsonRequest(endpoint, "POST", initPath, map.transportBindingId, nodeId, secret, initBody)
        if (initialized.optBoolean("duplicate")) return
        val progress = initialized.optJSONArray("files").collaborationObjects().associateBy { it.optInt("index") }
        fun uploadChunk(index: Int, payload: OutboundPayload, offset: Long, bytes: ByteArray): Long {
            val size = payload.descriptor.getLong("size")
            val path = "/api/collaboration/direct/packages/${manifest.getString("manifestId")}/files/$index/chunks/$offset"
            val connection = open(endpoint, "PUT", path, path, map.transportBindingId, nodeId, secret, bytes)
            return try {
                connection.setRequestProperty("X-Edu-File-Sha256", payload.descriptor.getString("sha256"))
                connection.outputStream.use { it.write(bytes) }
                val status = connection.responseCode
                val result = parseJsonResponse(connection, status)
                require(status in 200..299) { result.optString("message").ifBlank { "上传协作分块失败（HTTP $status）" } }
                result.optLong("receivedBytes", offset + bytes.size).also { next ->
                    require(next == offset + bytes.size.toLong() && next <= size) { "Windows 返回的协作断点与连续上传流不一致" }
                }
            } finally {
                connection.disconnect()
            }
        }
        for ((index, payload) in payloads.withIndex()) {
            val size = payload.descriptor.getLong("size")
            var offset = progress[index]?.optLong("receivedBytes", 0)?.coerceIn(0, size) ?: 0
            if (payload.bytes != null) {
                require(size == payload.bytes.size.toLong()) { "内存协作载荷大小与清单不一致" }
                while (offset < size) {
                    val length = minOf(CHUNK_BYTES.toLong(), size - offset).toInt()
                    offset = uploadChunk(index, payload, offset, payload.bytes.copyOfRange(offset.toInt(), offset.toInt() + length))
                }
            } else {
                store.openInputStream(payload.workspacePath).use { input ->
                    CollaborationStreamPolicy.skipFully(input, offset)
                    while (offset < size) {
                        val length = minOf(CHUNK_BYTES.toLong(), size - offset).toInt()
                        offset = uploadChunk(index, payload, offset, CollaborationStreamPolicy.readExactly(input, length))
                    }
                }
            }
        }
        val commitPath = "/api/collaboration/direct/packages/${manifest.getString("manifestId")}/commit"
        val commitBody = JSONObject().put("manifestId", manifest.getString("manifestId")).toString().toByteArray(Charsets.UTF_8)
        val committed = jsonRequest(endpoint, "POST", commitPath, map.transportBindingId, nodeId, secret, commitBody)
        require(committed.optBoolean("ok")) { committed.optString("message").ifBlank { "Windows 未提交协作包" } }
    }

    private fun jsonRequest(endpoint: String, method: String, path: String, bindingId: String, nodeId: String, secret: String, body: ByteArray = ByteArray(0)): JSONObject {
        val connection = open(endpoint, method, path, path.substringBefore('?'), bindingId, nodeId, secret, body)
        if (body.isNotEmpty()) connection.outputStream.use { it.write(body) }
        val status = connection.responseCode
        val parsed = parseJsonResponse(connection, status)
        connection.disconnect()
        require(status in 200..299) { parsed.optString("message").ifBlank { "协作请求失败（HTTP $status）" } }
        return parsed
    }

    private fun open(endpoint: String, method: String, pathWithQuery: String, signedPath: String, bindingId: String, nodeId: String, secret: String, body: ByteArray): HttpURLConnection {
        val timestamp = System.currentTimeMillis().toString()
        val nonce = UUID.randomUUID().toString().replace("-", "")
        val contentSha = sha256(body.inputStream())
        return (URL("$endpoint$pathWithQuery").openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 6_000; readTimeout = 30_000
            doOutput = body.isNotEmpty() || method in setOf("POST", "PUT")
            setRequestProperty("Content-Type", if (method == "PUT") "application/octet-stream" else "application/json; charset=utf-8")
            setRequestProperty("X-Edu-Binding-Id", bindingId); setRequestProperty("X-Edu-Node-Id", nodeId)
            setRequestProperty("X-Edu-Timestamp", timestamp); setRequestProperty("X-Edu-Nonce", nonce)
            setRequestProperty("X-Edu-Content-Sha256", contentSha)
            setRequestProperty("X-Edu-Signature", CollaborationDirectProtocol.requestSignature(secret, method, signedPath, bindingId, nodeId, timestamp, nonce, contentSha))
            if (body.isNotEmpty()) setFixedLengthStreamingMode(body.size)
        }
    }

    private fun parseJsonResponse(connection: HttpURLConnection, status: Int): JSONObject {
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.let { readBounded(it, 2 * 1024 * 1024).toString(Charsets.UTF_8) }.orEmpty()
        return runCatching { JSONObject(text) }.getOrElse { JSONObject().put("message", text.ifBlank { "主机返回空响应" }) }
    }

    private fun errorMessage(connection: HttpURLConnection, status: Int): String =
        parseJsonResponse(connection, status).optString("message").ifBlank { "协作下载失败（HTTP $status）" }

    companion object {
        private const val CHUNK_BYTES = 1024 * 1024
        private const val MAX_TOTAL_FILE_BYTES = 64L * 1024 * 1024
        private const val MAX_PACKAGE_BYTES = 2L * 1024 * 1024 * 1024
        private const val MIN_FREE_BYTES = 64L * 1024 * 1024
        private fun safeFileName(value: String) = value.replace(Regex("[^A-Za-z0-9._-]"), "-").take(160)
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

private fun hmac(secret: String, value: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    return mac.doFinal(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

private fun readBounded(input: InputStream, maximum: Int): ByteArray = input.use { stream ->
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(64 * 1024)
    while (true) {
        val count = stream.read(buffer)
        if (count < 0) break
        if (output.size() + count > maximum) error("协作响应超出大小限制")
        output.write(buffer, 0, count)
    }
    output.toByteArray()
}
