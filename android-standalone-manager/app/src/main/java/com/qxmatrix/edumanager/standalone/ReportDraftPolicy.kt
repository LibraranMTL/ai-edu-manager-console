package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

data class CompletedReportSections(val sections: JSONObject, val adoptedModelSections: Int, val fallbackSections: Int, val warnings: List<String>)

/** Makes report drafting tolerant of incomplete model JSON while keeping evidence citations strict. */
object ReportDraftPolicy {
    private val citationPattern = Regex("\\[依据:([^\\]]+)]")
    private val conservativePattern = Regex("资料不足|本周期无实质变化|继续观察|暂无足够依据")

    fun extractModelSections(text: String, reportId: String): JSONObject {
        val cleaned = text.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        val start = cleaned.indexOf('{'); val end = cleaned.lastIndexOf('}')
        if (start < 0 || end <= start) return markdownSections(cleaned)
        val root = runCatching { JSONObject(cleaned.substring(start, end + 1)) }.getOrNull() ?: return markdownSections(cleaned)
        return root.optJSONObject("reports")?.optJSONObject(reportId)
            ?: root.optJSONObject(reportId)
            ?: root.optJSONObject("sections")
            ?: root
    }

    fun complete(sectionNames: List<String>, modelSections: JSONObject?, confirmedEvidence: List<JSONObject>): CompletedReportSections {
        val allowedIds = confirmedEvidence.map { it.optString("id") }.filter(String::isNotBlank).toSet()
        val evidenceList = if (confirmedEvidence.isEmpty()) "资料不足。" else confirmedEvidence.joinToString("\n") { "- ${it.optString("title", "成长证据")} [依据:${it.optString("id")}]" }
        val output = JSONObject(); val warnings = mutableListOf<String>(); var adopted = 0; var fallback = 0
        sectionNames.forEach { section ->
            val candidate = modelSections?.optString(section).orEmpty().trim()
            val invalidIds = citationPattern.findAll(candidate).map { it.groupValues[1] }.filterNot(allowedIds::contains).toList()
            val needsCitation = candidate.isNotBlank() && !conservativePattern.containsMatchIn(candidate) && !citationPattern.containsMatchIn(candidate)
            if (candidate.isNotBlank() && invalidIds.isEmpty() && !needsCitation) {
                output.put(section, candidate); adopted += 1
            } else {
                output.put(section, if (section == "依据来源") evidenceList else "资料不足。")
                fallback += 1
                when {
                    candidate.isBlank() -> warnings += "$section 缺失，已使用保守模板"
                    invalidIds.isNotEmpty() -> warnings += "$section 引用了未确认依据，已拒绝采用"
                    needsCitation -> warnings += "$section 没有可核验依据，已使用保守模板"
                }
            }
        }
        return CompletedReportSections(output, adopted, fallback, warnings)
    }

    private fun markdownSections(text: String): JSONObject {
        val sections = JSONObject(); var heading = ""; val body = mutableListOf<String>()
        fun flush() { if (heading.isNotBlank()) sections.put(heading, body.joinToString("\n").trim()); body.clear() }
        text.lines().forEach { line ->
            if (line.startsWith("## ")) { flush(); heading = line.removePrefix("## ").trim() }
            else if (heading.isNotBlank()) body += line
        }
        flush(); return sections
    }
}
