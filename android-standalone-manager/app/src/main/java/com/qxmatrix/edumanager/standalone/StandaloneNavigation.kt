package com.qxmatrix.edumanager.standalone

import androidx.annotation.StringRes

/** Stable seven-domain navigation. Legacy names are accepted only for state restoration. */
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
            "COURSES", "GROWTH" -> LEARNING
            "PLANNING" -> PROJECTS
            "KNOWLEDGE" -> MATERIALS
            else -> entries.firstOrNull { it.name == raw } ?: HOME
        }
    }
}

fun AppSection.label(context: android.content.Context): String = context.getString(titleRes)
fun AppSection.displayLabel(context: android.content.Context): String = "$icon  ${label(context)}"
