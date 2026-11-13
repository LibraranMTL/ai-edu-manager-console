package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

object ProjectCheckpointRecoveryPolicy {
    fun matches(cache: JSONObject, expectedKey: String, frozen: JSONArray): Boolean {
        if (expectedKey.isBlank() || cache.optString("key") != expectedKey || frozen.length() == 0) return false
        val markdown = cache.optString("markdown"); val summary = cache.optJSONObject("result")?.optString("summary").orEmpty()
        if (summary.isBlank() || !markdown.contains(summary)) return false
        val ids = mutableSetOf<String>()
        for (i in 0 until frozen.length()) {
            val source = frozen.optJSONObject(i) ?: return false
            val id = source.optString("materialId"); val version = source.optInt("version"); val hash = source.optString("sha256")
            if (id.isBlank() || !ids.add(id) || version < 1 || !hash.matches(Regex("[0-9a-f]{64}")) ||
                !markdown.contains("$id v$version · $hash")) return false
        }
        return true
    }
}

object ProjectRetryPolicy {
    fun matches(ticket: JSONObject, jobId: String, projectId: String, studentId: String, frozen: JSONArray): Boolean =
        jobId.isNotBlank() && projectId.isNotBlank() && studentId.isNotBlank() && frozen.length() > 0 &&
            ticket.optString("state") == "authorized" && ticket.optString("jobId") == jobId &&
            ticket.optString("projectId") == projectId && ticket.optString("studentId") == studentId &&
            ticket.optString("frozenFingerprint") == ScopedContentPolicy.fingerprint(JSONObject().put("frozen", frozen))
}

/** Executes a bounded project digest from fixed local material versions. */
class LocalProjectDigestService(private val context: Context) {
    private val materials = LocalProjectMaterialService(context)
    private val projects = ProjectRepository(context)

    fun freezePending(projectId: String, maximum: Int = 20, automatic: Boolean = false): JSONArray = synchronized(LOCK) {
        require(maximum in 1..50)
        val project = projects.requireExact(projectId)
        require(project.materialStorageMode == "workspace-v1" && project.materialMigrationState != "running") { "项目资料尚未统一或正在迁移" }
        val selected = materials.list(projectId, "materials").filter {
            (!automatic || ProjectAutoDigestPolicy.eligibleMaterial(it)) && it.optString("adoption") == "accepted" && it.optJSONObject("processing")?.optString("state") != "completed" &&
                it.optString("title").substringAfterLast('.', "").lowercase() in TEXT_EXTENSIONS
        }.take(maximum)
        require(selected.isNotEmpty()) { "没有可直接消化的文本资料；图片和PDF须先完成OCR或解析" }
        val fixed = selected.map { materials.freezeVersion(projectId, it.getString("materialId")) }
        JSONArray().also { output -> fixed.forEach { item -> output.put(JSONObject()
            .put("materialId", item.getString("materialId")).put("title", item.optString("title"))
            .put("version", item.getInt("version")).put("sha256", item.getString("sha256"))
            .put("size", item.getLong("size"))) } }
    }

    fun digestPending(projectId: String, maximum: Int = 20): JSONObject = digestFrozen(projectId, freezePending(projectId, maximum))

    fun digestFrozen(projectId: String, frozen: JSONArray, studentId: String = "", cacheOnly: Boolean = false,
        retryJobId: String = "", expectedOperationId: String = "", provenanceOnly: Boolean = false): JSONObject = synchronized(LOCK) {
        require(!provenanceOnly || (cacheOnly && expectedOperationId.isNotBlank())) { "来源恢复必须使用固定的本机检查点" }
        require(frozen.length() in 1..50) { "固定资料批次为空或过大" }
        val project = projects.requireExact(projectId)
        require(project.materialStorageMode == "workspace-v1" && project.materialMigrationState != "running") { "项目资料尚未统一或正在迁移" }
        val fixed = (0 until frozen.length()).map { frozen.getJSONObject(it) }
        require(fixed.map { it.getString("materialId") }.distinct().size == fixed.size) { "固定资料批次包含重复项" }
        val db = BusinessDatabase.get(context); BusinessRestoreRecovery.recover(context, db)
        val inputs = fixed.map { item ->
            val bytes = materials.readFrozenVersionBytes(projectId, item.getString("materialId"), item.getInt("version"), item.getString("sha256"))
            require(bytes.size <= MAX_SOURCE_BYTES) { "单份资料超过本机消化上限：${item.optString("title")}" }
            val extension = item.optString("title").substringAfterLast('.', "").lowercase()
            val content = if (extension in OCR_EXTENSIONS) {
                val ocrKey = "project-ocr:$projectId:${item.getString("sha256")}:$extension:mlkit-v1"
                val cachedOcr = db.tasks().metadata(ocrKey)?.let(::JSONObject)
                val text = if (cachedOcr == null) OcrVisionService(context).extractProjectText(bytes, extension) else {
                    require(cachedOcr.optString("sourceSha256") == item.getString("sha256"))
                    cachedOcr.getString("text").also { require(ScopedContentPolicy.hash(it.toByteArray()) == cachedOcr.getString("textSha256")) }
                }
                if (cachedOcr == null) db.tasks().metadata(BusinessMetadataEntity(ocrKey, JSONObject()
                    .put("sourceSha256", item.getString("sha256")).put("textSha256", ScopedContentPolicy.hash(text.toByteArray()))
                    .put("text", text).put("engine", "mlkit-v1").toString()))
                text
            } else bytes.toString(Charsets.UTF_8)
            item to content.take(MAX_SOURCE_CHARS)
        }
        val rules = SafWorkspaceStore(context, Uri.parse(project.projectRootUri)).readBytes(project.paths.agentPath).toString(Charsets.UTF_8)
        val config = requireNotNull(AgentConfigurationStore(context).load()) { "尚未配置任务 Agent" }
        val scope = studentId.ifBlank { project.studentIds.singleOrNull().orEmpty() }
        if (scope.isNotBlank()) { require(scope in project.studentIds); StudentIndexRepository(context).requireExact(scope) }
        val keyInput = JSONObject().put("projectId", projectId).put("frozen", frozen)
            .put("rules", ScopedContentPolicy.hash(rules.toByteArray())).put("endpoint", config.endpoint).put("model", config.model)
        if (fixed.any { it.optString("title").substringAfterLast('.', "").lowercase() in OCR_EXTENSIONS }) {
            keyInput.put("strategy", "project-digest-ocr-v1").put("inputTextHashes", JSONArray(inputs.map { ScopedContentPolicy.hash(it.second.toByteArray()) }))
        } else keyInput.put("strategy", "project-digest-v2")
        val key = ScopedContentPolicy.fingerprint(keyInput)
        val cacheKey = "project-digest-cache:$projectId:$key"
        val saved = db.tasks().metadata(cacheKey)?.let(::JSONObject)
        val operationId = "project-digest-${key.take(32)}"
        require(expectedOperationId.isBlank() || operationId == expectedOperationId) { "任务检查点与历史产物不匹配" }
        require(!cacheOnly || saved != null) { "没有可核验的项目模型检查点，保留未知状态且不重复调用" }
        val cached = saved ?: run {
            val taskId = "project:$projectId:$key"
            val unresolved = db.ledger().hasUnresolvedCall(scope, listOf(taskId))
            if (unresolved || retryJobId.isNotBlank()) {
                db.runInTransaction {
                    val ticketKey = "project-digest-retry:$retryJobId"
                    val ticket = db.tasks().metadata(ticketKey)?.let(::JSONObject)
                    require(ticket != null && ProjectRetryPolicy.matches(ticket, retryJobId, projectId, scope, frozen)) {
                        "上次项目模型结果未知，请核对计费和产物；不重复调用"
                    }
                    db.tasks().metadata(BusinessMetadataEntity(ticketKey, ticket.put("state", "consumed")
                        .put("consumedAt", Timestamp.now()).put("taskId", taskId).toString()))
                }
            }
            val response = OpenAiCompatibleAgentAdapter(config, context, scope, taskId).execute(
                "你是Android家庭单机版项目资料消化Agent。严格遵守AGENT.md；固定来源版本不可替换，只输出JSON。",
                prompt(project, rules, inputs),
            )
            val parsed = parse(response)
            val payload = JSONObject().put("result", parsed).put("markdown", markdown(project, parsed, inputs)).put("key", key)
            require(payload.toString().toByteArray().size <= 500_000) { "项目结果超过缓存上限" }
            db.runInTransaction { db.tasks().metadata(BusinessMetadataEntity(cacheKey, payload.toString())) }
            payload
        }
        require(cached.getString("key") == key) { "项目缓存指纹不匹配" }
        if (cacheOnly) require(ProjectCheckpointRecoveryPolicy.matches(cached, key, frozen)) { "项目检查点与固定来源不一致，保留未知状态" }
        materials.requireFrozenSourcesCurrent(projectId, frozen)
        val parsed = cached.getJSONObject("result")
        val store = SafWorkspaceStore(context, Uri.parse(project.knowledgeRootUri))
        val artifact = "${project.paths.summaryPath}/资料消化-$operationId.md"
        writeVerified(store, artifact, cached.getString("markdown"), provenanceOnly)
        writeList(store, project.paths.conceptPath, "资料概念-$operationId.md", "概念", parsed.optJSONArray("concepts"), provenanceOnly)
        writeList(store, project.paths.entityPath, "资料实体-$operationId.md", "实体", parsed.optJSONArray("entities"), provenanceOnly)
        val qa = parsed.optJSONArray("qa") ?: JSONArray()
        if (qa.length() > 0) writeVerified(store, "${project.paths.qaPath}/资料问答-$operationId.md", buildString {
            appendLine("# 项目问答精华"); appendLine()
            for (index in 0 until qa.length()) qa.optJSONObject(index)?.let { appendLine("## ${it.optString("question")}"); appendLine(); appendLine(it.optString("answer")); appendLine() }
        }, provenanceOnly)
        materials.requireFrozenSourcesCurrent(projectId, frozen)
        val provenance = JSONObject().put("schema", "edu-manager.project-digest-provenance.v1")
            .put("projectId", projectId).put("operationId", operationId).put("sources", JSONArray(frozen.toString()))
        val provenanceStore = SafWorkspaceStore(context, Uri.parse(project.projectRootUri))
        val provenancePath = "${project.paths.managerPath}/project-materials/digest-provenance/$operationId.json"
        val provenanceBytes = provenance.toString().toByteArray(Charsets.UTF_8)
        if (provenanceStore.exists(provenancePath)) require(provenanceStore.readBytes(provenancePath).contentEquals(provenanceBytes)) { "项目来源凭证冲突，保留原文件" }
        else provenanceStore.writeStreamNewSafely(provenancePath, "application/json") { it.write(provenanceBytes) }
        require(provenanceStore.readBytes(provenancePath).contentEquals(provenanceBytes)) { "项目来源凭证回读校验失败" }
        if (!provenanceOnly) materials.markProcessedVersions(projectId, fixed.associate { it.getString("materialId") to it.getInt("version") }, artifact, operationId)
        JSONObject().put("ok", true).put("processed", fixed.size).put("operationId", operationId).put("artifactPath", artifact)
    }

    private fun prompt(project: ProjectRecord, rules: String, sources: List<Pair<JSONObject, String>>) = buildString {
        appendLine("项目：${project.name}"); appendLine("项目ID：${project.id}"); appendLine(); appendLine("AGENT.md："); appendLine(rules)
        appendLine(); appendLine("固定输入版本：")
        sources.forEach { (item, content) ->
            appendLine("\n--- ${item.optString("title")} | ${item.optString("materialId")} v${item.optInt("version")} | ${item.optString("sha256")} ---")
            appendLine(content)
        }
        appendLine("""
            返回：{"summary":"摘要","concepts":["概念"],"entities":["实体"],"qa":[{"question":"问题","answer":"答案"}]}
            只提炼项目知识，不直接形成学生能力或贡献结论；信息不足时保持空数组。
        """.trimIndent())
    }

    private fun markdown(project: ProjectRecord, parsed: JSONObject, sources: List<Pair<JSONObject, String>>) = """
        # ${project.name} 项目资料消化

        生成时间：${Timestamp.now()}

        ## 摘要

        ${parsed.optString("summary")}

        ## 固定来源

        ${sources.joinToString("\n") { (item, text) ->
            val ocr = item.optString("title").substringAfterLast('.', "").lowercase() in OCR_EXTENSIONS
            "- ${item.optString("title")} · ${item.optString("materialId")} v${item.optInt("version")} · ${item.optString("sha256")}" +
                if (ocr) " · 本机 OCR mlkit-v1 · 识别文本 SHA-256 ${ScopedContentPolicy.hash(text.toByteArray())}" else ""
        }}

        本文是项目知识候选；资料分类不等于学生贡献确认。
    """.trimIndent() + "\n"

    private fun writeList(store: SafWorkspaceStore, root: String, name: String, title: String, values: JSONArray?, verifyOnly: Boolean = false) {
        if (root.isBlank() || values == null || values.length() == 0) return
        val body = buildString { appendLine("# $title"); appendLine(); for (index in 0 until values.length()) appendLine("- ${values.optString(index)}") }
        writeVerified(store, "$root/$name", body, verifyOnly)
    }
    private fun writeVerified(store: SafWorkspaceStore, path: String, text: String, verifyOnly: Boolean = false) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        if (store.exists(path)) require(store.readBytes(path).contentEquals(bytes)) { "已有项目知识产物与检查点不一致，保留原文件" }
        else { require(!verifyOnly) { "历史项目产物缺失，保留原状且不补造凭证" }; store.writeBytesSafely(path, bytes, "text/markdown") }
        require(store.readBytes(path).contentEquals(bytes)) { "项目知识产物回读校验失败" }
    }
    private fun parse(text: String): JSONObject {
        val clean = text.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        val start = clean.indexOf('{'); val end = clean.lastIndexOf('}')
        require(start >= 0 && end > start) { "Agent未返回有效JSON" }
        return JSONObject(clean.substring(start, end + 1))
    }

    companion object {
        private val LOCK = Any()
        private val OCR_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "pdf")
        private val TEXT_EXTENSIONS = setOf("txt", "md", "markdown", "csv", "json") + OCR_EXTENSIONS
        private const val MAX_SOURCE_BYTES = 4 * 1024 * 1024
        private const val MAX_SOURCE_CHARS = 100_000
    }
}
