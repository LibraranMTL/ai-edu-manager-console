package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.util.UUID

data class UnknownOutcomeSummary(
    val row: BusinessMetadataEntity,
    val payload: JSONObject,
    val kind: String,
    val taskId: String,
    val occurredAt: String,
    val materialIds: List<String>,
    val fileNames: List<String>,
    val reason: String,
)

object UnknownOutcomePolicy {
    fun prefixes(studentId: String): List<String> {
        require(studentId.isNotBlank() && !studentId.contains(':'))
        return listOf("digest-request:$studentId:", "cloud-summary:$studentId:")
    }
    fun requireRecoverable(studentId: String, name: String, payload: JSONObject) {
        require(prefixes(studentId).any(name::startsWith)) { "记录不属于当前学生" }
        require(payload.optString("state") == "unknown") { "记录已变化，不重复授权" }
    }
    fun retryAllowed(previous: JSONObject?, explicit: Boolean = true): Boolean = previous == null ||
        previous.optString("state") in setOf("received", "validation_failed") ||
        (explicit && previous.optString("state") == "authorized_retry")
}

/** Authorization never erases receipts or starts a network/model request. A subsequent explicit
 * action consumes only its selected materials before creating a new independent unknown receipt. */
class UnknownOutcomeRecovery(private val context: Context, private val db: BusinessDatabase = BusinessDatabase.get(context),
    private val validateStudent: (String) -> Unit = { StudentIndexRepository(context).requireExact(it); Unit }) {
    fun pending(studentId: String): List<BusinessMetadataEntity> {
        validateStudent(studentId)
        return UnknownOutcomePolicy.prefixes(studentId).flatMap { db.tasks().metadataPrefix(it, "$it\uffff") }
            .filter { JSONObject(it.payload).optString("state") == "unknown" }
    }

    fun pendingSummaries(studentId: String): List<UnknownOutcomeSummary> {
        validateStudent(studentId)
        val materials = runCatching { FileAssetService(context).materials(studentId) }.getOrDefault(emptyList())
            .associateBy { it.optString("id") }
        val calls = db.ledger().calls(studentId, 200)
        return pending(studentId).map { row ->
            val payload = JSONObject(row.payload)
            val taskId = payload.optString("taskId")
            val task = taskId.takeIf(String::isNotBlank)?.let(db.tasks()::exact)?.let { JSONObject(it.payload) }
            val directIds = payload.optJSONArray("materialIds")
            val fallbackIds = task?.optJSONObject("input")?.optJSONArray("materialIds")
            val ids = (directIds ?: fallbackIds)?.let { array ->
                (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }.distinct()
            }.orEmpty()
            val call = calls.filter { it.taskId == taskId }.maxByOrNull { it.startedAt }
            val reason = when (call?.errorCode) {
                "timeout_unknown" -> "模型响应超时（${(call.elapsedMs / 1_000).coerceAtLeast(1)}秒），结果未知"
                "transport_unknown" -> "连接中断，服务端是否完成未知"
                "process_interrupted" -> "应用进程中断，结果未知"
                "cancelled" -> "请求已取消，服务端费用仍可能产生"
                else -> task?.optJSONObject("error")?.optString("message").orEmpty()
                    .ifBlank { "未取得最终回执，结果未知" }
            }
            UnknownOutcomeSummary(
                row = row,
                payload = payload,
                kind = if (row.name.startsWith("digest-request:")) "digest" else "cloud",
                taskId = taskId,
                occurredAt = task?.optString("startedAt").orEmpty()
                    .ifBlank { task?.optString("updatedAt").orEmpty() }
                    .ifBlank { payload.optString("receivedAt") },
                materialIds = ids,
                fileNames = ids.mapNotNull { id -> materials[id]?.optString("fileName")?.takeIf(String::isNotBlank) },
                reason = reason,
            )
        }.sortedByDescending { it.occurredAt }
    }
    fun authorize(studentId: String, name: String, expectedFingerprint: String, note: String): Int = synchronized(StudentWorkLocks.forStudent(studentId)) {
        validateStudent(studentId); require(note.trim().length in 4..500) { "请填写核对结果（4—500字）" }
        var materialIds = emptyList<String>()
        var authorizationId = ""
        db.runInTransaction {
            val payload = JSONObject(requireNotNull(db.tasks().metadata(name)))
            require(ScopedContentPolicy.fingerprint(payload) == expectedFingerprint) { "核对期间记录变化，请重新读取" }
            UnknownOutcomePolicy.requireRecoverable(studentId, name, payload)
            payload.optJSONArray("materialIds")?.let { ids ->
                materialIds = (0 until ids.length()).mapNotNull { ids.optString(it).takeIf(String::isNotBlank) }.distinct()
            }
            payload.optString("taskId").takeIf(String::isNotBlank)?.let { taskId ->
                val task = db.tasks().exact(taskId)
                require(task == null || task.studentId == studentId)
                require(task == null || task.processSession != BusinessDatabase.processSession || task.status !in setOf("running", "waiting_result", "reviewing")) { "任务仍在当前进程执行，请等待或先取消请求" }
                if (name.startsWith("digest-request:") && materialIds.isEmpty() && task != null) {
                    val ids = JSONObject(task.payload).optJSONObject("input")?.optJSONArray("materialIds")
                    materialIds = if (ids == null) emptyList() else (0 until ids.length()).mapNotNull { ids.optString(it).takeIf(String::isNotBlank) }.distinct()
                }
            }
            val auditId = UUID.randomUUID().toString(); val now = Timestamp.now()
            authorizationId = auditId
            db.tasks().metadata(BusinessMetadataEntity("recovery-audit:$studentId:$auditId", JSONObject().put("marker", name)
                .put("previous", payload).put("note", note.trim()).put("at", now).put("action", "explicit_one_shot_retry").toString()))
            db.tasks().metadata(BusinessMetadataEntity(name, JSONObject(payload.toString()).put("state", "authorized_retry")
                .put("authorizationId", auditId).put("authorizedAt", now)
                .put("materialIds", org.json.JSONArray(materialIds))
                .put("remainingMaterialIds", org.json.JSONArray(materialIds)).toString()))
        }
        if (materialIds.isEmpty()) return@synchronized 0
        val files = FileAssetService(context)
        val failures = mutableListOf<String>()
        val restoredMaterialIds = mutableListOf<String>()
        materialIds.forEach { materialId ->
            runCatching {
                val current = files.materials(studentId).singleOrNull { it.optString("id") == materialId } ?: return@runCatching
                if (MaterialStatus.normalize(current.optString("status")) == MaterialStatus.FAILED) {
                    files.transitionMaterial(studentId, materialId, MaterialStatus.PENDING_DIGEST)
                }
                files.patchMaterial(studentId, materialId, JSONObject()
                    .put("digestRecoveryState", "authorized_retry").put("digestError", "")
                    .put("digestRecoveryMarker", name).put("digestRecoveryAuthorizationId", authorizationId))
                restoredMaterialIds += materialId
            }.onFailure { failures += "$materialId：${it.message ?: "恢复失败"}" }
        }
        if (failures.isNotEmpty()) {
            db.runInTransaction {
                val current = JSONObject(requireNotNull(db.tasks().metadata(name)))
                if (current.optString("state") == "authorized_retry" && current.optString("authorizationId") == authorizationId) {
                    db.tasks().metadata(BusinessMetadataEntity(name, current.put("state", "unknown")
                        .put("recoveryRestoreError", failures.joinToString("；").take(800)).toString()))
                }
            }
            restoredMaterialIds.forEach { materialId -> runCatching {
                val current = files.materials(studentId).singleOrNull { it.optString("id") == materialId } ?: return@runCatching
                if (MaterialStatus.normalize(current.optString("status")) == MaterialStatus.PENDING_DIGEST) {
                    files.transitionMaterial(studentId, materialId, MaterialStatus.FAILED)
                }
                files.patchMaterial(studentId, materialId, JSONObject()
                    .put("digestRecoveryState", "needs_user")
                    .put("digestRecoveryMarker", "").put("digestRecoveryAuthorizationId", ""))
            } }
            error("单次授权已记录，但资料队列恢复未完成；原记录仍可再次核对：${failures.first()}")
        }
        materialIds.size
    }

    /** Consumes only the selected files from a one-shot authorization before a new request is sent. */
    fun consumeAuthorization(studentId: String, marker: String, authorizationId: String, materialIds: Set<String>) {
        require(materialIds.isNotEmpty())
        validateStudent(studentId)
        db.runInTransaction {
            val payload = JSONObject(requireNotNull(db.tasks().metadata(marker)) { "未找到消化恢复授权" })
            require(payload.optString("state") == "authorized_retry") { "消化恢复授权已使用或已失效" }
            require(payload.optString("authorizationId") == authorizationId && authorizationId.isNotBlank()) { "消化恢复授权不匹配" }
            val remainingArray = payload.optJSONArray("remainingMaterialIds") ?: payload.optJSONArray("materialIds")
            val remaining = if (remainingArray == null) emptySet() else
                (0 until remainingArray.length()).mapNotNull { remainingArray.optString(it).takeIf(String::isNotBlank) }.toSet()
            require(materialIds.all(remaining::contains)) { "所选资料不在本次恢复授权范围内" }
            val nextRemaining = remaining - materialIds
            val now = Timestamp.now()
            db.tasks().metadata(BusinessMetadataEntity(marker, payload
                .put("state", if (nextRemaining.isEmpty()) "retry_consumed" else "authorized_retry")
                .put("remainingMaterialIds", org.json.JSONArray(nextRemaining.toList()))
                .put("lastConsumedAt", now).toString()))
            val auditId = UUID.randomUUID().toString()
            db.tasks().metadata(BusinessMetadataEntity("recovery-consume:$studentId:$auditId", JSONObject()
                .put("marker", marker).put("authorizationId", authorizationId)
                .put("materialIds", org.json.JSONArray(materialIds.toList())).put("at", now).toString()))
        }
    }
}
