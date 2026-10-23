package com.qxmatrix.edumanager.standalone

import java.util.GregorianCalendar
import java.util.TimeZone

/**
 * Read-only path compatibility for student archives created by older Android or Windows builds.
 * The resolver never moves or rewrites a legacy document. New writes continue to use the current
 * summaryPath/成长模型 and summaryPath/学情报告 contract.
 */
object StudentArchiveCompatibility {
    private val pathDatePattern = Regex(
        "(?<!\\d)(20\\d{2})[-_.年/]?(0[1-9]|1[0-2])[-_.月/]?(0[1-9]|[12]\\d|3[01])" +
            "(?:[T _-]?([01]\\d|2[0-3])(?:[:时._-]?([0-5]\\d))?(?:[:分._-]?([0-5]\\d))?)?",
    )
    private val reportAliases = mapOf(
        "整体画像.md" to setOf("整体画像.md", "学生画像.md", "学情画像.md"),
        "历史变化.md" to setOf("历史变化.md", "成长变化.md", "学情变化.md"),
        "每日行动建议.md" to setOf("每日行动建议.md", "每周行动建议.md", "行动建议.md"),
        "阶段总结.md" to setOf("阶段总结.md", "阶段学情报告.md", "阶段报告.md"),
    )
    val reportDocumentNames = reportAliases.values.flatten().toSet()
    val growthDocumentNames = setOf(
        "index.md", "能力画像.md", "项目贡献.md", "成长证据.md", "成长证据草稿.md", "growth-index.md",
    )

    fun archiveRoots(student: StudentRecord, category: String): List<String> = when (category) {
        "成长模型" -> growthRoots(student) + growthDocumentNames.flatMap { growthDocumentPaths(student, it) }
        "学情报告" -> reportRoots(student) + reportDocumentNames.flatMap { reportDocumentPathsForAlias(student, it) }
        else -> emptyList()
    }.distinct()

    fun reportDocumentPaths(student: StudentRecord, fileName: String): List<String> {
        require(fileName in reportAliases) { "未知学情报告文件" }
        return reportAliases.getValue(fileName).flatMap { reportDocumentPathsForAlias(student, it) }.distinct()
    }

    fun reportSearchRoots(student: StudentRecord): List<String> =
        (reportRoots(student) + legacyArchiveRoots(student)).distinct()

    /** Broad locations are consumed only by the bounded archive-aware fallback scanner. */
    fun fallbackSearchRoots(student: StudentRecord): List<String> = if (student.knowledgeBaseMode == "adopted") {
        listOf(student.paths.summaryPath, student.paths.rootPath, "").distinct()
    } else {
        listOf(student.paths.summaryPath, student.paths.rootPath).filter(String::isNotBlank).distinct()
    }

    fun archivePathTerms(category: String): Set<String> = when (category) {
        "成长模型" -> setOf("成长模型", "学生成长模型", "growth")
        "学情报告" -> setOf("学情报告", "学情分析汇总", "教育档案", "reports", "report")
        else -> emptySet()
    }

    fun archiveDocumentNames(category: String): Set<String> = when (category) {
        "成长模型" -> growthDocumentNames
        "学情报告" -> reportDocumentNames
        else -> emptySet()
    }

    fun archivePreferredTerms(student: StudentRecord, category: String): Set<String> =
        archivePathTerms(category) + setOf(student.name, "知识库", "汇总", "档案", "archive", "summary")

    fun reportNames(fileName: String): Set<String> = reportAliases[fileName] ?: setOf(fileName)

    /**
     * Education archive documents are always presented newest first. SAF providers occasionally
     * return 0 for old imported files, so a date embedded in the legacy path is used only as a
     * deterministic fallback. Files with no usable date stay at the end and are ordered by path.
     */
    fun newestFirst(files: Collection<SafWorkspaceStore.MarkdownFile>): List<SafWorkspaceStore.MarkdownFile> =
        files.sortedWith(
            compareByDescending<SafWorkspaceStore.MarkdownFile> {
                archiveDateMillis(it.lastModified, it.relativePath)
            }.thenBy { it.relativePath.lowercase() },
        )

    fun archiveDateMillis(lastModified: Long, relativePath: String): Long {
        if (lastModified > 0L) return lastModified
        val match = pathDatePattern.findAll(relativePath.replace('\\', '/')).lastOrNull() ?: return 0L
        val values = match.groupValues
        return runCatching {
            GregorianCalendar(TimeZone.getTimeZone("UTC")).apply {
                isLenient = false
                clear()
                set(
                    values[1].toInt(),
                    values[2].toInt() - 1,
                    values[3].toInt(),
                    values[4].toIntOrNull() ?: 0,
                    values[5].toIntOrNull() ?: 0,
                    values[6].toIntOrNull() ?: 0,
                )
            }.timeInMillis
        }.getOrDefault(0L)
    }

    fun isReportDocumentPath(relativePath: String): Boolean {
        val normalized = relativePath.replace('\\', '/')
        val fileName = normalized.substringAfterLast('/')
        return fileName in reportDocumentNames || normalized.contains("/学情报告/") ||
            normalized.startsWith("学情报告/") || normalized.contains("/教育档案/") ||
            normalized.lowercase().contains("/reports/")
    }

    fun isGrowthDocumentPath(relativePath: String): Boolean {
        val normalized = relativePath.replace('\\', '/')
        val fileName = normalized.substringAfterLast('/')
        return fileName in growthDocumentNames || normalized.contains("/成长模型/") || normalized.startsWith("成长模型/")
    }

    private fun reportDocumentPathsForAlias(student: StudentRecord, fileName: String): List<String> {
        val summary = student.paths.summaryPath
        val root = student.paths.rootPath
        return (reportRoots(student).map { child(it, fileName) } + listOf(
            child(summary, fileName),
            child(summary, "教育档案/$fileName"),
            child(root, fileName),
            child(root, "教育档案/$fileName"),
            fileName,
        )).filter(String::isNotBlank).distinct()
    }

    fun growthDocumentPaths(student: StudentRecord, fileName: String): List<String> {
        require(fileName in growthDocumentNames) { "未知成长模型文件" }
        val summary = student.paths.summaryPath
        val root = student.paths.rootPath
        return (growthRoots(student).map { child(it, fileName) } + listOf(
            child(summary, fileName),
            child(summary, "教育档案/$fileName"),
            child(root, fileName),
            child(root, "教育档案/$fileName"),
            fileName,
        )).filter(String::isNotBlank).distinct()
    }

    fun legacyArchiveRoots(student: StudentRecord): List<String> = listOf(
        child(student.paths.summaryPath, "教育档案"),
        child(student.paths.rootPath, "教育档案"),
        "教育档案",
    ).filter(String::isNotBlank).distinct()

    private fun growthRoots(student: StudentRecord): List<String> = listOf(
        "${student.name}学情分析汇总/成长模型",
        child(student.paths.summaryPath, "成长模型"),
        child(student.paths.summaryPath, "学生成长模型"),
        child(student.paths.summaryPath, "教育档案/成长模型"),
        child(student.paths.rootPath, "成长模型"),
        child(student.paths.rootPath, "教育档案/成长模型"),
        "成长模型",
        "${student.name}成长模型",
    )

    private fun reportRoots(student: StudentRecord): List<String> = listOf(
        "${student.name}学情分析汇总/学情报告",
        "${student.name}学情分析汇总/报告",
        child(student.paths.summaryPath, "学情报告"),
        child(student.paths.summaryPath, "报告"),
        child(student.paths.summaryPath, "教育档案/学情报告"),
        child(student.paths.rootPath, "学情报告"),
        child(student.paths.rootPath, "教育档案/学情报告"),
        "学情报告",
        "${student.name}学情报告",
    )

    private fun child(root: String, relative: String): String = when {
        root.isBlank() -> relative.trimStart('/')
        relative.isBlank() -> root.trimEnd('/')
        else -> "${root.trimEnd('/')}/${relative.trimStart('/')}"
    }
}
