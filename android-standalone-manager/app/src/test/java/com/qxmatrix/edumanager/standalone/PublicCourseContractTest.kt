package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PublicCourseContractTest {
    @Test fun deploymentPrefixIsPreservedForEveryPublicEndpoint() {
        assertEquals(
            "https://www.greatbg.com/edu-cloud/v2/public-content/manifest",
            PublicCourseContract.endpoint("https://www.greatbg.com/edu-cloud", "v2/public-content/manifest"),
        )
        assertEquals(
            "https://www.greatbg.com/edu-cloud/v2/public-content/assets/asset-rev-${"a".repeat(64)}",
            PublicCourseContract.endpoint("https://www.greatbg.com/edu-cloud/", "/v2/public-content/assets/asset-rev-${"a".repeat(64)}"),
        )
        assertEquals(
            "https://www.greatbg.com/edu-cloud/v2/public-content/sync-receipts",
            PublicCourseContract.endpoint("https://www.greatbg.com/edu-cloud", PublicCourseContract.SYNC_RECEIPTS_PATH),
        )
    }

    @Test fun publicCourseTransportRejectsHttpCredentialsAndUnknownPaths() {
        assertThrows(IllegalArgumentException::class.java) { PublicCourseContract.endpoint("http://www.greatbg.com/edu-cloud", PublicCourseContract.MANIFEST_PATH) }
        assertThrows(IllegalArgumentException::class.java) { PublicCourseContract.endpoint("https://user@example.com/edu-cloud", PublicCourseContract.MANIFEST_PATH) }
        assertThrows(IllegalArgumentException::class.java) { PublicCourseContract.endpoint("https://www.greatbg.com/edu-cloud", "v2/private/students") }
    }

    @Test fun imageTypeComesFromBytesRatherThanOnlyMetadata() {
        assertEquals("image/png", PublicCourseContract.sniffImageMime(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))
        assertEquals("", PublicCourseContract.sniffImageMime("not-an-image".toByteArray()))
    }
}
