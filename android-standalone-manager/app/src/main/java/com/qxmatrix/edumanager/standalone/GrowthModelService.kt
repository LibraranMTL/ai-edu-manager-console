package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

data class LearningReportDefinition(val id: String, val title: String, val fileName: String, val type: String, val target: String, val summaryHeading: String, val sections: List<String>)

class GrowthModelService(private val context: Context) {
    private val students = StudentIndexRepository(context)
    private val projects = ProjectRepository(context)

    fun ensure(studentId: String): JSONObject {
        val student = students.requireExact(studentId); val store = store(student); val growth = growthRoot(student); val report = reportRoot(student)
        store.ensureDirectory(growth); store.ensureDirectory(report); store.ensureDirectory(draftRoot(student))
        val files = mapOf(
            "$growth/index.md" to "# ${student.name} 成长模型\n\n本目录是学生长期成长数据层。学情报告只引用这里的已确认结论，不反向替代成长模型。\n\n- 能力画像：能力画像.md\n- 项目贡献：项目贡献.md\n- 成长证据：成长证据.md\n- 成长证据草稿：成长证据草稿.md\n- 结构化索引：growth-index.json\n",
            "$growth/能力画像.md" to "# ${student.name} 能力画像\n\n## 学术能力\n\n- 待补充。\n\n## 通用能力\n\n- 待补充。\n\n## 兴趣方向\n\n- 待补充。\n\n## 可信度说明\n\n- 每条判断应标注证据来源、项目来源和更新时间。\n",
            "$growth/成长证据.md" to "# ${student.name} 成长证据\n\n| 日期 | 证据 | 来源资料/项目 | 支撑能力 | 可信度 |\n| --- | --- | --- | --- | --- |\n",
            "$growth/成长证据草稿.md" to "# ${student.name} 成长证据草稿\n\n候选成长证据需经本机用户确认后再沉淀为稳定成长模型。\n",
            "$growth/项目贡献.md" to "# ${student.name} 项目贡献\n\n| 日期 | 项目 | 贡献内容 | 动作 | 来源路径 |\n| --- | --- | --- | --- | --- |\n",
        )
        files.forEach { (path, content) -> writeIfMissing(store, path, content) }
        REPORTS.forEach { definition -> writeIfMissing(store, "$report/${definition.fileName}", reportTemplate(student, definition)) }
        if (!store.exists("$growth/成长证据审核.json")) writeJson(store, "$growth/成长证据审核.json", JSONObject().put("version", 1).put("updatedAt", "").put("candidates", JSONArray()))
        return JSONObject().put("ok", true).put("growthDir", growth).put("reportDir", report)
    }

    fun addCandidate(studentId: String, title: String, ability: String, sourceUri: String, content: String, confidence: String = "unknown", projectId: String = ""): JSONObject {
        val student = students.requireExact(studentId); require(title.isNotBlank()) { "成长证据标题不能为空" }; require(sourceUri.isNotBlank()) { "成长证据必须提供来源 URI" }
        if (projectId.isNotBlank()) require(projects.requireExact(projectId).studentIds.contains(studentId)) { "项目未绑定当前学生" }
        ensure(studentId); val review = readReview(student); val now = Timestamp.now()
        val candidate = JSONObject().put("schema", "edu-manager.growth-evidence.v1").put("protocolVersion", ProtocolBaseline.EDUCATION_DOMAIN_PROTOCOL_VERSION)
            .put("id", "growth-evidence-${UUID.randomUUID()}").put("studentId", student.id).put("studentName", student.name)
            .put("title", title.trim()).put("content", content.trim()).put("status", "pending").put("ability", ability.trim().ifBlank { "待标注" })
            .put("sourceUri", sourceUri.trim()).put("sourcePath", sourceUri.trim()).put("originalSourcePath", sourceUri.trim())
            .put("projectId", projectId).put("projectName", if (projectId.isBlank()) "" else projects.requireExact(projectId).name)
            .put("confidence", confidence).put("createdAt", now).put("updatedAt", now).put("review", JSONObject().put("status", "pending"))
        review.getJSONArray("candidates").put(candidate); writeReview(student, review); appendDraftCandidate(student, candidate); rebuildIndex(studentId)
        return candidate
    }

    fun candidates(studentId: String): List<JSONObject> { val student = students.requireExact(studentId); ensure(studentId); return readReview(student).getJSONArray("candidates").toObjects() }

    fun reviewCandidate(studentId: String, evidenceId: String, status: String, note: String): JSONObject {
        require(status in EVIDENCE_STATUSES) { "不支持的成长证据状态" }
        val student = students.requireExact(studentId); val review = readReview(student); val candidates = review.getJSONArray("candidates").toObjects(); val item = candidates.singleOrNull { it.optString("id") == evidenceId } ?: error("未找到成长证据候选")
        val previous = item.optString("status", "pending"); val now = Timestamp.now(); item.put("status", status).put("note", note).put("updatedAt", now)
        item.put("review", JSONObject().put("status", if (status == "confirmed") "approved" else if (status == "rejected") "rejected" else "pending")
            .put("reviewerRole", "administrator").put("reviewerId", "local-user").put("reviewedAt", now))
        val history = item.optJSONArray("reviewHistory") ?: JSONArray(); history.put(JSONObject().put("from", previous).put("to", status).put("note", note)
            .put("reviewerRole", "administrator").put("reviewerId", "local-user").put("reviewedAt", now)); item.put("reviewHistory", history)
        writeReview(student, JSONObject().put("version", 1).put("updatedAt", now).put("candidates", JSONArray(candidates)))
        if (status == "confirmed") appendConfirmedEvidence(student, item)
        rebuildIndex(studentId); return item
    }

    fun rebuildIndex(studentId: String): JSONObject {
        val student = students.requireExact(studentId); ensure(studentId); val evidence = readReview(student).getJSONArray("candidates").toObjects()
        val relatedProjects = projects.list().filter { studentId in it.studentIds }
        val abilities = evidence.groupBy { it.optString("ability", "待标注") }.map { (name, items) ->
            val confirmed = items.count { it.optString("status") == "confirmed" }; val watching = items.count { it.optString("status") == "watching" }
            JSONObject().put("abilityId", stableId("ability", name)).put("name", name).put("evidenceCount", items.size)
                .put("pendingCount", items.count { it.optString("status") == "pending" }).put("confirmedCount", confirmed).put("watchingCount", watching).put("rejectedCount", items.count { it.optString("status") == "rejected" })
                .put("projectIds", JSONArray(items.map { it.optString("projectId") }.filter(String::isNotBlank).distinct()))
                .put("projectNames", JSONArray(items.map { it.optString("projectName") }.filter(String::isNotBlank).distinct()))
                .put("evidenceIds", JSONArray(items.map { it.getString("id") })).put("firstObservedAt", items.minOfOrNull { it.optString("createdAt") } ?: "")
                .put("lastObservedAt", items.maxOfOrNull { it.optString("updatedAt") } ?: "").put("trend", if (confirmed >= 2) "improving" else if (confirmed + watching > 0) "stable" else "insufficient")
                .put("maturity", if (confirmed >= 3) "established" else if (confirmed >= 1) "emerging" else if (watching >= 1) "observing" else "unverified")
                .put("confidence", if (confirmed > 0) "confirmed" else if (watching > 0) "watching" else "pending")
        }
        val projectRows = relatedProjects.map { project -> val items = evidence.filter { it.optString("projectId") == project.id }
            JSONObject().put("contributionId", stableId("contribution", "${student.id}|${project.id}")).put("contributionType", "project_knowledge")
                .put("projectId", project.id).put("projectName", project.name).put("status", project.status).put("reviewStatus", if (items.isEmpty()) "not_started" else "pending")
                .put("evidenceCount", items.size).put("confirmedEvidenceCount", items.count { it.optString("status") == "confirmed" }).put("evidenceIds", JSONArray(items.map { it.getString("id") }))
                .put("abilityNames", JSONArray(items.map { it.optString("ability") }.distinct())).put("knowledgeRootPath", project.paths.knowledgeRootPath).put("publishedAt", "") }
        val index = JSONObject().put("version", 2).put("schema", "edu-manager.growth-model.v2").put("studentId", student.id).put("studentName", student.name).put("updatedAt", Timestamp.now())
            .put("growthDir", growthRoot(student)).put("summary", JSONObject().put("evidenceCount", evidence.size).put("pendingCount", evidence.count { it.optString("status") == "pending" })
                .put("confirmedCount", evidence.count { it.optString("status") == "confirmed" }).put("watchingCount", evidence.count { it.optString("status") == "watching" })
                .put("rejectedCount", evidence.count { it.optString("status") == "rejected" }).put("abilityCount", abilities.size).put("projectCount", projectRows.size))
            .put("abilities", JSONArray(abilities)).put("projects", JSONArray(projectRows)).put("evidence", JSONArray(evidence))
        val store = store(student); writeJson(store, "${growthRoot(student)}/growth-index.json", index); store.writeBytesSafely("${growthRoot(student)}/growth-index.md", growthIndexMarkdown(student, index).toByteArray(), "text/markdown")
        return index
    }

    fun generateReportDrafts(studentId: String): JSONObject {
        val student = students.requireExact(studentId); val index = rebuildIndex(studentId); val confirmed = index.getJSONArray("evidence").toObjects().filter { it.optString("status") == "confirmed" }
        val generated = JSONObject()
        if (confirmed.isEmpty()) {
            REPORTS.forEach { definition -> val path = "${draftRoot(student)}/${definition.id}.md"; store(student).writeBytesSafely(path, evidenceBoundDraft(student, definition, confirmed).toByteArray(), "text/markdown"); generated.put(definition.id, path) }
            return JSONObject().put("ok", true).put("drafts", generated).put("modelUsed", false).put("message", "没有已确认证据，已生成‘资料不足’草稿。")
        }
        val config = requireNotNull(AgentConfigurationStore(context).load()) { "尚未配置 Agent 模型" }
        val response = OpenAiCompatibleAgentAdapter(config).execute("你是教育管家的学情报告草稿工具。成长模型是唯一事实层；只引用已确认证据，不添加诊断或人格标签。只输出 JSON。",
            "学生：${student.name}\n已确认证据：${JSONArray(confirmed)}\n请返回 reports 对象，键为 profile,changes,daily,stage；每个值为对应章节标题到 Markdown 正文的对象。没有依据的章节写‘资料不足’。每个判断标注 [依据:证据ID]。")
        val parsed = parseJson(response).optJSONObject("reports") ?: error("Agent 未返回 reports 对象")
        REPORTS.forEach { definition ->
            val sections = parsed.optJSONObject(definition.id) ?: JSONObject(); val missing = definition.sections.filter { sections.optString(it).isBlank() }; require(missing.isEmpty()) { "${definition.title} 草稿缺少章节：${missing.joinToString()}" }
            val path = "${draftRoot(student)}/${definition.id}.md"; store(student).writeBytesSafely(path, reportDraft(student, definition, sections, confirmed).toByteArray(), "text/markdown"); generated.put(definition.id, path)
        }
        return JSONObject().put("ok", true).put("drafts", generated).put("modelUsed", true).put("message", "四份报告草稿已生成，等待本机用户发布确认。")
    }

    fun publishReportDrafts(studentId: String): JSONObject {
        val student = students.requireExact(studentId); val store = store(student); val published = JSONArray()
        REPORTS.forEach { definition ->
            val draft = "${draftRoot(student)}/${definition.id}.md"; require(store.exists(draft)) { "缺少 ${definition.title} 草稿" }
            val content = store.readBytes(draft).toString(Charsets.UTF_8).replace("status: pending_review", "status: active\nreviewer_role: administrator\nreviewer_id: local-user\nreviewed_at: ${Timestamp.now()}")
            val target = "${reportRoot(student)}/${definition.fileName}"; store.writeBytesSafely(target, content.toByteArray(), "text/markdown"); published.put(target)
        }
        return JSONObject().put("ok", true).put("published", published).put("message", "四份正式学情报告已由本机用户确认发布。")
    }

    fun readPublishedReport(studentId: String, reportId: String): String {
        val student = students.requireExact(studentId); ensure(studentId)
        val definition = REPORTS.singleOrNull { it.id == reportId } ?: error("未知学情报告")
        return store(student).readBytes("${reportRoot(student)}/${definition.fileName}").toString(Charsets.UTF_8)
    }

    private fun readReview(student: StudentRecord): JSONObject = JSONObject(store(student).readBytes("${growthRoot(student)}/成长证据审核.json").toString(Charsets.UTF_8))
    private fun writeReview(student: StudentRecord, review: JSONObject) = writeJson(store(student), "${growthRoot(student)}/成长证据审核.json", review.put("version", 1).put("updatedAt", Timestamp.now()))
    private fun appendDraftCandidate(student: StudentRecord, item: JSONObject) { val s = store(student); val p = "${growthRoot(student)}/成长证据草稿.md"; s.writeBytesSafely(p, (s.readBytes(p).toString(Charsets.UTF_8).trimEnd() + "\n\n- [${item.getString("id")}] ${item.getString("title")}（${item.getString("sourceUri")}）\n").toByteArray(), "text/markdown") }
    private fun appendConfirmedEvidence(student: StudentRecord, item: JSONObject) { val s = store(student); val p = "${growthRoot(student)}/成长证据.md"; val marker = "<!-- evidence:${item.getString("id")} -->"; val old = s.readBytes(p).toString(Charsets.UTF_8); if (!old.contains(marker)) s.writeBytesSafely(p, (old.trimEnd() + "\n$marker\n| ${Timestamp.now().take(10)} | ${item.getString("title")} | ${item.getString("sourceUri")} | ${item.optString("ability", "待标注")} | ${item.optString("confidence", "人工确认")} |\n").toByteArray(), "text/markdown") }
    private fun reportTemplate(student: StudentRecord, d: LearningReportDefinition) = reportHeader(student, d, "draft") + d.sections.joinToString("\n\n") { "## $it\n\n${if (it == d.summaryHeading) "待生成。" else "- 待补充。"}" } + "\n"
    private fun evidenceBoundDraft(student: StudentRecord, d: LearningReportDefinition, evidence: List<JSONObject>) = reportHeader(student, d, "pending_review") + d.sections.joinToString("\n\n") { "## $it\n\n${if (evidence.isEmpty()) "资料不足。" else evidence.joinToString("\n") { e -> "- ${e.getString("title")} [依据:${e.getString("id")}]" }}" } + "\n"
    private fun reportDraft(student: StudentRecord, d: LearningReportDefinition, sections: JSONObject, evidence: List<JSONObject>) = reportHeader(student, d, "pending_review", evidence.map { it.getString("id") }) + d.sections.joinToString("\n\n") { "## $it\n\n${sections.getString(it)}" } + "\n"
    private fun reportHeader(student: StudentRecord, d: LearningReportDefinition, status: String, ids: List<String> = emptyList()) = "---\ntype: ${d.type}\ntarget: ${d.target}\nstudent_id: ${student.id}\nupdated: ${Timestamp.now().take(10)}\nstatus: $status\nsource_layer: growth_model\npresentation_only: true\nsource_claim_ids: ${ids.joinToString(",")}\n---\n\n# ${d.title}\n\n> 本报告是成长模型的呈现输出，不是成长证据的事实来源。\n\n"
    private fun growthIndexMarkdown(student: StudentRecord, index: JSONObject) = "# ${student.name} 成长模型结构化索引\n\nSchema：edu-manager.growth-model.v2\n\n生成时间：${index.getString("updatedAt")}\n\n- 成长证据：${index.getJSONObject("summary").getInt("evidenceCount")}\n- 已确认：${index.getJSONObject("summary").getInt("confirmedCount")}\n- 待审核：${index.getJSONObject("summary").getInt("pendingCount")}\n"
    private fun parseJson(text: String): JSONObject { val cleaned = text.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim(); return JSONObject(cleaned.substring(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)) }
    private fun writeJson(store: SafWorkspaceStore, path: String, value: JSONObject) = store.writeBytesSafely(path, (value.toString(2) + "\n").toByteArray(), "application/json")
    private fun writeIfMissing(store: SafWorkspaceStore, path: String, content: String) { if (!store.exists(path)) store.writeBytesSafely(path, content.toByteArray(), if (path.endsWith(".json")) "application/json" else "text/markdown") }
    private fun store(student: StudentRecord) = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
    private fun growthRoot(s: StudentRecord) = "${s.paths.summaryPath}/成长模型"; private fun reportRoot(s: StudentRecord) = "${s.paths.summaryPath}/学情报告"; private fun draftRoot(s: StudentRecord) = child(s.paths.rootPath, ".edu-manager/report-drafts")
    private fun child(root: String, path: String) = if (root.isBlank()) path else "$root/$path"
    private fun stableId(prefix: String, value: String) = "$prefix-${MessageDigest.getInstance("SHA-1").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }.take(14)}"

    companion object {
        val EVIDENCE_STATUSES = setOf("pending", "confirmed", "watching", "rejected")
        val REPORTS = listOf(
            LearningReportDefinition("profile", "整体画像", "整体画像.md", "learning_profile", "家长 / 教师 / 学生", "一句话画像", listOf("一句话画像", "学习优势", "当前短板", "兴趣与动力", "学习习惯与执行力", "适合的学习方式", "家长沟通注意点", "依据来源")),
            LearningReportDefinition("changes", "历史变化", "历史变化.md", "learning_change", "家长 / 教师", "最近 7 天变化", listOf("最近 7 天变化", "最近 30 天变化", "能力变化", "习惯变化", "问题变化", "目标变化", "依据来源")),
            LearningReportDefinition("daily", "每周行动建议", "每日行动建议.md", "weekly_action", "学生 / 家长 / 教师", "每周重点", listOf("每周重点", "每日固定动作", "阶段性里程碑", "给学生", "给家长", "给老师", "本周不建议做的事", "观察点", "依据来源")),
            LearningReportDefinition("stage", "阶段总结", "阶段总结.md", "stage_summary", "家长 / 教师", "本阶段核心进展", listOf("本阶段核心进展", "主要问题", "关键证据", "下一阶段目标", "建议行动", "依据来源")),
        )
    }
}
