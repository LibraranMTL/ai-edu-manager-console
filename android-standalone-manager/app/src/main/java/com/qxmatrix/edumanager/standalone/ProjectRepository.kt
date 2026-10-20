package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class ProjectRepository(context: Context) {
    private val state = PrivateStateStore(context)
    fun list(): List<ProjectRecord> = synchronized(LOCK) {
        val bytes = state.readIfPresent(PATH) ?: return@synchronized emptyList()
        val array = JSONObject(bytes.toString(Charsets.UTF_8)).getJSONArray("projects")
        List(array.length()) { ProjectRecord.fromJson(array.getJSONObject(it)) }.also { projects ->
            require(projects.all { it.id.isNotBlank() } && projects.map { it.id }.distinct().size == projects.size) { "项目索引包含空白或重复 ID，停止写入" }
        }
    }

    fun validateAdd(project: ProjectRecord) {
        val current = list()
        require(current.none { it.name == project.name }) { "同名学习项目已存在" }
        require(project.knowledgeMode != "adopted" || current.none { it.knowledgeMode == "adopted" && it.knowledgeRootUri == project.knowledgeRootUri }) { "该项目知识库已被其他项目接管" }
    }

    fun add(project: ProjectRecord) = synchronized(LOCK) {
        validateAdd(project)
        val root = JSONObject().put("version", 1).put("updatedAt", Timestamp.now())
            .put("projects", JSONArray().also { array -> (listOf(project) + list()).forEach { array.put(it.toJson()) } })
        state.writeBytes(PATH, (root.toString(2) + "\n").toByteArray())
    }

    fun addImportedIdempotent(project: ProjectRecord) = synchronized(LOCK) {
        val current = list()
        val existing = current.singleOrNull { it.id == project.id }
        if (existing != null) {
            require(existing.name == project.name && existing.projectRootUri == project.projectRootUri) { "相同项目 ID 已被其他项目使用" }
            return@synchronized
        }
        add(project)
    }

    fun detachStudent(studentId: String) = synchronized(LOCK) {
        val current = list()
        val next = current.map { project ->
            if (studentId !in project.studentIds) project else project.copy(
                studentIds = project.studentIds.filterNot { it == studentId },
                studentNames = project.studentIds.filterNot { it == studentId }.mapNotNull { id ->
                    StudentIndexRepository(context = appContext).list().singleOrNull { it.id == id }?.name
                },
            )
        }
        writeAll(next)
    }

    fun requireExact(projectId: String): ProjectRecord = list().singleOrNull { it.id == projectId }
        ?: throw NoSuchElementException("未找到指定项目 ID：$projectId")

    fun update(project: ProjectRecord) = synchronized(LOCK) {
        val current = list()
        require(current.any { it.id == project.id }) { "未找到指定项目 ID：${project.id}" }
        writeAll(current.map { if (it.id == project.id) project else it })
    }

    private val appContext: Context = context.applicationContext

    private fun writeAll(projects: List<ProjectRecord>) {
        val root = JSONObject().put("version", 1).put("updatedAt", Timestamp.now())
            .put("projects", JSONArray().also { array -> projects.forEach { array.put(it.toJson()) } })
        state.writeBytes(PATH, (root.toString(2) + "\n").toByteArray())
    }

    companion object { private const val PATH = "projects.json"; private val LOCK = Any() }
}
