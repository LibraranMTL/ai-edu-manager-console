package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject

/** Student self-report only; never treated as an independent assessment. */
class StudentLearningState(context: Context) {
    private val students = StudentIndexRepository(context)
    private val storage = PrivateStateStore(context)
    private fun path(studentId: String) = "learning-self-report/${ScopedContentPolicy.hash(studentId.toByteArray())}.json"
    fun read(studentId: String): JSONObject? {
        students.requireExact(studentId)
        return storage.readIfPresent(path(studentId))?.let { bytes -> JSONObject(bytes.toString(Charsets.UTF_8)).also {
            require(it.getString("studentId") == studentId) { "学习状态学生范围不匹配" }
        } }
    }
    fun save(studentId: String, goal: String, state: String, problem: String = "", method: String = "", efficiency: String = ""): JSONObject {
        students.requireExact(studentId)
        val fields = listOf(goal, state, problem, method, efficiency)
        require(goal.length <= 1000 && fields.drop(1).all { it.length <= 2000 } && fields.any(String::isNotBlank)) { "请填写至少一项；目标不超过 1000 字，其余每项不超过 2000 字。" }
        val value = JSONObject().put("schema", "edu-manager.learning-self-report.v2").put("studentId", studentId)
            .put("goal", goal.trim()).put("state", state.trim()).put("problem", problem.trim())
            .put("method", method.trim()).put("efficiency", efficiency.trim()).put("kind", "self_report").put("updatedAt", Timestamp.now())
        storage.writeBytes(path(studentId), value.toString(2).toByteArray())
        return value
    }
}
