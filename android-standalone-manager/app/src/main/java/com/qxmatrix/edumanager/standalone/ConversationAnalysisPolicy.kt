package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject

/** Fast local analysis used for navigation; Agent digestion remains the authoritative semantic step. */
object ConversationAnalysisPolicy {
    private val topicWords = listOf("数学", "语文", "英语", "物理", "化学", "生物", "历史", "地理", "编程", "阅读", "写作", "考试", "作业", "课程", "项目")

    fun analyze(content: String): JSONObject {
        val normalized = content.replace("\r\n", "\n").trim()
        val lines = normalized.lineSequence().map(String::trim).filter(String::isNotBlank).take(200).toList()
        val title = lines.firstOrNull()?.removePrefix("#")?.trim()?.take(60).orEmpty().ifBlank { "智能体对话" }
        val summary = lines.take(6).joinToString(" ").take(360)
        val topics = topicWords.filter { normalized.contains(it) }.take(8)
        val actionItems = lines.filter { line ->
            line.contains("待办") || line.contains("下一步") || line.contains("建议") || line.matches(Regex("^[-*]\\s*\\[[ xX]?].*"))
        }.map { it.take(240) }.distinct().take(20)
        return JSONObject()
            .put("schema", "edu-manager.conversation-analysis.v1")
            .put("mode", "local-fallback")
            .put("title", title)
            .put("summary", summary)
            .put("topics", JSONArray(topics))
            .put("actionItems", JSONArray(actionItems))
            .put("lineCount", lines.size)
    }
}
