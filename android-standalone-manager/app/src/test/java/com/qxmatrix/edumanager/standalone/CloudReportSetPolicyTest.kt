package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudReportSetPolicyTest {
    @Test fun completeCommittedSetMatches() {
        val hashes = ('a'..'d').map { it.toString().repeat(64) }
        assertTrue(CloudReportSetPolicy.matches(hashes, hashes.toList()))
    }

    @Test fun partialWriteAndMissingFileCannotMatchCommittedSet() {
        val hashes = ('a'..'d').map { it.toString().repeat(64) }
        assertFalse(CloudReportSetPolicy.matches(hashes, hashes.take(3)))
        assertFalse(CloudReportSetPolicy.matches(hashes, listOf("e".repeat(64)) + hashes.drop(1)))
        assertFalse(CloudReportSetPolicy.matches(hashes, hashes.map { "not-a-sha" }))
    }

    @Test fun interruptedNewPublicationCannotReusePreviousManifest() {
        val hashes = ('a'..'d').map { it.toString().repeat(64) }
        assertFalse(CloudReportSetPolicy.uploadable("new-publication", "old-publication", hashes, hashes))
        assertFalse(CloudReportSetPolicy.uploadable("new-publication", null, hashes, hashes))
        assertTrue(CloudReportSetPolicy.uploadable(null, "old-publication", hashes, hashes))
    }

    @Test fun crashAfterManifestCommitIsRecoverableOnlyForMatchingPublication() {
        val hashes = ('a'..'d').map { it.toString().repeat(64) }
        assertTrue(CloudReportSetPolicy.uploadable("publication-1", "publication-1", hashes, hashes))
        assertFalse(CloudReportSetPolicy.uploadable("publication-1", "publication-1", hashes, hashes.dropLast(1)))
    }

    @Test fun startupRecoversOnlyConfiguredEnabledOrPendingStudents() {
        val first = "student-11111111-1111-4111-8111-111111111111"
        val second = "student-22222222-2222-4222-8222-222222222222"
        val disabled = "student-33333333-3333-4333-8333-333333333333"
        val preferences: Map<String, Any> = mapOf(
            "cloud:$first" to "cs_first", "enabled:$first" to true,
            "cloud:$second" to "cs_second", "enabled:$second" to false, "pending:$second" to "disable",
            "cloud:$disabled" to "cs_disabled", "enabled:$disabled" to false,
            "cloud:../../invalid" to "cs_invalid", "enabled:../../invalid" to true,
        )
        assertTrue(CloudReportSetPolicy.recoveryCandidates(preferences) == listOf(first, second))
    }
}
