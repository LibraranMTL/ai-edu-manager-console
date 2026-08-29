package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationNearbySecurityPolicyTest {
    @Test
    fun pairingFailuresUseBoundedIncreasingCooldowns() {
        assertEquals(2_000L, CollaborationNearbySecurityPolicy.pairingCooldownMillis(1))
        assertEquals(5_000L, CollaborationNearbySecurityPolicy.pairingCooldownMillis(2))
        assertEquals(15_000L, CollaborationNearbySecurityPolicy.pairingCooldownMillis(3))
        assertEquals(60_000L, CollaborationNearbySecurityPolicy.pairingCooldownMillis(4))
        assertEquals(60_000L, CollaborationNearbySecurityPolicy.pairingCooldownMillis(99))
        assertEquals(5, CollaborationNearbySecurityPolicy.MAX_PAIRING_FAILURES)
    }

    @Test
    fun inboundPackageOnlyExpiresAfterSevenDays() {
        val now = 10L * CollaborationNearbySecurityPolicy.INBOUND_RETENTION_MS
        assertFalse(CollaborationNearbySecurityPolicy.expiredInbound(now - CollaborationNearbySecurityPolicy.INBOUND_RETENTION_MS + 1, now))
        assertTrue(CollaborationNearbySecurityPolicy.expiredInbound(now - CollaborationNearbySecurityPolicy.INBOUND_RETENTION_MS, now))
        assertTrue(CollaborationNearbySecurityPolicy.expiredInbound(0L, now))
    }

    @Test
    fun stagingAppendProjectionCountsEveryNewByte() {
        assertEquals(3_524L, CollaborationNearbySecurityPolicy.projectedAppendBytes(2_500L, 1_024L))
        assertEquals(2_000L, CollaborationNearbySecurityPolicy.projectedAppendBytes(2_000L, 0L))
    }

    @Test
    fun freeSpaceAlwaysKeepsTheSafetyReserve() {
        val reserve = CollaborationNearbySecurityPolicy.MIN_FREE_BYTES
        assertTrue(CollaborationNearbySecurityPolicy.hasRequiredFreeSpace(reserve + 100L, 100L))
        assertFalse(CollaborationNearbySecurityPolicy.hasRequiredFreeSpace(reserve + 99L, 100L))
    }
}
