package com.qxmatrix.edumanager.standalone

import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationSyncPolicyTest {
    @Test fun scopeLimitAcceptsMoreThanFiveThousandButNeverTruncatesSilently() {
        CollaborationSyncPolicy.requireCompleteScope(5_005, "fixture")
        val error = runCatching {
            CollaborationSyncPolicy.requireCompleteScope(CollaborationSyncPolicy.MAX_FILES_PER_SCOPE + 1, "fixture")
        }.exceptionOrNull()
        assertTrue(error?.message?.contains("超过") == true)
    }

    @Test fun inventoryReuseRequiresExactMetadataAndPeriodicReverification() {
        val now = 2_000_000L
        val inventory = CollaborationFileInventoryEntity(
            localStudentId = "student-a",
            kind = "confirmed_knowledge",
            relativePath = "知识.md",
            sizeBytes = 12,
            lastModified = 1_000,
            contentSha256 = "a".repeat(64),
            verifiedAtMillis = now - 1_000,
        )
        assertTrue(CollaborationSyncPolicy.mayReuseInventory(inventory, 12, 1_000, now))
        assertFalse(CollaborationSyncPolicy.mayReuseInventory(inventory, 13, 1_000, now))
        assertFalse(CollaborationSyncPolicy.mayReuseInventory(inventory, 12, 0, now))
        assertFalse(CollaborationSyncPolicy.mayReuseInventory(inventory, 12, 1_000, now + CollaborationSyncPolicy.INVENTORY_REVERIFY_MS))
    }

    @Test fun resumedFileStreamSkipsOnceThenReadsSequentialChunks() {
        val source = ByteArray(3 * 1024 * 1024) { index -> (index % 251).toByte() }
        val input = ByteArrayInputStream(source)
        val offset = 1024L * 1024
        CollaborationStreamPolicy.skipFully(input, offset)
        val first = CollaborationStreamPolicy.readExactly(input, 1024 * 1024)
        val second = CollaborationStreamPolicy.readExactly(input, 1024 * 1024)
        assertArrayEquals(source.copyOfRange(offset.toInt(), offset.toInt() + first.size), first)
        assertArrayEquals(source.copyOfRange(offset.toInt() + first.size, source.size), second)
        assertEquals(0, input.available())
    }

    @Test fun persistedRetryDelayUsesTheExactNextAttemptWithoutGoingNegative() {
        assertEquals(15_000L, CollaborationQueuePolicy.followUpDelay(115_000L, 100_000L))
        assertEquals(0L, CollaborationQueuePolicy.followUpDelay(99_000L, 100_000L))
    }
}
