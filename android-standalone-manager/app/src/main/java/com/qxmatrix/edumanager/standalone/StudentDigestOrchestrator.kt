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
    private val digestSources = MaterialDigestSourceResolver(context, files)

    fun digestPending(studentId: String): JSONObject = digestBatches(studentId, null, explicitUserAction = false)

    fun digestSelected(studentId: String, materialIds: Set<String>, explicitUserAction: Boolean = true,
        automationTaskId: String = "", automationExecutionId: String = ""): JSONObject {
        require(materialIds.isNotEmpty()) { "没有选择要消化的资料" }
        val result = digestBatches(studentId, materialIds, explicitUserAction, automationTaskId, automationExecutionId)
        if (!explicitUserAction && result.optInt("processed") != materialIds.size)
            throw AutomationExecutionException("digest_partial_result", AutomationFailureClass.EXECUTION_UNKNOWN,
                resultUnknown = true, message = "仅部分选定资料完成消化，已保留结果并等待核对")
        return result
    }

    private fun digestBatches(studentId: String, selectedMaterialIds: Set<String>?, explicitUserAction: Boolean,
        automationTaskId: String = "", automationExecutionId: String = ""): JSONObject =
        synchronized(StudentWorkLocks.forStudent(studentId)) {
            students.requireExact(studentId)
            val materials = files.materials(studentId).filter {
                MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PENDING_DIGEST &&
                    MaterialProcessingPolicy.digestReady(it) &&
                    (selectedMaterialIds == null || it.optString("id") in selectedMaterialIds)
            }.take(20)
            require(materials.isNotEmpty()) { "当前没有已准备好的待消化资料" }
            val candidates = materials.map { material ->
                val estimated = runCatching {
                    digestSources.resolve(studentId, material).take(MaterialDigestBatchPlanner.MAX_CHARACTERS_PER_SOURCE).length
                }.getOrDefault(MaterialDigestBatchPlanner.MAX_CHARACTERS_PER_SOURCE)
                MaterialDigestCandidate(
                    material.getString("id"),
                    estimated.coerceAtLeast(1),
                    material.optString("digestRecoveryMarker"),
                )
            }
            val batches = MaterialDigestBatchPlanner.plan(candidates)
            var processed = 0
            val failures = JSONArray()
            val results = JSONArray()
            var firstFailure: Throwable? = null
            batches.forEachIndexed { index, ids ->
                runCatching { digestOne(studentId, ids.toSet(), explicitUserAction, automationTaskId, automationExecutionId) }
                    .onSuccess { result ->
                        processed += result.optInt("processed")
                        results.put(JSONObject().put("batch", index + 1).put("materialIds", JSONArray(ids))
                            .put("ok", true).put("taskId", result.optJSONObject("task")?.optString("id").orEmpty()))
                    }
                    .onFailure { error ->
                        if (firstFailure == null || (error is AutomationExecutionException && error.resultUnknown)) firstFailure = error
                        failures.put(JSONObject().put("batch", index + 1).put("materialIds", JSONArray(ids))
                            .put("message", (error.message ?: "消化失败").take(600)))
                    }
            }
            if (!explicitUserAction && firstFailure != null) throw firstFailure!!
            JSONObject().put("ok", failures.length() == 0).put("processed", processed)
                .put("batchCount", batches.size).put("failedBatches", failures.length())
                .put("batches", results).put("failures", failures)
        }

    private fun digestOne(studentId: String, selectedMaterialIds: Set<String>, explicitUserAction: Boolean,
        automationTaskId: String, automationExecutionId: String): JSONObject {
        val student = students.requireExact(studentId)
        val materials = files.materials(studentId).filter {
            MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PENDING_DIGEST &&
                it.optString("id") in selectedMaterialIds
        }
        require(materials.isNotEmpty()) { "当前没有待消化资料" }
        val eligible = materials.filter(MaterialProcessingPolicy::digestReady).take(20)
        require(eligible.isNotEmpty()) { "当前待消化资料需要先完成 OCR/文档解析；未识别到内容的资料请返回 OCR 补充处理" }
        require(explicitUserAction || eligible.none { it.optString("digestRecoveryState") == "authorized_retry" }) {
            "已授权的未知消化结果只能由用户在资料页明确选择后重试"
        }
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
        val stageKey = "digest-stage:$studentId:$executionId"
        val initialStage = JSONObject().put("schema", "digest-stage-v1").put("studentId", studentId)
            .put("executionId", executionId).put("childTaskId", task.getString("id"))
            .put("automationTaskId", automationTaskId).put("automationExecutionId", automationExecutionId)
            .put("notDispatchedProofVersion", 1).put("allowAutoNoDispatch", true)
            .put("state", "initial").put("createdAt", Timestamp.now())
            .put("sources", JSONArray(eligible.map { material -> JSONObject().put("id", material.getString("id"))
                .put("sha256", material.optString("sourceSha256")).put("sha1", material.optString("sha1"))
                .put("previousBatchId", material.optString("digestBatchId")) }))
        BusinessDatabase.get(context).tasks().metadata(BusinessMetadataEntity(stageKey, initialStage.toString()))
        eligible.forEach {
            files.patchMaterial(studentId, it.getString("id"), JSONObject().put("digestBatchId", executionId).put("digestRecoveryState", "running"))
            files.transitionMaterial(studentId, it.getString("id"), MaterialStatus.SUBMITTED)
            files.transitionMaterial(studentId, it.getString("id"), MaterialStatus.DIGESTING)
        }
        var unknownMarkerKey: String? = null
        var completionReceiptReady = false
        var checkpointAvailable = false
        return try {
            val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
            val rules = store.readBytes(student.paths.agentPath).toString(Charsets.UTF_8)
            val sourceContents = eligible.map { material ->
                val original = files.readMaterialBytes(studentId, material.getString("id"))
                material.put("digestSourceSha256", ScopedContentPolicy.hash(original))
                val content = digestSources.resolve(studentId, material)
                require(content.isNotBlank()) { "${material.optString("fileName")} 没有可消化内容，请返回 OCR 补充处理" }
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
            val stage = JSONObject().put("schema", "digest-stage-v1").put("studentId", studentId)
                .put("executionId", executionId).put("childTaskId", task.getString("id"))
                .put("notDispatchedProofVersion", 1).put("allowAutoNoDispatch", true)
                .put("automationTaskId", automationTaskId).put("automationExecutionId", automationExecutionId)
                .put("fingerprint", cacheKey).put("state", "prepared").put("createdAt", Timestamp.now())
                .put("sources", JSONArray(sourceContents.map { (material, _) -> JSONObject()
                    .put("id", material.getString("id")).put("sha256", material.getString("digestSourceSha256"))
                    .put("textSha256", material.getString("digestTextSha256")) }))
            db.tasks().metadata(BusinessMetadataEntity(stageKey, stage.toString()))
            val cached = content.checkpoint(studentId, "digest_result", cacheKey)
            checkpointAvailable = cached != null
            val markerKey = "digest-request:$studentId:$cacheKey"
            unknownMarkerKey = markerKey
            val parsed = if (cached != null) cached.getJSONObject("result") else {
                val previous = db.tasks().metadata(markerKey)?.let(::JSONObject)
                if (previous?.optString("state") == "received") {
                    db.tasks().metadata(BusinessMetadataEntity(markerKey, JSONObject(previous.toString())
                        .put("state", "unknown").put("recoveryReason", "response_not_checkpointed").toString()))
                }
                if (previous?.optString("state") == "unknown" && explicitUserAction && eligible.all(::hasLegacyLocalValidationFailure)) {
                    db.tasks().metadata(BusinessMetadataEntity(markerKey, JSONObject(previous.toString())
                        .put("state", "validation_failed").put("recoveredAt", Timestamp.now())
                        .put("recoveryReason", "legacy-local-evidence-validation").toString()))
                }
                val retryState = db.tasks().metadata(markerKey)?.let(::JSONObject)
                require(retryState?.optString("state") == "not_dispatched" || UnknownOutcomePolicy.retryAllowed(retryState, explicitUserAction)) { "上次相同资料消化结果未知，请到任务中心核对并单次授权；授权后资料会回到待消化列表，仍需由你明确选择消化" }
                consumeRecoveryAuthorizations(studentId, eligible)
                db.tasks().metadata(BusinessMetadataEntity(markerKey, JSONObject().put("state", "unknown").put("taskId", task.getString("id"))
                    .put("materialIds", JSONArray(eligible.map { it.getString("id") })).toString()))
                OpenAiCompatibleAgentAdapter(adapterConfig, context, student.id, task.getString("id")).executeWithCheckpoint(
                    "你是 AI 教育管家的资料消化 Agent。严格遵守 AGENT.md；只形成可审计知识候选，不发布正式教育结论。只输出 JSON。", prompt) { response ->
                    val sourceMap = sourceContents.associate { it.first.getString("id") to it.second }
                    val result = DigestEvidencePolicy.sanitized(parseJsonResponse(response), sourceMap)
                    DigestEvidencePolicy.validate(result, sourceMap)
                    content.saveCheckpoint(studentId, "digest_result", cacheKey, JSONObject().put("result", result)
                        .put("markdown", digestMarkdown(student, result, sourceContents)).put("sourceFingerprint", cacheKey))
                    checkpointAvailable = true
                    FaultInjection.hit(context, "digest_checkpoint")
                    db.tasks().metadata(BusinessMetadataEntity(markerKey, JSONObject().put("state", "succeeded").toString()))
                }
                requireNotNull(content.checkpoint(studentId, "digest_result", cacheKey)) { "模型结果检查点缺失" }.getJSONObject("result")
            }
            DigestEvidencePolicy.validate(parsed, sourceContents.associate { it.first.getString("id") to it.second })
            sourceContents.forEach { (material, _) ->
                require(ScopedContentPolicy.hash(files.readMaterialBytes(studentId, material.getString("id"))) == material.getString("digestSourceSha256")) { "来源已变化，拒绝写入迟到结果" }
                val text = digestSources.resolve(studentId, material)
                require(ScopedContentPolicy.hash(text.toByteArray()) == material.getString("digestTextSha256")) { "解析来源已变化，原版本保留" }
            }
            val artifactPath = "${student.paths.summaryPath}/摘要库/消化-${cacheKey.take(24)}.md"
            val markdown = requireNotNull(content.checkpoint(studentId, "digest_result", cacheKey)).getString("markdown")
            if (store.exists(artifactPath)) require(store.readBytes(artifactPath).contentEquals(markdown.toByteArray())) { "已有消化产物与检查点不一致，保留原件" }
            else store.writeBytesSafely(artifactPath, markdown.toByteArray(), "text/markdown")
            updateWikiIndexes(store, student, artifactPath)
            registerKnowledge(student, sourceContents, parsed, cacheKey)
            registerGrowthEvidence(student, sourceContents, parsed)
            val completedSourceIds = JSONArray(eligible.map { it.getString("id") })
            val completion = JSONObject().put("schema", "digest-completion-v1").put("studentId", studentId)
                .put("fingerprint", cacheKey).put("executionId", executionId).put("artifactPath", artifactPath)
                .put("childTaskId", task.getString("id"))
                .put("automationTaskId", automationTaskId).put("automationExecutionId", automationExecutionId)
                .put("artifactSha256", ScopedContentPolicy.hash(markdown.toByteArray()))
                .put("summary", parsed.optString("summary")).put("sourceIds", completedSourceIds)
                .put("sources", JSONArray(sourceContents.map { (material, _) -> JSONObject()
                    .put("id", material.getString("id")).put("sha256", material.getString("digestSourceSha256"))
                    .put("textSha256", material.getString("digestTextSha256")) }))
                .put("state", "ready").put("createdAt", Timestamp.now())
            db.tasks().metadata(BusinessMetadataEntity("digest-completion:$studentId:$cacheKey", completion.toString()))
            completionReceiptReady = true
            eligible.forEach {
                files.patchMaterial(studentId, it.getString("id"), JSONObject()
                    .put("digestedAt", Timestamp.now()).put("digestBatchId", executionId)
                    .put("automationDigestFingerprint", cacheKey).put("automationDigestSourceIds", completedSourceIds)
                    .put("digestArtifactPath", artifactPath).put("digestResult", parsed.optString("summary"))
                    .put("digestAttemptedAt", Timestamp.now()).put("digestError", "").put("digestRecoveryState", "completed")
                    .put("digestRecoveryMarker", "").put("digestRecoveryAuthorizationId", ""))
                files.transitionMaterial(studentId, it.getString("id"), MaterialStatus.PROCESSED)
            }
            db.tasks().metadata(BusinessMetadataEntity("digest-completion:$studentId:$cacheKey",
                completion.put("state", "completed").put("completedAt", Timestamp.now()).toString()))
            db.tasks().metadata(BusinessMetadataEntity(stageKey, stage.put("state", "completed").put("completedAt", Timestamp.now()).toString()))
            val result = resultPayload(task.getString("id"), executionId, true, "已消化 ${eligible.size} 份资料", artifactPath)
            tasks.acceptResult(task.getString("id"), result)
            runCatching { StudioAutomation.enqueueCheck(context, studentId) }
            runCatching {
                AutomationOrchestrator(context).emit(AutomationEventType.DIGEST_COMPLETED, studentId, cacheKey,
                    eligible.map { it.getString("id") })
            }
            JSONObject().put("ok", true).put("task", tasks.requireExact(task.getString("id"))).put("artifactPath", artifactPath).put("processed", eligible.size)
        } catch (error: Throwable) {
            unknownMarkerKey?.let { marker ->
                val metadata = BusinessDatabase.get(context).tasks().metadata(marker)?.let(::JSONObject)
                if (metadata?.optString("state") == "received") {
                    BusinessDatabase.get(context).tasks().metadata(BusinessMetadataEntity(marker, JSONObject(metadata.toString())
                        .put("state", "validation_failed").put("failedAt", Timestamp.now())
                        .put("message", (error.message ?: "本地结果校验失败").take(600)).toString()))
                }
            }
            val unknownOutcome = unknownMarkerKey?.let { marker ->
                BusinessDatabase.get(context).tasks().metadata(marker)?.let(::JSONObject)?.optString("state") == "unknown"
            } == true
            val retryableTransport = !explicitUserAction && !unknownOutcome &&
                AutomationFailurePolicy.decide(error, 1, 4).classification in
                setOf(AutomationFailureClass.TRANSIENT, AutomationFailureClass.CAPABILITY_MISSING)
            if (!completionReceiptReady && !checkpointAvailable) eligible.forEach { material -> runCatching {
                files.patchMaterial(studentId, material.getString("id"), JSONObject()
                    .put("digestAttemptedAt", Timestamp.now()).put("digestBatchId", executionId)
                    .put("digestError", (error.message ?: "资料消化失败").take(600))
                    .put("digestRecoveryState", if (unknownOutcome) "needs_user" else "failed")
                    .put("digestRecoveryMarker", if (unknownOutcome) unknownMarkerKey.orEmpty() else "")
                    .put("digestRecoveryAuthorizationId", ""))
                files.transitionMaterial(studentId, material.getString("id"), MaterialStatus.FAILED)
                if (retryableTransport) {
                    files.transitionMaterial(studentId, material.getString("id"), MaterialStatus.PENDING_DIGEST)
                    files.patchMaterial(studentId, material.getString("id"), JSONObject().put("digestRecoveryState", "retry_pending"))
                }
            } }
            if (!completionReceiptReady && !checkpointAvailable && !unknownOutcome && AutomationMaterialPolicy.isQualityFailure(error)) runCatching {
                AutomationEventEmitter.qualityFailure(context, studentId, eligible, "digest_validation_failed")
            }
            val result = resultPayload(task.getString("id"), executionId, false, error.message ?: "资料消化失败", "")
            runCatching { tasks.acceptResult(task.getString("id"), result) }
            if (unknownOutcome || completionReceiptReady || checkpointAvailable) throw AutomationExecutionException("digest_result_unknown", AutomationFailureClass.EXECUTION_UNKNOWN,
                resultUnknown = true, message = "资料消化请求结果未知，已保留原件并等待核对")
            throw error
        }
    }

    private fun consumeRecoveryAuthorizations(studentId: String, materials: List<JSONObject>) {
        val authorized = materials.filter { it.optString("digestRecoveryState") == "authorized_retry" }
        if (authorized.isEmpty()) return
        val recovery = UnknownOutcomeRecovery(context)
        authorized.groupBy { it.optString("digestRecoveryMarker") }.forEach { (marker, group) ->
            require(marker.isNotBlank()) { "资料缺少对应的单次恢复授权，请重新到任务中心核对" }
            val authorizationIds = group.map { it.optString("digestRecoveryAuthorizationId") }.toSet()
            require(authorizationIds.size == 1 && authorizationIds.first().isNotBlank()) { "资料恢复授权不一致，请重新核对" }
            recovery.consumeAuthorization(
                studentId,
                marker,
                authorizationIds.first(),
                group.map { it.getString("id") }.toSet(),
            )
        }
    }

    /** Resume only from the stored, validated model response; this method never sends a model request. */
    internal fun resumeCheckpointStage(studentId: String, stageKey: String, stage: JSONObject): Boolean =
        synchronized(StudentWorkLocks.forStudent(studentId)) {
            require(stage.optString("schema") == "digest-stage-v1" && stage.optString("studentId") == studentId)
            val executionId = stage.getString("executionId")
            require(executionId.isNotBlank() && stageKey == "digest-stage:$studentId:$executionId")
            val child = tasks.requireExact(stage.getString("childTaskId"))
            require(child.optString("executionId") == executionId && child.optJSONObject("input")?.optString("studentId") == studentId)
            require(child.optString("status") !in setOf("cancelled", "archived")) { "原消化任务已取消或归档" }
            stage.optString("automationTaskId").takeIf(String::isNotBlank)?.let { parentId ->
                val parent = tasks.requireExact(parentId)
                require(parent.optString("executionId") == stage.optString("automationExecutionId") &&
                    parent.optString("status") !in setOf("cancelled", "archived")) { "原自动任务已变化或取消" }
            }
            if (stage.optString("state") == "initial") return@synchronized requeueProvenNotDispatched(studentId, stageKey, stage)
            val fingerprint = stage.getString("fingerprint")
            val db = BusinessDatabase.get(context)
            val checkpoint = ScopedContentRepository(context).checkpoint(studentId, "digest_result", fingerprint)
            if (checkpoint == null) {
                if (requeueProvenNotDispatched(studentId, stageKey, stage)) return@synchronized true
                val requestKey = "digest-request:$studentId:$fingerprint"
                db.tasks().metadata(requestKey)?.let { raw ->
                    val request = JSONObject(raw)
                    if (request.optString("state") == "received" && request.optString("taskId") == stage.getString("childTaskId"))
                        db.tasks().metadata(BusinessMetadataEntity(requestKey, request.put("state", "unknown")
                            .put("recoveryReason", "response_not_checkpointed").put("recoveredAt", Timestamp.now()).toString()))
                }
                return@synchronized false
            }
            require(checkpoint.optString("sourceFingerprint") == fingerprint)
            val originalRequestKey = "digest-request:$studentId:$fingerprint"
            db.tasks().metadata(originalRequestKey)?.let { raw ->
                val request = JSONObject(raw)
                require(request.optString("state") in setOf("unknown", "received", "validation_failed", "succeeded")) { "原请求恢复状态已变化" }
                require(request.optString("taskId").isBlank() || request.optString("taskId") == stage.optString("childTaskId")) { "原请求已属于其他执行" }
            }
            val priorCompletion = db.tasks().metadata("digest-completion:$studentId:$fingerprint")?.let(::JSONObject)
            if (priorCompletion != null) {
                require(priorCompletion.optString("executionId") == executionId && priorCompletion.optString("studentId") == studentId)
                require(priorCompletion.optString("state") in setOf("ready", "completed"))
                if (priorCompletion.optString("state") == "completed") {
                    db.tasks().metadata(originalRequestKey)?.let { raw ->
                        val request = JSONObject(raw)
                        db.tasks().metadata(BusinessMetadataEntity(originalRequestKey, request.put("state", "succeeded")
                            .put("recoveredAt", Timestamp.now()).toString()))
                    }
                }
                db.tasks().metadata(BusinessMetadataEntity(stageKey, JSONObject(stage.toString())
                    .put("state", "handed_off").put("recoveredAt", Timestamp.now()).toString()))
                return@synchronized true
            }
            val sourceRows = stage.getJSONArray("sources")
            require(sourceRows.length() in 1..20)
            val current = files.materials(studentId).associateBy { it.getString("id") }
            val sources = (0 until sourceRows.length()).map { index ->
                val evidence = sourceRows.getJSONObject(index); val id = evidence.getString("id")
                val material = requireNotNull(current[id])
                val rawHash = ScopedContentPolicy.hash(files.readMaterialBytes(studentId, id))
                val fullText = digestSources.resolve(studentId, material)
                val textHash = ScopedContentPolicy.hash(fullText.toByteArray())
                require(DigestCompletionReceiptPolicy.sourceMatches(studentId, executionId, id, material, evidence, rawHash, textHash))
                material.put("digestSourceSha256", rawHash).put("digestTextSha256", textHash)
                material to fullText.take(6_000)
            }
            require(sources.map { it.first.getString("id") }.distinct().size == sources.size)
            val parsed = checkpoint.getJSONObject("result")
            DigestEvidencePolicy.validate(parsed, sources.associate { it.first.getString("id") to it.second })
            val student = students.requireExact(studentId)
            val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
            val artifactPath = "${student.paths.summaryPath}/摘要库/消化-${fingerprint.take(24)}.md"
            val markdown = checkpoint.getString("markdown")
            if (store.exists(artifactPath)) require(store.readBytes(artifactPath).contentEquals(markdown.toByteArray())) { "已有消化产物与检查点不一致" }
            else store.writeBytesSafely(artifactPath, markdown.toByteArray(), "text/markdown")
            updateWikiIndexes(store, student, artifactPath)
            registerKnowledge(student, sources, parsed, fingerprint)
            registerGrowthEvidence(student, sources, parsed)
            val ids = JSONArray(sources.map { it.first.getString("id") })
            val completion = JSONObject().put("schema", "digest-completion-v1").put("studentId", studentId)
                .put("fingerprint", fingerprint).put("executionId", executionId).put("artifactPath", artifactPath)
                .put("childTaskId", stage.getString("childTaskId"))
                .put("automationTaskId", stage.optString("automationTaskId")).put("automationExecutionId", stage.optString("automationExecutionId"))
                .put("artifactSha256", ScopedContentPolicy.hash(markdown.toByteArray())).put("summary", parsed.optString("summary"))
                .put("sourceIds", ids).put("sources", sourceRows).put("state", "ready").put("createdAt", stage.getString("createdAt"))
            db.tasks().metadata(BusinessMetadataEntity("digest-completion:$studentId:$fingerprint", completion.toString()))
            val requestKey = "digest-request:$studentId:$fingerprint"
            db.tasks().metadata(requestKey)?.let { raw ->
                val request = JSONObject(raw)
                require(request.optString("state") in setOf("unknown", "received", "validation_failed", "succeeded")) { "原请求恢复状态已变化" }
                require(request.optString("taskId").isBlank() || request.optString("taskId") == stage.optString("childTaskId")) { "原请求已属于其他执行" }
                db.tasks().metadata(BusinessMetadataEntity(requestKey, request.put("state", "succeeded")
                    .put("recoveredAt", Timestamp.now()).toString()))
            }
            db.tasks().metadata(BusinessMetadataEntity(stageKey, JSONObject(stage.toString()).put("state", "handed_off")
                .put("recoveredAt", Timestamp.now()).toString()))
            true
        }

    /** A model call is written to the ledger before transport; absence is checked under the student lock. */
    private fun requeueProvenNotDispatched(studentId: String, stageKey: String, stage: JSONObject): Boolean {
        if (stage.optInt("notDispatchedProofVersion") != 1 || !stage.optBoolean("allowAutoNoDispatch")) return false
        val parentId = stage.optString("automationTaskId")
        val parentExecution = stage.optString("automationExecutionId")
        if (parentId.isBlank() || parentExecution.isBlank()) return false
        val parent = tasks.requireExact(parentId)
        if (parent.optString("executionId") != parentExecution || parent.optString("status") !in setOf("waiting_result", "queued") ||
            parent.optJSONObject("error")?.optBoolean("attentionRequired") == true || parent.optInt("attempt") >= parent.optInt("maxAttempts")) return false
        val input = parent.getJSONObject("input")
        val parentArray = input.optJSONArray("sourceIds") ?: return false
        val parentIds = (0 until parentArray.length()).map { parentArray.optString(it) }
        val rows = stage.getJSONArray("sources")
        val ids = (0 until rows.length()).map { rows.getJSONObject(it).getString("id") }
        if (input.optString("studentId") != studentId || input.optString("actionType") != "digest_material" ||
            ids.isEmpty() || ids.size != ids.distinct().size || parentIds.size != ids.size || parentIds.toSet() != ids.toSet()) return false
        val childId = stage.getString("childTaskId")
        if (tasks.requireExact(childId).optString("status") !in setOf("failed", "waiting_result", "timed_out")) return false
        val db = BusinessDatabase.get(context)
        if (db.ledger().hasAnyCall(studentId, childId)) return false
        val initial = stage.optString("state") == "initial"
        val fingerprint = stage.optString("fingerprint")
        if (!initial && fingerprint.isBlank()) return false
        val requestKey = if (initial) "" else "digest-request:$studentId:$fingerprint"
        val previous = if (initial) null else db.tasks().metadata(requestKey)?.let(::JSONObject)
        if (previous != null && (previous.optString("taskId") != childId ||
                previous.optString("state") !in setOf("unknown", "not_dispatched"))) return false
        val indexed = files.materials(studentId).associateBy { it.getString("id") }
        ids.forEachIndexed { index, id ->
            val row = requireNotNull(indexed[id]); val expected = rows.getJSONObject(index)
            require(row.optString("studentId") == studentId)
            val status = MaterialStatus.normalize(row.optString("status"))
            require(row.optString("digestBatchId") == stage.getString("executionId") ||
                (initial && status == MaterialStatus.PENDING_DIGEST && row.optString("digestBatchId") == expected.optString("previousBatchId")))
            require(status in setOf(MaterialStatus.SUBMITTED, MaterialStatus.DIGESTING, MaterialStatus.PENDING_DIGEST) ||
                (status == MaterialStatus.FAILED && row.optString("digestRecoveryState") == "recovering_not_sent"))
            val bytes = files.readMaterialBytes(studentId, id)
            if (expected.optString("sha256").isNotBlank()) require(ScopedContentPolicy.hash(bytes) == expected.getString("sha256"))
            else {
                require(initial && expected.optString("sha1").isNotBlank()) { "缺少可验证的原件指纹" }
                val hash = java.security.MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }
                require(hash.equals(expected.getString("sha1"), ignoreCase = true))
            }
            if (!initial) require(ScopedContentPolicy.hash(digestSources.resolve(studentId, row).toByteArray()) == expected.getString("textSha256"))
        }
        db.runInTransaction {
            check(!db.ledger().hasAnyCall(studentId, childId)) { "模型请求记录已出现，停止自动重试" }
            val current = if (initial) null else db.tasks().metadata(requestKey)?.let(::JSONObject)
            require(current == null || (current.optString("taskId") == childId && current.optString("state") in setOf("unknown", "not_dispatched")))
            if (!initial) db.tasks().metadata(BusinessMetadataEntity(requestKey, JSONObject().put("state", "not_dispatched")
                .put("taskId", childId).put("executionId", stage.getString("executionId"))
                .put("materialIds", JSONArray(ids)).put("verifiedAt", Timestamp.now()).toString()))
        }
        ids.forEach { id ->
            val row = files.materials(studentId).single { it.getString("id") == id }
            files.patchMaterial(studentId, id, JSONObject().put("digestRecoveryState", "recovering_not_sent")
                .put("digestBatchId", stage.getString("executionId")))
            when (MaterialStatus.normalize(row.optString("status"))) {
                MaterialStatus.SUBMITTED, MaterialStatus.DIGESTING -> {
                    files.transitionMaterial(studentId, id, MaterialStatus.FAILED)
                    files.transitionMaterial(studentId, id, MaterialStatus.PENDING_DIGEST)
                }
                MaterialStatus.FAILED -> files.transitionMaterial(studentId, id, MaterialStatus.PENDING_DIGEST)
                else -> Unit
            }
        }
        val queued = tasks.requeueKnownNotDispatched(parentId, parentExecution)
        AutomationOrchestrator.ensureScheduled(context, queued)
        db.tasks().metadata(BusinessMetadataEntity(stageKey, JSONObject(stage.toString()).put("state", "not_dispatched_requeued")
            .put("recoveredAt", Timestamp.now()).toString()))
        return true
    }

    private fun hasLegacyLocalValidationFailure(material: JSONObject): Boolean {
        val message = material.optString("digestError")
        return message.contains("候选摘录不在固定输入片段中") ||
            message.contains("成长观察缺少真实原文摘录") ||
            message.contains("知识声明没有真实原文摘录")
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
            require(DigestEvidencePolicy.matchesExcerpt(sources.single { it.first.getString("id") == material.getString("id") }.second, excerpt)) { "成长观察缺少真实原文摘录，不登记" }
            val content = if (excerpt.isBlank() || observation.contains(excerpt)) observation else "$observation\n\n原文摘录：$excerpt"
            growth.addAutomaticCandidate(
                studentId = student.id,
                title = title,
                ability = candidate.optString("ability", "待标注"),
                sourceUri = "edu://student/${student.id}/raw/${material.getString("id")}",
                content = content,
                confidence = candidate.optString("confidence", "unknown"),
                projectId = material.optString("projectId").takeIf { projectId ->
                    projectId.isNotBlank() && !MaterialProcessingPolicy.attributionConflict(material) &&
                        ProjectRepository(context).list().any { it.id == projectId && student.id in it.studentIds }
                }.orEmpty(),
                generatedBy = "local-agent-student-digest",
            )
        }
    }

    private fun registerKnowledge(student: StudentRecord, sources: List<Pair<JSONObject, String>>, parsed: JSONObject, cacheKey: String) {
        val engine = StudentWorkspaceService(context).knowledgeEngine(student.id)
        val uriByMaterial = mutableMapOf<String, String>()
        sources.forEach { (material, content) ->
            val sourceUri = "edu://student/${student.id}/raw/${material.getString("id")}"; uriByMaterial[material.getString("id")] = sourceUri
            val sourceId = material.optString("sha1").ifBlank { material.getString("digestSourceSha256") }
            val stableSourceId = engine.sourceIdForRecord("source-$sourceId", sourceUri)
            engine.importAsset(JSONObject().put("id", stableSourceId).put("uri", sourceUri).put("title", material.getString("fileName")).put("mediaType", "text/plain").put("content", content))
        }
        val claims = parsed.optJSONArray("claims") ?: JSONArray()
        for (index in 0 until claims.length()) {
            val candidate = claims.optJSONObject(index) ?: continue; val materialId = candidate.optString("sourceMaterialId"); val sourceUri = uriByMaterial[materialId] ?: continue
            val predicate = candidate.optString("predicate").trim(); if (predicate.isBlank() || candidate.optString("value").isBlank()) continue
            require(DigestEvidencePolicy.matchesExcerpt(sources.single { it.first.getString("id") == materialId }.second, candidate.optString("excerpt"))) { "知识声明没有真实原文摘录，不登记" }
            val source = sources.single { it.first.getString("id") == materialId }.first
            val identity = ScopedContentPolicy.hash("$cacheKey:$materialId:$predicate:${candidate.optString("value")}".toByteArray()).take(24)
            val existing = engine.getClaim("claim-$identity")
            if (existing != null) {
                require(existing.optString("subjectId") == engine.subjectId && existing.optString("predicate") == predicate &&
                    existing.optString("value") == candidate.optString("value")) { "既有知识声明与消化结果不一致，保留原版本" }
                val existingEvidence = existing.optJSONArray("evidence") ?: JSONArray()
                require((0 until existingEvidence.length()).any { index ->
                    existingEvidence.optJSONObject(index)?.let { evidence ->
                        evidence.optString("sourceUri") == sourceUri &&
                            evidence.optString("sourceSha256") == source.getString("digestSourceSha256") &&
                            evidence.optString("excerpt") == candidate.optString("excerpt")
                    } == true
                }) { "既有知识声明缺少对应来源证据，保留原版本" }
                engine.ensureClaimProjection("claim-$identity")
                continue
            }
            val evidence = JSONArray().put(JSONObject().put("id", "evidence-$identity").put("sourceUri", sourceUri).put("excerpt", candidate.optString("excerpt")).put("observedAt", Timestamp.now())
                .put("sourceSha256", source.getString("digestSourceSha256")).put("fragment", "前6000字符").put("processingVersion", "student-digest-v2"))
            engine.upsertClaim(JSONObject().put("id", "claim-$identity").put("subjectId", engine.subjectId).put("predicate", predicate).put("value", candidate.optString("value"))
                .put("status", "candidate").put("confidence", candidate.optString("confidence", "unknown")).put("evidence", evidence).put("generatedBy", "local-agent"))
            FaultInjection.hit(context, "knowledge_registered")
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
