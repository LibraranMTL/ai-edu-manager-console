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

    fun digestPending(studentId: String): JSONObject = digest(studentId, null)

    fun digestSelected(studentId: String, materialIds: Set<String>): JSONObject {
        require(materialIds.isNotEmpty()) { "没有选择要消化的资料" }
        return digest(studentId, materialIds)
    }

    private fun digest(studentId: String, selectedMaterialIds: Set<String>?): JSONObject = synchronized(StudentWorkLocks.forStudent(studentId)) {
        val student = students.requireExact(studentId)
        val materials = files.materials(studentId).filter {
            MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PENDING_DIGEST &&
                (selectedMaterialIds == null || it.optString("id") in selectedMaterialIds)
        }
        require(materials.isNotEmpty()) { "当前没有待消化资料" }
        val eligible = materials.filter { it.optString("fileName").substringAfterLast('.', "").lowercase() in setOf("txt", "md", "csv", "json") || it.optString("ocrStatus") == "completed" }.take(20)
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
        try {
            val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
            val rules = store.readBytes(student.paths.agentPath).toString(Charsets.UTF_8)
            val sourceContents = eligible.map { material ->
                val original = files.readMaterialBytes(studentId, material.getString("id"))
                material.put("digestSourceSha256", ScopedContentPolicy.hash(original))
                val content = if (material.optString("ocrStatus") == "completed" && material.optString("ocrPath").isNotBlank()) {
                    JSONObject(files.readLogicalBytes(studentId, material.getString("ocrPath")).toString(Charsets.UTF_8)).optString("text")
                } else original.toString(Charsets.UTF_8)
                material.put("digestTextSha256", ScopedContentPolicy.hash(content.toByteArray()))
                val bounded = content.take(6_000)
                material to bounded
            }
            val adapterConfig = requireNotNull(AgentConfigurationStore(context).load()) { "尚未配置 Agent 模型" }
            val prompt = buildPrompt(student, rules, sourceContents)
            val cacheKey = ScopedContentPolicy.fingerprint(JSONObject().put("strategy", "student-digest-v3").put("studentId", studentId)
                .put("endpoint", adapterConfig.endpoint).put("model", adapterConfig.model).put("prompt", prompt)
                .put("fullTextHashes", JSONArray(sourceContents.map { it.first.getString("digestTextSha256") })))
            val content = ScopedContentRepository(context); val db = BusinessDatabase.get(context)
            val cached = content.checkpoint(studentId, "digest_result", cacheKey)
            val markerKey = "digest-request:$studentId:$cacheKey"
            val parsed = if (cached != null) cached.getJSONObject("result") else {
                require(UnknownOutcomePolicy.retryAllowed(db.tasks().metadata(markerKey)?.let(::JSONObject), selectedMaterialIds != null)) { "上次相同资料消化结果未知，请到任务中心核对并单次授权，再手动选择资料消化；不会自动重试" }
                db.tasks().metadata(BusinessMetadataEntity(markerKey, JSONObject().put("state", "unknown").put("taskId", task.getString("id")).toString()))
                val response = OpenAiCompatibleAgentAdapter(adapterConfig, context, student.id, task.getString("id")).execute(
                    "你是 AI 教育管家的资料消化 Agent。严格遵守 AGENT.md；只形成可审计知识候选，不发布正式教育结论。只输出 JSON。", prompt)
                parseJsonResponse(response).also { result ->
                    DigestEvidencePolicy.validate(result, sourceContents.associate { it.first.getString("id") to it.second })
                    content.saveCheckpoint(studentId, "digest_result", cacheKey, JSONObject().put("result", result)
                        .put("markdown", digestMarkdown(student, result, sourceContents)).put("sourceFingerprint", cacheKey))
                    db.tasks().metadata(BusinessMetadataEntity(markerKey, JSONObject().put("state", "succeeded").toString()))
                }
            }
            DigestEvidencePolicy.validate(parsed, sourceContents.associate { it.first.getString("id") to it.second })
            sourceContents.forEach { (material, _) ->
                require(ScopedContentPolicy.hash(files.readMaterialBytes(studentId, material.getString("id"))) == material.getString("digestSourceSha256")) { "来源已变化，拒绝写入迟到结果" }
                if (material.optString("ocrStatus") == "completed" && material.optString("ocrPath").isNotBlank()) {
                    val text = JSONObject(files.readLogicalBytes(studentId, material.getString("ocrPath")).toString(Charsets.UTF_8)).optString("text")
                    require(ScopedContentPolicy.hash(text.toByteArray()) == material.getString("digestTextSha256")) { "OCR 来源已变化，原版本保留" }
                }
            }
            val artifactPath = "${student.paths.summaryPath}/摘要库/消化-${cacheKey.take(24)}.md"
            val markdown = requireNotNull(content.checkpoint(studentId, "digest_result", cacheKey)).getString("markdown")
            store.writeBytesSafely(artifactPath, markdown.toByteArray(), "text/markdown")
            updateWikiIndexes(store, student, artifactPath)
            registerKnowledge(student, sourceContents, parsed, cacheKey)
            registerGrowthEvidence(student, sourceContents, parsed)
            eligible.forEach {
                files.patchMaterial(studentId, it.getString("id"), JSONObject()
                    .put("digestedAt", Timestamp.now()).put("digestBatchId", executionId)
                    .put("digestArtifactPath", artifactPath).put("digestResult", parsed.optString("summary"))
                    .put("digestAttemptedAt", Timestamp.now()).put("digestError", ""))
                files.transitionMaterial(studentId, it.getString("id"), MaterialStatus.PROCESSED)
            }
            val result = resultPayload(task.getString("id"), executionId, true, "已消化 ${eligible.size} 份资料", artifactPath)
            tasks.acceptResult(task.getString("id"), result)
            JSONObject().put("ok", true).put("task", tasks.requireExact(task.getString("id"))).put("artifactPath", artifactPath).put("processed", eligible.size)
        } catch (error: Throwable) {
            eligible.forEach { material -> runCatching {
                files.patchMaterial(studentId, material.getString("id"), JSONObject()
                    .put("digestAttemptedAt", Timestamp.now()).put("digestBatchId", executionId)
                    .put("digestError", (error.message ?: "资料消化失败").take(600)))
                files.transitionMaterial(studentId, material.getString("id"), MaterialStatus.FAILED)
            } }
            val result = resultPayload(task.getString("id"), executionId, false, error.message ?: "资料消化失败", "")
            runCatching { tasks.acceptResult(task.getString("id"), result) }
            throw error
        }
    }

    private fun buildPrompt(student: StudentRecord, rules: String, sources: List<Pair<JSONObject, String>>): String = buildString {
        appendLine("学生 ID：${student.id}"); appendLine("学生姓名：${student.name}"); appendLine("\nAGENT.md：\n$rules")
        appendLine("\n本批资料：")
        sources.forEach { (material, content) -> appendLine("\n--- ${material.getString("fileName")} | materialId=${material.getString("id")} | sha256=${material.getString("digestSourceSha256")} | fragment=前6000字符 ---\n$content") }
        appendLine("""

            返回格式：
            {"summary":"批次摘要","concepts":["概念"],"entities":["实体"],"qa":[{"question":"问题","answer":"答案"}],"claims":[{"predicate":"声明类型","value":"候选判断","confidence":"low|medium|high","sourceMaterialId":"资料ID","excerpt":"证据摘录"}],"growthEvidence":[{"title":"可审核的观察标题","ability":"支撑的能力维度或待标注","observation":"只描述资料中可直接观察到的学习行为或成果","confidence":"low|medium","sourceMaterialId":"资料ID","excerpt":"原文摘录"}]}
            claims 只能是 candidate；没有来源证据就不要生成。不得输出学生人格、能力或诊断性标签。
            growthEvidence 只登记原始资料直接支持的学习行为、作品成果、订正或执行事实；不能从分数、报告或单次表现推断人格和稳定能力。没有这类事实时返回空数组。
        """.trimIndent())
    }

    private fun registerGrowthEvidence(student: StudentRecord, sources: List<Pair<JSONObject, String>>, parsed: JSONObject) {
        val sourceByMaterial = sources.associate { (material, _) -> material.optString("id") to material }
        val candidates = parsed.optJSONArray("growthEvidence") ?: JSONArray(); val growth = GrowthModelService(context)
        for (index in 0 until candidates.length()) {
            val candidate = candidates.optJSONObject(index) ?: continue
            val material = sourceByMaterial[candidate.optString("sourceMaterialId")] ?: continue
            val title = candidate.optString("title").trim(); val observation = candidate.optString("observation").trim()
            if (title.isBlank() || observation.isBlank()) continue
            val excerpt = candidate.optString("excerpt").trim()
            require(excerpt.isNotBlank() && sources.single { it.first.getString("id") == material.getString("id") }.second.contains(excerpt)) { "成长观察缺少真实原文摘录，不登记" }
            val content = if (excerpt.isBlank() || observation.contains(excerpt)) observation else "$observation\n\n原文摘录：$excerpt"
            growth.addAutomaticCandidate(
                studentId = student.id,
                title = title,
                ability = candidate.optString("ability", "待标注"),
                sourceUri = "edu://student/${student.id}/raw/${material.getString("id")}",
                content = content,
                confidence = candidate.optString("confidence", "unknown"),
                generatedBy = "local-agent-student-digest",
            )
        }
    }

    private fun registerKnowledge(student: StudentRecord, sources: List<Pair<JSONObject, String>>, parsed: JSONObject, cacheKey: String) {
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
            require(candidate.optString("excerpt").isNotBlank() && sources.single { it.first.getString("id") == materialId }.second.contains(candidate.getString("excerpt"))) { "知识声明没有真实原文摘录，不登记" }
            val source = sources.single { it.first.getString("id") == materialId }.first
            val identity = ScopedContentPolicy.hash("$cacheKey:$materialId:$predicate:${candidate.optString("value")}".toByteArray()).take(24)
            val evidence = JSONArray().put(JSONObject().put("id", "evidence-$identity").put("sourceUri", sourceUri).put("excerpt", candidate.optString("excerpt")).put("observedAt", Timestamp.now())
                .put("sourceSha256", source.getString("digestSourceSha256")).put("fragment", "前6000字符").put("processingVersion", "student-digest-v2"))
            engine.upsertClaim(JSONObject().put("id", "claim-$identity").put("subjectId", engine.subjectId).put("predicate", predicate).put("value", candidate.optString("value"))
                .put("status", "candidate").put("confidence", candidate.optString("confidence", "unknown")).put("evidence", evidence).put("generatedBy", "local-agent"))
        }
    }

    private fun updateWikiIndexes(store: SafWorkspaceStore, student: StudentRecord, artifactPath: String) {
        val indexPath = "${student.paths.summaryPath}/index.md"; val logPath = "${student.paths.summaryPath}/log.md"
        val previousIndex = store.readBytes(indexPath).toString(Charsets.UTF_8).trimEnd()
        val previousLog = store.readBytes(logPath).toString(Charsets.UTF_8).trimEnd()
        val index = if (previousIndex.contains(artifactPath)) previousIndex else previousIndex + "\n\n- [${Timestamp.now()}] $artifactPath\n"
        val log = if (previousLog.contains(artifactPath)) previousLog else previousLog + "\n- ${Timestamp.now()}：完成一批资料消化，产物 $artifactPath。\n"
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

        ${sources.joinToString("\n") { (m, _) -> "- ${m.getString("fileName")} · ${m.getString("id")} · SHA256 ${m.getString("digestSourceSha256")} · 前6000字符 · student-digest-v2" }}
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
