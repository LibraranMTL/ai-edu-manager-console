package com.qxmatrix.edumanager.standalone

import java.security.MessageDigest

data class EducationPublicationTemplate(
    val id: String,
    val name: String,
    val description: String,
    val formats: List<String>,
)

data class EducationPublicationItem(
    val text: String,
    val sourceHeading: String,
)

data class EducationPublicationSection(
    val id: String,
    val label: String,
    val items: List<EducationPublicationItem>,
)

data class EducationPublicationDraft(
    val schema: String,
    val templateId: String,
    val title: String,
    val subtitle: String,
    val sourceHash: String,
    val generatedAt: String,
    val mode: String,
    val markdown: String,
    val sections: List<EducationPublicationSection>,
    val generationMethod: String = "source",
    val edited: Boolean = false,
) {
    fun renderedMarkdown(): String = when (mode) {
        "document" -> markdown
        else -> buildString {
            append("# ").append(title).append("\n\n")
            if (subtitle.isNotBlank()) append("> ").append(subtitle).append("\n\n")
            sections.forEach { section ->
                append("## ").append(section.label).append("\n\n")
                section.items.forEach { append("- ").append(it.text).append("\n") }
                append("\n")
            }
        }.trimEnd() + "\n"
    }
}

data class ValidatedEducationReport(
    val title: String,
    val sourceHash: String,
    val markdown: String,
)

/** Cross-platform publication rules shared with the Windows host template contract. */
object EducationPublicationPolicy {
    const val PUBLICATION_SCHEMA = "edu-manager.education-publication.v1"
    const val DRAFT_SCHEMA = "edu-manager.education-publication-draft.v2"

    val TEMPLATES = listOf(
        EducationPublicationTemplate("formal", "正式报告", "完整保留报告主体，适合正式沟通", listOf("pdf", "markdown")),
        EducationPublicationTemplate("concise", "简明报告", "按结论、进展、关注与行动提取原文", listOf("pdf", "png", "markdown")),
        EducationPublicationTemplate("growth-card", "成长要点卡", "适合手机查看和分享", listOf("png", "pdf")),
    )

    private val placeholder = Regex("^(?:[-*+>\\s]*)(?:待生成|待补充|资料不足|本周期无实质变化)[。.!！?？\\s]*$")
    private val publishableStatuses = setOf("published", "current", "updated", "active")

    fun validatePublishedReport(studentId: String, expectedTitle: String, source: String): ValidatedEducationReport {
        require(source.toByteArray(Charsets.UTF_8).size <= 2 * 1024 * 1024) { "学情报告超过出版上限" }
        val frontmatter = parseFrontmatter(source)
        require(isPublishableStatus(frontmatter["status"].orEmpty())) { "只能输出已经审核发布的正式学情报告" }
        val declaredStudent = frontmatter["student_id"].orEmpty().trim()
        require(declaredStudent.isBlank() || declaredStudent == studentId) { "报告归属与当前学生不一致，已停止输出" }
        val normalized = normalizeDocument(source)
        require(hasMeaningfulBody(source)) { "报告仍是空白或占位内容，请先生成、审核并发布正式报告" }
        val title = normalized.lineSequence().firstOrNull { it.startsWith("# ") }?.removePrefix("# ")?.trim().orEmpty().ifBlank { expectedTitle }
        return ValidatedEducationReport(title, sha256(source), normalized)
    }

    /** Matches the formal report states already used by Windows and archive synchronization. */
    fun isPublishableStatus(status: String): Boolean = status.trim().lowercase() in publishableStatuses

    /** Used by the UI to distinguish an untouched template from an existing report that must not be overwritten. */
    fun hasMeaningfulBody(source: String): Boolean {
        val meaningful = normalizeDocument(source).lineSequence()
            .map(String::trim)
            .filter { it.isNotBlank() && !it.startsWith('#') && !it.startsWith('>') && !placeholder.matches(it) }
            .joinToString("")
            .replace(Regex("[\\s，。！？、；：‘’“”（）()|_-]"), "")
        return meaningful.length >= 12
    }

    fun buildDraft(validated: ValidatedEducationReport, templateId: String): EducationPublicationDraft {
        require(TEMPLATES.any { it.id == templateId }) { "未知输出模板" }
        val units = publicationUnits(validated.markdown)
        val sections = when (templateId) {
            "formal" -> emptyList()
            "growth-card" -> growthSections(units)
            else -> summarySections(units)
        }
        require(templateId == "formal" || sections.isNotEmpty()) { "报告缺少可提取的有效正文，请改用正式报告模板" }
        return EducationPublicationDraft(
            schema = DRAFT_SCHEMA,
            templateId = templateId,
            title = validated.title,
            subtitle = if (templateId == "formal") "学情报告" else "学情报告要点",
            sourceHash = validated.sourceHash,
            generatedAt = Timestamp.now(),
            mode = if (templateId == "formal") "document" else if (templateId == "growth-card") "card" else "summary",
            markdown = if (templateId == "formal") validated.markdown else "",
            sections = sections,
        )
    }

    /** Agent is allowed to select exact source excerpts only; any invented/rephrased sentence fails closed. */
    fun buildAgentSelectedDraft(base: EducationPublicationDraft, source: String, selected: List<String>): EducationPublicationDraft {
        require(base.templateId != "formal") { "正式报告始终忠实保留原文，不进行 Agent 改写" }
        val normalizedSource = plain(source).replace(Regex("\\s+"), "")
        val items = selected.map(String::trim).filter(String::isNotBlank).distinct().take(8)
        require(items.isNotEmpty()) { "Agent 未返回可用要点" }
        require(items.all { normalizedSource.contains(plain(it).replace(Regex("\\s+"), "")) }) { "Agent 内容未通过原文一致性校验" }
        return base.copy(
            sections = listOf(EducationPublicationSection("agent", "Agent 精选原文要点", items.map { EducationPublicationItem(it, "原文") })),
            generationMethod = "agent",
        )
    }

    fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun parseFrontmatter(source: String): Map<String, String> {
        val lines = source.removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n').lines()
        if (lines.firstOrNull()?.trim() != "---") return emptyMap()
        val end = lines.drop(1).indexOfFirst { it.trim() == "---" }
        if (end < 0) return emptyMap()
        return lines.subList(1, end + 1).mapNotNull { line ->
            val index = line.indexOf(':')
            if (index <= 0) null else line.substring(0, index).trim().lowercase() to line.substring(index + 1).trim()
        }.toMap()
    }

    private fun normalizeDocument(source: String): String {
        val normalized = source.removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n')
        if (!normalized.startsWith("---\n")) return normalized.trim() + "\n"
        val end = normalized.indexOf("\n---\n", 4)
        return (if (end >= 0) normalized.substring(end + 5) else normalized).trim() + "\n"
    }

    private data class Unit(val text: String, val heading: String, val category: String)

    private fun publicationUnits(markdown: String): List<Unit> {
        var heading = "正文"
        val output = mutableListOf<Unit>()
        val lines = markdown.lines()
        lines.forEachIndexed { index, line ->
            val trimmed = line.trim()
            if (trimmed.startsWith("#")) {
                heading = trimmed.trimStart('#').trim().ifBlank { heading }
                return@forEachIndexed
            }
            val value = if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                val cells = trimmed.trim('|').split('|').map(String::trim)
                val separator = cells.isEmpty() || cells.all { it.matches(Regex(":?-{3,}:?")) }
                val header = lines.getOrNull(index + 1)?.trim()?.let(::isTableSeparator) == true
                if (separator || header) return@forEachIndexed
                cells.filterNot(String::isBlank).joinToString("；")
            } else trimmed.replace(Regex("^(?:[-*+]\\s+|\\d+[.)]\\s+|>\\s*)"), "").trim()
            if (value.length < 4 || placeholder.matches(value) || value.startsWith("```")) return@forEachIndexed
            splitSentences(value).forEach { sentence ->
                val category = classify("$heading $sentence")
                output += Unit(sentence, heading, category)
            }
        }
        return output.distinctBy { plain(it.text).lowercase() }
    }

    private fun isTableSeparator(value: String): Boolean = value.startsWith('|') && value.endsWith('|') &&
        value.trim('|').split('|').map(String::trim).all { it.matches(Regex(":?-{3,}:?")) }

    private fun splitSentences(value: String): List<String> = value.split(Regex("(?<=[。！？!?；;])\\s*"))
        .map(String::trim).filter { it.length >= 4 }

    private fun classify(value: String): String = when {
        Regex("下一步|建议|行动|目标|计划|里程碑|不建议|观察点").containsMatchIn(value) -> "action"
        Regex("短板|问题|风险|弱势|不足|关注|困难|波动|回落|待提升").containsMatchIn(value) -> "attention"
        Regex("优势|亮点|潜力|擅长|兴趣|动力|能力").containsMatchIn(value) -> "strength"
        Regex("最近|近期|本周|本月|变化|更新|进展|提升|完成").containsMatchIn(value) -> "progress"
        Regex("整体|画像|概述|综合评估|结论|当前状态").containsMatchIn(value) -> "overview"
        else -> "other"
    }

    private fun summarySections(units: List<Unit>): List<EducationPublicationSection> {
        val specs = listOf("overview" to "核心结论", "progress" to "近期主要进展", "strength" to "优势与潜力", "attention" to "当前重点问题", "action" to "下一步建议")
        val used = mutableSetOf<String>()
        val sections = specs.mapNotNull { (category, label) ->
            var selected = units.filter { it.category == category && it.text !in used }.take(if (category == "overview") 1 else 2)
            if (selected.isEmpty() && category == "overview") selected = units.filter { it.text !in used }.take(1)
            selected.forEach { used += it.text }
            selected.takeIf { it.isNotEmpty() }?.let { EducationPublicationSection(category, label, it.map { unit -> EducationPublicationItem(unit.text, unit.heading) }) }
        }.toMutableList()
        if (sections.sumOf { it.items.size } < 3) {
            units.filter { used.add(it.text) }.take(3).takeIf { it.isNotEmpty() }?.let { rest ->
                sections += EducationPublicationSection("other", "补充要点", rest.map { EducationPublicationItem(it.text, it.heading) })
            }
        }
        return sections
    }

    private fun growthSections(units: List<Unit>): List<EducationPublicationSection> {
        val specs = listOf("progress" to "本期进步", "strength" to "当前优势", "attention" to "需要关注", "action" to "下一步行动")
        val used = mutableSetOf<String>()
        val sections = specs.mapNotNull { (category, label) ->
            units.firstOrNull { it.category == category && used.add(it.text) }?.let { EducationPublicationSection(category, label, listOf(EducationPublicationItem(it.text, it.heading))) }
        }.toMutableList()
        if (sections.isEmpty()) units.take(4).forEachIndexed { index, unit -> sections += EducationPublicationSection("other-$index", "成长要点", listOf(EducationPublicationItem(unit.text, unit.heading))) }
        units.filter { used.add(it.text) }.take((6 - sections.sumOf { it.items.size }).coerceAtLeast(0)).forEach { unit ->
            val index = sections.indexOfFirst { it.id == unit.category }.takeIf { it >= 0 } ?: 0
            if (sections.isNotEmpty()) sections[index] = sections[index].copy(items = sections[index].items + EducationPublicationItem(unit.text, unit.heading))
        }
        return sections
    }

    private fun plain(value: String): String = value.replace(Regex("[`*_#>\\[\\]()]"), "").trim()
}
