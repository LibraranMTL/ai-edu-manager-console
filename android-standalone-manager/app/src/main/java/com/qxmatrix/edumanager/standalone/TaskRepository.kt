package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.util.UUID

/** Protocol 1.2 is unchanged; task-center/tasks.json and task-center/events.jsonl are import-only. */
class TaskRepository internal constructor(private val store: TaskLedgerStore) {
    constructor(context: Context) : this(RoomTaskLedgerStore(context))
    fun list(): List<JSONObject> = store.transaction { store.all() }
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
    fun requireExact(taskId: String): JSONObject = store.transaction { store.exact(taskId) ?: throw NoSuchElementException("未找到指定任务 ID：$taskId") }
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
