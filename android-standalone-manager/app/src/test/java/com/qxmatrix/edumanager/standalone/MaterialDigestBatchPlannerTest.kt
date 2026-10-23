package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MaterialDigestBatchPlannerTest {
    @Test
    fun splitsLargeSourcesByCharactersAndNeverExceedsThreeItems() {
        val batches = MaterialDigestBatchPlanner.plan(listOf(
            MaterialDigestCandidate("a", 6_000),
            MaterialDigestCandidate("b", 6_000),
            MaterialDigestCandidate("c", 6_000),
            MaterialDigestCandidate("d", 100),
            MaterialDigestCandidate("e", 100),
            MaterialDigestCandidate("f", 100),
        ))

        assertEquals(listOf(listOf("a", "b"), listOf("c", "d", "e"), listOf("f")), batches)
        assertTrue(batches.all { it.size <= MaterialDigestBatchPlanner.MAX_ITEMS_PER_BATCH })
    }

    @Test
    fun emptyInputCreatesNoModelBatch() {
        assertTrue(MaterialDigestBatchPlanner.plan(emptyList()).isEmpty())
    }

    @Test
    fun separateRecoveryAuthorizationsNeverShareOneRequest() {
        val batches = MaterialDigestBatchPlanner.plan(listOf(
            MaterialDigestCandidate("old-a", 100, "marker-a"),
            MaterialDigestCandidate("old-b", 100, "marker-a"),
            MaterialDigestCandidate("old-c", 100, "marker-b"),
            MaterialDigestCandidate("new", 100),
        ))

        assertEquals(listOf(listOf("old-a", "old-b"), listOf("old-c"), listOf("new")), batches)
    }
}
