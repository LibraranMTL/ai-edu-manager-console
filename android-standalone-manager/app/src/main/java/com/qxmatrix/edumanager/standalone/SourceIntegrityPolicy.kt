package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

/** Pure classification; a transient read failure never deletes or rewrites source evidence. */
object SourceIntegrityPolicy {
    fun failure(row: JSONObject?, actualSha256: String?, actualSha1: String?): String? {
        if (row == null) return "source_missing_from_index"
        if (MaterialStatus.normalize(row.optString("status")) == MaterialStatus.REMOVED) return "source_removed"
        if (MaterialProcessingPolicy.attributionConflict(row)) return "source_scope_conflict"
        if (row.optString("sourceEvidence") == "current_bytes_observed_history_unverified") return "source_unverifiable"
        val sha256 = row.optString("sourceSha256").trim()
        val sha1 = row.optString("sha1").trim()
        if (sha256.isBlank() && sha1.isBlank()) return "source_unverifiable"
        if (actualSha256 == null || actualSha1 == null) return "source_unreadable"
        if (sha256.isNotBlank() && !sha256.equals(actualSha256, ignoreCase = true)) return "source_changed"
        if (sha256.isBlank() && !sha1.equals(actualSha1, ignoreCase = true)) return "source_changed"
        return null
    }
}
