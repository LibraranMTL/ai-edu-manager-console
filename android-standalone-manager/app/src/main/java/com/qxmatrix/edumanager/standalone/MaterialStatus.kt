package com.qxmatrix.edumanager.standalone

enum class MaterialStatus(val wireValue: String) {
    PENDING_DIGEST("pending_digest"), SUBMITTED("submitted"), DIGESTING("digesting"),
    PROCESSED("processed"), IGNORED("ignored"), INVALID("invalid"), FAILED("failed"), REMOVED("removed");

    fun canTransitionTo(next: MaterialStatus): Boolean = next == this || next in TRANSITIONS.getValue(this)

    companion object {
        fun normalize(value: String?): MaterialStatus = when (value?.trim()?.lowercase()) {
            "submitted", "waiting_result", "waiting_receipt" -> SUBMITTED
            "digesting", "processing", "running" -> DIGESTING
            "processed", "digested", "completed", "complete", "done", "success", "succeeded", "covered" -> PROCESSED
            "ignored", "skipped", "duplicate", "excluded" -> IGNORED
            "invalid", "empty", "empty_file" -> INVALID
            "failed", "error", "unreadable" -> FAILED
            "removed" -> REMOVED
            else -> PENDING_DIGEST
        }

        private val TRANSITIONS = mapOf(
            PENDING_DIGEST to setOf(SUBMITTED, IGNORED, INVALID, FAILED, REMOVED),
            SUBMITTED to setOf(DIGESTING, PROCESSED, IGNORED, INVALID, FAILED, REMOVED),
            DIGESTING to setOf(PROCESSED, IGNORED, INVALID, FAILED, REMOVED),
            FAILED to setOf(PENDING_DIGEST, SUBMITTED, REMOVED),
            PROCESSED to setOf(REMOVED), IGNORED to setOf(REMOVED), INVALID to setOf(REMOVED),
            REMOVED to emptySet(),
        )
    }
}
