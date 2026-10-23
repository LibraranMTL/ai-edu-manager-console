package com.qxmatrix.edumanager.standalone

import androidx.annotation.StringRes

/** Internal routes. ARCHIVES and SETTINGS remain utility routes, not primary destinations. */
enum class AppSection(@StringRes val titleRes: Int, val icon: String) {
    HOME(R.string.section_home, "⌂"),
    ARCHIVES(R.string.section_archives, "▣"),
    MATERIALS(R.string.section_materials, "＋"),
    LEARNING(R.string.section_learning, "▶"),
    REPORTS(R.string.section_reports, "☰"),
    PROJECTS(R.string.section_projects, "◆"),
    SETTINGS(R.string.section_settings, "⚙");

    companion object {
        fun restore(raw: String?): AppSection = when (raw) {
            "ARCHIVES" -> HOME
            "COURSES", "GROWTH" -> LEARNING
            "PLANNING" -> PROJECTS
            "KNOWLEDGE" -> MATERIALS
            else -> entries.firstOrNull { it.name == raw } ?: HOME
        }
    }
}

/** The five stable destinations shown in both the phone bar and tablet rail. */
enum class PrimaryDestination(val section: AppSection) {
    HOME(AppSection.HOME),
    MATERIALS(AppSection.MATERIALS),
    REPORTS(AppSection.REPORTS),
    LEARNING(AppSection.LEARNING),
    PROJECTS(AppSection.PROJECTS);
}

enum class PipelineStage { COLLECTION, DIGEST, REPORT, LEARNING }
enum class PipelineUserStatus { EMPTY, WAITING, PROCESSING, READY, NEEDS_HELP }

data class PipelineStageUiState(
    val stage: PipelineStage,
    val status: PipelineUserStatus,
    val title: String,
    val summary: String,
    val badge: String,
)

fun AppSection.label(context: android.content.Context): String = context.getString(titleRes)
fun AppSection.displayLabel(context: android.content.Context): String = "$icon  ${label(context)}"
