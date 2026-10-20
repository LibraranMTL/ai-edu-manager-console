package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class ProjectPaths(
    val projectRootPath: String, val managerPath: String, val workspacePath: String, val stagingPath: String,
    val knowledgeRootPath: String, val rawPath: String, val conceptPath: String, val entityPath: String,
    val summaryPath: String, val qaPath: String, val synthesisPath: String, val reportPath: String,
    val contributionPath: String, val agentPath: String, val outputPath: String,
) {
    companion object {
        fun managed(name: String): ProjectPaths {
            val clean = StudentNamePolicy.sanitize(name)
            val root = "学习项目/${clean}项目知识库"
            val knowledge = "$root/项目知识空间"
            return ProjectPaths(root, "$root/.edu-manager", "$root/项目工作空间", "$root/项目工作空间/研究暂存",
                knowledge, "$knowledge/${clean}项目原始资料库", "$knowledge/概念库", "$knowledge/实体库", "$knowledge/摘要库",
                "$knowledge/问答精华库", "$knowledge/综合汇总库", "$knowledge/项目报告", "$knowledge/知识贡献",
                "$root/AGENT.md", "$root/输出结果")
        }

        fun adoptedKnowledge(name: String, adopted: AdoptedKnowledgePaths): ProjectPaths {
            val clean = StudentNamePolicy.sanitize(name)
            val root = "学习项目/${clean}项目控制目录"
            return ProjectPaths(root, "$root/.edu-manager", "$root/项目工作空间", "$root/项目工作空间/研究暂存", "",
                adopted.rawPath, adopted.conceptPath, adopted.entityPath, adopted.summaryPath, adopted.qaPath,
                adopted.synthesisPath, adopted.reportPath, adopted.contributionPath, "$root/AGENT.md", "$root/输出结果")
        }
    }
}

data class AdoptedKnowledgePaths(
    val rawPath: String, val conceptPath: String, val entityPath: String, val summaryPath: String,
    val qaPath: String, val synthesisPath: String, val reportPath: String = "项目报告", val contributionPath: String = "知识贡献",
)

data class ProjectRecord(
    val id: String, val name: String, val type: String, val description: String, val objective: String,
    val studentIds: List<String>, val studentNames: List<String>, val status: String,
    val projectRootUri: String, val knowledgeRootUri: String, val workspaceRootUri: String,
    val workspaceMode: String, val knowledgeMode: String, val knowledgeSpaceId: String,
    val paths: ProjectPaths, val knowledgeAdoption: JSONObject?, val createdAt: String,
    val materialStorageMode: String = "legacy", val materialRegistryVersion: Int = 1,
    val materialMigrationState: String = "not_started",
    val agentTool: String = "workbuddy",
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("name", name); put("storageName", name); put("type", type)
        put("description", description); put("objective", objective); put("status", status)
        put("studentIds", JSONArray(studentIds)); put("studentNames", JSONArray(studentNames)); put("agentTool", agentTool)
        put("projectRootUri", projectRootUri); put("knowledgeRootUri", knowledgeRootUri); put("workspaceRootUri", workspaceRootUri)
        put("pathDialect", "android-saf-relative-v1")
        put("projectRootPath", paths.projectRootPath); put("managerPath", paths.managerPath); put("workspacePath", paths.workspacePath)
        put("workspaceMode", workspaceMode); put("stagingPath", paths.stagingPath); put("knowledgeRootPath", paths.knowledgeRootPath)
        put("knowledgeMode", knowledgeMode); put("knowledgeSpaceId", knowledgeSpaceId); put("knowledgeAdoption", knowledgeAdoption ?: JSONObject.NULL)
        put("rawPath", paths.rawPath); put("conceptPath", paths.conceptPath); put("entityPath", paths.entityPath)
        put("summaryPath", paths.summaryPath); put("qaPath", paths.qaPath); put("synthesisPath", paths.synthesisPath)
        put("reportPath", paths.reportPath); put("contributionPath", paths.contributionPath); put("agentPath", paths.agentPath); put("outputPath", paths.outputPath)
        put("workspaceTemplateId", "general"); put("workspaceTemplateName", "通用学习项目")
        put("workspaceFolders", JSONArray(listOf("资料", "进展", "团队成员", "成果")))
        put("knowledgeStrategy", "提取核心概念、关键实体、阶段摘要和可复用问答。")
        put("growthStrategy", "关注主动学习、问题解决和成果表达。")
        put("deliverables", JSONArray(listOf("项目总结", "最终成果")))
        put("studentEvidence", JSONArray()); put("assetIds", JSONArray()); put("stagingItems", JSONArray())
        put("materialStorageMode", materialStorageMode); put("materialRegistryVersion", materialRegistryVersion)
        put("materialMigrationState", materialMigrationState); put("inboxRelativePath", "收件箱")
        put("digestState", JSONObject().put("status", "idle").put("pendingCount", 0))
        put("automation", JSONObject().put("enabled", false).put("onWorkspaceChange", true).put("onStatusChange", false).put("intervalMinutes", 1440))
        put("promotionPath", child(paths.contributionPath, "知识贡献申请.md"))
        put("createdAt", createdAt); put("updatedAt", createdAt); put("archivedAt", ""); put("sealedAt", ""); put("publishedAt", "")
    }

    companion object {
        fun create(name: String, type: String, description: String, objective: String, students: List<StudentRecord>, baseUri: String, adoptedUri: String = "", adopted: AdoptedKnowledgePaths? = null, knowledgeSpaceId: String = "", adoption: JSONObject? = null): ProjectRecord {
            val clean = StudentNamePolicy.sanitize(name); val isAdopted = adopted != null; val now = Timestamp.now()
            return ProjectRecord("project-${UUID.randomUUID()}", clean, type.ifBlank { "学习项目" }, description.trim(), objective.trim(),
                students.map { it.id }, students.map { it.name }, "active", baseUri, if (isAdopted) adoptedUri else baseUri, baseUri,
                "managed", if (isAdopted) "adopted" else "managed", if (isAdopted) knowledgeSpaceId else "", if (isAdopted) ProjectPaths.adoptedKnowledge(clean, adopted!!) else ProjectPaths.managed(clean), adoption, now,
                materialStorageMode = "workspace-v1", materialRegistryVersion = 1, materialMigrationState = "complete")
        }

        fun fromJson(json: JSONObject): ProjectRecord = ProjectRecord(
            json.getString("id"), json.getString("name"), json.optString("type", "学习项目"), json.optString("description"), json.optString("objective"),
            json.optJSONArray("studentIds").strings(), json.optJSONArray("studentNames").strings(), json.optString("status", "active"),
            json.getString("projectRootUri"), json.optString("knowledgeRootUri", json.getString("projectRootUri")), json.optString("workspaceRootUri", json.getString("projectRootUri")),
            json.optString("workspaceMode", "managed"), json.optString("knowledgeMode", "managed"), json.optString("knowledgeSpaceId"),
            ProjectPaths(json.getString("projectRootPath"), json.getString("managerPath"), json.getString("workspacePath"), json.getString("stagingPath"), json.optString("knowledgeRootPath"),
                json.getString("rawPath"), json.getString("conceptPath"), json.getString("entityPath"), json.getString("summaryPath"), json.getString("qaPath"), json.getString("synthesisPath"),
                json.getString("reportPath"), json.getString("contributionPath"), json.getString("agentPath"), json.getString("outputPath")),
            json.optJSONObject("knowledgeAdoption"), json.optString("createdAt"),
            json.optString("materialStorageMode", "legacy"), json.optInt("materialRegistryVersion", 1),
            json.optString("materialMigrationState", "not_started"), json.optString("agentTool", "workbuddy"))

        private fun child(root: String, path: String) = if (root.isBlank()) path else "$root/$path"
    }
}
