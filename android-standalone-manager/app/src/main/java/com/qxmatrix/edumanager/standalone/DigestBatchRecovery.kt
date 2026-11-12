package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject

object DigestCompletionReceiptPolicy {
    fun matches(task: JSONObject, receipt: JSONObject): Boolean {
        val input = task.optJSONObject("input") ?: return false
        return receipt.optString("schema") == "digest-completion-v1" && receipt.optString("state") == "completed" &&
            receipt.optString("studentId").isNotBlank() && receipt.optString("studentId") == input.optString("studentId") &&
            receipt.optString("automationTaskId").isNotBlank() && receipt.optString("automationTaskId") == task.optString("id") &&
            receipt.optString("automationExecutionId").isNotBlank() && receipt.optString("automationExecutionId") == task.optString("executionId")
    }
    fun sourceMatches(studentId: String, executionId: String, id: String, row: JSONObject,
        evidence: JSONObject, actualHash: String, actualTextHash: String): Boolean =
        evidence.optString("id") == id && row.optString("studentId") == studentId && studentId.isNotBlank() &&
            executionId.isNotBlank() && row.optString("digestBatchId") == executionId &&
            MaterialStatus.normalize(row.optString("status")) in setOf(MaterialStatus.SUBMITTED, MaterialStatus.DIGESTING, MaterialStatus.PROCESSED) &&
            actualHash.isNotBlank() && actualHash == evidence.optString("sha256") &&
            actualTextHash.isNotBlank() && actualTextHash == evidence.optString("textSha256")
}

/** A later terminal parent attempt is acceptable only with evidence of the original run. */
object MissingModelParentPolicy {
    fun matches(parent: JSONObject, studentId: String, originalExecution: String, events: List<JSONObject>): Boolean {
        if (studentId.isBlank() || originalExecution.isBlank() ||
            parent.optString("kind") != "automation_digest_material" ||
            parent.optJSONObject("input")?.optString("studentId") != studentId ||
            parent.optString("status") in setOf("cancelled", "archived")) return false
        if (parent.optString("executionId") == originalExecution) return true
        if (parent.optString("status") !in setOf("failed", "blocked", "timed_out") ||
            parent.optBoolean("autoRetry")) return false
        return events.any { it.optString("taskId") == parent.optString("id") &&
            it.optString("executionId") == originalExecution && it.optString("type") == "status_changed" &&
            it.optJSONObject("detail")?.optString("to") == "running" }
    }
}

/** A completed write sequence can be finalized only against its exact original sources. */
class DigestBatchRecovery(private val context: Context) {
    fun receiptForTask(task: JSONObject): JSONObject? {
        val input = task.optJSONObject("input") ?: return null
        if (input.optString("actionType") != "digest_material") return null
        val studentId = input.optString("studentId"); val sourceArray = input.optJSONArray("sourceIds") ?: return null
        val expected = (0 until sourceArray.length()).map { sourceArray.optString(it) }
        if (studentId.isBlank() || expected.isEmpty() || expected.any { it.isBlank() } || expected.distinct().size != expected.size) return null
        val prefix = "digest-completion:$studentId:"
        val dao = BusinessDatabase.get(context).tasks()
        val seen = mutableListOf<String>(); val fingerprints = mutableListOf<String>()
        var cursor = ""
        do {
            val page = dao.metadataPage(prefix, cursor, 100)
            page.forEach { row ->
                val receipt = runCatching { JSONObject(row.payload) }.getOrNull() ?: return@forEach
                if (!DigestCompletionReceiptPolicy.matches(task, receipt)) return@forEach
                val ids = receipt.optJSONArray("sourceIds") ?: return@forEach
                seen.addAll((0 until ids.length()).map { ids.optString(it) })
                fingerprints.add(receipt.optString("fingerprint"))
            }
            if (page.isNotEmpty()) cursor = page.last().name
        } while (page.size == 100)
        if (seen.size != expected.size || seen.toSet() != expected.toSet() || fingerprints.any { it.isBlank() }) return null
        return JSONObject().put("reconciled", true).put("taskId", task.optString("id"))
            .put("executionId", task.optString("executionId")).put("sourceIds", sourceArray)
            .put("recoveryTaskId", task.optString("id")).put("recoveryExecutionId", task.optString("executionId"))
            .put("fingerprints", org.json.JSONArray(fingerprints)).put("checkedAt", Timestamp.now())
    }

    fun recover(studentId: String): JSONObject = synchronized(StudentWorkLocks.forStudent(studentId)) {
        val files = FileAssetService(context)
        val dao = BusinessDatabase.get(context).tasks()
        val stagePrefix = "digest-stage:$studentId:"
        var stageCursor = ""; var resumed = 0; var waitingCheckpoint = 0; var stageErrors = 0
        do {
            val page = dao.metadataPage(stagePrefix, stageCursor, 100)
            page.forEach { entry ->
                val stage = runCatching { JSONObject(entry.payload) }.getOrNull()
                if (stage == null) { stageErrors++; return@forEach }
                if (stage.optString("state") !in setOf("initial", "prepared")) return@forEach
                if (stage.optString("state") == "initial" && runCatching { recoverMissingModel(studentId, stage) }.getOrDefault(false)) {
                    resumed++; return@forEach
                }
                runCatching { StudentDigestOrchestrator(context).resumeCheckpointStage(studentId, entry.name, stage) }
                    .onSuccess { if (it) resumed++ else waitingCheckpoint++ }
                    .onFailure { stageErrors++ }
            }
            if (page.isNotEmpty()) stageCursor = page.last().name
        } while (page.size == 100)
        val prefix = "digest-completion:$studentId:"
        var cursor = ""; var completed = 0; var attention = 0
        do {
            val page = dao.metadataPage(prefix, cursor, 100)
            page.forEach { entry ->
                val receipt = runCatching { JSONObject(entry.payload) }.getOrNull()
                if (receipt == null) { attention++; return@forEach }
                if (receipt.optString("state") != "ready") return@forEach
                val attempt = runCatching {
                    require(receipt.getString("schema") == "digest-completion-v1" && receipt.getString("studentId") == studentId)
                    val fingerprint = receipt.getString("fingerprint")
                    require(entry.name == "$prefix$fingerprint")
                    val idsArray = receipt.getJSONArray("sourceIds")
                    val ids = (0 until idsArray.length()).map(idsArray::getString)
                    require(ids.isNotEmpty() && ids.size == ids.distinct().size)
                    val sources = receipt.getJSONArray("sources")
                    require(sources.length() == ids.size)
                    val current = files.materials(studentId).associateBy { it.getString("id") }
                    val resolver = MaterialDigestSourceResolver(context, files)
                    val checkpoint = requireNotNull(ScopedContentRepository(context).checkpoint(studentId, "digest_result", fingerprint))
                    require(checkpoint.optString("sourceFingerprint") == fingerprint)
                    val artifact = files.readLogicalBytes(studentId, receipt.getString("artifactPath"))
                    require(ScopedContentPolicy.hash(artifact) == receipt.getString("artifactSha256"))
                    require(artifact.contentEquals(checkpoint.getString("markdown").toByteArray()))
                    ids.forEachIndexed { index, id ->
                        val evidence = sources.getJSONObject(index)
                        val row = requireNotNull(current[id])
                        val sourceHash = ScopedContentPolicy.hash(files.readMaterialBytes(studentId, id))
                        val textHash = ScopedContentPolicy.hash(resolver.resolve(studentId, row).toByteArray())
                        require(DigestCompletionReceiptPolicy.sourceMatches(studentId, receipt.getString("executionId"), id,
                            row, evidence, sourceHash, textHash)) { "消化来源或执行不匹配" }
                    }
                    ids.forEach { id ->
                        val row = current.getValue(id)
                        files.patchMaterial(studentId, id, JSONObject().put("digestBatchId", receipt.getString("executionId"))
                            .put("automationDigestFingerprint", fingerprint).put("automationDigestSourceIds", idsArray)
                            .put("digestArtifactPath", receipt.getString("artifactPath")).put("digestResult", receipt.optString("summary"))
                            .put("digestedAt", receipt.optString("createdAt")).put("digestRecoveryState", "completed")
                            .put("digestError", "").put("digestRecoveryMarker", "").put("digestRecoveryAuthorizationId", "")
                            .put("automationAttentionReason", "").put("automationAttentionMessage", ""))
                        if (MaterialStatus.normalize(row.optString("status")) != MaterialStatus.PROCESSED)
                            files.transitionMaterial(studentId, id, MaterialStatus.PROCESSED)
                    }
                    dao.metadata(BusinessMetadataEntity(entry.name, receipt.put("state", "completed")
                        .put("recoveredAt", Timestamp.now()).toString()))
                    val requestKey = "digest-request:$studentId:$fingerprint"
                    dao.metadata(requestKey)?.let { raw ->
                        val request = JSONObject(raw)
                        if (request.optString("state") in setOf("unknown", "received", "validation_failed", "succeeded") &&
                            (request.optString("taskId").isBlank() || (receipt.optString("childTaskId").isNotBlank() &&
                                request.optString("taskId") == receipt.optString("childTaskId"))))
                            dao.metadata(BusinessMetadataEntity(requestKey, request.put("state", "succeeded")
                                .put("recoveredAt", Timestamp.now()).toString()))
                    }
                }
                if (attempt.isSuccess) completed++ else {
                    attention++
                    runCatching {
                        val execution = receipt.optString("executionId")
                        val array = receipt.optJSONArray("sourceIds") ?: return@runCatching
                        val ids = (0 until array.length()).map { array.optString(it) }.toSet()
                        files.materials(studentId).filter { it.optString("id") in ids && execution.isNotBlank() &&
                            it.optString("digestBatchId") == execution }.forEach { row ->
                            files.patchMaterial(studentId, row.getString("id"), JSONObject()
                                .put("automationAttentionReason", "digest_recovery_unverified")
                                .put("automationAttentionMessage", "消化批次的来源或产物无法核对，已保留原件和结果"))
                        }
                    }
                }
            }
            if (page.isNotEmpty()) cursor = page.last().name
        } while (page.size == 100)
        JSONObject().put("completedBatches", completed).put("needsAttention", attention + stageErrors)
            .put("resumedCheckpoints", resumed).put("waitingCheckpoint", waitingCheckpoint)
    }

    /** Only the exact pre-dispatch configuration failure is eligible for automatic repair. */
    private fun recoverMissingModel(studentId: String, stage: JSONObject): Boolean {
        if (AgentConfigurationStore(context).load() == null || stage.optString("studentId") != studentId ||
            stage.optInt("notDispatchedProofVersion") != 1 || !stage.optBoolean("allowAutoNoDispatch")) return false
        val executionId = stage.optString("executionId")
        val childId = stage.optString("childTaskId")
        val child = runCatching { TaskRepository(context).requireExact(childId) }.getOrNull() ?: return false
        if (executionId.isBlank() || child.optString("executionId") != executionId || child.optString("status") != "failed" ||
            child.optJSONObject("input")?.optString("studentId") != studentId ||
            BusinessDatabase.get(context).ledger().hasAnyCall(studentId, childId)) return false
        val parentId = stage.optString("automationTaskId")
        if (parentId.isNotBlank()) {
            val parent = runCatching { TaskRepository(context).requireExact(parentId) }.getOrNull() ?: return false
            val events = runCatching { TaskRepository(context).events(parentId, 100) }.getOrNull() ?: return false
            if (!MissingModelParentPolicy.matches(parent, studentId, stage.optString("automationExecutionId"), events)) return false
        }
        val sources = stage.optJSONArray("sources") ?: return false
        if (sources.length() == 0) return false
        val files = FileAssetService(context)
        val indexed = files.materials(studentId).associateBy { it.optString("id") }
        val selected = mutableListOf<JSONObject>()
        for (index in 0 until sources.length()) {
            val source = sources.optJSONObject(index) ?: return false
            val id = source.optString("id")
            val material = indexed[id] ?: return false
            val expected = source.optString("sha256")
            if (id.isBlank() || expected.isBlank() || material.optString("studentId") != studentId ||
                material.optString("digestBatchId") != executionId ||
                MaterialStatus.normalize(material.optString("status")) != MaterialStatus.FAILED ||
                material.optString("digestRecoveryState") != "failed" ||
                material.optString("digestError") != "尚未配置 Agent 模型" ||
                ScopedContentPolicy.hash(files.readMaterialBytes(studentId, id)) != expected) return false
            selected.add(material)
        }
        if (selected.map { it.getString("id") }.distinct().size != selected.size) return false
        AutomationEventEmitter.qualityFailure(context, studentId, selected, "model_configuration_restored:$executionId")
        val fingerprint = ScopedContentPolicy.fingerprint(JSONObject().put("recovery", "model_configuration_restored")
            .put("executionId", executionId).put("studentId", studentId))
        AutomationOrchestrator(context).emit(AutomationEventType.OCR_COMPLETED, studentId, fingerprint,
            selected.map { it.getString("id") })
        return true
    }
}
