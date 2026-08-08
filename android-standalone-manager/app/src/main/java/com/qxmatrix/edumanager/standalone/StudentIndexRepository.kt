package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray

/** The Windows students.json array contract, stored atomically in app-private state. */
class StudentIndexRepository(context: Context) {
    private val stateStore = PrivateStateStore(context)
    private val licenseManager = LicenseManager(context)

    fun list(): List<StudentRecord> = try {
        val values = JSONArray(stateStore.readBytes(INDEX_PATH).toString(Charsets.UTF_8))
        buildList {
            for (index in 0 until values.length()) add(StudentRecord.fromJson(values.getJSONObject(index)))
        }
    } catch (_: Exception) {
        emptyList()
    }

    fun add(record: StudentRecord): List<StudentRecord> {
        val current = list()
        validateAdd(record, current)
        val next = current + record
        write(next)
        return next
    }

    fun validateAdd(record: StudentRecord) {
        validateAdd(record, list())
    }

    private fun validateAdd(record: StudentRecord, current: List<StudentRecord>) {
        licenseManager.requireCanAddStudent(current.size)
        require(current.none { it.id == record.id }) { "学生 ID 已存在" }
        require(current.none { it.name == record.name }) { "同名学生档案已存在" }
        require(record.knowledgeBaseMode != "adopted" || current.none {
            it.knowledgeBaseMode == "adopted" && it.storageRootUri == record.storageRootUri
        }) { "该已有目录已被另一名学生档案接管" }
    }

    fun requireExact(studentId: String): StudentRecord = list().singleOrNull { it.id == studentId }
        ?: throw NoSuchElementException("未找到指定学生 ID：$studentId")

    private fun write(students: List<StudentRecord>) {
        val array = JSONArray()
        students.forEach { array.put(it.toJson()) }
        stateStore.writeBytes(INDEX_PATH, array.toString(2).toByteArray(Charsets.UTF_8))
    }

    companion object {
        private const val INDEX_PATH = "students.json"
    }
}
