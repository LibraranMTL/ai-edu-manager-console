package com.qxmatrix.edumanager.standalone

/** Read-only decisions; ambiguity is never resolved by deleting a file. */
object FileOrganizationRecoveryPolicy {
    fun decision(sourceHash: String?, targetHash: String?, expectedHash: String,
                 registeredHash: String, registeredPath: String, source: String, target: String): String = when {
        registeredHash != expectedHash || registeredPath !in setOf(source, target) -> "needs_user"
        sourceHash == null && targetHash == expectedHash -> "adopt_target"
        sourceHash == expectedHash && targetHash == null && registeredPath == source -> "keep_source"
        else -> "needs_user"
    }
}
