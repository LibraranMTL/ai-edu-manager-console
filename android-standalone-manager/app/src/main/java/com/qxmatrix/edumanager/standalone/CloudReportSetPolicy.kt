package com.qxmatrix.edumanager.standalone

/** A publication is uploadable only when all four current files match one committed set. */
object CloudReportSetPolicy {
    fun matches(committedHashes: List<String>, currentHashes: List<String>): Boolean =
        committedHashes.size == 4 && currentHashes.size == 4 &&
            committedHashes.all { it.matches(Regex("^[a-f0-9]{64}$")) } &&
            committedHashes == currentHashes

    fun uploadable(
        pendingPublicationId: String?, committedPublicationId: String?,
        committedHashes: List<String>, currentHashes: List<String>,
    ): Boolean = !committedPublicationId.isNullOrBlank() &&
        (pendingPublicationId.isNullOrBlank() || pendingPublicationId == committedPublicationId) &&
        matches(committedHashes, currentHashes)

    /** Reconcile only configured students; never scan report files on the UI thread. */
    fun recoveryCandidates(preferences: Map<String, *>): List<String> = preferences.keys.asSequence()
        .filter { it.startsWith("cloud:") }
        .map { it.removePrefix("cloud:") }
        .filter { Regex("^student-[a-f0-9-]{36}$").matches(it) }
        .filter { studentId ->
            (preferences["cloud:$studentId"] as? String).orEmpty().isNotBlank() &&
                (preferences["enabled:$studentId"] == true ||
                    preferences["pending:$studentId"] in setOf("enable", "disable"))
        }
        .sorted().toList()
}
