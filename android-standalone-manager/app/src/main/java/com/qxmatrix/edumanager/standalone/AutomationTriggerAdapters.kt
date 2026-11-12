package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Deterministic adapters used by the automation trigger matrix. They never delete or overwrite originals. */
class AutomationTriggerAdapters(private val context: Context) {
    private val files = FileAssetService(context)
    private val projects = ProjectRepository(context)

    fun classify(studentId: String, sourceIds: List<String>): JSONObject {
        val selected = selectedMaterials(studentId, sourceIds)
        var attributionResolved = 0
        var sourceConflictsResolved = 0
        selected.forEach { material ->
            if (MaterialProcessingPolicy.attributionConflict(material)) {
                resolveAttribution(studentId, listOf(material.getString("id")))
                attributionResolved++
            }
            if (AutomationMaterialPolicy.sourceConflict(material)) {
                resolveSourceConflict(studentId, listOf(material.getString("id")))
                sourceConflictsResolved++
            }
        }
        return JSONObject().put("classified", selected.size)
            .put("attributionResolved", attributionResolved)
            .put("sourceConflictsResolved", sourceConflictsResolved)
            .put("studentId", studentId)
    }

    fun runOcrOrParser(studentId: String, sourceIds: List<String>): JSONObject {
        val selected = selectedMaterials(studentId, sourceIds)
        var ready = 0; var ocr = 0; var office = 0; var unsupported = 0; var skipped = 0
        selected.forEach { material ->
            require(!MaterialProcessingPolicy.attributionConflict(material)) { "资料归属仍不明确" }
            if (MaterialStatus.normalize(material.optString("status")) != MaterialStatus.PENDING_DIGEST) {
                skipped++; return@forEach
            }
            val id = material.getString("id")
            when {
                MaterialProcessingPolicy.digestReady(material) -> {
                    AutomationEventEmitter.digestReady(context, studentId, material); ready++
                }
                AutomationMaterialPolicy.supportsLocalOcr(material) -> {
                    val result = OcrVisionService(context).extract(studentId, id, includeVision = false)
                    if (result.optBoolean("ok")) ocr++ else throw AutomationExecutionException(
                        "ocr_quality_failed", AutomationFailureClass.INPUT_PROBLEM,
                        message = "OCR 未识别到可消化正文；原件和识别候选均已保留",
                    )
                }
                AutomationMaterialPolicy.supportsOfficeParser(material) -> {
                    OfficeDocumentParserService(context).parse(studentId, id); office++
                }
                else -> unsupported++
            }
        }
        if (unsupported > 0) throw AutomationExecutionException(
            "document_parser_unavailable", AutomationFailureClass.CAPABILITY_MISSING,
            message = "$unsupported 份资料需要用户授权音频转写或转换为受支持格式；原件已保留",
        )
        return JSONObject().put("ready", ready).put("ocrCompleted", ocr).put("officeParsed", office)
            .put("unsupported", unsupported).put("skipped", skipped)
    }

    fun resolveAttribution(studentId: String, sourceIds: List<String>): JSONObject {
        val selected = selectedMaterials(studentId, sourceIds)
        var resolved = 0
        selected.forEach { material ->
            require(material.optString("studentId") == studentId) { "资料不属于当前学生" }
            val projectId = material.optString("projectId")
            if (projectId.isNotBlank()) require(studentId in projects.requireExact(projectId).studentIds) { "项目不属于当前学生" }
            val patch = JSONObject().put("attributionConflict", false)
                .put("studentAttributionConflict", false).put("projectAttributionConflict", false)
                .put("attributionResolvedBy", "exact_local_scope").put("attributionResolvedAt", Timestamp.now())
            AutomationMaterialPolicy.attributionCodeFields.forEach { field ->
                if (AutomationMaterialPolicy.isAttributionCode(material.optString(field))) patch.put(field, "")
            }
            AutomationMaterialPolicy.messageFields.forEach { field ->
                if (AutomationMaterialPolicy.isAttributionMessage(material.optString(field))) patch.put(field, "")
            }
            files.patchMaterial(studentId, material.getString("id"), patch); resolved++
        }
        return JSONObject().put("resolved", resolved).put("strategy", "exact_local_scope")
    }

    fun resolveSourceConflict(studentId: String, sourceIds: List<String>): JSONObject {
        val selected = selectedMaterials(studentId, sourceIds)
        var resolved = 0
        selected.forEach { material ->
            val expected = material.optString("sourceSha256")
            require(expected.isNotBlank()) { "资料缺少原件 SHA-256，不能自动裁决来源冲突" }
            val actual = ScopedContentPolicy.hash(files.readMaterialBytes(studentId, material.getString("id")))
            require(actual == expected) { "当前原件与登记哈希不一致，需要人工核对；不会覆盖原件" }
            val patch = JSONObject().put("sourceConflict", false).put("hashConflict", false)
                .put("sourceConflictResolvedBy", "source_sha256_match").put("sourceConflictResolvedAt", Timestamp.now())
            AutomationMaterialPolicy.sourceCodeFields.forEach { field ->
                if (AutomationMaterialPolicy.isSourceCode(material.optString(field))) patch.put(field, "")
            }
            AutomationMaterialPolicy.messageFields.forEach { field ->
                if (AutomationMaterialPolicy.isSourceMessage(material.optString(field))) patch.put(field, "")
            }
            files.patchMaterial(studentId, material.getString("id"), patch); resolved++
        }
        return JSONObject().put("resolved", resolved).put("strategy", "source_sha256_match")
    }

    fun redactProjection(studentId: String, sourceIds: List<String>, sourceFingerprint: String): JSONObject {
        val student = StudentIndexRepository(context).requireExact(studentId)
        val selected = selectedMaterials(studentId, sourceIds)
        val projections = JSONArray()
        selected.forEach { material ->
            val text = AutomationMaterialPolicy.readExtractedText(files, studentId, material)
            projections.put(AutomationPrivacyPolicy.projection(material, text, student.name))
        }
        val payload = JSONObject().put("schema", "edu-manager.redacted-material-projection.v1")
            .put("module", "redacted_material_projection").put("sourceFingerprint", sourceFingerprint)
            .put("sourceIds", JSONArray(sourceIds)).put("items", projections)
            .put("originalsRetained", true).put("candidateOnly", true)
        val key = "redacted-projection:${ScopedContentPolicy.fingerprint(payload)}"
        val version = ScopedContentRepository(context).insertVersion(studentId, key, "资料脱敏投影", payload)
        return JSONObject().put("versionId", version.id).put("redacted", projections.length())
            .put("originalsRetained", true)
    }

    fun repairQuality(studentId: String, sourceIds: List<String>): JSONObject {
        val selected = selectedMaterials(studentId, sourceIds)
        var recoveredOcr = 0; var requeuedDigest = 0
        selected.forEach { material ->
            val id = material.getString("id")
            if (MaterialProcessingPolicy.attributionConflict(material)) {
                resolveAttribution(studentId, listOf(id))
            }
            if (AutomationMaterialPolicy.sourceConflict(material)) {
                resolveSourceConflict(studentId, listOf(id))
            }
            var ready = MaterialProcessingPolicy.digestReady(material)
            if (!ready && (material.optString("ocrPath").isNotBlank() || material.optString("ocrMarkdownPath").isNotBlank())) {
                val recovered = AutomationMaterialPolicy.readExtractedText(files, studentId, material)
                if (recovered.isNotBlank()) {
                    files.patchMaterial(studentId, id, JSONObject().put("ocrStatus", "completed")
                        .put("ocrError", "").put("digestReady", true).put("qualityRepair", "recovered_saved_ocr"))
                    ready = true; recoveredOcr++
                }
            }
            if (MaterialStatus.normalize(material.optString("status")) == MaterialStatus.FAILED &&
                material.optString("digestRecoveryState") !in setOf("needs_user", "unknown", "waiting_reconciliation")) {
                files.transitionMaterial(studentId, id, MaterialStatus.PENDING_DIGEST)
                files.patchMaterial(studentId, id, JSONObject().put("digestRecoveryState", "quality_repaired")
                    .put("digestError", "").put("qualityRepairAt", Timestamp.now()))
                requeuedDigest++
            }
            if (ready) AutomationEventEmitter.digestReady(context, studentId, files.materials(studentId).single { it.getString("id") == id })
            else throw AutomationExecutionException("quality_not_repairable", AutomationFailureClass.INPUT_PROBLEM,
                message = "资料没有可恢复的 OCR/解析正文，需要补充清晰原件或人工处理")
        }
        return JSONObject().put("recoveredOcr", recoveredOcr).put("requeuedDigest", requeuedDigest)
    }

    fun generateProjectSnapshot(projectId: String, triggerFingerprint: String): JSONObject {
        val project = projects.requireExact(projectId)
        require(project.studentIds.isNotEmpty()) { "项目未绑定学生，不能发布学生范围快照" }
        val materialService = LocalProjectMaterialService(context)
        if (materialService.persistedSnapshotFingerprint(projectId) != triggerFingerprint)
            return JSONObject().put("projectId", projectId).put("status", "superseded")
                .put("message", "项目资料已变化，等待最新快照事件")
        if (project.studentIds.size == 1 && materialService.autoClassify(projectId) > 0)
            return JSONObject().put("projectId", projectId).put("status", "superseded")
                .put("message", "已自动登记可核验的资料分类，等待新快照生成报告")
        val status = materialService.status(projectId)
        val metrics = JSONObject().put("materials", status.optInt("materials"))
            .put("pendingMaterials", status.optInt("pending"))
            .put("pendingDigest", status.optInt("digestPending"))
            .put("unavailable", status.optInt("unavailable"))
        val payload = JSONObject().put("schema", "edu-manager.project-progress-snapshot.v1")
            .put("module", "project_progress").put("projectId", project.id).put("projectName", project.name)
            .put("stage", project.status).put("objective", project.objective)
            .put("triggerFingerprint", triggerFingerprint).put("metrics", metrics)
            .put("pendingItems", ProjectDashboardService(context).closeChecklist(projectId))
            .put("evidenceBoundary", "仅汇总本机项目登记和任务状态，不代表成果质量或学习掌握")
        val key = "project-progress:${project.id}:${ScopedContentPolicy.fingerprint(payload)}"
        val versions = JSONArray()
        project.studentIds.forEach { studentId ->
            StudentIndexRepository(context).requireExact(studentId)
            val row = ScopedContentRepository(context).insertVersion(studentId, key, "${project.name}项目进展快照", payload, project.id)
            versions.put(JSONObject().put("studentId", studentId).put("versionId", row.id))
        }
        val report = ProjectOutcomeService(context).generateProgressReport(project.id, triggerFingerprint)
        val digest = ProjectDigestQueue(context).enqueueAutomatic(project.id)
        return JSONObject().put("projectId", project.id).put("versions", versions).put("metrics", metrics)
            .put("progressReport", report).put("automaticDigestJobId", digest?.optString("jobId").orEmpty())
    }

    private fun selectedMaterials(studentId: String, sourceIds: List<String>): List<JSONObject> {
        require(studentId.isNotBlank() && sourceIds.isNotEmpty()) { "自动适配器缺少学生或来源" }
        val indexed = files.materials(studentId).associateBy { it.getString("id") }
        return sourceIds.distinct().map { requireNotNull(indexed[it]) { "来源资料不存在：$it" } }
    }
}

object AutomationMaterialPolicy {
    internal val attributionCodeFields = setOf("errorCode", "digestErrorCode", "ocrErrorCode", "conflictType", "automationAttentionReason")
    internal val sourceCodeFields = setOf("errorCode", "digestErrorCode", "ocrErrorCode", "conflictType", "automationAttentionReason")
    internal val messageFields = setOf("digestError", "ocrError", "visionError", "error", "message")
    private val attributionCodes = setOf("attribution_conflict", "student_attribution_conflict", "project_attribution_conflict",
        "student_scope_mismatch", "project_scope_mismatch", "scope_conflict", "subject_scope_mismatch")
    private val sourceCodes = setOf("source_conflict", "source_hash_mismatch", "hash_conflict", "source_changed")
    private val attributionMessage = Regex("归属(?:冲突|不一致|不明确)|不属于当前学生|未绑定当前学生|不得跨学生|学生范围不一致|项目范围不一致")
    private val sourceMessage = Regex("来源(?:冲突|不一致|已变化)|原件(?:哈希|内容).*(?:不一致|变化)|哈希不一致")
    private val ocrExtensions = setOf("jpg", "jpeg", "png", "webp", "bmp", "pdf")
    private val officeExtensions = setOf("docx", "pptx", "xlsx")

    fun isAttributionCode(value: String) = value.trim().lowercase() in attributionCodes
    fun isSourceCode(value: String) = value.trim().lowercase() in sourceCodes
    fun isAttributionMessage(value: String) = attributionMessage.containsMatchIn(value)
    fun isSourceMessage(value: String) = sourceMessage.containsMatchIn(value)
    fun sourceConflict(material: JSONObject): Boolean = material.optBoolean("sourceConflict") || material.optBoolean("hashConflict") ||
        sourceCodeFields.any { isSourceCode(material.optString(it)) } || messageFields.any { isSourceMessage(material.optString(it)) }
    fun supportsLocalOcr(material: JSONObject) = material.optString("fileName").substringAfterLast('.', "").lowercase() in ocrExtensions
    fun supportsOfficeParser(material: JSONObject) = material.optString("fileName").substringAfterLast('.', "").lowercase() in officeExtensions
    fun isQualityFailure(error: Throwable): Boolean {
        val message = error.message.orEmpty()
        return listOf("校验", "Schema", "schema", "候选摘录", "真实原文摘录", "来源未在输入", "缺少决策字段", "题目重复")
            .any(message::contains)
    }

    fun readExtractedText(files: FileAssetService, studentId: String, material: JSONObject): String {
        val json = material.optString("ocrPath").takeIf(String::isNotBlank)?.let { path ->
            runCatching { files.readLogicalBytes(studentId, path).toString(Charsets.UTF_8) }.getOrDefault("")
        }.orEmpty()
        val markdown = material.optString("ocrMarkdownPath").takeIf(String::isNotBlank)?.let { path ->
            runCatching { files.readLogicalBytes(studentId, path).toString(Charsets.UTF_8) }.getOrDefault("")
        }.orEmpty()
        return MaterialProcessingPolicy.recoveredOcrInput(json, markdown).take(80_000)
    }

    fun projectFingerprint(registry: JSONObject): String {
        val rows = registry.optJSONArray("materials") ?: JSONArray()
        val stable = JSONArray((0 until rows.length()).mapNotNull(rows::optJSONObject).sortedBy { it.optString("materialId") }.map { item ->
            val classification = item.optJSONObject("classification")
            JSONObject().put("materialId", item.optString("materialId")).put("sha256", item.optString("sha256"))
                .put("version", item.optInt("version"))
                .put("availability", item.optString("availability", "available"))
                .put("organizationState", item.optString("organizationState"))
                .put("categoryId", classification?.optString("categoryId").orEmpty())
                .put("suggestedCategoryId", classification?.optString("suggestedCategoryId").orEmpty())
                .put("processingState", item.optJSONObject("processing")?.optString("state").orEmpty())
        })
        return ScopedContentPolicy.fingerprint(JSONObject().put("projectId", registry.optString("projectId")).put("materials", stable))
    }
}

object AutomationPrivacyPolicy {
    private val email = Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")
    private val phone = Regex("(?<!\\d)1[3-9]\\d{9}(?!\\d)")
    private val cnId = Regex("(?<![0-9A-Za-z])\\d{17}[0-9Xx](?![0-9A-Za-z])")
    private val sensitiveLabels = Regex("身份证|家庭住址|住址|病史|诊断|家长电话|护照号")
    private val sensitiveLine = Regex("(?m)(身份证|家庭住址|住址|病史|诊断|家长电话|护照号)\\s*[:：]?\\s*[^\\r\\n]{0,200}")

    fun containsSensitive(text: String, studentName: String = ""): Boolean =
        email.containsMatchIn(text) || phone.containsMatchIn(text) || cnId.containsMatchIn(text) ||
            sensitiveLabels.containsMatchIn(text) || (studentName.isNotBlank() && text.contains(studentName))

    fun redact(text: String, studentName: String = ""): String = text
        .let { if (studentName.isBlank()) it else it.replace(studentName, "学生") }
        .replace(sensitiveLine) { "${it.groupValues[1]}：[敏感内容已隐藏]" }
        .replace(email, "[邮箱已隐藏]").replace(phone, "[电话已隐藏]")
        .replace(cnId, "[证件号已隐藏]")

    fun projection(material: JSONObject, extractedText: String, studentName: String): JSONObject = JSONObject()
        .put("sourceId", material.optString("id"))
        .put("fileName", redact(material.optString("fileName"), studentName))
        .put("sourceName", redact(material.optString("sourceName"), studentName))
        .put("projectId", material.optString("projectId"))
        .put("courseId", material.optString("courseId"))
        .put("sourceSha256", material.optString("sourceSha256"))
        .put("redactedExcerpt", redact(extractedText, studentName).take(20_000))
        .put("redactionApplied", true)
}

object AutomationEventEmitter {
    fun imported(context: Context, studentId: String, material: JSONObject) {
        val fingerprint = material.optString("sourceSha256").ifBlank { material.optString("sha1") }
        if (fingerprint.isNotBlank()) AutomationOrchestrator(context).emit(
            AutomationEventType.MATERIAL_IMPORTED, studentId, fingerprint, listOf(material.getString("id")), material.optString("projectId"))
    }

    fun digestReady(context: Context, studentId: String, material: JSONObject) {
        val fingerprint = ScopedContentPolicy.fingerprint(JSONObject().put("source", material.optString("sourceSha256"))
            .put("ocrPath", material.optString("ocrPath")).put("ocrStatus", material.optString("ocrStatus")))
        AutomationOrchestrator(context).emit(AutomationEventType.OCR_COMPLETED, studentId, fingerprint,
            listOf(material.getString("id")), material.optString("projectId"))
    }

    fun ocrResult(context: Context, studentId: String, material: JSONObject, result: JSONObject) {
        digestReady(context, studentId, material)
        val text = MaterialProcessingPolicy.digestInput(result)
        val studentName = StudentIndexRepository(context).requireExact(studentId).name
        if (AutomationPrivacyPolicy.containsSensitive(text, studentName)) {
            val fingerprint = ScopedContentPolicy.fingerprint(JSONObject().put("source", material.optString("sourceSha256")).put("kind", "sensitive"))
            AutomationOrchestrator(context).emit(AutomationEventType.SENSITIVE_CONTENT, studentId, fingerprint,
                listOf(material.getString("id")), material.optString("projectId"))
        }
    }

    fun qualityFailure(context: Context, studentId: String, materials: List<JSONObject>, errorCode: String) {
        if (materials.isEmpty()) return
        val fingerprint = ScopedContentPolicy.fingerprint(JSONObject().put("sources", JSONArray(materials.map { it.optString("sourceSha256").ifBlank { it.optString("id") } }))
            .put("errorCode", errorCode))
        AutomationOrchestrator(context).emit(AutomationEventType.QUALITY_FAILED, studentId, fingerprint,
            materials.map { it.getString("id") })
    }
}
