package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SourceIntegrityPolicyTest {
    @Test fun removedChangedAndUnreadableSourcesFailClosedWithoutChangingTheirRecords() {
        val original = JSONObject().put("status", "processed").put("sourceSha256", "abc")
        assertNull(SourceIntegrityPolicy.failure(original, "abc", "sha1"))
        assertEquals("source_changed", SourceIntegrityPolicy.failure(original, "other", "sha1"))
        assertEquals("source_unreadable", SourceIntegrityPolicy.failure(original, null, null))
        assertEquals("processed", original.getString("status"))
        assertEquals("source_removed", SourceIntegrityPolicy.failure(JSONObject(original.toString()).put("status", "removed"), null, null))
        assertEquals("source_missing_from_index", SourceIntegrityPolicy.failure(null, null, null))
        assertEquals("source_unverifiable", SourceIntegrityPolicy.failure(JSONObject().put("status", "processed"), "abc", "def"))
    }

    @Test fun legacyHashIsAllowedOnlyWhenItMatchesAndWasNotMerelyObserved() {
        val legacy = JSONObject().put("status", "processed").put("sha1", "ABC")
        assertNull(SourceIntegrityPolicy.failure(legacy, "ignored", "abc"))
        assertEquals("source_changed", SourceIntegrityPolicy.failure(legacy, "ignored", "mismatch"))
        legacy.put("sourceEvidence", "current_bytes_observed_history_unverified")
        assertEquals("source_unverifiable", SourceIntegrityPolicy.failure(legacy, "ignored", "abc"))
    }
}
