package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class UnknownOutcomePolicyTest {
    @Test fun unknownNeverRetriesWithoutExplicitSingleUseAuthorization() {
        assertTrue(UnknownOutcomePolicy.retryAllowed(null))
        assertFalse(UnknownOutcomePolicy.retryAllowed(JSONObject().put("state", "unknown")))
        assertFalse(UnknownOutcomePolicy.retryAllowed(JSONObject().put("state", "withdrawn")))
        assertTrue(UnknownOutcomePolicy.retryAllowed(JSONObject().put("state", "authorized_retry")))
        assertFalse(UnknownOutcomePolicy.retryAllowed(JSONObject().put("state", "authorized_retry"), false))
    }
    @Test fun recoveryCannotGrantAnotherStudentOrNonUnknownRecord() {
        UnknownOutcomePolicy.requireRecoverable("a", "digest-request:a:hash", JSONObject().put("state", "unknown"))
        assertThrows(IllegalArgumentException::class.java) { UnknownOutcomePolicy.requireRecoverable("a", "digest-request:ab:hash", JSONObject().put("state", "unknown")) }
        assertThrows(IllegalArgumentException::class.java) { UnknownOutcomePolicy.requireRecoverable("a", "cloud-summary:a:hash", JSONObject().put("state", "succeeded")) }
        assertThrows(IllegalArgumentException::class.java) { UnknownOutcomePolicy.requireRecoverable("a", "studio-auto:a", JSONObject().put("state", "unknown")) }
    }
}
