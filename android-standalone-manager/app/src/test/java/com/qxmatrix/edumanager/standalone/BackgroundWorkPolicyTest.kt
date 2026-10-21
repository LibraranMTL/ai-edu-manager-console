package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundWorkPolicyTest {
    @Test fun userStatesHideProtocolDetails() {
        assertEquals(UserWorkState.WAITING, UserWorkState.fromInternal("queued"))
        assertEquals(UserWorkState.NEEDS_HELP, UserWorkState.fromInternal("unknown"))
        assertEquals(UserWorkState.COMPLETED, UserWorkState.fromInternal("delivered"))
    }

    @Test fun idempotencyAndPerStudentNamesAreStableAndIsolated() {
        val one = BackgroundWorkPolicy.idempotencyKey("sync", "student-a", "source-1")
        assertEquals(one, BackgroundWorkPolicy.idempotencyKey("sync", "student-a", "source-1"))
        assertNotEquals(one, BackgroundWorkPolicy.idempotencyKey("sync", "student-b", "source-1"))
        assertTrue(BackgroundWorkPolicy.uniqueName("sync", "student-a").startsWith("edu-sync-student-"))
    }
}
