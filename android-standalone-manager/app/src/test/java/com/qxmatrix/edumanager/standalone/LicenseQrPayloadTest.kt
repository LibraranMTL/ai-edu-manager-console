package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LicenseQrPayloadTest {
    @Test
    fun acceptsOnlineCodesWithGroupingAndRejectsChangedChecksum() {
        val stem = "AEC1A0123456789ABCDEFGHJKMNPQRSTVWXYZ"
        val checksum = java.security.MessageDigest.getInstance("SHA-256").digest(stem.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }.take(4).uppercase(java.util.Locale.US)
        val token = stem + checksum
        assertEquals(token, LicenseQrPayload.normalize(token.chunked(5).joinToString("-").lowercase(java.util.Locale.US)))
        assertNull(LicenseQrPayload.normalize(token.dropLast(1) + "G"))
    }
    @Test
    fun acceptsTrimmedLicenseV3Token() {
        val token = "AIE3.payload123.signature123"
        assertEquals(token, LicenseQrPayload.normalize("  $token\n"))
    }

    @Test
    fun rejectsOtherVersionsWhitespaceAndMalformedSegments() {
        assertNull(LicenseQrPayload.normalize("AIE2.payload123.signature123"))
        assertNull(LicenseQrPayload.normalize("AIE3.payload 123.signature123"))
        assertNull(LicenseQrPayload.normalize("AIE3.payload123"))
        assertNull(LicenseQrPayload.normalize("AIE3.one.two.three"))
    }
}
