package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

/** View states do not rename the shared Task Protocol 1.2 wire states. */
object TaskCenterPolicy {
    fun viewState(task: JSONObject): String {
        if (task.optJSONObject("error")?.optString("code") == "process_interrupted") return "needs_user"
        val approval = task.optJSONObject("approval")
        if (task.optString("status") == "pending" && approval?.optBoolean("required") == true && approval.optString("status") != "approved") return "needs_user"
        return when (task.optString("status")) {
            "draft", "pending", "approved", "queued" -> "queued"
            "running", "waiting_result", "reviewing" -> "running"
            "blocked", "timed_out" -> "needs_user"
            "completed" -> "succeeded"
            else -> task.optString("status").ifBlank { "needs_user" }
        }
    }
    fun label(state: String): String = when (state) {
        "queued" -> "等待处理"; "running" -> "处理中"; "waiting_network" -> "待联网"
        "waiting_quota" -> "等待额度"; "needs_user", "unknown" -> "需要核对"
        "succeeded" -> "已完成"; "failed" -> "处理失败"; "cancelled" -> "已取消"; "superseded" -> "已有新版本"
        else -> "需要处理"
    }
    fun visible(task: JSONObject, studentId: String, projectIds: Set<String>): Boolean {
        if (studentId.isBlank()) return false
        val owner = LegacyTaskCodec.studentId(task)
        return owner == studentId || (owner.isBlank() && LegacyTaskCodec.projectId(task) in projectIds)
    }
    fun canCancel(task: JSONObject, studentId: String) = LegacyTaskCodec.studentId(task) == studentId &&
        task.optString("status") in setOf("draft", "pending", "approved", "queued", "blocked")
}
