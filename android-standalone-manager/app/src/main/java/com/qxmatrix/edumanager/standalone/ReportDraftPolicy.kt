package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

data class CompletedReportSections(val sections: JSONObject, val adoptedModelSections: Int, val fallbackSections: Int, val warnings: List<String>)

/** Makes report drafting tolerant of incomplete model JSON while keeping evidence citations strict. */
object ReportDraftPolicy {
    private val citationPattern = Regex("[\\[【]依据\\s*[:：]\\s*([^\\]】]+)[\\]】]")
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
        val candidates = sectionNames.associateWith { sectionValue(modelSections, it) }
        val providedCandidates = candidates.values.filter(String::isNotBlank)
        val modelReturnedOnlyConservativeText = providedCandidates.isNotEmpty() && providedCandidates.all(::isConservativeOnly)
        val output = JSONObject(); val warnings = mutableListOf<String>(); var adopted = 0; var fallback = 0
        sectionNames.forEach { section ->
            val candidate = candidates.getValue(section)
            val citedIds = citationIds(candidate)
            val invalidIds = citedIds.filterNot(allowedIds::contains)
            val needsCitation = candidate.isNotBlank() && !isConservativeOnly(candidate) && !citationPattern.containsMatchIn(candidate)
            val allConservativeDespiteEvidence = allowedIds.isNotEmpty() && modelReturnedOnlyConservativeText && isConservativeOnly(candidate)
            if (candidate.isNotBlank() && invalidIds.isEmpty() && !needsCitation && !allConservativeDespiteEvidence) {
                output.put(section, candidate); adopted += 1
            } else {
                output.put(section, evidenceFallback(section, confirmedEvidence))
                fallback += 1
                when {
                    candidate.isBlank() -> warnings += "$section 缺失，已改用已确认成长证据"
                    invalidIds.isNotEmpty() -> warnings += "$section 引用了未确认依据，已改用已确认成长证据"
                    needsCitation -> warnings += "$section 没有可核验依据，已改用已确认成长证据"
                    allConservativeDespiteEvidence -> warnings += "$section 未使用已有证据，已改用已确认成长证据"
                }
            }
        }
        return CompletedReportSections(output, adopted, fallback, warnings)
    }

    private fun citationIds(value: String): List<String> = citationPattern.findAll(value).flatMap { match ->
        match.groupValues[1].split(Regex("[,，、\\s]+")).asSequence().map(String::trim).filter(String::isNotBlank)
    }.toList()

    private fun sectionValue(sections: JSONObject?, expected: String): String {
        if (sections == null) return ""
        sections.optString(expected).trim().takeIf(String::isNotBlank)?.let { return it }
        val expectedKey = normalizedHeading(expected)
        val keys = sections.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            if (normalizedHeading(key) == expectedKey) return sections.optString(key).trim()
        }
        return ""
    }

    private fun normalizedHeading(value: String): String = value.trim()
        .removePrefix("##").trim()
        .replace(Regex("^[（(]?\\d+[）).、．.：:]\\s*"), "")
        .replace(Regex("\\s+"), "")

    private fun evidenceFallback(section: String, evidence: List<JSONObject>): String {
        val usable = evidence.filter { it.optString("id").isNotBlank() }.distinctBy { it.optString("id") }.take(8)
        if (usable.isEmpty()) return "资料不足。"
        val rows = usable.joinToString("\n") { item ->
            val id = item.optString("id").trim()
            val title = inlineText(item.optString("title", "成长证据")).ifBlank { "成长证据" }
            val content = inlineText(item.optString("content")).take(320)
            if (section == "依据来源" || content.isBlank()) "- $title [依据:$id]" else "- $title：$content [依据:$id]"
        }
        return if (section == "依据来源") rows else "以下内容直接来自已确认的成长证据，未作额外推断：\n$rows"
    }

    private fun inlineText(value: String) = value.trim().replace(Regex("\\s+"), " ")

    private fun isConservativeOnly(value: String): Boolean {
        if (!conservativePattern.containsMatchIn(value)) return false
        return conservativePattern.replace(value, "")
            .replace(Regex("[\\s，。！？、；：,.!?;:()（）【】\\[\\]>*+_-]"), "")
            .isBlank()
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
