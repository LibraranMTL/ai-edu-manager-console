package com.qxmatrix.edumanager.standalone

import android.os.Bundle
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel

/** Non-secret navigation and draft state. Credentials and license data are deliberately excluded. */
class StandaloneUiStateViewModel(private val saved: SavedStateHandle) : ViewModel() {
    var section: AppSection
        get() = AppSection.restore(saved.get<String>(KEY_SECTION))
        set(value) { saved[KEY_SECTION] = value.name }
    var studentId: String
        get() = saved.get<String>(KEY_STUDENT).orEmpty()
        set(value) { saved[KEY_STUDENT] = value }
    var projectId: String
        get() = saved.get<String>(KEY_PROJECT).orEmpty()
        set(value) { saved[KEY_PROJECT] = value }
    var materialFilter: String
        get() = saved.get<String>(KEY_MATERIAL_FILTER).orEmpty()
        set(value) { saved[KEY_MATERIAL_FILTER] = value }
    var materialTab: String
        get() = saved.get<String>(KEY_MATERIAL_TAB).orEmpty()
        set(value) { saved[KEY_MATERIAL_TAB] = value.take(40) }
    var materialAdvanced: Boolean
        get() = saved.get<Boolean>(KEY_MATERIAL_ADVANCED) ?: false
        set(value) { saved[KEY_MATERIAL_ADVANCED] = value }
    var query: String
        get() = saved.get<String>(KEY_QUERY).orEmpty()
        set(value) { saved[KEY_QUERY] = value.take(200) }
    var sort: String
        get() = saved.get<String>(KEY_SORT).orEmpty()
        set(value) { saved[KEY_SORT] = value.take(40) }
    var scrollY: Int
        get() = saved.get<Int>(KEY_SCROLL) ?: 0
        set(value) { saved[KEY_SCROLL] = value.coerceAtLeast(0) }
    fun scrollY(section: AppSection): Int = saved.get<Int>("$KEY_SCROLL:${section.name}") ?: if (section == this.section) scrollY else 0
    fun setScrollY(section: AppSection, value: Int) { saved["$KEY_SCROLL:${section.name}"] = value.coerceAtLeast(0) }
    var pendingOperation: String
        get() = saved.get<String>(KEY_PENDING_OPERATION).orEmpty()
        set(value) { saved[KEY_PENDING_OPERATION] = value.take(80) }
    var pendingUri: String
        get() = saved.get<String>(KEY_PENDING_URI).orEmpty()
        set(value) { saved[KEY_PENDING_URI] = value.take(2_000) }
    var draftTitle: String
        get() = saved.get<String>(KEY_DRAFT_TITLE).orEmpty()
        set(value) { saved[KEY_DRAFT_TITLE] = value.take(500) }
    var draftBody: String
        get() = saved.get<String>(KEY_DRAFT_BODY).orEmpty()
        set(value) { saved[KEY_DRAFT_BODY] = value.take(8_000) }

    fun saveTo(bundle: Bundle) {
        // Keep utility routes such as ARCHIVES verbatim. They are normalized only when the
        // primary navigation is restored, so MainActivity can reopen the matching utility page.
        bundle.putString(KEY_SECTION, saved.get<String>(KEY_SECTION) ?: section.name)
        bundle.putString(KEY_STUDENT, studentId)
        bundle.putString(KEY_PROJECT, projectId)
        bundle.putString(KEY_MATERIAL_FILTER, materialFilter)
        bundle.putString(KEY_MATERIAL_TAB, materialTab)
        bundle.putBoolean(KEY_MATERIAL_ADVANCED, materialAdvanced)
        bundle.putString(KEY_QUERY, query)
        bundle.putString(KEY_SORT, sort)
        bundle.putInt(KEY_SCROLL, scrollY)
        AppSection.entries.forEach { section -> bundle.putInt("$KEY_SCROLL:${section.name}", scrollY(section)) }
        bundle.putString(KEY_PENDING_OPERATION, pendingOperation)
        bundle.putString(KEY_PENDING_URI, pendingUri)
        bundle.putString(KEY_DRAFT_TITLE, draftTitle)
        bundle.putString(KEY_DRAFT_BODY, draftBody)
    }

    companion object {
        const val KEY_SECTION = "active_section"
        const val KEY_STUDENT = "current_student_id"
        const val KEY_PROJECT = "current_project_id"
        const val KEY_MATERIAL_FILTER = "material_filter"
        const val KEY_MATERIAL_TAB = "material_tab"
        const val KEY_MATERIAL_ADVANCED = "material_advanced"
        const val KEY_QUERY = "list_query"
        const val KEY_SORT = "list_sort"
        const val KEY_SCROLL = "section_scroll_y"
        const val KEY_PENDING_OPERATION = "pending_operation"
        const val KEY_PENDING_URI = "pending_uri"
        const val KEY_DRAFT_TITLE = "draft_title"
        const val KEY_DRAFT_BODY = "draft_body"
    }
}
