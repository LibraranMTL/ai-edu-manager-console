package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.util.UUID

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

/** Authorization never erases receipts or starts a network/model request. One subsequent explicit
 * action consumes it by replacing state with unknown BEFORE sending again. */
class UnknownOutcomeRecovery(private val context: Context, private val db: BusinessDatabase = BusinessDatabase.get(context),
    private val validateStudent: (String) -> Unit = { StudentIndexRepository(context).requireExact(it); Unit }) {
    fun pending(studentId: String): List<BusinessMetadataEntity> {
        validateStudent(studentId)
        return UnknownOutcomePolicy.prefixes(studentId).flatMap { db.tasks().metadataPrefix(it, "$it\uffff") }
            .filter { JSONObject(it.payload).optString("state") == "unknown" }
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
                .put("authorizationId", auditId).put("authorizedAt", now).toString()))
        }
        if (materialIds.isEmpty()) return@synchronized 0
        val files = FileAssetService(context)
        val failures = mutableListOf<String>()
        materialIds.forEach { materialId ->
            runCatching {
                val current = files.materials(studentId).singleOrNull { it.optString("id") == materialId } ?: return@runCatching
                if (MaterialStatus.normalize(current.optString("status")) == MaterialStatus.FAILED) {
                    files.transitionMaterial(studentId, materialId, MaterialStatus.PENDING_DIGEST)
                }
                files.patchMaterial(studentId, materialId, JSONObject()
                    .put("digestRecoveryState", "authorized_retry").put("digestError", ""))
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
            error("单次授权已记录，但资料队列恢复未完成；原记录仍可再次核对：${failures.first()}")
        }
        materialIds.size
    }
}
