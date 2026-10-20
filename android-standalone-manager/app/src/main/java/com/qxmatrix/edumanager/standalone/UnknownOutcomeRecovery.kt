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
    fun authorize(studentId: String, name: String, expectedFingerprint: String, note: String) = synchronized(StudentWorkLocks.forStudent(studentId)) {
        validateStudent(studentId); require(note.trim().length in 4..500) { "请填写核对结果（4—500字）" }
        db.runInTransaction {
            val payload = JSONObject(requireNotNull(db.tasks().metadata(name)))
            require(ScopedContentPolicy.fingerprint(payload) == expectedFingerprint) { "核对期间记录变化，请重新读取" }
            UnknownOutcomePolicy.requireRecoverable(studentId, name, payload)
            payload.optString("taskId").takeIf(String::isNotBlank)?.let { taskId ->
                val task = db.tasks().exact(taskId)
                require(task == null || task.studentId == studentId)
                require(task == null || task.processSession != BusinessDatabase.processSession || task.status !in setOf("running", "waiting_result", "reviewing")) { "任务仍在当前进程执行，请等待或先取消请求" }
            }
            val auditId = UUID.randomUUID().toString(); val now = Timestamp.now()
            db.tasks().metadata(BusinessMetadataEntity("recovery-audit:$studentId:$auditId", JSONObject().put("marker", name)
                .put("previous", payload).put("note", note.trim()).put("at", now).put("action", "explicit_one_shot_retry").toString()))
            db.tasks().metadata(BusinessMetadataEntity(name, JSONObject(payload.toString()).put("state", "authorized_retry")
                .put("authorizationId", auditId).put("authorizedAt", now).toString()))
        }
    }
}
