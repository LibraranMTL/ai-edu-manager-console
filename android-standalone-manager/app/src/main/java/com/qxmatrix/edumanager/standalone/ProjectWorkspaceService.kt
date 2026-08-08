package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

data class ProjectKnowledgeScan(val ok: Boolean, val knowledgeSpaceId: String, val paths: AdoptedKnowledgePaths?, val missing: List<String>, val warnings: List<String>)

class ProjectWorkspaceService(private val context: Context) {
    private val projects = ProjectRepository(context)
    private val students = StudentIndexRepository(context)

    fun listProjects(): List<ProjectRecord> = projects.list()

    fun createManaged(name: String, type: String, description: String, objective: String, studentIds: List<String>, baseUri: Uri): ProjectRecord {
        val boundStudents = exactStudents(studentIds)
        val project = ProjectRecord.create(name, type, description, objective, boundStudents, baseUri.toString())
        projects.validateAdd(project)
        val controlStore = SafWorkspaceStore(context, baseUri)
        require(!controlStore.exists(project.paths.projectRootPath)) { "同名项目目录已存在，请选择接管已有项目知识库" }
        initializeControlAndWorkspace(controlStore, project, boundStudents)
        initializeManagedKnowledge(controlStore, project)
        projects.add(project)
        return project
    }

    fun scanAdoptedKnowledge(rootUri: Uri): ProjectKnowledgeScan {
        val store = SafWorkspaceStore(context, rootUri)
        val directories = store.listRoot().filter { it.isDirectory }.mapNotNull { it.name }
        fun find(names: List<String>, suffix: Boolean = false): String? = directories.firstOrNull { candidate ->
            names.any { candidate == it || (suffix && candidate.endsWith(it)) }
        }
        val raw = find(listOf("项目原始资料库", "原始资料库"), suffix = true)
        val concept = find(listOf("概念库")); val entity = find(listOf("实体库")); val summary = find(listOf("摘要库"))
        val qa = find(listOf("问答精华库", "问答库")); val synthesis = find(listOf("综合汇总库", "综合库"))
        val pairs = listOf("rawPath" to raw, "conceptPath" to concept, "entityPath" to entity, "summaryPath" to summary, "qaPath" to qa, "synthesisPath" to synthesis)
        val missing = pairs.filter { it.second == null }.map { it.first }
        val warnings = buildList {
            if (!store.exists("AGENT.md")) add("未发现 AGENT.md；接管后使用项目控制目录中的规则文件，不修改原知识库。")
            if (!store.exists("项目报告")) add("未发现项目报告目录。")
            if (!store.exists("知识贡献")) add("未发现知识贡献目录。")
        }
        val fingerprint = sha256((listOf(rootUri.toString()) + pairs.map { "${it.first}:${it.second}" }).sorted().joinToString("\n")).take(20)
        val paths = if (missing.isEmpty()) AdoptedKnowledgePaths(raw!!, concept!!, entity!!, summary!!, qa!!, synthesis!!,
            reportPath = if (store.exists("项目报告")) "项目报告" else "", contributionPath = if (store.exists("知识贡献")) "知识贡献" else "") else null
        return ProjectKnowledgeScan(missing.isEmpty(), "project-kb-$fingerprint", paths, missing, warnings)
    }

    fun adoptKnowledge(name: String, type: String, description: String, objective: String, studentIds: List<String>, controlBaseUri: Uri, knowledgeRootUri: Uri): Pair<ProjectRecord, ProjectKnowledgeScan> {
        val scan = scanAdoptedKnowledge(knowledgeRootUri)
        require(scan.ok && scan.paths != null) { "项目知识库缺少统一 Schema 目录：${scan.missing.joinToString()}" }
        val boundStudents = exactStudents(studentIds)
        val adoption = JSONObject().put("adoptedAt", Timestamp.now()).put("identitySource", "generated_compatibility_id")
            .put("warnings", JSONArray(scan.warnings)).put("originalFilesModified", false)
        val project = ProjectRecord.create(name, type, description, objective, boundStudents, controlBaseUri.toString(), knowledgeRootUri.toString(), scan.paths, scan.knowledgeSpaceId, adoption)
        projects.validateAdd(project)
        initializeControlAndWorkspace(SafWorkspaceStore(context, controlBaseUri), project, boundStudents)
        writeAdoptionRecords(SafWorkspaceStore(context, controlBaseUri), project, scan)
        projects.add(project)
        return project to scan
    }

    fun requireProject(projectId: String): ProjectRecord = projects.requireExact(projectId)

    private fun exactStudents(ids: List<String>): List<StudentRecord> = ids.distinct().map(students::requireExact)

    private fun initializeControlAndWorkspace(store: SafWorkspaceStore, project: ProjectRecord, boundStudents: List<StudentRecord>) {
        val p = project.paths
        listOf(p.projectRootPath, p.managerPath, p.workspacePath, p.stagingPath, p.outputPath, "${p.workspacePath}/资料", "${p.workspacePath}/进展", "${p.workspacePath}/团队成员", "${p.workspacePath}/成果").forEach(store::ensureDirectory)
        writeIfMissing(store, p.agentPath, projectAgent(project, boundStudents))
        writeIfMissing(store, "${p.workspacePath}/工作空间结构.md", workspaceIndex(project))
        writeIfMissing(store, "${p.managerPath}/绑定学生.md", bindingIndex(project, boundStudents))
    }

    private fun initializeManagedKnowledge(store: SafWorkspaceStore, project: ProjectRecord) {
        val p = project.paths
        listOf(p.knowledgeRootPath, p.rawPath, p.conceptPath, p.entityPath, p.summaryPath, p.qaPath, p.synthesisPath, p.reportPath, p.contributionPath).forEach(store::ensureDirectory)
        writeIfMissing(store, "${p.knowledgeRootPath}/index.md", "# ${project.name} 项目知识空间\n\n- 项目原始资料库：${p.rawPath}\n- 综合汇总库：${p.synthesisPath}\n- 知识贡献：${p.contributionPath}\n")
        writeIfMissing(store, "${p.knowledgeRootPath}/log.md", "# ${project.name} 项目处理日志\n\n")
    }

    private fun writeAdoptionRecords(store: SafWorkspaceStore, project: ProjectRecord, scan: ProjectKnowledgeScan) {
        val p = project.paths
        val pathmap = JSONObject().put("version", 1).put("projectId", project.id).put("knowledgeSpaceId", scan.knowledgeSpaceId).put("adoptedAt", Timestamp.now())
            .put("source", "adopted_project_knowledge_base").put("paths", JSONObject()
                .put("@PROJECT_ROOT", p.projectRootPath).put("@PROJECT_WORKSPACE", p.workspacePath).put("@PROJECT_KNOWLEDGE_ROOT", "@ADOPTED_KNOWLEDGE_ROOT")
                .put("@PROJECT_RAW", p.rawPath).put("@PROJECT_CONCEPTS", p.conceptPath).put("@PROJECT_ENTITIES", p.entityPath)
                .put("@PROJECT_SUMMARIES", p.summaryPath).put("@PROJECT_QA", p.qaPath).put("@PROJECT_SYNTHESIS", p.synthesisPath))
        store.writeBytesSafely("${p.managerPath}/adopted-knowledge-pathmap.json", (pathmap.toString(2) + "\n").toByteArray(), "application/json")
        val record = JSONObject().put("version", 1).put("projectId", project.id).put("knowledgeSpaceId", scan.knowledgeSpaceId)
            .put("adoptedAt", Timestamp.now()).put("sourceRoot", project.knowledgeRootUri).put("originalFilesModified", false)
            .put("rollback", "删除项目记录即可解除绑定；原知识库文件保持不变。")
        store.writeBytesSafely("${p.managerPath}/knowledge-adoption-record.json", (record.toString(2) + "\n").toByteArray(), "application/json")
    }

    private fun writeIfMissing(store: SafWorkspaceStore, path: String, text: String) {
        if (!store.exists(path)) store.writeBytesSafely(path, text.toByteArray(), "text/markdown")
    }

    private fun projectAgent(project: ProjectRecord, bound: List<StudentRecord>) = "# ${project.name} 项目教育管家 AGENT.md\n\n## 绑定学生\n\n${bound.joinToString("\n") { "- ${it.name}：${it.id}" }.ifBlank { "- 暂未绑定学生" }}\n\n## 工作规则\n\n1. 所有资料消化只围绕本项目知识空间执行，不直接写入学生主档案。\n2. 只有确认知识贡献申请后，才把项目结论发布到学生主档案或成长模型。\n3. 原始资料保留来源，不删除、移动或覆盖。\n4. 每次资料消化后更新项目 index.md 和 log.md。\n"
    private fun workspaceIndex(project: ProjectRecord) = "# ${project.name} 项目工作空间结构\n\n项目工作空间用于人工项目管理；研究暂存用于候选资料；项目知识空间固定遵循 LLM Wiki Schema。\n"
    private fun bindingIndex(project: ProjectRecord, bound: List<StudentRecord>) = "# ${project.name} 项目绑定学生\n\n${bound.joinToString("\n") { "- ${it.name}（${it.id}）" }.ifBlank { "暂无绑定学生。" }}\n"
    private fun sha256(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}
