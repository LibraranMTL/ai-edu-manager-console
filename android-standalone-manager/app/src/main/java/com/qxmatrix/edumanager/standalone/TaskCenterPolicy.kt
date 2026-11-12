package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

/** View states do not rename the shared Task Protocol 1.2 wire states. */
object TaskCenterPolicy {
    fun viewState(task: JSONObject): String {
        if (task.optString("status") == "archived" && task.optJSONObject("result")?.optJSONObject("supersededReceipt") != null) return "superseded"
        if (requiresAttributionResolution(task)) return "needs_user"
        if (task.optJSONObject("error")?.optBoolean("attentionRequired") == true) return "needs_user"
        val approval = task.optJSONObject("approval")
        if (task.optString("status") == "pending" && approval?.optBoolean("required") == true && approval.optString("status") != "approved") return "queued"
        return when (task.optString("status")) {
            "draft", "pending", "approved", "queued" -> "queued"
            "running", "waiting_result", "reviewing" -> "running"
            "blocked", "timed_out", "needs_user", "unknown" -> "failed"
            "completed" -> "succeeded"
            else -> task.optString("status").ifBlank { "failed" }
        }
    }
    fun label(state: String): String = when (state) {
        "queued" -> "等待处理"; "running" -> "处理中"; "waiting_network" -> "待联网"
        "waiting_quota" -> "等待额度"; "needs_user" -> "需要处理"; "unknown" -> "等待系统确认"
        "succeeded" -> "已完成"; "failed" -> "处理失败"; "cancelled" -> "已取消"; "superseded" -> "已有新版本"
        else -> "需要处理"
    }
    fun requiresAttributionResolution(task: JSONObject): Boolean {
        if (task.optBoolean("attributionConflict") || task.optBoolean("studentAttributionConflict") ||
            task.optBoolean("projectAttributionConflict")) return true
        val error = task.optJSONObject("error")
        val code = sequenceOf(task.optString("errorCode"), task.optString("conflictType"),
            error?.optString("code").orEmpty()).map(String::lowercase)
        if (code.any { it in setOf("attribution_conflict", "student_attribution_conflict", "project_attribution_conflict",
                "student_scope_mismatch", "project_scope_mismatch", "scope_conflict", "subject_scope_mismatch") }) return true
        val message = listOf(task.optString("message"), error?.optString("message").orEmpty()).joinToString("\n")
        return Regex("归属(?:冲突|不一致|不明确)|不属于当前学生|未绑定当前学生|不得跨学生|学生范围不一致|项目范围不一致")
            .containsMatchIn(message)
    }
    fun visible(task: JSONObject, studentId: String, projectIds: Set<String>): Boolean {
        if (studentId.isBlank()) return false
        val owner = LegacyTaskCodec.studentId(task)
        return owner == studentId || (owner.isBlank() && LegacyTaskCodec.projectId(task) in projectIds)
    }
    fun canCancel(task: JSONObject, studentId: String) = LegacyTaskCodec.studentId(task) == studentId &&
        task.optString("status") in setOf("draft", "pending", "approved", "queued", "blocked")
}
