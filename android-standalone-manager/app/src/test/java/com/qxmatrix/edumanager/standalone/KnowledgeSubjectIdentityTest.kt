package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class KnowledgeSubjectIdentityTest {
    @Test fun keepsAlreadyPortableBusinessIds() {
        assertEquals("student-123:abc", KnowledgeSubjectIdentity.canonicalize("student-123:abc"))
    }

    @Test fun mapsLegacyWindowsIdsDeterministicallyWithoutLeakingInvalidCharacters() {
        val first = KnowledgeSubjectIdentity.canonicalize("学生 档案/2026")
        val second = KnowledgeSubjectIdentity.canonicalize("学生 档案/2026")
        assertEquals(first, second)
        assertTrue(Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$").matches(first))
        assertNotEquals("学生 档案/2026", first)
    }
}
