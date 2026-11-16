package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class PreparedStudioInput(val input: JSONObject, val research: Boolean, val allowed: MutableSet<String>, val frozenHashes: Map<String, String>)

/** One bounded, deidentified snapshot for automatic reference suggestions and low-frequency refreshes. */
class StudioInputFactory(private val context: Context, private val repository: ScopedContentRepository = ScopedContentRepository(context)) {
    fun prepare(studentId: String, module: String, selectedIds: List<String>, topic: String, count: Int, recent: Boolean, includeFeedback: Boolean = false): PreparedStudioInput {
        require(module in LearningStudioPolicy.fields && selectedIds.size <= 5 && count in 1..10)
        val student = StudentIndexRepository(context).requireExact(studentId)
        val sources = JSONArray(); val allowed = mutableSetOf<String>(); val frozen = linkedMapOf<String, String>()
        selectedIds.distinct().forEach { id ->
            val row = repository.exact(studentId, id)
            require(row.kind == "search" && row.sourceSha256.isNotBlank()) { "选择已索引的 TXT/Markdown 来源；其他文档先解析或消化" }
            val text = ContentSourceResolver(context).readText(studentId, row)
            if (recent) {
                val reportRoot = "${student.paths.summaryPath.trimEnd('/')}/学情报告"
                val report = GrowthModelService.REPORTS.singleOrNull { row.projectId.isBlank() && row.logicalPath == "$reportRoot/${it.fileName}" }
                require(report != null && LearningStudioPolicy.recentPublished(text)) { "近期学习入口只能使用该学生正式报告目录中的已发布报告" }
                EducationPublicationPolicy.validatePublishedReport(studentId, report.title, text)
                val active = GrowthModelService(context).readPublishedReport(studentId, report.id)
                require(EducationPublicationPolicy.sha256(text) == EducationPublicationPolicy.sha256(active)) {
                    "报告来源已变化或不可用，请先更新当前学情报告"
                }
                require(Regex("(?m)^student_id: ${Regex.escape(studentId)}\\s*$").containsMatchIn(text)) { "报告缺少明确学生归属" }
            }
            allowed += id; frozen[id] = row.sourceSha256
            sources.put(JSONObject().put("id", id).put("sha256", row.sourceSha256).put("excerpt", LearningStudioPolicy.redact(text.take(6_000), student.name)))
        }
        val research = module !in setOf("cards", "topics")
        if (module == "cards") require(allowed.isNotEmpty()) { "学习卡片必须有来源" }
        if (module != "cards") allowed += "profile"
        val profile = JSONObject(LearningStudioPolicy.redact(student.planningProfile.toJson().apply { remove("birthDate") }.toString(), student.name))
            .put("age", student.planningProfile.ageAt() ?: JSONObject.NULL).put("grade", LearningStudioPolicy.redact(student.grade, student.name))
        val projectChanges = context.getSharedPreferences("reference-suggestion-project-changes", Context.MODE_PRIVATE)
        val projects = JSONArray(ProjectRepository(context).list().filter { studentId in it.studentIds }.map { project ->
            JSONObject().put("id", project.id)
                .put("name", LearningStudioPolicy.redact(project.name, student.name).take(200))
                .put("type", project.type.take(100)).put("status", project.status.take(100))
                .put("description", LearningStudioPolicy.redact(project.description, student.name).take(1_000))
                .put("objective", LearningStudioPolicy.redact(project.objective, student.name).take(1_000))
                .put("changeToken", projectChanges.getString(project.id, "").orEmpty())
        })
        val input = JSONObject().put("module", module).put("profile", profile).put("profileSourceId", "profile")
            .put("goal", LearningStudioPolicy.redact(student.goal, student.name)).put("topic", LearningStudioPolicy.redact(topic.take(500), student.name))
            .put("projects", projects).put("sources", sources)
            .put("mode", if (recent) "published_report_practice" else "reference_suggestion")
            .put("count", count).put("strategy", "reference-suggestion-v2")
            .put("refreshPeriod", Timestamp.now().take(7))
        if (research && ResearchServiceSelection.independent(context)) input.put("searchStrategy", "tavily-source-validation-v3")
        if (includeFeedback) {
            require(module == "cards") { "人工审核回流仅用于练习，不自动用于规划判断" }
            input.put("humanReviewObservations", StudioFeedbackPolicy.observations(repository.list(studentId, listOf("review"), 100), studentId, frozen, student.name))
        }
        return PreparedStudioInput(input, research, allowed, frozen)
    }
}
