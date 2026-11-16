package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

/** Presents source-checked observations without turning project participation into personal credit. */
internal object GrowthProjectionDocuments {
    const val MARKER = "<!-- edu-manager:growth-projection:v1 -->"

    fun render(index: JSONObject): Pair<String, String> {
        val evidence = index.getJSONArray("evidence")
        val prefix = "edu://student/${index.getString("studentId")}/raw/"
        val rows = (0 until evidence.length()).map { evidence.getJSONObject(it) }
            .filter { row ->
                val uri = row.optString("sourceUri")
                val sourceId = uri.removePrefix(prefix)
                row.optString("status") in setOf("confirmed", "watching") && uri.startsWith(prefix) &&
                    sourceId.isNotBlank() && '/' !in sourceId
            }
        fun safe(value: String) = value.replace("\r", " ").replace("\n", " ").take(1500)
        fun describe(row: JSONObject): String {
            val label = if (row.optString("status") == "confirmed") "已确认" else "观察中"
            val source = safe(row.optString("sourceUri").ifBlank { row.optString("id") })
            return "- [$label] ${safe(row.optString("content").ifBlank { row.optString("title", "资料记录") })}（依据：$source）"
        }
        val date = safe(index.optString("updatedAt"))
        val profile = buildString {
            append("$MARKER\n# 能力画像\n\n更新时间：$date\n\n")
            append("仅汇总当前可核验记录；观察中的内容不代表已确认能力。\n\n")
            if (rows.isEmpty()) append("暂无可核验的已确认或观察中成长证据。\n")
            rows.groupBy { safe(it.optString("ability").ifBlank { "待分类" }) }.forEach { (ability, items) ->
                append("## $ability\n\n"); items.forEach { append(describe(it)).append('\n') }; append('\n')
            }
        }
        val projectRows = rows.filter { it.optString("projectId").isNotBlank() }
        val contribution = buildString {
            append("$MARKER\n# 项目贡献\n\n更新时间：$date\n\n")
            append("以下为已关联当前学生且来源可核验的项目相关学习记录；项目归属或资料内容本身不能证明学生个人贡献，个人贡献需核对具体行动。\n\n")
            if (projectRows.isEmpty()) append("暂无可核验的学生项目贡献记录。\n")
            projectRows.groupBy { safe(it.optString("projectName").ifBlank { "关联项目" }) }.forEach { (name, items) ->
                append("## $name\n\n"); items.forEach { append(describe(it)).append('\n') }; append('\n')
            }
        }
        return profile to contribution
    }
}
