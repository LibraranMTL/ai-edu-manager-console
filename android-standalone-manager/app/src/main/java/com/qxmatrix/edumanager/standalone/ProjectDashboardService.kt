package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException

class ProjectDashboardService(private val context: Context) {
    private val projects = ProjectRepository(context)
    private val materials = LocalProjectMaterialService(context)
    private val state = PrivateStateStore(context)

    fun dashboard(projectId: String): JSONObject {
        val project = projects.requireExact(projectId); val status = materials.status(projectId)
        val knowledge = runCatching { materials.knowledgeFiles(projectId).size }.getOrDefault(0)
        val contributions = runCatching { materials.contributionFiles(projectId).size }.getOrDefault(0)
        val outputs = outputCount(project); val task = runCatching { ProjectDigestQueue(context).latest(projectId) }.getOrNull()
        return JSONObject().put("projectId", projectId).put("studentId", project.studentIds.firstOrNull().orEmpty())
            .put("sourceId", projectId).put("time", Timestamp.now()).put("stage", project.status)
            .put("materials", status.optInt("materials")).put("pendingMaterials", status.optInt("pending"))
            .put("pendingDigest", status.optInt("digestPending")).put("knowledge", knowledge)
            .put("tasks", if (task == null) 0 else 1).put("taskStatus", task?.optString("status").orEmpty())
            .put("outputs", outputs).put("contributions", contributions).put("pendingItems", closeChecklist(projectId))
            .let { it.put("contentFingerprint", ScopedContentPolicy.fingerprint(it)) }
    }

    fun closeChecklist(projectId: String): JSONArray {
        val project = projects.requireExact(projectId); val issues = JSONArray(); val status = materials.status(projectId)
        fun add(id: String, title: String, detail: String) { issues.put(JSONObject().put("id", id).put("title", title).put("detail", detail)) }
        if (status.optInt("pending") > 0) add("materials", "待处理资料", "${status.optInt("pending")} 份资料尚未确认分类")
        if (status.optInt("digestPending") > 0) add("digest", "未完成知识处理", "${status.optInt("digestPending")} 份资料尚未完成消化")
        val task = runCatching { ProjectDigestQueue(context).latest(projectId) }.getOrNull()
        if (task?.optString("status") in setOf("queued", "running", "needs_user", "failed")) add("task", "项目任务未结束", task?.optString("message").orEmpty())
        val pendingKnowledge = project.studentIds.sumOf { studentId ->
            ScopedContentRepository(context).list(studentId, listOf("artifact", "inbox_candidate"), 100, 0).count { it.projectId == projectId && it.state == "candidate" }
        }
        if (pendingKnowledge > 0) add("knowledge", "未确认知识", "$pendingKnowledge 条候选尚未确认")
        if (outputCount(project) == 0) add("outputs", "成果未确认", "项目输出目录还没有成果文件")
        val cloudNeedsHelp = project.studentIds.map { CloudReportSync(context).status(it) }.any { it.configured && (it.lastError.isNotBlank() || it.pendingServerState.isNotBlank()) }
        if (cloudNeedsHelp) add("sync", "同步状态待核对", "至少一名学生存在失败或待送达状态")
        if (!backupRecorded(projectId)) add("backup", "备份未确认", "请先导出一次显式项目包")
        return issues
    }

    fun close(projectId: String): ProjectRecord {
        val issues = closeChecklist(projectId); require(issues.length() == 0) { "还有 ${issues.length()} 项关闭检查未完成" }
        val updated = projects.requireExact(projectId).copy(status = "closed"); projects.update(updated); return updated
    }

    fun recordBackup(projectId: String) {
        val project = projects.requireExact(projectId); val payload = JSONObject().put("projectId", projectId).put("sourceId", "project-export:$projectId")
            .put("time", Timestamp.now()).put("studentIds", JSONArray(project.studentIds))
        payload.put("contentFingerprint", ScopedContentPolicy.fingerprint(payload))
        state.writeBytes(path(projectId), payload.toString(2).toByteArray())
    }

    private fun outputCount(project: ProjectRecord) = runCatching {
        SafWorkspaceStore(context, Uri.parse(project.projectRootUri)).listFiles(project.paths.outputPath, 500, maximumDepth = 12).size
    }.getOrDefault(0)
    private fun backupRecorded(projectId: String) = try { JSONObject(state.readBytes(path(projectId)).toString(Charsets.UTF_8)).optString("projectId") == projectId }
        catch (_: FileNotFoundException) { false }
    private fun path(projectId: String) = "project-dashboard/$projectId-backup.json"
}
