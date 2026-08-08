package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class TaskRepository(context: Context) {
    private val state = PrivateStateStore(context)

    fun list(): List<JSONObject> = readStore().getJSONArray("tasks").toObjects()

    fun create(input: JSONObject): JSONObject {
        val task = TaskProtocol.envelope(input)
        TaskProtocol.validatePermissions(task, OPERATION_ALLOWLIST)
        val store = readStore(); val tasks = store.getJSONArray("tasks").toObjects().toMutableList()
        require(tasks.none { it.getString("id") == task.getString("id") }) { "任务 ID 已存在" }
        tasks.add(0, task); writeStore(store, tasks); appendEvent(task, "task_created", JSONObject())
        return task
    }

    fun approve(taskId: String): JSONObject = transition(taskId, "approved", JSONObject().put("approval", JSONObject().put("required", true).put("status", "approved").put("reviewerRole", "administrator").put("reviewerId", "local-user").put("approvedAt", Timestamp.now())))

    fun start(taskId: String): JSONObject {
        val task = requireExact(taskId)
        if (task.optString("status") == "pending" && task.getJSONObject("approval").optBoolean("required")) {
            require(task.getJSONObject("approval").optString("status") == "approved") { "高风险任务必须先由用户批准" }
        }
        val current = requireExact(taskId)
        require(current.optString("status") in setOf("pending", "approved", "queued", "failed", "blocked", "timed_out")) { "任务当前不能启动" }
        if (current.optString("status") == "pending") transition(taskId, "approved")
        return transition(taskId, "running", JSONObject().put("executionId", "execution-${UUID.randomUUID()}").put("startedAt", Timestamp.now()).put("lastHeartbeatAt", Timestamp.now()).put("attempt", current.optInt("attempt") + 1))
    }

    fun acceptResult(taskId: String, payload: JSONObject): JSONObject {
        val task = requireExact(taskId); TaskProtocol.validateExternalResult(task, payload)
        val reviewing = transition(taskId, "reviewing", JSONObject().put("result", payload))
        val passed = payload.optJSONObject("validation")?.optBoolean("passed") == true
        return transition(taskId, if (passed) "succeeded" else "failed", JSONObject().put("result", payload).put("completedAt", Timestamp.now()))
    }

    fun requireExact(taskId: String): JSONObject = list().singleOrNull { it.optString("id") == taskId }
        ?: throw NoSuchElementException("未找到指定任务 ID：$taskId")

    fun authorize(taskId: String, executionId: String, operation: String, logicalPath: String, write: Boolean): JSONObject {
        val task = requireExact(taskId)
        require(task.optString("executionId") == executionId) { "任务执行上下文无效或已过期" }
        require(task.optString("status") == "running") { "文件工具只允许由运行中的任务调用" }
        TaskProtocol.validatePermissions(task, OPERATION_ALLOWLIST)
        val permissions = task.getJSONObject("permissions")
        require(operation in permissions.getJSONArray("operations").strings()) { "任务未授权操作：$operation" }
        val path = WorkspacePath.normalized(logicalPath)
        val roots = permissions.getJSONArray(if (write) "write" else "read").strings().map(WorkspacePath::normalized)
        require(roots.any { path == it || path.startsWith("${it.trimEnd('/')}/") }) { "文件工具目标超出任务授权范围" }
        return task
    }

    private fun transition(taskId: String, nextStatus: String, patch: JSONObject = JSONObject()): JSONObject {
        val store = readStore(); val tasks = store.getJSONArray("tasks").toObjects().toMutableList(); val index = tasks.indexOfFirst { it.optString("id") == taskId }
        require(index >= 0) { "未找到任务" }; val current = tasks[index]; TaskProtocol.validateTransition(current.optString("status"), nextStatus)
        val nextInput = JSONObject(current.toString()).put("status", nextStatus)
        patch.keys().forEach { nextInput.put(it, patch.opt(it)) }
        val next = TaskProtocol.envelope(nextInput, current); tasks[index] = next; writeStore(store, tasks); appendEvent(next, "status_changed", JSONObject().put("from", current.optString("status")).put("to", nextStatus)); return next
    }

    private fun readStore(): JSONObject = try { JSONObject(state.readBytes(TASKS).toString(Charsets.UTF_8)) } catch (_: Exception) {
        JSONObject().put("protocolVersion", TaskProtocol.VERSION).put("updatedAt", "").put("tasks", JSONArray()).put("history", JSONArray())
    }

    private fun writeStore(previous: JSONObject, tasks: List<JSONObject>) {
        val next = JSONObject().put("protocolVersion", TaskProtocol.VERSION).put("updatedAt", Timestamp.now())
            .put("tasks", JSONArray().also { a -> tasks.forEach(a::put) }).put("history", previous.optJSONArray("history") ?: JSONArray())
        state.writeBytes(TASKS, (next.toString(2) + "\n").toByteArray())
    }

    private fun appendEvent(task: JSONObject, type: String, detail: JSONObject) {
        val event = JSONObject().put("id", "event-${UUID.randomUUID()}").put("taskId", task.getString("id")).put("executionId", task.optString("executionId")).put("type", type).put("at", Timestamp.now()).put("detail", detail)
        val old = try { state.readBytes(EVENTS).toString(Charsets.UTF_8).trimEnd() } catch (_: Exception) { "" }
        state.writeBytes(EVENTS, ((if (old.isBlank()) "" else "$old\n") + event + "\n").toByteArray())
    }

    companion object {
        private const val TASKS = "task-center/tasks.json"; private const val EVENTS = "task-center/events.jsonl"
        val OPERATION_ALLOWLIST = mapOf("student_digest" to setOf("read_file", "write_knowledge", "update_index"), "project_digest" to setOf("read_file", "write_project_knowledge", "update_index"), "ocr_extract" to setOf("read_file", "write_ocr_result", "vision_analyze"))
    }
}
