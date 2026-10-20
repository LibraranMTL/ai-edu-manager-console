package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudServiceEndpointTest {
    @Test
    fun officialAlibabaCloudEndpointIsCanonical() {
        assertEquals("https://www.greatbg.com/edu-cloud", CloudServiceEndpoint.OFFICIAL_BASE_URL)
        assertEquals(CloudServiceEndpoint.OFFICIAL_BASE_URL,
            CloudServiceEndpoint.normalize("https://www.greatbg.com/edu-cloud/"))
        assertTrue(CloudServiceEndpoint.isOfficial("https://www.greatbg.com/edu-cloud/"))
    }

    @Test
    fun publicHttpAndUnsafeUrlsAreRejected() {
        listOf(
            "http://www.greatbg.com/edu-cloud",
            "https://name:secret@www.greatbg.com/edu-cloud",
            "https://www.greatbg.com/edu-cloud?token=x",
            "https://www.greatbg.com/%2e%2e/edu-cloud",
        ).forEach { value -> assertTrue(runCatching { CloudServiceEndpoint.normalize(value) }.isFailure) }
        assertFalse(CloudServiceEndpoint.isOfficial("https://example.com/edu-cloud"))
    }

    @Test
    fun loopbackHttpRemainsAvailableOnlyForLocalTests() {
        assertEquals("http://127.0.0.1:8755", CloudServiceEndpoint.normalize("http://127.0.0.1:8755/"))
    }
}
