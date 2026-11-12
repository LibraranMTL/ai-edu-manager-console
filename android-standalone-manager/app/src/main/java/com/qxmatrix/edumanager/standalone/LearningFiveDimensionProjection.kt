package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

data class LearningDimensionProjection(
    val id: String,
    val label: String,
    val summary: String,
    val source: String,
    val updatedAt: String,
    val evidenceIds: List<String>,
)

/** Read-only projection. It never turns file counts, browsing or an unconfirmed candidate into a learning conclusion. */
object LearningFiveDimensionPolicy {
    private val definitions = listOf(
        Triple("goal", "学习目标", Regex("目标|规划|方向|任务|行动", RegexOption.IGNORE_CASE)),
        Triple("mindset", "学习心态", Regex("心态|情绪|动机|坚持|自信|投入", RegexOption.IGNORE_CASE)),
        Triple("problem", "学习问题", Regex("问题|困难|薄弱|错误|障碍|待改进", RegexOption.IGNORE_CASE)),
        Triple("method", "学习方法", Regex("方法|策略|习惯|整理|复盘|练习", RegexOption.IGNORE_CASE)),
        Triple("efficiency", "学习效率", Regex("效率|时间管理|节奏|专注|进度", RegexOption.IGNORE_CASE)),
    )

    fun project(index: JSONObject?): List<LearningDimensionProjection> {
        val evidence = index?.optJSONArray("evidence")?.let { rows ->
            (0 until rows.length()).mapNotNull(rows::optJSONObject)
        }.orEmpty().filter { it.optString("status") == "confirmed" && it.optString("sourceUri").isNotBlank() }
        return definitions.map { (id, label, matcher) ->
            val matched = evidence.filter { row -> matcher.containsMatchIn(listOf(row.optString("ability"), row.optString("title"), row.optString("content")).joinToString(" ")) }
            if (matched.isEmpty()) LearningDimensionProjection(id, label, "资料不足", "none", "", emptyList())
            else LearningDimensionProjection(id, label,
                matched.take(2).joinToString("；") { it.optString("title").ifBlank { it.optString("content").take(80) } },
                "confirmed_evidence", matched.maxOfOrNull { it.optString("updatedAt", it.optString("createdAt")) }.orEmpty(),
                matched.map { it.optString("id") }.filter(String::isNotBlank))
        }
    }
}
