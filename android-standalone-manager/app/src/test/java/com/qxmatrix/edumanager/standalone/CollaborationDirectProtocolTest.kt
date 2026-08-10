package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationDirectProtocolTest {
    @Test fun directRequestSignatureMatchesWindowsVector() {
        assertEquals(
            "0cafb9a73571ebc45eb69d1984723f5bdf7706e7d1c5c4d7cf9523aa4a60b83f",
            CollaborationDirectProtocol.requestSignature(
                secret = "fixture-secret",
                method = "GET",
                pathname = "/api/collaboration/android/pull/student-map-1",
                bindingId = "binding-fixture",
                nodeId = "node-android",
                timestamp = "1786320000000",
                nonce = "00112233445566778899aabb",
                contentSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
        )
    }

    @Test fun manifestProofMatchesWindowsVector() {
        assertEquals(
            "dd5629a88cc3f106d51dd968e21fc15bf4ce0c4ac84410dbe1954529e53d8856",
            CollaborationDirectProtocol.manifestProof(
                "fixture-secret",
                "manifest-1",
                "ffbc2dfc402782325da71132100e74ff511d1585dd80e4ea196ed4bcace3fef2",
            ),
        )
    }

    @Test fun lineageAndObjectIdentityArePathNeutralAndStudentExact() {
        val lineage = CollaborationDirectProtocol.lineageId(
            "mapping-binding",
            listOf("node-windows" to "student-a", "node-android" to "student-b"),
        )
        assertEquals("mapping-binding:student-archive:node-android:student-b|node-windows:student-a", lineage)
        val objectId = CollaborationDirectProtocol.objectId(lineage, "growth_model", "能力画像.md")
        assertTrue(objectId.matches(Regex("^student-archive:[a-f0-9]{40}$")))
        assertEquals(objectId, CollaborationDirectProtocol.objectId(lineage, "growth_model", "能力画像.md"))
    }
}
