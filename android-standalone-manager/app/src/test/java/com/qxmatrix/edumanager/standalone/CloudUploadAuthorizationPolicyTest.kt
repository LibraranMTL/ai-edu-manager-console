package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudUploadAuthorizationPolicyTest {
    @Test fun accepts_field_category_purpose_and_bounded_expiry() {
        val now = 1_000_000L
        CloudUploadAuthorizationPolicy.validate(setOf("displayName", "grade"), setOf("learning_report"),
            "expert_interpretation", now + 30L * 24 * 60 * 60 * 1_000, now)
        assertFalse(CloudUploadAuthorizationPolicy.isExpired(now + 1, now))
        assertTrue(CloudUploadAuthorizationPolicy.isExpired(now, now))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejects_profile_scope_without_display_name() {
        val now = 1_000_000L
        CloudUploadAuthorizationPolicy.validate(setOf("grade"), emptySet(), "document_sync", now + 86_400_000, now)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejects_empty_scope() {
        val now = 1_000_000L
        CloudUploadAuthorizationPolicy.validate(emptySet(), emptySet(), "document_sync", now + 86_400_000, now)
    }
}
