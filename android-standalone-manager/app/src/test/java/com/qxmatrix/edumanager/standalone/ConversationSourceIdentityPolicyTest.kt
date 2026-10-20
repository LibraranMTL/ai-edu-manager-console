package com.qxmatrix.edumanager.standalone

import org.junit.Assert.*
import org.junit.Test

class ConversationSourceIdentityPolicyTest {
    @Test fun sameProjectContentIsStillIsolatedByStudent() {
        val hash = "a".repeat(64)
        assertNotEquals(ConversationSourceIdentityPolicy.key(hash, "project", "project-1", "student-1"),
            ConversationSourceIdentityPolicy.key(hash, "project", "project-1", "student-2"))
        assertEquals(ConversationSourceIdentityPolicy.key(hash, "project", "project-1", "student-1"),
            ConversationSourceIdentityPolicy.key(hash, "project", "project-1", "student-1"))
    }
    @Test fun studentScopeCannotReferenceAnotherStudent() {
        assertThrows(IllegalArgumentException::class.java) {
            ConversationSourceIdentityPolicy.key("a".repeat(64), "student", "student-1", "student-2")
        }
        assertThrows(IllegalArgumentException::class.java) {
            ConversationSourceIdentityPolicy.key("invalid", "project", "project-1", "student-1")
        }
    }
}
