package com.qxmatrix.edumanager.standalone

data class MaterialDigestCandidate(
    val materialId: String,
    val boundedCharacters: Int,
    val recoveryMarker: String = "",
)

/**
 * Keeps one model request small enough for ordinary mobile networks and provider latency.
 * Each returned batch receives its own task, execution ID, idempotency fingerprint and receipt.
 */
object MaterialDigestBatchPlanner {
    const val MAX_ITEMS_PER_BATCH = 3
    const val MAX_CHARACTERS_PER_BATCH = 12_000
    const val MAX_CHARACTERS_PER_SOURCE = 6_000

    fun plan(candidates: List<MaterialDigestCandidate>): List<List<String>> {
        val batches = mutableListOf<List<String>>()
        val current = mutableListOf<String>()
        var currentCharacters = 0
        var currentRecoveryMarker = ""

        fun flush() {
            if (current.isNotEmpty()) {
                batches += current.toList()
                current.clear()
                currentCharacters = 0
                currentRecoveryMarker = ""
            }
        }

        candidates.forEach { candidate ->
            require(candidate.materialId.isNotBlank()) { "资料 ID 不能为空" }
            val characters = candidate.boundedCharacters.coerceIn(1, MAX_CHARACTERS_PER_SOURCE)
            val crossesRecoveryScope = current.isNotEmpty() && currentRecoveryMarker != candidate.recoveryMarker &&
                (currentRecoveryMarker.isNotBlank() || candidate.recoveryMarker.isNotBlank())
            if (current.isNotEmpty() &&
                (crossesRecoveryScope || current.size >= MAX_ITEMS_PER_BATCH || currentCharacters + characters > MAX_CHARACTERS_PER_BATCH)) {
                flush()
            }
            if (current.isEmpty()) currentRecoveryMarker = candidate.recoveryMarker
            current += candidate.materialId
            currentCharacters += characters
        }
        flush()
        return batches
    }
}
