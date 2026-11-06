package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

data class LearningReportDefinition(val id: String, val title: String, val fileName: String, val type: String, val target: String, val summaryHeading: String, val sections: List<String>)

private data class GeneratedReportSections(
    val definition: LearningReportDefinition,
    val sections: JSONObject,
)

private data class GeneratedReportSet(
    val evidence: List<JSONObject>,
    val reports: List<GeneratedReportSections>,
    val modelReportCount: Int,
    val fallbackSectionCount: Int,
    val warnings: List<String>,
)

class GrowthModelService(private val context: Context) {
    private val students = StudentIndexRepository(context)
    private val projects = ProjectRepository(context)

    fun ensure(studentId: String): JSONObject {
        val student = students.requireExact(studentId); val store = store(student); val growth = growthRoot(student); val report = reportRoot(student)
        store.ensureDirectory(growth); store.ensureDirectory(report)
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
        val student = students.requireExact(studentId); require(title.isNotBlank()) { "成长证据标题不能为空" }; require(content.isNotBlank()) { "成长证据观察内容不能为空" }; require(sourceUri.isNotBlank()) { "成长证据必须关联原始资料" }
        if (projectId.isNotBlank()) require(projects.requireExact(projectId).studentIds.contains(studentId)) { "项目未绑定当前学生" }
        ensure(studentId); val review = readReview(student); val now = Timestamp.now()
        val candidate = JSONObject().put("schema", "edu-manager.growth-evidence.v1").put("protocolVersion", ProtocolBaseline.EDUCATION_DOMAIN_PROTOCOL_VERSION)
            .put("id", "growth-evidence-${UUID.randomUUID()}").put("studentId", student.id).put("studentName", student.name)
            .put("title", inlineText(title)).put("content", content.trim()).put("status", "pending").put("ability", inlineText(ability).ifBlank { "待标注" })
            .put("sourceUri", sourceUri.trim()).put("sourcePath", sourceUri.trim()).put("originalSourcePath", sourceUri.trim())
            .put("projectId", projectId).put("projectName", if (projectId.isBlank()) "" else projects.requireExact(projectId).name)
            .put("confidence", confidence).put("createdAt", now).put("updatedAt", now).put("review", JSONObject().put("status", "pending"))
        review.getJSONArray("candidates").put(candidate); writeReview(student, review); appendDraftCandidate(student, candidate); rebuildIndex(studentId)
        return candidate
    }

    fun addAutomaticCandidate(studentId: String, title: String, ability: String, sourceUri: String, content: String, confidence: String = "unknown", projectId: String = "", generatedBy: String): JSONObject {
        val student = students.requireExact(studentId)
        require(title.isNotBlank() && content.isNotBlank()) { "自动成长证据必须包含标题和观察内容" }
        require(sourceUri.isNotBlank()) { "自动成长证据必须绑定原始资料来源" }
        if (projectId.isNotBlank()) require(projects.requireExact(projectId).studentIds.contains(studentId)) { "项目未绑定当前学生" }
        ensure(studentId)
        val review = readReview(student)
        val evidenceId = GrowthEvidencePolicy.automaticId(studentId, sourceUri, title, content)
        review.getJSONArray("candidates").toObjects().singleOrNull { it.optString("id") == evidenceId }?.let { return it }
        val now = Timestamp.now()
        val candidate = JSONObject().put("schema", "edu-manager.growth-evidence.v1").put("protocolVersion", ProtocolBaseline.EDUCATION_DOMAIN_PROTOCOL_VERSION)
            .put("id", evidenceId).put("studentId", student.id).put("studentName", student.name)
            .put("title", title.trim()).put("content", content.trim()).put("status", "pending").put("ability", ability.trim().ifBlank { "待标注" })
            .put("sourceUri", sourceUri.trim()).put("sourcePath", sourceUri.trim()).put("originalSourcePath", sourceUri.trim())
            .put("sourceVerification", "derived_from_registered_raw_material").put("primarySourceStatus", "provided")
            .put("projectId", projectId).put("projectName", if (projectId.isBlank()) "" else projects.requireExact(projectId).name)
            .put("confidence", confidence).put("generatedBy", generatedBy).put("createdAt", now).put("updatedAt", now)
            .put("review", JSONObject().put("status", "pending"))
        review.getJSONArray("candidates").put(candidate)
        val decided = applyAutomaticDecision(student, candidate)
        writeReview(student, review); appendDraftCandidate(student, decided); rebuildIndex(studentId)
        return decided
    }

    fun attachCandidateSource(studentId: String, evidenceId: String, materialId: String, sourceName: String): JSONObject {
        val student = students.requireExact(studentId); ensure(studentId)
        val review = readReview(student); val candidates = review.getJSONArray("candidates").toObjects()
        val item = candidates.singleOrNull { it.optString("id") == evidenceId } ?: error("未找到成长证据候选")
        require(item.optString("status") in setOf("pending", "watching", "needs_attention")) { "只能为待处理证据补充来源" }
        val material = FileAssetService(context).materials(studentId).singleOrNull { it.optString("id") == materialId }
            ?: error("所选资料不属于当前学生")
        val sourceUri = "edu://student/${student.id}/raw/$materialId"; val now = Timestamp.now()
        item.put("sourceUri", sourceUri).put("sourceMaterialId", materialId).put("sourceName", sourceName)
            .put("sourceVerification", "provided_by_local_user").put("primarySourceStatus", "provided").put("updatedAt", now)
            .put("studentId", student.id)
        val materialProjectId = material.optString("projectId")
        if (materialProjectId.isNotBlank() && projects.list().any { it.id == materialProjectId && student.id in it.studentIds }) {
            item.put("projectId", materialProjectId).put("projectName", projects.requireExact(materialProjectId).name)
        }
        listOf("attributionConflict", "studentAttributionConflict", "projectAttributionConflict", "sourceStudentId",
            "declaredStudentId", "attributedStudentId", "sourceProjectId", "declaredProjectId", "attributedProjectId",
            "conflictType", "scopeError", "errorCode").forEach(item::remove)
        if (item.optString("automationAttentionReason") in setOf("attribution_conflict", "student_attribution_conflict",
                "project_attribution_conflict", "student_scope_mismatch", "project_scope_mismatch", "scope_conflict")) {
            item.remove("automationAttentionReason")
        }
        val history = item.optJSONArray("reviewHistory") ?: JSONArray()
        history.put(JSONObject().put("action", "attach_source").put("sourceUri", sourceUri).put("sourceName", sourceName)
            .put("reviewerRole", "administrator").put("reviewerId", "local-user").put("reviewedAt", now))
        item.put("reviewHistory", history)
        if (item.optString("status") == "needs_attention") applyAutomaticDecision(student, item)
        writeReview(student, JSONObject().put("version", 1).put("updatedAt", now).put("candidates", JSONArray(candidates)))
        rebuildIndex(studentId)
        return item
    }

    fun candidates(studentId: String): List<JSONObject> {
        val student = students.requireExact(studentId); ensure(studentId)
        val review = readReview(student); var changed = false
        review.getJSONArray("candidates").toObjects().filter {
            it.optString("status") == "pending" || it.optString("status") == "needs_attention" ||
                it.optJSONObject("risk")?.optString("level") == "high"
        }.forEach {
            applyAutomaticDecision(student, it); changed = true
        }
        if (changed) writeReview(student, review)
        return review.getJSONArray("candidates").toObjects()
    }

    fun attentionCandidates(studentId: String): List<JSONObject> = candidates(studentId)
        .filter { it.optString("status") == "needs_attention" || it.optJSONObject("risk")?.optString("level") == "high" }

    fun excludeCandidate(studentId: String, evidenceId: String, note: String = "自动成长模型异常清单中排除"): JSONObject =
        reviewCandidate(studentId, evidenceId, "rejected", note)

    fun reviewCandidate(studentId: String, evidenceId: String, status: String, note: String): JSONObject {
        require(status in EVIDENCE_STATUSES) { "不支持的成长证据状态" }
        val student = students.requireExact(studentId); val review = readReview(student); val candidates = review.getJSONArray("candidates").toObjects(); val item = candidates.singleOrNull { it.optString("id") == evidenceId } ?: error("未找到成长证据候选")
        if (status == "confirmed") require(!GrowthEvidencePolicy.requiresPrimarySource(item)) { "该候选缺少可核验的原始资料来源，请先补充来源后再确认采用" }
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
            val confirmed = items.count(::publicationEligible); val watching = items.count { it.optString("status") == "watching" }
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
                .put("confirmedCount", evidence.count(::publicationEligible)).put("watchingCount", evidence.count { it.optString("status") == "watching" })
                .put("attentionCount", evidence.count { it.optString("status") == "needs_attention" })
                .put("rejectedCount", evidence.count { it.optString("status") == "rejected" }).put("abilityCount", abilities.size).put("projectCount", projectRows.size))
            .put("abilities", JSONArray(abilities)).put("projects", JSONArray(projectRows)).put("evidence", JSONArray(evidence))
        val store = store(student); writeJson(store, "${growthRoot(student)}/growth-index.json", index); store.writeBytesSafely("${growthRoot(student)}/growth-index.md", growthIndexMarkdown(student, index).toByteArray(), "text/markdown")
        HighGrowthRoomStore(context).mirrorAsync(studentId, HighGrowthRoomStore.GROWTH_SNAPSHOT, listOf(JSONObject(index.toString())
            .put("sourceId", "growth-snapshot:current").put("time", index.getString("updatedAt"))))
        return index
    }

    fun generateAndPublishReportsIfChanged(studentId: String): JSONObject {
        val index = rebuildIndex(studentId)
        val evidence = index.getJSONArray("evidence").toObjects().filter(::publicationEligible)
        if (evidence.isEmpty()) return JSONObject().put("ok", true).put("status", "deferred_insufficient_evidence")
            .put("message", "尚无可发布的已确认证据，保留现有报告且不创建需要处理任务")
        val fingerprint = LearningReportPublicationPolicy.evidenceFingerprint(evidence)
        val latest = LearningInsightsStore(context).reportRevisions(studentId)
            .filter { it.optString("evidenceFingerprint").isNotBlank() }.maxByOrNull { it.optString("time") }
        if (latest?.optString("evidenceFingerprint") == fingerprint) {
            val repaired = reconcileActivePublication(students.requireExact(studentId))
            return JSONObject().put("ok", true).put("status", if (repaired) "reconciled" else "unchanged")
                .put("evidenceFingerprint", fingerprint)
                .put("message", if (repaired) "已补齐当前报告组发布回执" else "学情证据未变化，沿用当前报告版本")
        }
        return generateAndPublishReports(studentId, fingerprint)
    }

    fun generateAndPublishReports(studentId: String, requestedEvidenceFingerprint: String = ""): JSONObject {
        val student = students.requireExact(studentId)
        val result = generateReportSet(student)
        require(result.evidence.isNotEmpty()) { "当前没有已确认的成长证据。请先消化资料并在成长模型中确认至少一条证据，再生成正式学情报告。" }
        val evidenceFingerprint = LearningReportPublicationPolicy.evidenceFingerprint(result.evidence)
        require(requestedEvidenceFingerprint.isBlank() || requestedEvidenceFingerprint == evidenceFingerprint) { "生成期间成长证据已变化，请按新版本重新生成" }
        val prepared = result.reports.map { report -> report.definition to reportPublished(student, report.definition, report.sections, result.evidence) }
        val published = JSONArray()
        CloudReportSync.withPublicationLock {
            val sync = CloudReportSync(context)
            val existing = runCatching { REPORTS.map { definition ->
                val text = readPublishedReport(student.id, definition.id)
                EducationPublicationPolicy.validatePublishedReport(student.id, definition.title, text)
                definition to text
            } }.getOrNull()
            val publicationId = sync.beginPublication(student.id)
            val versionRoot = "${reportRoot(student)}/$REPORT_SET_DIRECTORY/$publicationId"
            val paths = prepared.associate { (definition, _) -> definition.id to "$versionRoot/${definition.fileName}" }
            prepared.forEach { (definition, content) -> store(student).writeBytesSafely(paths.getValue(definition.id), content.toByteArray(), "text/markdown") }
            val readBack = prepared.map { (definition, content) ->
                val actual = store(student).readBytes(paths.getValue(definition.id)).toString(Charsets.UTF_8)
                check(actual == content) { "${definition.title}候选写入后校验失败，活动版本未切换" }
                EducationPublicationPolicy.validatePublishedReport(student.id, definition.title, actual)
                actual
            }
            val pointer = LearningReportPublicationPolicy.pointer(student.id, publicationId, evidenceFingerprint,
                paths, prepared.associate { it.first.id to it.second }, Timestamp.now())
            if (existing != null) {
                val previousHash = ScopedContentPolicy.hash(existing.joinToString("|") { it.second }.toByteArray()).take(24)
                LearningInsightsStore(context).archiveReportSet(student.id, "before-$previousHash", existing)
            }
            LearningInsightsStore(context).archiveReportSet(student.id, publicationId,
                prepared.mapIndexed { index, (definition, _) -> definition to readBack[index] }, evidenceFingerprint)
            store(student).writeBytesSafely(activeReportSetPath(student), (pointer.toString(2) + "\n").toByteArray(), "application/json")
            prepared.forEach { (definition, _) -> published.put(paths.getValue(definition.id)) }
            runCatching { sync.commitPublication(student.id, publicationId, readBack) }
                .onFailure { sync.pauseAfterSnapshotFailure(student.id, it) }
            // Compatibility mirrors are not authoritative; readers use the single active pointer above.
            prepared.forEachIndexed { index, (definition, _) -> runCatching {
                store(student).writeBytesSafely("${reportRoot(student)}/${definition.fileName}", readBack[index].toByteArray(), "text/markdown")
            } }
        }
        runCatching { CloudReportSync.enqueueAfterCompletePublication(context, student.id) }
        runCatching { StudioAutomation.enqueueCheck(context, student.id) } // Worker sends nothing without prior per-student consent.
        val message = if (result.warnings.isEmpty()) {
            "四份正式学情报告已生成并发布，可直接查看、导出或打印。"
        } else {
            "四份正式学情报告已生成并发布；${result.warnings.size} 项模型漏项或无依据内容已自动使用保守表述。"
        }
        return JSONObject().put("ok", true).put("status", "published").put("published", published)
            .put("evidenceFingerprint", evidenceFingerprint).put("modelUsed", result.modelReportCount > 0)
            .put("modelReportCount", result.modelReportCount).put("fallbackSectionCount", result.fallbackSectionCount)
            .put("warnings", JSONArray(result.warnings)).put("message", message)
    }

    private fun generateReportSet(student: StudentRecord): GeneratedReportSet {
        val index = rebuildIndex(student.id)
        val confirmed = index.getJSONArray("evidence").toObjects().filter(::publicationEligible)
        val warnings = mutableListOf<String>()
        var modelReports = 0
        var fallbackSections = 0
        val adapter = AgentConfigurationStore(context).load()?.let(::OpenAiCompatibleAgentAdapter)
        val evidencePayload = JSONArray(confirmed.take(100).map { evidence -> JSONObject()
            .put("id", evidence.optString("id")).put("title", evidence.optString("title"))
            .put("ability", evidence.optString("ability")).put("content", evidence.optString("content").take(1200))
            .put("sourceUri", evidence.optString("sourceUri")) })
        val reports = REPORTS.map { definition ->
            val modelSections = if (adapter == null || confirmed.isEmpty()) null else runCatching {
                val response = adapter.execute(
                    "你是教育管家的学情报告生成工具。成长模型是唯一事实层；只引用给定的已确认证据，不添加诊断、人格标签或新事实。只输出 JSON。",
                    "学生：${student.name}\n报告：${definition.title}\n章节：${definition.sections.joinToString("、")}\n已确认证据：$evidencePayload\n返回 {\"sections\":{\"章节标题\":\"Markdown 正文\"}}。必须使用原章节名；每项事实判断标注 [依据:证据ID]；没有依据写“资料不足”，没有变化写“本周期无实质变化”。",
                )
                ReportDraftPolicy.extractModelSections(response, definition.id)
            }.onFailure { warnings += "${definition.title} Agent 生成失败，已使用保守模板：${it.message ?: "未知错误"}" }.getOrNull()
            val completed = ReportDraftPolicy.complete(definition.sections, modelSections, confirmed)
            if (completed.adoptedModelSections > 0) modelReports += 1
            fallbackSections += completed.fallbackSections
            completed.warnings.forEach { warnings += "${definition.title}：$it" }
            GeneratedReportSections(definition, completed.sections)
        }
        return GeneratedReportSet(confirmed, reports, modelReports, fallbackSections, warnings)
    }

    fun readPublishedReport(studentId: String, reportId: String): String {
        val student = students.requireExact(studentId)
        val definition = REPORTS.singleOrNull { it.id == reportId } ?: error("未知学情报告")
        val workspace = store(student)
        if (workspace.exists(activeReportSetPath(student))) {
            val pointer = JSONObject(workspace.readBytes(activeReportSetPath(student)).toString(Charsets.UTF_8))
            val entry = LearningReportPublicationPolicy.requireEntry(pointer, student.id, reportId)
            val text = workspace.readBytes(entry.getString("path")).toString(Charsets.UTF_8)
            require(EducationPublicationPolicy.sha256(text) == entry.getString("sha256")) { "学情报告活动版本哈希不一致" }
            EducationPublicationPolicy.validatePublishedReport(student.id, definition.title, text)
            return text
        }
        val direct = StudentArchiveCompatibility.reportDocumentPaths(student, definition.fileName).asSequence()
            .mapNotNull { path -> runCatching { path to workspace.readBytes(path).toString(Charsets.UTF_8) }.getOrNull() }
            .firstOrNull { (_, text) -> EducationPublicationPolicy.hasMeaningfulBody(text) }
        direct?.let { return it.second }
        val exactArchived = StudentArchiveCompatibility.reportSearchRoots(student).asSequence().map { root ->
            workspace.listMarkdownFiles(listOf(root), maximum = 500, maximumDepth = 6)
        }.firstOrNull { it.isNotEmpty() }.orEmpty()
        val discoveredArchived = if (exactArchived.isNotEmpty()) emptyList() else workspace.findArchiveMarkdownFiles(
            relativeRoots = StudentArchiveCompatibility.fallbackSearchRoots(student),
            expectedFileNames = StudentArchiveCompatibility.archiveDocumentNames("学情报告"),
            pathTerms = StudentArchiveCompatibility.archivePathTerms("学情报告"),
            preferredTerms = StudentArchiveCompatibility.archivePreferredTerms(student, "学情报告"),
            allowRoot = student.knowledgeBaseMode == "adopted",
        )
        val archived = (exactArchived + discoveredArchived).distinctBy { it.relativePath }.mapNotNull { file ->
            val text = runCatching { workspace.readBytes(file.relativePath).toString(Charsets.UTF_8) }.getOrNull()
                ?.takeIf(EducationPublicationPolicy::hasMeaningfulBody) ?: return@mapNotNull null
            migratedReportRank(definition, file, text)?.let { rank -> Triple(rank, file.relativePath, text) }
        }.sortedWith(compareBy<Triple<Int, String, String>> { it.first }.thenByDescending { it.second })
            .firstOrNull()?.third
        if (archived != null) return archived
        ensure(studentId)
        return workspace.readBytes("${reportRoot(student)}/${definition.fileName}").toString(Charsets.UTF_8)
    }

    private fun reconcileActivePublication(student: StudentRecord): Boolean {
        val workspace = store(student)
        if (!workspace.exists(activeReportSetPath(student))) return false
        val pointer = JSONObject(workspace.readBytes(activeReportSetPath(student)).toString(Charsets.UTF_8))
        val contents = REPORTS.map { definition ->
            val entry = LearningReportPublicationPolicy.requireEntry(pointer, student.id, definition.id)
            val text = workspace.readBytes(entry.getString("path")).toString(Charsets.UTF_8)
            require(EducationPublicationPolicy.sha256(text) == entry.getString("sha256")) { "学情报告活动版本哈希不一致" }
            EducationPublicationPolicy.validatePublishedReport(student.id, definition.title, text)
            text
        }
        return CloudReportSync(context).reconcilePublication(student.id, pointer.getString("publicationId"), contents)
    }

    private fun migratedReportRank(definition: LearningReportDefinition, file: SafWorkspaceStore.MarkdownFile, text: String): Int? {
        val aliases = StudentArchiveCompatibility.reportNames(definition.fileName)
        val normalizedPath = file.relativePath.replace('\\', '/')
        val reportArea = normalizedPath.contains("/学情报告/") || normalizedPath.startsWith("学情报告/") ||
            normalizedPath.contains("学情分析汇总") || normalizedPath.contains("/教育档案/") ||
            normalizedPath.lowercase().contains("/reports/")
        val declaredType = Regex("(?mi)^(?:type|report_type)\\s*:\\s*([^\\s#]+)").find(text)?.groupValues?.getOrNull(1)?.trim()?.lowercase().orEmpty()
        val typeAliases = when (definition.id) {
            "profile" -> setOf("learning_profile", "profile", "整体画像")
            "changes" -> setOf("learning_change", "learning_changes", "changes", "历史变化")
            "daily" -> setOf("weekly_action", "daily_action", "每日行动建议", "每周行动建议")
            "stage" -> setOf("stage_summary", "learning_stage", "stage", "阶段总结")
            else -> setOf(definition.type.lowercase())
        }
        val headingMatches = Regex("(?m)^#\\s+${Regex.escape(definition.title)}(?:\\s|$)").containsMatchIn(text)
        return when {
            reportArea && file.name == definition.fileName -> 0
            reportArea && file.name in aliases -> 1
            declaredType in typeAliases -> 2
            file.name == definition.fileName -> 3
            file.name in aliases -> 4
            reportArea && headingMatches -> 5
            else -> null
        }
    }

    private fun readReview(student: StudentRecord): JSONObject {
        val source = JSONObject(store(student).readBytes("${growthRoot(student)}/成长证据审核.json").toString(Charsets.UTF_8))
        val normalized = JSONArray(); val candidates = source.optJSONArray("candidates") ?: JSONArray()
        for (index in 0 until candidates.length()) candidates.optJSONObject(index)?.let { normalized.put(GrowthEvidencePolicy.normalizeCandidate(student.id, it)) }
        return source.put("candidates", normalized)
    }
    private fun writeReview(student: StudentRecord, review: JSONObject) {
        val updated = review.put("version", 1).put("updatedAt", Timestamp.now())
        writeJson(store(student), "${growthRoot(student)}/成长证据审核.json", updated)
        HighGrowthRoomStore(context).mirrorAsync(student.id, HighGrowthRoomStore.GROWTH_EVIDENCE, updated.getJSONArray("candidates").toObjects())
    }
    private fun applyAutomaticDecision(student: StudentRecord, item: JSONObject): JSONObject {
        val assessment = GrowthEvidenceRiskPolicy.assess(item)
        val now = Timestamp.now()
        item.put("risk", assessment.toJson()).put("status", assessment.suggestedStatus).put("updatedAt", now)
            .put("automationDecision", JSONObject().put("schema", GrowthEvidenceRiskPolicy.SCHEMA)
                .put("status", assessment.suggestedStatus).put("decidedAt", now).put("actor", "system-risk-policy"))
        if (assessment.level == GrowthRiskLevel.LOW) appendConfirmedEvidence(student, item)
        return item
    }
    private fun publicationEligible(item: JSONObject): Boolean {
        if (item.optString("status") != "confirmed") return false
        val automatic = item.optJSONObject("automationDecision")
        if (automatic?.optString("status") == "confirmed" && item.optJSONObject("risk")?.optString("level") == "low") return true
        val review = item.optJSONObject("review") ?: return false
        return review.optString("status") == "approved" && review.optString("reviewerRole") in setOf("student", "parent", "teacher", "administrator")
            && review.optString("reviewerId").isNotBlank() && review.optString("reviewedAt").isNotBlank()
    }
    private fun appendDraftCandidate(student: StudentRecord, item: JSONObject) { val s = store(student); val p = "${growthRoot(student)}/成长证据草稿.md"; s.writeBytesSafely(p, (s.readBytes(p).toString(Charsets.UTF_8).trimEnd() + "\n\n- [${item.getString("id")}] ${item.getString("title")}（${item.getString("sourceUri")}）\n").toByteArray(), "text/markdown") }
    private fun appendConfirmedEvidence(student: StudentRecord, item: JSONObject) { val sourceUri = item.optString("sourceUri").trim(); require(sourceUri.isNotBlank()) { "成长证据缺少来源，不能写入正式成长模型" }; val s = store(student); val p = "${growthRoot(student)}/成长证据.md"; val marker = "<!-- evidence:${item.getString("id")} -->"; val old = s.readBytes(p).toString(Charsets.UTF_8); if (!old.contains(marker)) s.writeBytesSafely(p, (old.trimEnd() + "\n$marker\n| ${Timestamp.now().take(10)} | ${markdownCell(item.getString("title"))} | ${markdownCell(sourceUri)} | ${markdownCell(item.optString("ability", "待标注"))} | ${markdownCell(item.optString("confidence", "人工确认"))} |\n").toByteArray(), "text/markdown") }
    private fun reportTemplate(student: StudentRecord, d: LearningReportDefinition) = reportHeader(student, d, "draft") + d.sections.joinToString("\n\n") { "## $it\n\n${if (it == d.summaryHeading) "待生成。" else "- 待补充。"}" } + "\n"
    private fun reportPublished(student: StudentRecord, d: LearningReportDefinition, sections: JSONObject, evidence: List<JSONObject>): String {
        val now = Timestamp.now()
        val metadata = "publication_mode: direct\npublisher_role: administrator\npublisher_id: local-user\npublished_at: $now\n"
        return reportHeader(student, d, "active", evidence.map { it.getString("id") }, metadata) +
            d.sections.joinToString("\n\n") { "## $it\n\n${sections.getString(it)}" } + "\n"
    }
    private fun reportHeader(student: StudentRecord, d: LearningReportDefinition, status: String, ids: List<String> = emptyList(), extraMetadata: String = "") = "---\ntype: ${d.type}\ntarget: ${d.target}\nstudent_id: ${student.id}\nupdated: ${Timestamp.now().take(10)}\nstatus: $status\nsource_layer: growth_model\npresentation_only: true\nsource_claim_ids: ${ids.joinToString(",")}\n$extraMetadata---\n\n# ${d.title}\n\n> 本报告是成长模型的呈现输出，不是成长证据的事实来源。\n\n"
    private fun growthIndexMarkdown(student: StudentRecord, index: JSONObject) = "# ${student.name} 成长模型结构化索引\n\nSchema：edu-manager.growth-model.v2\n\n生成时间：${index.getString("updatedAt")}\n\n- 成长证据：${index.getJSONObject("summary").getInt("evidenceCount")}\n- 已确认：${index.getJSONObject("summary").getInt("confirmedCount")}\n- 待审核：${index.getJSONObject("summary").getInt("pendingCount")}\n"
    private fun writeJson(store: SafWorkspaceStore, path: String, value: JSONObject) = store.writeBytesSafely(path, (value.toString(2) + "\n").toByteArray(), "application/json")
    private fun writeIfMissing(store: SafWorkspaceStore, path: String, content: String) { if (!store.exists(path)) store.writeBytesSafely(path, content.toByteArray(), if (path.endsWith(".json")) "application/json" else "text/markdown") }
    private fun store(student: StudentRecord) = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
    private fun growthRoot(s: StudentRecord) = "${s.paths.summaryPath}/成长模型"; private fun reportRoot(s: StudentRecord) = "${s.paths.summaryPath}/学情报告"
    private fun activeReportSetPath(s: StudentRecord) = "${reportRoot(s)}/active-report-set.json"
    private fun stableId(prefix: String, value: String) = "$prefix-${MessageDigest.getInstance("SHA-1").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }.take(14)}"
    private fun inlineText(value: String) = value.trim().replace(Regex("\\s+"), " ")
    private fun markdownCell(value: String) = inlineText(value).replace("|", "｜")

    companion object {
        const val REPORT_SET_DIRECTORY = "发布版本"
        val EVIDENCE_STATUSES = setOf("pending", "confirmed", "watching", "needs_attention", "rejected")
        val REPORTS = listOf(
            LearningReportDefinition("profile", "整体画像", "整体画像.md", "learning_profile", "家长 / 教师 / 学生", "一句话画像", listOf("一句话画像", "学习优势", "当前短板", "兴趣与动力", "学习习惯与执行力", "适合的学习方式", "家长沟通注意点", "依据来源")),
            LearningReportDefinition("changes", "历史变化", "历史变化.md", "learning_change", "家长 / 教师", "最近 7 天变化", listOf("最近 7 天变化", "最近 30 天变化", "能力变化", "习惯变化", "问题变化", "目标变化", "依据来源")),
            LearningReportDefinition("daily", "每周行动建议", "每日行动建议.md", "weekly_action", "学生 / 家长 / 教师", "每周重点", listOf("每周重点", "每日固定动作", "阶段性里程碑", "给学生", "给家长", "给老师", "本周不建议做的事", "观察点", "依据来源")),
            LearningReportDefinition("stage", "阶段总结", "阶段总结.md", "stage_summary", "家长 / 教师", "本阶段核心进展", listOf("本阶段核心进展", "主要问题", "关键证据", "下一阶段目标", "建议行动", "依据来源")),
        )
    }
}
