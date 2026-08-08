package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri

class ControlledFileTools(private val context: Context) {
    private val tasks = TaskRepository(context)
    private val students = StudentIndexRepository(context)

    fun readStudentFile(taskId: String, executionId: String, studentId: String, logicalPath: String, operation: String = "read_file"): ByteArray {
        val student = students.requireExact(studentId)
        val task = tasks.authorize(taskId, executionId, operation, logicalPath, write = false)
        require(task.optString("sourceId") == student.id || task.optJSONObject("input")?.optString("studentId") == student.id) { "任务与学生范围不一致" }
        return SafWorkspaceStore(context, Uri.parse(student.storageRootUri)).readBytes(logicalPath)
    }

    fun writeStudentFile(taskId: String, executionId: String, studentId: String, logicalPath: String, bytes: ByteArray, mimeType: String, operation: String): String {
        val student = students.requireExact(studentId)
        val task = tasks.authorize(taskId, executionId, operation, logicalPath, write = true)
        require(task.optString("sourceId") == student.id || task.optJSONObject("input")?.optString("studentId") == student.id) { "任务与学生范围不一致" }
        SafWorkspaceStore(context, Uri.parse(student.storageRootUri)).writeBytesSafely(logicalPath, bytes, mimeType)
        return logicalPath
    }
}
