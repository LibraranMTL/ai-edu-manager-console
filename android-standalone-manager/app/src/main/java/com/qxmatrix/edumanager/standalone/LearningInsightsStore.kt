package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException

/** Read-only learning views plus append-only report-set revisions. No model or network work is started here. */
class LearningInsightsStore(private val context: Context) {
    private val state = PrivateStateStore(context)
    private val content = ScopedContentRepository(context)

    fun archiveReportSet(studentId: String, publicationId: String, reports: List<Pair<LearningReportDefinition, String>>,
        evidenceFingerprint: String = ""): JSONObject {
        StudentIndexRepository(context).requireExact(studentId)
        require(reports.size == GrowthModelService.REPORTS.size) { "四份报告必须作为一组归档" }
        val now = Timestamp.now()
        val items = JSONArray(reports.map { (definition, text) ->
            val verified = EducationPublicationPolicy.validatePublishedReport(studentId, definition.title, text)
            JSONObject().put("studentId", studentId).put("sourceId", "report:${definition.id}:$publicationId")
                .put("reportId", definition.id).put("title", definition.title).put("time", now)
                .put("contentFingerprint", EducationPublicationPolicy.sha256(text))
                .put("sourceFingerprint", verified.sourceHash).put("content", text)
        })
        val fingerprintInput = JSONObject().put("studentId", studentId).put("sourceId", publicationId)
            .put("time", now).put("generationPeriod", now.take(7)).put("reports", items)
            .put("evidenceSummary", JSONObject().put("referencedEvidenceCount", reports.flatMap { (_, text) ->
                Regex("\\[依据:([^]\\s]+)]").findAll(text).map { it.groupValues[1] }.toList()
            }.distinct().size))
            .put("cloudStatus", CloudReportSync(context).status(studentId).let { cloud ->
                when { !cloud.configured -> "not_configured"; !cloud.enabled -> "disabled"; cloud.lastError.isNotBlank() -> "needs_help"; else -> "enabled" }
            })
        val revision = fingerprintInput.put("evidenceFingerprint", evidenceFingerprint)
            .put("contentFingerprint", ScopedContentPolicy.fingerprint(fingerprintInput))
        synchronized(LOCK) {
            val root = reportRoot(studentId)
            val revisions = root.getJSONArray("revisions")
            if ((0 until revisions.length()).none { revisions.getJSONObject(it).optString("sourceId") == publicationId }) {
                revisions.put(revision)
                root.put("updatedAt", now)
                state.writeBytes(reportPath(studentId), (root.toString(2) + "\n").toByteArray())
            }
        }
        HighGrowthRoomStore(context).mirrorAsync(studentId, HighGrowthRoomStore.REPORT_REVISION, listOf(revision))
        return revision
    }

    fun reportRevisions(studentId: String): List<JSONObject> {
        StudentIndexRepository(context).requireExact(studentId)
        val rows = reportRoot(studentId).getJSONArray("revisions")
        val legacy = (0 until rows.length()).map { rows.getJSONObject(it) }
        return HighGrowthRoomStore(context).migrateAndPage(studentId, HighGrowthRoomStore.REPORT_REVISION, legacy, 50, 0)
    }

    fun mastery(studentId: String): List<JSONObject> {
        val rows = content.list(studentId, listOf("artifact", "attempt", "review"), 100, 0)
        val versions = rows.filter { it.kind == "artifact" }.filter { runCatching { JSONObject(it.payload).optString("module") == "cards" }.getOrDefault(false) }
        val attempts = rows.filter { it.kind == "attempt" }
        val reviews = rows.filter { it.kind == "review" }.associateBy { JSONObject(it.payload).optString("attemptId") }
        return versions.flatMap { version ->
            val root = JSONObject(version.payload)
            val items = root.optJSONObject("result")?.optJSONArray("items") ?: JSONArray()
            val related = attempts.filter { JSONObject(it.payload).optString("versionId") == version.id }
            (0 until items.length()).map { index ->
                val item = items.getJSONObject(index)
                val outcomes = related.mapNotNull { reviews[it.id] }.map { JSONObject(it.payload).optString("outcome") }
                val correctDates = related.mapNotNull { attempt ->
                    reviews[attempt.id]?.takeIf { JSONObject(it.payload).optString("outcome") == "correct" }?.let { attempt.createdAt.take(10) }
                }.distinct()
                val status = when {
                    correctDates.size >= 2 -> "较稳定"
                    outcomes.any { it in setOf("revise", "partial") } -> "需巩固"
                    related.isNotEmpty() -> "学习中"
                    else -> "待验证"
                }
                val sourceIds = JSONArray(listOf(version.id) + related.map { it.id } + related.mapNotNull { reviews[it.id]?.id })
                val row = JSONObject().put("studentId", studentId).put("sourceId", "${version.id}:$index")
                    .put("time", (related.maxOfOrNull { it.updatedAt } ?: version.updatedAt))
                    .put("title", item.optString("question", "学习卡片 ${index + 1}"))
                    .put("status", status).put("sourceIds", sourceIds).put("projectId", version.projectId)
                    .put("attemptCount", related.size).put("crossTimeCorrectCount", correctDates.size)
                row.put("contentFingerprint", ScopedContentPolicy.fingerprint(row))
            }
        }.sortedByDescending { it.optString("time") }
    }

    fun timeline(studentId: String): List<JSONObject> {
        val kinds = listOf("material", "conversation", "artifact", "attempt", "review", "action", "action_event", "decision")
        val scoped = content.list(studentId, kinds, 100, 0).map { row ->
            val event = JSONObject().put("studentId", studentId).put("sourceId", row.id).put("time", row.updatedAt)
                .put("kind", row.kind).put("title", row.title.ifBlank { label(row.kind) })
                .put("summary", label(row.kind)).put("projectId", row.projectId)
                .put("contentFingerprint", row.sourceSha256.ifBlank { ScopedContentPolicy.hash(row.payload.toByteArray()) })
            event
        }
        val growth = runCatching { GrowthModelService(context).candidates(studentId) }.getOrDefault(emptyList()).map { item ->
            val event = JSONObject().put("studentId", studentId).put("sourceId", item.optString("id"))
                .put("time", item.optString("updatedAt", item.optString("createdAt"))).put("kind", "growth")
                .put("title", item.optString("title", "成长证据")).put("summary", "成长证据 · ${growthStatus(item.optString("status"))}")
                .put("projectId", item.optString("projectId"))
            event.put("contentFingerprint", ScopedContentPolicy.fingerprint(event))
        }
        val projects = ProjectRepository(context).list().filter { studentId in it.studentIds }.map { project ->
            val event = JSONObject().put("studentId", studentId).put("sourceId", project.id).put("time", project.createdAt)
                .put("kind", "project").put("title", project.name).put("summary", "学习项目 · ${project.status}").put("projectId", project.id)
            event.put("contentFingerprint", ScopedContentPolicy.fingerprint(event))
        }
        return (scoped + growth + projects).sortedByDescending { it.optString("time") }
    }

    fun dimensions(studentId: String): List<JSONObject> = runCatching { GrowthModelService(context).candidates(studentId) }
        .getOrDefault(emptyList()).groupBy { it.optString("ability", "待标注") }.map { (ability, evidence) ->
            val sourceIds = evidence.map { it.optString("id") }.filter { it.isNotBlank() }
            val row = JSONObject().put("studentId", studentId).put("sourceId", "ability:${ScopedContentPolicy.hash(ability.toByteArray()).take(16)}")
                .put("time", evidence.maxOfOrNull { it.optString("updatedAt", it.optString("createdAt")) }.orEmpty())
                .put("title", ability).put("confirmed", evidence.count { it.optString("status") == "confirmed" })
                .put("watching", evidence.count { it.optString("status") == "watching" })
                .put("pending", evidence.count { it.optString("status") == "pending" }).put("sourceIds", JSONArray(sourceIds))
            row.put("contentFingerprint", ScopedContentPolicy.fingerprint(row))
        }.sortedByDescending { it.optString("time") }

    private fun reportRoot(studentId: String): JSONObject = try {
        JSONObject(state.readBytes(reportPath(studentId)).toString(Charsets.UTF_8))
    } catch (_: FileNotFoundException) {
        JSONObject().put("version", 1).put("studentId", studentId).put("updatedAt", "").put("revisions", JSONArray())
    }

    private fun reportPath(studentId: String) = "learning-insights/report-revisions-$studentId.json"
    private fun label(kind: String) = when (kind) {
        "material" -> "资料采集"; "conversation" -> "对话资料"; "artifact" -> "学习或规划候选"
        "attempt" -> "学习卡片作答"; "review" -> "作答反馈"; "action" -> "已采用草稿"
        "action_event" -> "行动进展"; "decision" -> "候选决定"; else -> kind
    }
    private fun growthStatus(status: String) = when (status) { "confirmed" -> "已确认"; "watching" -> "继续观察"; "rejected" -> "未采用"; else -> "待审核" }

    companion object { private val LOCK = Any() }
}
