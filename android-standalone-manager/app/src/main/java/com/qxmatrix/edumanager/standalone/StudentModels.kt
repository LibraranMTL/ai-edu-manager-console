package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

data class StudentWorkspacePaths(
    val rootPath: String,
    val rawPath: String,
    val summaryPath: String,
    val agentPath: String,
    val outputPath: String,
) {
    companion object {
        fun standard(studentName: String): StudentWorkspacePaths {
            val cleanName = StudentNamePolicy.sanitize(studentName)
            val root = "${cleanName}知识库"
            return inside(root, cleanName)
        }

        fun adopted(studentName: String): StudentWorkspacePaths = inside("", StudentNamePolicy.sanitize(studentName))

        private fun inside(root: String, cleanName: String): StudentWorkspacePaths {
            fun child(name: String) = if (root.isBlank()) name else "$root/$name"
            return StudentWorkspacePaths(
                rootPath = root,
                rawPath = child("${cleanName}原始资料库"),
                summaryPath = child("${cleanName}学情分析汇总"),
                agentPath = child("AGENT.md"),
                outputPath = child("输出结果"),
            )
        }
    }
}

object StudentNamePolicy {
    fun sanitize(value: String): String = value
        .replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "")
        .replace(Regex("\\s+"), " ")
        .trim()
        .take(60)
        .also { require(it.isNotBlank()) { "学生姓名不能为空或只包含非法字符" } }
}

data class StudentRecord(
    val id: String,
    val name: String,
    val grade: String,
    val school: String,
    val goal: String,
    val knowledgeBaseMode: String,
    val storageRootUri: String,
    val paths: StudentWorkspacePaths,
    val adoptedAt: String,
    val createdAt: String,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("loginId", "")
        put("loginIdVersion", 1)
        put("loginIdIssuedAt", "")
        put("name", name)
        put("grade", grade)
        put("school", school)
        put("phone", "")
        put("email", "")
        put("goal", goal)
        put("digestTime", "21:30")
        put("agentTool", "qclaw")
        put("agentBindingMode", "subAgent")
        put("agentName", "")
        put("agentNote", "")
        put("knowledgeBaseMode", knowledgeBaseMode)
        put("storageRootUri", storageRootUri)
        put("pathDialect", "android-saf-relative-v1")
        put("rootPath", paths.rootPath)
        put("rawPath", paths.rawPath)
        put("summaryPath", paths.summaryPath)
        put("agentPath", paths.agentPath)
        put("outputPath", paths.outputPath)
        put("memoryConfig", JSONObject().put("unifiedMemoryPath", child(paths.rootPath, "Agent记忆/UnifiedMemory.md")).put("lastMergedAt", "").put("sources", JSONArray()))
        put("soulConfig", JSONObject().put("unifiedSoulPath", child(paths.rootPath, "Agent设定/UnifiedSoul.md")).put("lastDistributedAt", "").put("sources", JSONArray()))
        put("templateProfile", JSONObject().put("activeTemplate", "system").put("customTemplatePath", ""))
        put("materialSources", JSONArray())
        put("adoptedAt", adoptedAt)
        put("remoteChannel", "none")
        put("remoteContact", "")
        put("remoteNote", "")
        put("remoteBindingStatus", "unbound")
        put("remoteBoundAt", "")
        put("createdAt", createdAt)
    }

    companion object {
        fun create(
            name: String,
            grade: String,
            school: String,
            goal: String,
            mode: String,
            storageRootUri: String,
        ): StudentRecord {
            val cleanName = StudentNamePolicy.sanitize(name)
            val now = utcTimestamp()
            val adopted = mode == "adopted"
            return StudentRecord(
                id = "student-${UUID.randomUUID()}",
                name = cleanName,
                grade = grade.trim(),
                school = school.trim(),
                goal = goal.trim(),
                knowledgeBaseMode = if (adopted) "adopted" else "standard",
                storageRootUri = storageRootUri,
                paths = if (adopted) StudentWorkspacePaths.adopted(cleanName) else StudentWorkspacePaths.standard(cleanName),
                adoptedAt = if (adopted) now else "",
                createdAt = now,
            )
        }

        fun imported(
            id: String,
            name: String,
            grade: String,
            school: String,
            goal: String,
            storageRootUri: String,
            paths: StudentWorkspacePaths,
        ): StudentRecord {
            require(id.isNotBlank()) { "迁移学生 ID 不能为空" }
            val now = utcTimestamp()
            return StudentRecord(
                id = id.trim(),
                name = StudentNamePolicy.sanitize(name),
                grade = grade.trim(),
                school = school.trim(),
                goal = goal.trim(),
                knowledgeBaseMode = "adopted",
                storageRootUri = storageRootUri,
                paths = paths,
                adoptedAt = now,
                createdAt = now,
            )
        }

        fun fromJson(value: JSONObject): StudentRecord {
            val mode = if (value.optString("knowledgeBaseMode") == "adopted") "adopted" else "standard"
            val name = StudentNamePolicy.sanitize(value.getString("name"))
            return StudentRecord(
                id = value.getString("id"),
                name = name,
                grade = value.optString("grade"),
                school = value.optString("school"),
                goal = value.optString("goal"),
                knowledgeBaseMode = mode,
                storageRootUri = value.getString("storageRootUri"),
                paths = StudentWorkspacePaths(
                    rootPath = value.optString("rootPath"),
                    rawPath = value.optString("rawPath"),
                    summaryPath = value.optString("summaryPath"),
                    agentPath = value.optString("agentPath"),
                    outputPath = value.optString("outputPath"),
                ),
                adoptedAt = value.optString("adoptedAt"),
                createdAt = value.optString("createdAt"),
            )
        }

        private fun child(root: String, relative: String): String = if (root.isBlank()) relative else "$root/$relative"

        private fun utcTimestamp(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())
    }
}
