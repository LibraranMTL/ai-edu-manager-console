package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.util.UUID

/** Protocol 1.2 is unchanged; task-center/tasks.json and task-center/events.jsonl are import-only. */
class TaskRepository internal constructor(private val store: TaskLedgerStore) {
    constructor(context: Context) : this(RoomTaskLedgerStore(context))
    fun list(): List<JSONObject> = store.transaction { store.all() }
    internal fun pageAfter(afterId: String, limit: Int): List<JSONObject> = store.transaction { store.pageAfter(afterId, limit) }
    fun hasActiveForStudent(studentId: String, projectIds: List<String>): Boolean {
        require(studentId.isNotBlank()); return store.transaction { store.hasActive(studentId, projectIds) }
    }
    fun listForStudent(studentId: String, projectIds: List<String>, limit: Int = 100): List<JSONObject> {
        require(studentId.isNotBlank()) { "请先选择学生" }
        return store.transaction { store.scoped(studentId, projectIds, limit) }
    }
    fun events(taskId: String, limit: Int = 30) = store.transaction { requireExact(taskId); store.events(taskId, limit) }
    fun create(input: JSONObject): JSONObject = store.transaction {
        val task = TaskProtocol.envelope(input); LegacyTaskCodec.validateTask(task)
        require(store.exact(task.getString("id")) == null) { "任务 ID 已存在" }
        store.insert(task); appendEvent(task, "task_created", JSONObject()); task
    }
    /** Stable business keys make trigger replay idempotent without hiding conflicting payloads. */
    fun createOrGet(input: JSONObject): JSONObject = store.transaction {
        val task = TaskProtocol.envelope(input); LegacyTaskCodec.validateTask(task)
        val key = task.getString("idempotencyKey")
        val matches = store.all().filter { it.optString("idempotencyKey") == key }
        require(matches.size <= 1) { "任务账本存在重复业务键，停止自动写入" }
        matches.singleOrNull()?.let { existing ->
            require(existing.optString("kind") == task.optString("kind") &&
                existing.optJSONObject("input")?.toString() == task.optJSONObject("input")?.toString()) {
                "同一业务键对应不同自动化输入，原任务保留"
            }
            return@transaction existing
        }
        require(store.exact(task.getString("id")) == null) { "任务 ID 已存在" }
        store.insert(task); appendEvent(task, "task_created", JSONObject().put("idempotent", true)); task
    }
    fun approve(taskId: String): JSONObject = store.transaction {
        transition(taskId, "approved", JSONObject().put("approval", JSONObject().put("required", true).put("status", "approved").put("reviewerRole", "administrator").put("reviewerId", "local-user").put("approvedAt", Timestamp.now())))
    }
    fun start(taskId: String): JSONObject = store.transaction {
        val task = requireExact(taskId)
        if (task.getJSONObject("approval").optBoolean("required")) require(task.getJSONObject("approval").optString("status") == "approved") { "高风险任务必须先由用户批准" }
        require(task.optString("status") in setOf("pending", "approved", "queued", "failed", "blocked", "timed_out")) { "任务当前不能启动" }
        if (task.optString("status") in setOf("pending", "failed", "blocked", "timed_out")) transition(taskId, "approved")
        transition(taskId, "running", JSONObject().put("executionId", "execution-${UUID.randomUUID()}").put("startedAt", Timestamp.now()).put("lastHeartbeatAt", Timestamp.now()).put("attempt", task.optInt("attempt") + 1))
    }
    fun acceptResult(taskId: String, payload: JSONObject): JSONObject = store.transaction {
        val task = requireExact(taskId); TaskProtocol.validateExternalResult(task, payload)
        transition(taskId, "reviewing", JSONObject().put("result", payload))
        val passed = payload.optJSONObject("validation")?.optBoolean("passed") == true
        transition(taskId, if (passed) "succeeded" else "failed", JSONObject().put("result", payload).put("completedAt", Timestamp.now()))
    }
    fun completeInternal(taskId: String, executionId: String, result: JSONObject): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("kind").startsWith("automation_")) { "仅内部自动化任务可使用自动完成" }
        require(task.optString("status") in setOf("running", "waiting_result")) { "自动化任务当前不能完成" }
        require(executionId.isNotBlank() && task.optString("executionId") == executionId) { "任务执行上下文已变化" }
        transition(taskId, "reviewing", JSONObject().put("result", result))
        transition(taskId, "succeeded", JSONObject().put("result", result).put("completedAt", Timestamp.now()).put("autoRetry", false))
    }
    /** Persist the exact execution result before the final status transition. */
    fun recordInternalReceipt(taskId: String, executionId: String, result: JSONObject): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("kind").startsWith("automation_") && task.optString("status") == "running")
        require(executionId.isNotBlank() && task.optString("executionId") == executionId) { "任务执行上下文已变化" }
        val receipt = JSONObject().put("schema", "automation-receipt-v1").put("taskId", taskId)
            .put("executionId", executionId).put("idempotencyKey", task.getString("idempotencyKey"))
            .put("input", JSONObject(task.getJSONObject("input").toString())).put("result", result)
            .put("recordedAt", Timestamp.now())
        transition(taskId, "running", JSONObject().put("result", receipt))
    }
    fun failInternal(taskId: String, error: JSONObject, nextRetryAt: String = "", autoRetry: Boolean = false,
        resultUnknown: Boolean = false, executionId: String): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("kind").startsWith("automation_")) { "仅内部自动化任务可使用自动失败" }
        require(task.optString("status") in setOf("running", "waiting_result")) { "自动化任务当前不能失败" }
        require(executionId.isNotBlank() && task.optString("executionId") == executionId) { "任务执行上下文已变化" }
        transition(taskId, if (resultUnknown) "waiting_result" else "failed", JSONObject()
            .put("error", error).put("nextRetryAt", nextRetryAt).put("autoRetry", autoRetry && !resultUnknown)
            .put("completedAt", if (resultUnknown) "" else Timestamp.now()))
    }
    fun requeueInternal(taskId: String): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("kind").startsWith("automation_")) { "仅内部自动化任务可自动续跑" }
        require(task.optBoolean("autoRetry") && task.optInt("attempt") < task.optInt("maxAttempts")) { "任务不允许自动重试" }
        require(task.optString("status") in setOf("failed", "blocked", "timed_out")) { "任务当前不能重新排队" }
        transition(taskId, "approved", JSONObject().put("error", JSONObject.NULL).put("nextRetryAt", ""))
        transition(taskId, "queued")
    }
    /** Caller has verified that no model call was dispatched for this exact execution. */
    internal fun requeueKnownNotDispatched(taskId: String, executionId: String): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("kind") == "automation_digest_material" && task.optString("executionId") == executionId && executionId.isNotBlank())
        if (task.optString("status") == "queued") return@transaction task
        require(task.optString("status") == "waiting_result" && task.optInt("attempt") < task.optInt("maxAttempts"))
        transition(taskId, "failed", JSONObject().put("error", JSONObject().put("code", "proven_not_dispatched"))
            .put("autoRetry", true))
        transition(taskId, "approved")
        transition(taskId, "queued")
    }
    fun recoverInternal(taskId: String, result: JSONObject): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("kind").startsWith("automation_") && task.optString("status") == "waiting_result") { "任务不处于回执核对状态" }
        require(result.optString("recoveryTaskId") == taskId && result.optString("recoveryExecutionId").isNotBlank() &&
            result.optString("recoveryExecutionId") == task.optString("executionId")) { "恢复回执对应的执行已变化" }
        transition(taskId, "reviewing", JSONObject().put("result", result))
        transition(taskId, "succeeded", JSONObject().put("result", result).put("completedAt", Timestamp.now()).put("autoRetry", false))
    }
    fun markInternalAttention(taskId: String, message: String): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("kind").startsWith("automation_")) { "仅内部自动化任务可进入需要处理" }
        val error = JSONObject(task.optJSONObject("error")?.toString() ?: "{}")
            .put("attentionRequired", true).put("message", message.take(600))
        val patch = JSONObject().put("error", error).put("autoRetry", false).put("nextRetryAt", "")
        when (task.optString("status")) {
            "waiting_result", "running" -> transition(taskId, "failed", patch.put("completedAt", Timestamp.now()))
            "failed" -> transition(taskId, "failed", patch)
            "blocked" -> transition(taskId, "blocked", patch)
            "timed_out" -> transition(taskId, "timed_out", patch)
            else -> error("任务当前不能进入需要处理")
        }
    }
    fun requireExact(taskId: String): JSONObject = store.transaction { store.exact(taskId) ?: throw NoSuchElementException("未找到指定任务 ID：$taskId") }
    /** Archive an obsolete failed attempt, retaining its original error and a verified replacement receipt. */
    internal fun supersedeFailedDigest(taskId: String, studentId: String, executionId: String, receipt: JSONObject): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("kind") == "automation_digest_material" && LegacyTaskCodec.studentId(task) == studentId)
        require(task.optString("status") in setOf("failed", "blocked", "timed_out") && !task.optBoolean("autoRetry"))
        require(executionId.isNotBlank() && task.optString("executionId") == executionId)
        require(receipt.optString("replacementFingerprint").isNotBlank() && receipt.optString("studentId") == studentId)
        val result = JSONObject(task.optJSONObject("result")?.toString() ?: "{}").put("supersededReceipt", receipt)
        transition(taskId, "archived", JSONObject().put("result", result).put("autoRetry", false))
    }
    fun authorize(taskId: String, executionId: String, operation: String, logicalPath: String, write: Boolean): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(task.optString("executionId") == executionId) { "任务执行上下文无效或已过期" }
        require(task.optString("status") == "running") { "文件工具只允许由运行中的任务调用" }
        TaskProtocol.validatePermissions(task, OPERATION_ALLOWLIST)
        val permissions = task.getJSONObject("permissions")
        require(operation in permissions.getJSONArray("operations").strings()) { "任务未授权操作：$operation" }
        val path = WorkspacePath.normalized(logicalPath)
        val roots = permissions.getJSONArray(if (write) "write" else "read").strings().map(WorkspacePath::normalized)
        require(roots.any { path == it || path.startsWith("${it.trimEnd('/')}/") }) { "文件工具目标超出任务授权范围" }
        task
    }
    /** Running tasks are not claimed to be cancelled without cooperative worker cancellation. */
    fun cancelQueued(taskId: String, studentId: String): JSONObject = store.transaction {
        val task = requireExact(taskId)
        require(LegacyTaskCodec.studentId(task) == studentId) { "学生作用域已变化" }
        require(task.getString("status") in setOf("draft", "pending", "approved", "queued", "blocked")) { "仅能取消尚未执行的任务" }
        transition(taskId, "cancelled", JSONObject().put("autoRetry", false).put("completedAt", Timestamp.now()))
    }
    private fun transition(taskId: String, nextStatus: String, patch: JSONObject = JSONObject()): JSONObject {
        val current = requireExact(taskId); TaskProtocol.validateTransition(current.optString("status"), nextStatus)
        val nextInput = JSONObject(current.toString()).put("status", nextStatus)
        patch.keys().forEach { nextInput.put(it, patch.opt(it)) }
        val next = TaskProtocol.envelope(nextInput, current); store.replace(current, next)
        appendEvent(next, "status_changed", JSONObject().put("from", current.optString("status")).put("to", nextStatus)); return next
    }
    private fun appendEvent(task: JSONObject, type: String, detail: JSONObject) {
        store.event(JSONObject().put("id", "event-${UUID.randomUUID()}").put("taskId", task.getString("id")).put("executionId", task.optString("executionId")).put("type", type).put("at", Timestamp.now()).put("detail", detail))
    }
    companion object {
        val OPERATION_ALLOWLIST = mapOf("student_digest" to setOf("read_file", "write_knowledge", "update_index"), "project_digest" to setOf("read_file", "write_project_knowledge", "update_index"), "ocr_extract" to setOf("read_file", "write_ocr_result", "vision_analyze"))
    }
}
