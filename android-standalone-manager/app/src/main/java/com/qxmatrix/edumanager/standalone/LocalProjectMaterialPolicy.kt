package com.qxmatrix.edumanager.standalone

/** Pure policy shared by the local SAF service and JVM tests. */
object LocalProjectMaterialPolicy {
    const val SCHEMA = "edu-manager.android-project-materials.v1"
    const val MAX_SCAN_FILES = 5_000
    const val MAX_BATCH = 50

    val categories = linkedMapOf(
        "reference" to "参考资料",
        "design" to "方案设计",
        "progress" to "过程记录",
        "deliverable" to "提交成果",
        "team" to "团队协作",
        "other" to "其他资料",
    )
    private val safeExtensions = setOf("txt", "md", "markdown", "csv", "json", "pdf", "doc", "docx",
        "xls", "xlsx", "ppt", "pptx", "jpg", "jpeg", "png", "webp")
    private val dependencyExtensions = setOf("html", "htm", "mhtml", "css", "js", "mjs", "cjs", "xml",
        "dwg", "dxf", "step", "stp", "blend", "psd", "indd", "prproj")

    fun safeFilename(value: String): String {
        val cleaned = value.trim().replace(Regex("[\\/:*?\"<>|\\p{Cntrl}]"), "_")
            .trimEnd('.', ' ').take(180)
        return cleaned.ifBlank { "项目资料" }
    }

    fun isSafeOrdinaryFile(path: String): Boolean {
        val extension = path.substringAfterLast('.', "").lowercase()
        return extension in safeExtensions && extension !in dependencyExtensions
    }

    fun isDependencyProtected(path: String): Boolean {
        val extension = path.substringAfterLast('.', "").lowercase()
        return extension in dependencyExtensions || path.split('/').any {
            it.lowercase().endsWith("_files") || it.lowercase().endsWith(".assets")
        }
    }

    fun suggestedCategory(path: String): String? {
        val value = path.lowercase()
        return when {
            listOf("参考", "资料", "文献", "reference", "source").any(value::contains) -> "reference"
            listOf("方案", "设计", "design", "proposal").any(value::contains) -> "design"
            listOf("进展", "过程", "记录", "日志", "progress", "log").any(value::contains) -> "progress"
            listOf("成果", "提交", "交付", "报告", "deliverable", "final").any(value::contains) -> "deliverable"
            listOf("团队", "成员", "协作", "team").any(value::contains) -> "team"
            else -> null
        }
    }

    fun canAutoOrganize(relativePath: String, adoption: String, categoryId: String, manualLocked: Boolean,
                        actualCategoryIds: Set<String> = categories.keys, inboxPrefix: String = "项目工作空间/收件箱/"): Boolean =
        relativePath.startsWith(inboxPrefix) && relativePath.removePrefix(inboxPrefix).count { it == '/' } == 0 &&
            adoption == "accepted" && categoryId in actualCategoryIds && isSafeOrdinaryFile(relativePath) &&
            !isDependencyProtected(relativePath) && (manualLocked || suggestedCategory(relativePath) == categoryId)

    fun migrationDisposition(sourceKind: String, relativePath: String, targetOccupied: Boolean): String = when {
        sourceKind == "workspace" -> "associate"
        sourceKind == "adopted_external" -> "preserve_external"
        isDependencyProtected(relativePath) -> "preserve_dependency"
        targetOccupied -> "preserve_conflict"
        else -> "migrate"
    }
}
