package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Digests one explicitly saved Agent conversation without crossing its student/project scope. */
class ConversationDigestService(private val context: Context) {
    private val conversations = ConversationImportService(context)
    private val students = StudentIndexRepository(context)
    private val projects = ProjectRepository(context)
    private val tasks = TaskRepository(context)

    fun digest(recordId: String): JSONObject {
        val record = conversations.requireExact(recordId)
        require(record.optString("digestStatus") !in setOf("running", "completed")) { "该对话正在消化或已经完成消化" }
        val content = conversations.readContent(recordId).take(MAX_PROMPT_CHARS)
        val project = record.optString("scopeType").takeIf { it == "project" }?.let { projects.requireExact(record.getString("scopeId")) }
        val student = students.requireExact(record.getString("studentId"))
        require(project == null || student.id in project.studentIds) { "所选项目未绑定当前学生" }
        val outputRoot = project?.paths?.summaryPath ?: "${student.paths.summaryPath}/摘要库"
        val taskKind = if (project == null) "student_digest" else "project_digest"
        val task = tasks.create(JSONObject()
            .put("title", "${record.optString("sourceAgent")} 对话消化")
            .put("kind", taskKind).put("sourceType", "conversation").put("sourceId", recordId)
            .put("sourceName", record.optString("sourceAgent")).put("status", "pending")
            .put("riskLevel", "medium").put("completionPolicy", "validated_result")
            .put("count", 1).put("input", JSONObject().put("recordId", recordId).put("studentId", student.id).put("projectId", project?.id.orEmpty()))
            .put("expectedOutput", JSONObject().put("path", outputRoot).put("format", "markdown+candidate-knowledge"))
            .put("permissions", JSONObject()
                .put("read", JSONArray(listOf(project?.paths?.agentPath ?: student.paths.agentPath, project?.paths?.rawPath ?: student.paths.rawPath)))
                .put("write", JSONArray(if (project == null) listOf(student.paths.summaryPath, child(student.paths.rootPath, ".edu-manager/knowledge-engine-v1")) else listOf(project.paths.summaryPath, project.paths.conceptPath, project.paths.entityPath, project.paths.qaPath)))
                .put("operations", JSONArray(if (project == null) listOf("read_file", "write_knowledge", "update_index") else listOf("read_file", "write_project_knowledge", "update_index")))))
        val running = tasks.start(task.getString("id")); val executionId = running.getString("executionId")
        conversations.markDigestState(recordId, "running")
        return try {
            val rules = if (project == null) {
                SafWorkspaceStore(context, Uri.parse(student.storageRootUri)).readBytes(student.paths.agentPath).toString(Charsets.UTF_8)
            } else {
                SafWorkspaceStore(context, Uri.parse(project.projectRootUri)).readBytes(project.paths.agentPath).toString(Charsets.UTF_8)
            }
            val config = requireNotNull(AgentConfigurationStore(context).load()) { "尚未配置 Agent 模型" }
            val response = OpenAiCompatibleAgentAdapter(config).execute(
                "你是 AI 教育管家的对话消化 Agent。严格遵守 AGENT.md，只形成有来源、可审核的候选知识；只输出 JSON。",
                buildPrompt(record, student, project, rules, content),
            )
            val parsed = parseJsonResponse(response)
            val artifactPath = if (project == null) digestStudent(record, student, parsed, content, executionId)
                else digestProject(record, project, parsed, executionId)
            conversations.markDigestState(recordId, "completed", artifactPath)
            val result = resultPayload(task.getString("id"), executionId, true, "对话消化完成", artifactPath)
            tasks.acceptResult(task.getString("id"), result)
            JSONObject().put("ok", true).put("recordId", recordId).put("artifactPath", artifactPath).put("task", tasks.requireExact(task.getString("id")))
        } catch (error: Throwable) {
            conversations.markDigestState(recordId, "failed", error = error.message ?: "对话消化失败")
            runCatching { tasks.acceptResult(task.getString("id"), resultPayload(task.getString("id"), executionId, false, error.message ?: "对话消化失败", "")) }
            throw error
        }
    }

    private fun digestStudent(record: JSONObject, student: StudentRecord, parsed: JSONObject, content: String, executionId: String): String {
        val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
        val artifactPath = "${student.paths.summaryPath}/摘要库/对话消化-$executionId.md"
        store.writeBytesSafely(artifactPath, digestMarkdown(record, parsed).toByteArray(), "text/markdown")
        updateIndexAndLog(store, "${student.paths.summaryPath}/index.md", "${student.paths.summaryPath}/log.md", artifactPath)
        val engine = StudentWorkspaceService(context).knowledgeEngine(student.id)
        val sourceUri = "edu://student/${student.id}/conversation/${record.getString("recordId")}"
        engine.importAsset(JSONObject().put("id", "source-${record.getString("contentHash").take(32)}")
            .put("uri", sourceUri).put("title", "${record.optString("sourceAgent")} 对话")
            .put("mediaType", "text/markdown").put("content", content))
        val claims = parsed.optJSONArray("claims") ?: JSONArray()
        for (index in 0 until claims.length()) {
            val candidate = claims.optJSONObject(index) ?: continue
            val predicate = candidate.optString("predicate").trim(); val value = candidate.optString("value").trim()
            if (predicate.isBlank() || value.isBlank()) continue
            val evidence = JSONArray().put(JSONObject().put("id", "evidence-${UUID.randomUUID()}")
                .put("sourceUri", sourceUri).put("excerpt", candidate.optString("excerpt")).put("observedAt", Timestamp.now()))
            engine.upsertClaim(JSONObject().put("id", "claim-${UUID.randomUUID()}").put("subjectId", student.id)
                .put("predicate", predicate).put("value", value).put("status", "candidate")
                .put("confidence", candidate.optString("confidence", "unknown")).put("evidence", evidence).put("generatedBy", "local-agent-conversation-digest"))
        }
        return artifactPath
    }

    private fun digestProject(record: JSONObject, project: ProjectRecord, parsed: JSONObject, executionId: String): String {
        val store = SafWorkspaceStore(context, Uri.parse(project.knowledgeRootUri))
        val artifactPath = "${project.paths.summaryPath}/对话消化-$executionId.md"
        store.writeBytesSafely(artifactPath, digestMarkdown(record, parsed).toByteArray(), "text/markdown")
        writeListArtifact(store, project.paths.conceptPath, "对话概念-$executionId.md", "概念", parsed.optJSONArray("concepts"))
        writeListArtifact(store, project.paths.entityPath, "对话实体-$executionId.md", "实体", parsed.optJSONArray("entities"))
        val qa = parsed.optJSONArray("qa") ?: JSONArray()
        if (qa.length() > 0) {
            val body = buildString {
                appendLine("# 对话问答精华"); appendLine()
                for (index in 0 until qa.length()) qa.optJSONObject(index)?.let { appendLine("## ${it.optString("question")}"); appendLine(); appendLine(it.optString("answer")); appendLine() }
            }
            store.writeBytesSafely("${project.paths.qaPath}/对话问答-$executionId.md", body.toByteArray(), "text/markdown")
        }
        val knowledgeRoot = project.paths.knowledgeRootPath
        updateIndexAndLog(store, child(knowledgeRoot, "index.md"), child(knowledgeRoot, "log.md"), artifactPath)
        return artifactPath
    }

    private fun writeListArtifact(store: SafWorkspaceStore, root: String, filename: String, title: String, values: JSONArray?) {
        val items = values.strings(); if (items.isEmpty()) return
        store.writeBytesSafely("$root/$filename", ("# $title\n\n" + items.joinToString("\n") { "- $it" } + "\n").toByteArray(), "text/markdown")
    }

    private fun updateIndexAndLog(store: SafWorkspaceStore, indexPath: String, logPath: String, artifactPath: String) {
        val index = if (store.exists(indexPath)) store.readBytes(indexPath).toString(Charsets.UTF_8).trimEnd() else "# 知识索引"
        val log = if (store.exists(logPath)) store.readBytes(logPath).toString(Charsets.UTF_8).trimEnd() else "# 处理日志"
        store.writeBytesSafely(indexPath, (index + "\n\n- [${Timestamp.now()}] $artifactPath\n").toByteArray(), "text/markdown")
        store.writeBytesSafely(logPath, (log + "\n- ${Timestamp.now()}：完成 Agent 对话消化，产物 $artifactPath。\n").toByteArray(), "text/markdown")
    }

    private fun buildPrompt(record: JSONObject, student: StudentRecord, project: ProjectRecord?, rules: String, content: String) = """
        学生 ID：${student.id}
        对话来源：${record.optString("sourceAgent")}
        归属范围：${if (project == null) "学生档案 ${student.name}" else "学习项目 ${project.name}"}

        AGENT.md：
        $rules

        对话原文：
        $content

        返回格式：
        {"summary":"摘要","concepts":["概念"],"entities":["实体"],"qa":[{"question":"问题","answer":"答案"}],"claims":[{"predicate":"声明类型","value":"候选判断","confidence":"low|medium|high","excerpt":"原文证据"}]}
        claims 只能是 candidate；没有原文证据就不要生成。不得输出人格、能力或诊断性标签。项目对话不得直接写入学生主档案。
    """.trimIndent()

    private fun digestMarkdown(record: JSONObject, parsed: JSONObject) = """
        # ${record.optString("sourceAgent")} 对话消化结果

        生成时间：${Timestamp.now()}
        原文 SHA-256：${record.optString("contentHash")}

        ## 摘要

        ${parsed.optString("summary")}

        ## 概念

        ${parsed.optJSONArray("concepts").strings().joinToString("\n") { "- $it" }}

        ## 实体

        ${parsed.optJSONArray("entities").strings().joinToString("\n") { "- $it" }}

        ## 说明

        本结果属于候选知识，需结合不可变对话原文审核后使用。
    """.trimIndent() + "\n"

    private fun parseJsonResponse(text: String): JSONObject {
        val cleaned = text.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        val start = cleaned.indexOf('{'); val end = cleaned.lastIndexOf('}')
        require(start >= 0 && end > start) { "Agent 未返回有效 JSON" }
        return JSONObject(cleaned.substring(start, end + 1))
    }

    private fun resultPayload(taskId: String, executionId: String, passed: Boolean, message: String, artifactPath: String) = JSONObject()
        .put("protocolVersion", TaskProtocol.VERSION).put("taskId", taskId).put("executionId", executionId)
        .put("status", if (passed) "completed" else "failed").put("message", message)
        .put("artifacts", JSONArray().also { if (artifactPath.isNotBlank()) it.put(JSONObject().put("path", artifactPath)) })
        .put("validation", JSONObject().put("passed", passed))

    private fun child(root: String, path: String) = if (root.isBlank()) path else "$root/$path"

    companion object { private const val MAX_PROMPT_CHARS = 100_000 }
}
