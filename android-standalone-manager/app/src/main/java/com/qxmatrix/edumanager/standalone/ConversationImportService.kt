package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Stores only conversations the user explicitly pasted, selected, or shared. */
class ConversationImportService(private val context: Context) {
    private val students = StudentIndexRepository(context)
    private val projects = ProjectRepository(context)
    private val privateState = PrivateStateStore(context)

    fun save(studentId: String, projectId: String, sourceAgent: String, content: String, sourcePath: String = ""): JSONObject = synchronized(INDEX_LOCK) {
        val student = students.requireExact(studentId)
        val project = projectId.takeIf { it.isNotBlank() }?.let(projects::requireExact)
        require(project == null || student.id in project.studentIds) { "所选学习项目未绑定当前学生" }
        val normalized = content.trim()
        require(normalized.isNotBlank()) { "对话历史不能为空" }
        val bytes = normalized.toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_BYTES) { "单份对话历史不能超过 5 MB" }
        val hash = sha256(bytes)
        val assetId = "conversation-${hash.take(24)}"
        val scopeType = if (project == null) "student" else "project"
        val scopeId = project?.id ?: student.id
        val recordId = ConversationSourceIdentityPolicy.key(hash, scopeType, scopeId, student.id)
        val index = readIndex()
        index.optJSONArray("imports").toObjects().firstOrNull {
            it.optString("studentId") == student.id && it.optString("contentHash") == hash && it.optString("scopeType") == scopeType && it.optString("scopeId") == scopeId
        }?.let {
            IntakeRegistry(context).register(student.id, "explicit_conversation", recordId, hash, it.getString("contentPath"), project?.knowledgeRootUri ?: student.storageRootUri, it.getString("importedAt"), project?.id.orEmpty())
            return@synchronized JSONObject().put("ok", true).put("deduplicated", true).put("record", normalizeRecord(it)).put("message", "相同对话已经保存，本次未生成重复记录。")
        }

        val rootUri = project?.knowledgeRootUri ?: student.storageRootUri
        val rawRoot = project?.paths?.rawPath ?: student.paths.rawPath
        val folder = "$rawRoot/Agent对话资料"
        val contentPath = "$folder/$assetId.md"
        val metadataPath = "$folder/$recordId.meta.json"
        val importedAt = Timestamp.now()
        val safeAgent = sourceAgent.trim().take(80).ifBlank { "其他Agent" }
        val messageCount = estimateMessageCount(normalized)
        val record = JSONObject()
            .put("schema", "edu-manager.conversation-asset.v1").put("recordId", recordId).put("assetId", assetId)
            .put("interactionId", "interaction-${hash.take(24)}").put("immutable", true)
            .put("studentId", student.id).put("studentName", student.name)
            .put("scopeType", scopeType).put("scopeId", scopeId)
            .put("projectId", project?.id.orEmpty()).put("projectName", project?.name.orEmpty())
            .put("sourceAgent", safeAgent).put("sourcePath", sourcePath.take(1000))
            .put("contentHash", hash).put("size", bytes.size).put("messageCount", messageCount)
            .put("contentPath", contentPath).put("metadataPath", metadataPath).put("importedAt", importedAt).put("candidateOnly", true)
            .put("digestStatus", "pending").put("digestedAt", "").put("digestArtifactPath", "").put("digestError", "")
            .put("analysis", ConversationAnalysisPolicy.analyze(normalized)).put("analyzedAt", importedAt)
            .put("lifecycleStatus", "active").put("trashedAt", "").put("restoredAt", "")
            .put("explicitUserSave", true)
        val store = SafWorkspaceStore(context, Uri.parse(rootUri))
        if (store.exists(contentPath)) require(sha256(store.readBytes(contentPath)) == hash) { "已有对话原件已变化，不覆盖" }
        else store.writeBytesSafely(contentPath, bytes, "text/markdown")
        IntakeRegistry(context).register(student.id, "explicit_conversation", recordId, hash, contentPath, rootUri, importedAt, project?.id.orEmpty())
        store.writeBytesSafely(metadataPath, (record.toString(2) + "\n").toByteArray(), "application/json")
        index.getJSONArray("imports").put(record)
        index.put("updatedAt", importedAt)
        writeIndex(index)
        JSONObject().put("ok", true).put("deduplicated", false).put("record", record)
            .put("message", "对话已保存到教育管家，共记录 $messageCount 条消息定位；知识内容保持候选状态。")
    }

    fun list(studentId: String? = null, includeTrashed: Boolean = false): List<JSONObject> = readIndex().optJSONArray("imports").toObjects().map(::normalizeRecord)
        .filter { (studentId.isNullOrBlank() || it.optString("studentId") == studentId) && (includeTrashed || it.optString("lifecycleStatus") != "trashed") }
        .sortedByDescending { it.optString("importedAt") }

    fun trashed(studentId: String? = null): List<JSONObject> = list(studentId, includeTrashed = true)
        .filter { it.optString("lifecycleStatus") == "trashed" }

    fun analyze(recordId: String): JSONObject {
        val analysis = ConversationAnalysisPolicy.analyze(readContent(recordId))
        return updateRecord(recordId) { it.put("analysis", analysis).put("analyzedAt", Timestamp.now()) }
    }

    fun requireExact(recordId: String): JSONObject = readIndex().optJSONArray("imports").toObjects()
        .singleOrNull { normalizeRecord(it).optString("recordId") == recordId }
        ?.let(::normalizeRecord) ?: throw NoSuchElementException("未找到指定对话记录")

    fun readContent(recordId: String): String {
        val record = requireExact(recordId); val access = access(record); validateConversationPaths(record, access)
        val bytes = SafWorkspaceStore(context, Uri.parse(access.rootUri)).readBytes(record.getString("contentPath"))
        require(bytes.size <= MAX_BYTES) { "对话原文超过 5 MB 浏览上限" }
        require(sha256(bytes) == record.getString("contentHash")) { "对话原文哈希校验失败，已停止读取" }
        return bytes.toString(Charsets.UTF_8)
    }

    fun readDigestArtifact(recordId: String): String {
        val record = requireExact(recordId)
        require(record.optString("digestStatus") == "completed") { "该对话尚未完成消化" }
        val path = record.optString("digestArtifactPath"); require(path.isNotBlank()) { "消化结果路径缺失" }
        val access = access(record); val allowedRoot = if (record.optString("scopeType") == "project") {
            projects.requireExact(record.getString("scopeId")).paths.summaryPath
        } else students.requireExact(record.getString("studentId")).paths.summaryPath
        require(path == allowedRoot || path.startsWith("${allowedRoot.trimEnd('/')}/")) { "消化结果路径超出当前归属范围" }
        val bytes = SafWorkspaceStore(context, Uri.parse(access.rootUri)).readBytes(path)
        require(bytes.size <= MAX_BYTES) { "消化结果超过浏览上限" }
        return bytes.toString(Charsets.UTF_8)
    }

    fun markDigestState(recordId: String, status: String, artifactPath: String = "", error: String = ""): JSONObject {
        require(status in setOf("pending", "running", "completed", "failed")) { "未知对话消化状态" }
        val index = readIndex(); val records = index.getJSONArray("imports").toObjects().toMutableList()
        val position = records.indexOfFirst { normalizeRecord(it).optString("recordId") == recordId }
        require(position >= 0) { "未找到指定对话记录" }
        val next = normalizeRecord(records[position]).put("digestStatus", status).put("digestError", error.take(1000))
        if (status == "completed") next.put("digestedAt", Timestamp.now()).put("digestArtifactPath", artifactPath)
        records[position] = next
        index.put("imports", JSONArray(records)).put("updatedAt", Timestamp.now()); writeIndex(index)
        return next
    }

    fun trash(recordId: String): JSONObject {
        val current = requireExact(recordId)
        require(current.optString("digestStatus") != "running") { "对话正在消化，不能移入回收站" }
        return updateRecord(recordId) { it.put("lifecycleStatus", "trashed").put("trashedAt", Timestamp.now()) }
    }

    fun restore(recordId: String): JSONObject = updateRecord(recordId) {
        it.put("lifecycleStatus", "active").put("restoredAt", Timestamp.now()).put("trashedAt", "")
    }

    fun delete(recordId: String): JSONObject {
        val record = requireExact(recordId)
        require(record.optString("lifecycleStatus") == "trashed") { "请先将对话移入回收站，再执行永久删除" }
        require(record.optString("digestStatus") != "running") { "对话正在消化，不能删除" }
        require(record.optString("digestStatus") != "completed") { "已消化对话必须保留原文作为候选知识证据；请保留该记录" }
        val access = access(record); validateConversationPaths(record, access)
        val store = SafWorkspaceStore(context, Uri.parse(access.rootUri))
        store.deleteFileIfExists(record.getString("contentPath"))
        store.deleteFileIfExists(record.getString("metadataPath"))
        val index = readIndex(); val remaining = index.getJSONArray("imports").toObjects()
            .filterNot { normalizeRecord(it).optString("recordId") == recordId }
        val tombstone = JSONObject().put("schema", "edu-manager.conversation-deletion.v1")
            .put("recordId", recordId).put("assetId", record.optString("assetId"))
            .put("studentId", record.optString("studentId")).put("scopeType", record.optString("scopeType"))
            .put("scopeId", record.optString("scopeId")).put("contentHash", record.optString("contentHash"))
            .put("deletedAt", Timestamp.now()).put("explicitUserDelete", true)
        index.put("imports", JSONArray(remaining)).getJSONArray("deletions").put(tombstone)
        index.put("updatedAt", Timestamp.now()); writeIndex(index)
        return JSONObject().put("ok", true).put("deleted", true).put("tombstone", tombstone)
    }

    private fun room(): RoomConversationStore {
        val db = BusinessDatabase.get(context); BusinessRestoreRecovery.recover(context, db)
        return RoomConversationStore(db) { ids -> val known = students.list().map { it.id }.toSet(); require(ids.all { it in known }) { "对话登记指向不存在的学生" } }
    }
    private fun readIndex(): JSONObject = MaterialDatabaseAccess.run { room().read { legacyIndex().apply { put("imports", JSONArray(getJSONArray("imports").toObjects().map(::normalizeRecord))) } } }
    private fun legacyIndex(): JSONObject {
        val bytes = privateState.readIfPresent(INDEX_PATH) ?: return JSONObject().put("schema", "edu-manager.android-conversation-index.v2").put("imports", JSONArray()).put("deletions", JSONArray()).put("updatedAt", "")
        return JSONObject(bytes.toString(Charsets.UTF_8)).also {
            val imports = it.getJSONArray("imports")
            for (i in 0 until imports.length()) require(imports.getJSONObject(i).getString("studentId").isNotBlank()) { "对话登记缺少学生作用域，停止写入" }
            if (!it.has("deletions")) it.put("deletions", JSONArray())
            it.put("schema", "edu-manager.android-conversation-index.v2")
        }
    }

    private fun writeIndex(index: JSONObject) = MaterialDatabaseAccess.run {
        val room = room(); room.write(index)
        privateState.writeBytes(INDEX_PATH, (index.toString(2) + "\n").toByteArray()); room.projectionComplete()
    }

    private fun normalizeRecord(input: JSONObject): JSONObject = JSONObject(input.toString()).apply {
        if (optString("recordId").isBlank()) put("recordId", recordId(optString("contentHash"), optString("scopeType"), optString("scopeId")))
        if (optString("metadataPath").isBlank()) put("metadataPath", optString("contentPath").removeSuffix(".md") + ".meta.json")
        if (optString("digestStatus").isBlank()) put("digestStatus", "pending")
        if (!has("digestedAt")) put("digestedAt", "")
        if (!has("digestArtifactPath")) put("digestArtifactPath", "")
        if (!has("digestError")) put("digestError", "")
        if (!has("analysis")) put("analysis", JSONObject())
        if (!has("analyzedAt")) put("analyzedAt", "")
        if (!has("lifecycleStatus")) put("lifecycleStatus", "active")
        if (!has("trashedAt")) put("trashedAt", "")
        if (!has("restoredAt")) put("restoredAt", "")
    }

    private fun updateRecord(recordId: String, transform: (JSONObject) -> JSONObject): JSONObject = synchronized(INDEX_LOCK) {
        val index = readIndex(); val records = index.getJSONArray("imports").toObjects().toMutableList()
        val position = records.indexOfFirst { normalizeRecord(it).optString("recordId") == recordId }
        require(position >= 0) { "未找到指定对话记录" }
        val next = transform(normalizeRecord(records[position]))
        records[position] = next
        index.put("imports", JSONArray(records)).put("updatedAt", Timestamp.now())
        writeIndex(index)
        next
    }

    private fun recordId(hash: String, scopeType: String, scopeId: String): String =
        "conversation-record-${sha256("$hash|$scopeType|$scopeId".toByteArray()).take(24)}"

    private fun access(record: JSONObject): ConversationAccess {
        val student = students.requireExact(record.getString("studentId"))
        return if (record.optString("scopeType") == "project") {
            val project = projects.requireExact(record.getString("scopeId"))
            require(student.id in project.studentIds) { "对话项目不再绑定当前学生" }
            ConversationAccess(project.knowledgeRootUri, project.paths.rawPath)
        } else {
            require(record.getString("scopeId") == student.id) { "对话学生范围不一致" }
            ConversationAccess(student.storageRootUri, student.paths.rawPath)
        }
    }

    private fun validateConversationPaths(record: JSONObject, access: ConversationAccess) {
        val folder = "${access.rawRoot.trimEnd('/')}/Agent对话资料/"
        require(record.getString("contentPath").startsWith(folder) && record.getString("metadataPath").startsWith(folder)) {
            "对话文件路径超出当前原始资料库"
        }
    }

    private fun estimateMessageCount(content: String): Int {
        val jsonCount = runCatching {
            val parsed = JSONObject(content); parsed.optJSONArray("messages")?.length() ?: 0
        }.getOrDefault(0)
        if (jsonCount > 0) return jsonCount
        val marked = Regex("(?m)^(用户|User|助手|Assistant|豆包|PalmClaw|QClaw)\\s*[:：]").findAll(content).count()
        return marked.coerceAtLeast(1)
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private data class ConversationAccess(val rootUri: String, val rawRoot: String)

    companion object { private const val INDEX_PATH = "conversation-imports.json"; private const val MAX_BYTES = 5 * 1024 * 1024; private val INDEX_LOCK = Any() }
}
