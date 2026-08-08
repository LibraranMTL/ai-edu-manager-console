package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class TaskProtocolTest {
    @Test
    fun usesProtocol12AndRequiresReviewBeforeSuccess() {
        assertEquals("1.2", TaskProtocol.VERSION)
        TaskProtocol.validateTransition("running", "reviewing")
        TaskProtocol.validateTransition("reviewing", "succeeded")
        assertThrows(IllegalArgumentException::class.java) { TaskProtocol.validateTransition("running", "succeeded") }
    }

    @Test
    fun rejectsMismatchedExternalResultIdentity() {
        val task = task().put("status", "running").put("executionId", "execution-1")
        val valid = JSONObject().put("protocolVersion", "1.2").put("taskId", "task-1").put("executionId", "execution-1")
        TaskProtocol.validateExternalResult(task, valid)
        assertThrows(IllegalArgumentException::class.java) { TaskProtocol.validateExternalResult(task, JSONObject(valid.toString()).put("executionId", "old")) }
        assertThrows(IllegalArgumentException::class.java) { TaskProtocol.validateExternalResult(task, JSONObject(valid.toString()).put("protocolVersion", "1.1")) }
    }

    @Test
    fun validatesSafLogicalPermissionBoundariesAndOperations() {
        val task = task().put("kind", "student_digest").put("riskLevel", "high")
            .put("permissions", JSONObject().put("read", JSONArray(listOf("学生甲知识库/学生甲原始资料库")))
                .put("write", JSONArray(listOf("学生甲知识库/学生甲学情分析汇总")))
                .put("operations", JSONArray(listOf("read_file", "write_knowledge"))))
            .put("expectedOutput", JSONObject().put("path", "学生甲知识库/学生甲学情分析汇总/摘要.md"))
        TaskProtocol.validatePermissions(task, mapOf("student_digest" to setOf("read_file", "write_knowledge")))
        task.getJSONObject("permissions").put("read", JSONArray(listOf("../other-student")))
        assertThrows(IllegalArgumentException::class.java) { TaskProtocol.validatePermissions(task, emptyMap()) }
    }

    private fun task() = TaskProtocol.envelope(JSONObject().put("id", "task-1").put("title", "测试").put("kind", "student_digest")
        .put("permissions", JSONObject().put("read", JSONArray(listOf("safe/read"))).put("write", JSONArray(listOf("safe/write"))).put("operations", JSONArray())))
}
