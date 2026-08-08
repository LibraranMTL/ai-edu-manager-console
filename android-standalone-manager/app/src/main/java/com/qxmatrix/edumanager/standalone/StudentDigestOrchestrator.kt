package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class StudentDigestOrchestrator(private val context: Context) {
    private val students = StudentIndexRepository(context)
    private val files = FileAssetService(context)
    private val tasks = TaskRepository(context)

    fun digestPending(studentId: String): JSONObject {
        val student = students.requireExact(studentId)
        val materials = files.materials(studentId).filter { MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PENDING_DIGEST }
        require(materials.isNotEmpty()) { "当前没有待消化资料" }
        val eligible = materials.filter { it.optString("fileName").substringAfterLast('.', "").lowercase() in setOf("txt", "md", "csv", "json") || it.optString("ocrStatus") == "completed" }
        require(eligible.isNotEmpty()) { "当前待消化资料需要先经过 W7 OCR/文档解析" }
        val expectedPath = "${student.paths.summaryPath}/摘要库/消化结果.md"
        val task = tasks.create(JSONObject()
            .put("title", "${student.name} 资料消化").put("kind", "student_digest").put("sourceType", "student").put("sourceId", student.id).put("sourceName", student.name)
            .put("status", "pending").put("riskLevel", "medium").put("completionPolicy", "validated_result")
            .put("count", eligible.size).put("input", JSONObject().put("studentId", student.id).put("materialIds", JSONArray(eligible.map { it.getString("id") })))
            .put("expectedOutput", JSONObject().put("path", expectedPath).put("format", "markdown+knowledge-engine-v1"))
            .put("permissions", JSONObject().put("read", JSONArray(listOf(student.paths.agentPath, student.paths.rawPath)))
                .put("write", JSONArray(listOf(student.paths.summaryPath, child(student.paths.rootPath, ".edu-manager/knowledge-engine-v1"))))
                .put("operations", JSONArray(listOf("read_file", "write_knowledge", "update_index")))))
        val running = tasks.start(task.getString("id")); val executionId = running.getString("executionId")
        eligible.forEach { files.transitionMaterial(studentId, it.getString("id"), MaterialStatus.SUBMITTED); files.transitionMaterial(studentId, it.getString("id"), MaterialStatus.DIGESTING) }
        return try {
            val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
            val rules = store.readBytes(student.paths.agentPath).toString(Charsets.UTF_8)
            val sourceContents = eligible.map { material ->
                val content = if (material.optString("ocrStatus") == "completed" && material.optString("ocrPath").isNotBlank()) {
                    JSONObject(files.readLogicalBytes(studentId, material.getString("ocrPath")).toString(Charsets.UTF_8)).optString("text")
                } else files.readMaterialBytes(studentId, material.getString("id")).toString(Charsets.UTF_8)
                val bounded = content.take(100_000)
                material to bounded
            }
            val adapterConfig = requireNotNull(AgentConfigurationStore(context).load()) { "尚未配置 Agent 模型" }
            val response = OpenAiCompatibleAgentAdapter(adapterConfig).execute(
                "你是 AI 教育管家的资料消化 Agent。严格遵守 AGENT.md；只形成可审计知识候选，不发布正式教育结论。只输出 JSON。",
                buildPrompt(student, rules, sourceContents),
            )
            val parsed = parseJsonResponse(response)
            val artifactPath = "${student.paths.summaryPath}/摘要库/消化-${executionId}.md"
            store.writeBytesSafely(artifactPath, digestMarkdown(student, parsed, sourceContents).toByteArray(), "text/markdown")
            updateWikiIndexes(store, student, artifactPath)
            registerKnowledge(student, sourceContents, parsed)
            eligible.forEach { files.transitionMaterial(studentId, it.getString("id"), MaterialStatus.PROCESSED) }
            val result = resultPayload(task.getString("id"), executionId, true, "已消化 ${eligible.size} 份资料", artifactPath)
            tasks.acceptResult(task.getString("id"), result)
            JSONObject().put("ok", true).put("task", tasks.requireExact(task.getString("id"))).put("artifactPath", artifactPath).put("processed", eligible.size)
        } catch (error: Throwable) {
            eligible.forEach { material -> runCatching { files.transitionMaterial(studentId, material.getString("id"), MaterialStatus.FAILED) } }
            val result = resultPayload(task.getString("id"), executionId, false, error.message ?: "资料消化失败", "")
            runCatching { tasks.acceptResult(task.getString("id"), result) }
            throw error
        }
    }

    private fun buildPrompt(student: StudentRecord, rules: String, sources: List<Pair<JSONObject, String>>): String = buildString {
        appendLine("学生 ID：${student.id}"); appendLine("学生姓名：${student.name}"); appendLine("\nAGENT.md：\n$rules")
        appendLine("\n本批资料：")
        sources.forEach { (material, content) -> appendLine("\n--- ${material.getString("fileName")} | ${material.getString("sha1")} ---\n$content") }
        appendLine("""

            返回格式：
            {"summary":"批次摘要","concepts":["概念"],"entities":["实体"],"qa":[{"question":"问题","answer":"答案"}],"claims":[{"predicate":"声明类型","value":"候选判断","confidence":"low|medium|high","sourceMaterialId":"资料ID","excerpt":"证据摘录"}]}
            claims 只能是 candidate；没有来源证据就不要生成。不得输出学生人格、能力或诊断性标签。
        """.trimIndent())
    }

    private fun registerKnowledge(student: StudentRecord, sources: List<Pair<JSONObject, String>>, parsed: JSONObject) {
        val engine = StudentWorkspaceService(context).knowledgeEngine(student.id)
        val uriByMaterial = mutableMapOf<String, String>()
        sources.forEach { (material, content) ->
            val sourceUri = "edu://student/${student.id}/raw/${material.getString("id")}"; uriByMaterial[material.getString("id")] = sourceUri
            engine.importAsset(JSONObject().put("id", "source-${material.getString("sha1")}").put("uri", sourceUri).put("title", material.getString("fileName")).put("mediaType", "text/plain").put("content", content))
        }
        val claims = parsed.optJSONArray("claims") ?: JSONArray()
        for (index in 0 until claims.length()) {
            val candidate = claims.optJSONObject(index) ?: continue; val materialId = candidate.optString("sourceMaterialId"); val sourceUri = uriByMaterial[materialId] ?: continue
            val predicate = candidate.optString("predicate").trim(); if (predicate.isBlank() || candidate.optString("value").isBlank()) continue
            val evidence = JSONArray().put(JSONObject().put("id", "evidence-${UUID.randomUUID()}").put("sourceUri", sourceUri).put("excerpt", candidate.optString("excerpt")).put("observedAt", Timestamp.now()))
            engine.upsertClaim(JSONObject().put("id", "claim-${UUID.randomUUID()}").put("subjectId", student.id).put("predicate", predicate).put("value", candidate.optString("value"))
                .put("status", "candidate").put("confidence", candidate.optString("confidence", "unknown")).put("evidence", evidence).put("generatedBy", "local-agent"))
        }
    }

    private fun updateWikiIndexes(store: SafWorkspaceStore, student: StudentRecord, artifactPath: String) {
        val indexPath = "${student.paths.summaryPath}/index.md"; val logPath = "${student.paths.summaryPath}/log.md"
        val index = store.readBytes(indexPath).toString(Charsets.UTF_8).trimEnd() + "\n\n- [${Timestamp.now()}] $artifactPath\n"
        val log = store.readBytes(logPath).toString(Charsets.UTF_8).trimEnd() + "\n- ${Timestamp.now()}：完成一批资料消化，产物 $artifactPath。\n"
        store.writeBytesSafely(indexPath, index.toByteArray(), "text/markdown"); store.writeBytesSafely(logPath, log.toByteArray(), "text/markdown")
    }

    private fun digestMarkdown(student: StudentRecord, parsed: JSONObject, sources: List<Pair<JSONObject, String>>) = """
        # ${student.name} 资料消化结果

        生成时间：${Timestamp.now()}

        ## 批次摘要

        ${parsed.optString("summary")}

        ## 概念

        ${parsed.optJSONArray("concepts").strings().joinToString("\n") { "- $it" }}

        ## 实体

        ${parsed.optJSONArray("entities").strings().joinToString("\n") { "- $it" }}

        ## 来源

        ${sources.joinToString("\n") { (m, _) -> "- ${m.getString("fileName")}（${m.getString("sha1")}）" }}
    """.trimIndent() + "\n"

    private fun parseJsonResponse(text: String): JSONObject {
        val cleaned = text.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        val start = cleaned.indexOf('{'); val end = cleaned.lastIndexOf('}')
        require(start >= 0 && end > start) { "Agent 未返回有效 JSON" }
        return JSONObject(cleaned.substring(start, end + 1))
    }

    private fun resultPayload(taskId: String, executionId: String, passed: Boolean, message: String, artifactPath: String) = JSONObject()
        .put("protocolVersion", TaskProtocol.VERSION).put("taskId", taskId).put("executionId", executionId)
        .put("status", if (passed) "completed" else "failed").put("message", message)
        .put("artifacts", JSONArray().also { if (artifactPath.isNotBlank()) it.put(JSONObject().put("path", artifactPath)) })
        .put("validation", JSONObject().put("passed", passed))

    private fun child(root: String, path: String) = if (root.isBlank()) path else "$root/$path"
}
