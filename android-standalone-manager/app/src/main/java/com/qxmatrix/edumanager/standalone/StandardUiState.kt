package com.qxmatrix.edumanager.standalone

import android.content.Context

enum class StandardUiState(val labelRes: Int) {
    LOADING(R.string.state_loading),
    EMPTY(R.string.state_empty),
    PROCESSING(R.string.state_processing),
    STORAGE_GRANT_LOST(R.string.state_storage_grant_lost),
    NETWORK_UNAVAILABLE(R.string.state_network_unavailable),
    SOURCE_PRESERVED(R.string.state_source_preserved),
    GROWTH_ATTENTION(R.string.state_growth_attention),
}

data class StandardUiMessage(val state: StandardUiState, val detail: String = "") {
    fun text(context: Context): String = context.getString(state.labelRes) + detail.trim().takeIf(String::isNotBlank)?.let { "\n$it" }.orEmpty()
    val announcesError: Boolean get() = state in setOf(StandardUiState.STORAGE_GRANT_LOST, StandardUiState.NETWORK_UNAVAILABLE, StandardUiState.SOURCE_PRESERVED, StandardUiState.GROWTH_ATTENTION)
}
