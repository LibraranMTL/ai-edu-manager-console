package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LicenseQrPayloadTest {
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
