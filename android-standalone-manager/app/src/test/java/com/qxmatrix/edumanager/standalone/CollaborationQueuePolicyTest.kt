package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationQueuePolicyTest {
    @Test fun retriesUseBoundedBackoffBeforeBecomingVisibleFailure() {
        val now = 1_000_000L
        val first = CollaborationQueuePolicy.nextFailure(0, now)
        assertEquals("retry", first.first)
        assertEquals(1, first.second)
        assertTrue(first.third > now)

        val terminal = CollaborationQueuePolicy.nextFailure(CollaborationQueuePolicy.MAX_ATTEMPTS - 1, now)
        assertEquals("failed", terminal.first)
        assertEquals(CollaborationQueuePolicy.MAX_ATTEMPTS, terminal.second)
        assertEquals(0L, terminal.third)
    }
}
