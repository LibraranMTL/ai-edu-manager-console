package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MaterialStatusTest {
    @Test
    fun exposesTheEightAuthoritativeStatuses() {
        assertEquals(
            listOf("pending_digest", "submitted", "digesting", "processed", "ignored", "invalid", "failed", "removed"),
            MaterialStatus.entries.map { it.wireValue },
        )
    }

    @Test
    fun normalizesLegacyWindowsReceiptTerms() {
        assertEquals(MaterialStatus.PENDING_DIGEST, MaterialStatus.normalize("queued"))
        assertEquals(MaterialStatus.PROCESSED, MaterialStatus.normalize("completed"))
        assertEquals(MaterialStatus.IGNORED, MaterialStatus.normalize("duplicate"))
        assertEquals(MaterialStatus.INVALID, MaterialStatus.normalize("empty_file"))
    }

    @Test
    fun enforcesForwardProcessingAndExplicitRetryOrRemoval() {
        assertTrue(MaterialStatus.PENDING_DIGEST.canTransitionTo(MaterialStatus.SUBMITTED))
        assertTrue(MaterialStatus.DIGESTING.canTransitionTo(MaterialStatus.PROCESSED))
        assertTrue(MaterialStatus.FAILED.canTransitionTo(MaterialStatus.PENDING_DIGEST))
        assertFalse(MaterialStatus.PROCESSED.canTransitionTo(MaterialStatus.DIGESTING))
        assertFalse(MaterialStatus.REMOVED.canTransitionTo(MaterialStatus.PENDING_DIGEST))
    }
}
