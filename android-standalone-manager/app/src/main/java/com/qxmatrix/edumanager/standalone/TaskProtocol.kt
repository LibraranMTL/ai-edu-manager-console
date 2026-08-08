package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

object TaskProtocol {
    const val VERSION = "1.2"
    val transitions = mapOf(
        "draft" to setOf("pending", "cancelled"), "pending" to setOf("approved", "cancelled", "blocked"),
        "approved" to setOf("queued", "running", "waiting_result", "cancelled", "blocked"),
        "queued" to setOf("running", "waiting_result", "cancelled", "timed_out", "blocked"),
        "running" to setOf("waiting_result", "reviewing", "failed", "timed_out", "cancelled"),
        "waiting_result" to setOf("running", "reviewing", "failed", "timed_out", "cancelled"),
        "reviewing" to setOf("succeeded", "failed", "pending", "cancelled"),
        "succeeded" to setOf("pending"), "failed" to setOf("pending", "approved", "cancelled"),
        "blocked" to setOf("pending", "approved", "cancelled"), "cancelled" to setOf("pending"),
        "timed_out" to setOf("pending", "approved", "cancelled"),
    )

    fun validateTransition(current: String, next: String) {
        if (current == next) return
        require(next in transitions[current].orEmpty()) { "不允许从 $current 直接流转到 $next" }
        require(next != "succeeded" || current == "reviewing") { "任务成功前必须进入 reviewing" }
    }

    fun envelope(input: JSONObject, current: JSONObject? = null): JSONObject {
        fun text(key: String, fallback: String = "") = input.optString(key).ifBlank { current?.optString(key).orEmpty().ifBlank { fallback } }
        fun objectValue(key: String, fallback: JSONObject = JSONObject()) = input.optJSONObject(key) ?: current?.optJSONObject(key) ?: fallback
        val now = Timestamp.now(); val kind = text("kind", "generic"); val sourceType = text("sourceType", "system"); val sourceId = text("sourceId", "system")
        val risk = text("riskLevel", "low"); val status = text("status", "pending")
        return JSONObject().apply {
            put("protocolVersion", VERSION); put("id", text("id", "task-${UUID.randomUUID()}")); put("title", text("title", "未命名任务"))
            put("kind", kind); put("sourceType", sourceType); put("sourceId", sourceId); put("sourceName", text("sourceName")); put("status", status)
            put("statusGroup", statusGroup(status)); put("trigger", text("trigger", "manual")); put("priority", text("priority", "normal")); put("riskLevel", risk)
            put("executor", text("executor", "local-agent")); put("requestedExecutor", text("requestedExecutor", "local-agent")); put("executionMode", text("executionMode", "automatic"))
            put("scheduledAt", text("scheduledAt")); put("deadlineAt", text("deadlineAt")); put("timeoutSeconds", input.optInt("timeoutSeconds", current?.optInt("timeoutSeconds", 900) ?: 900).coerceAtLeast(30))
            put("heartbeatTimeoutSeconds", input.optInt("heartbeatTimeoutSeconds", current?.optInt("heartbeatTimeoutSeconds", 180) ?: 180).coerceAtLeast(30))
            put("resultTimeoutSeconds", input.optInt("resultTimeoutSeconds", current?.optInt("resultTimeoutSeconds", 0) ?: 0).coerceAtLeast(0))
            put("idempotencyKey", text("idempotencyKey", "$kind:$sourceType:$sourceId:current")); put("completionPolicy", text("completionPolicy", "manual_review"))
            put("input", objectValue("input")); put("expectedOutput", objectValue("expectedOutput")); put("permissions", objectValue("permissions", JSONObject().put("read", JSONArray()).put("write", JSONArray()).put("operations", JSONArray())))
            put("detail", text("detail")); put("action", text("action")); put("count", input.optInt("count", current?.optInt("count", 0) ?: 0).coerceAtLeast(0))
            put("approval", objectValue("approval", JSONObject().put("required", risk == "high").put("status", if (risk == "high") "pending" else "not_required")))
            put("result", input.opt("result") ?: current?.opt("result") ?: JSONObject.NULL); put("attempt", input.optInt("attempt", current?.optInt("attempt", 0) ?: 0).coerceAtLeast(0))
            put("maxAttempts", input.optInt("maxAttempts", current?.optInt("maxAttempts", 3) ?: 3).coerceAtLeast(1)); put("retryBackoffSeconds", input.optInt("retryBackoffSeconds", current?.optInt("retryBackoffSeconds", 30) ?: 30).coerceAtLeast(0))
            put("autoRetry", if (input.has("autoRetry")) input.optBoolean("autoRetry") else current?.optBoolean("autoRetry", true) ?: true)
            put("routingMode", text("routingMode", "smart")); put("routeAttempts", input.optJSONArray("routeAttempts") ?: current?.optJSONArray("routeAttempts") ?: JSONArray())
            put("createdAt", current?.optString("createdAt").orEmpty().ifBlank { input.optString("createdAt", now) }); put("updatedAt", now)
            for (key in listOf("startedAt", "completedAt", "lastHeartbeatAt", "nextRetryAt", "executionId", "adapterId")) put(key, text(key))
            put("routeDecision", input.opt("routeDecision") ?: current?.opt("routeDecision") ?: JSONObject.NULL); put("error", input.opt("error") ?: current?.opt("error") ?: JSONObject.NULL)
        }
    }

    fun validatePermissions(task: JSONObject, operationAllowlist: Map<String, Set<String>>) {
        val permissions = task.getJSONObject("permissions")
        val reads = permissions.optJSONArray("read").strings(); val writes = permissions.optJSONArray("write").strings(); val operations = permissions.optJSONArray("operations").strings()
        (reads + writes).forEach(WorkspacePath::segments)
        if (task.optString("riskLevel") == "high") require(writes.isNotEmpty() && operations.isNotEmpty()) { "高风险任务必须声明写入范围和操作" }
        val allowed = operationAllowlist[task.optString("kind")]
        require(allowed == null || operations.all { it in allowed }) { "任务包含未允许操作" }
        val output = task.optJSONObject("expectedOutput")?.optString("path").orEmpty()
        if (output.isNotBlank()) require(writes.any { output == it || output.startsWith("${it.trimEnd('/')}/") }) { "预期产物超出声明写入范围" }
    }

    fun validateExternalResult(task: JSONObject, payload: JSONObject) {
        require(payload.optString("protocolVersion") == VERSION) { "PROTOCOL_MISMATCH" }
        require(payload.optString("taskId") == task.getString("id")) { "TASK_ID_MISMATCH" }
        require(payload.optString("executionId").isNotBlank() && payload.optString("executionId") == task.optString("executionId")) { "EXECUTION_ID_MISMATCH" }
        require(task.optString("status") in setOf("running", "waiting_result")) { "TASK_STATUS_MISMATCH" }
    }

    private fun statusGroup(status: String) = when (status) {
        "succeeded" -> "completed"; "failed", "cancelled", "timed_out" -> "ended"; "running", "waiting_result", "reviewing" -> "active"; else -> "pending"
    }
}
