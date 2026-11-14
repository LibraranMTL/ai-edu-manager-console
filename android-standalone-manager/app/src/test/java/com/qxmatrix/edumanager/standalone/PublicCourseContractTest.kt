package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class PublicCourseContractTest {
    @Test fun signedRevocationHistoryCannotSilentlyRegress() {
        fun payload(revision: String, time: String, vararg ids: String) = JSONObject()
            .put("revocationRevision", revision).put("issuedAt", time)
            .put("tombstones", JSONArray(ids.map { JSONObject().put("courseId", it) }))
        val previous = payload("rev-1", "2026-11-12T00:00:00Z", "course-a")
        PublicCourseContract.requireNonRegressingRevocations(previous,
            payload("rev-2", "2026-11-13T00:00:00Z", "course-a", "course-b"))
        assertThrows(IllegalArgumentException::class.java) { PublicCourseContract.requireNonRegressingRevocations(previous,
            payload("rev-2", "2026-11-13T00:00:00Z", "course-b")) }
        assertThrows(IllegalArgumentException::class.java) { PublicCourseContract.requireNonRegressingRevocations(previous,
            payload("rev-2", "2026-11-11T00:00:00Z", "course-a")) }
        assertThrows(IllegalArgumentException::class.java) { PublicCourseContract.requireNonRegressingRevocations(previous,
            payload("rev-1", "2026-11-12T00:00:00Z", "course-a", "course-b")) }
        assertThrows(IllegalArgumentException::class.java) { PublicCourseContract.requireNonRegressingRevocations(null,
            payload("rev-3", "2026-11-13T00:00:00Z", "course-a", "course-a")) }
    }
    @Test fun revocationEndpointMustExistAnd304RequiresCachedList() {
        PublicCourseContract.requireRevocationResponse(200, false)
        PublicCourseContract.requireRevocationResponse(304, true)
        assertThrows(IllegalArgumentException::class.java) { PublicCourseContract.requireRevocationResponse(304, false) }
        assertThrows(IllegalStateException::class.java) { PublicCourseContract.requireRevocationResponse(404, true) }
        assertThrows(IllegalStateException::class.java) { PublicCourseContract.requireRevocationResponse(503, true) }
    }

    @Test fun linkedCardPacksRequireEveryCourseToRemainAvailable() {
        val packs = JSONArray().put(JSONObject().put("packId", "math").put("courseIds", JSONArray().put("math")))
            .put(JSONObject().put("packId", "mixed").put("courseIds", JSONArray().put("math").put("other")))
            .put(JSONObject().put("packId", "independent").put("courseIds", JSONArray()))
        val visible = PublicCourseContract.allowedCardPacks(packs, setOf("math"))
        assertEquals(2, visible.length())
        assertEquals("math", visible.getJSONObject(0).getString("packId"))
        assertEquals("independent", visible.getJSONObject(1).getString("packId"))
        assertEquals(1, PublicCourseContract.allowedCardPacks(packs, emptySet()).length())
    }
    @Test fun defaultBaseUrlComesFromTheAuditableBuildConfiguration() {
        assertEquals(BuildConfig.PUBLIC_CONTENT_BASE_URL, PublicCourseContract.DEFAULT_BASE_URL)
    }

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
