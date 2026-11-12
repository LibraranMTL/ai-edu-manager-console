package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudSyncReceiptPolicyTest {
    @Test fun enrollmentAndUploadReceiptsHaveDistinctSupportedStates() {
        assertTrue(CloudSyncReceiptPolicy.accepts("configured"))
        assertTrue(CloudSyncReceiptPolicy.accepts("delivered"))
        assertTrue(CloudSyncReceiptPolicy.accepts("withdrawn"))
        assertFalse(CloudSyncReceiptPolicy.accepts("uploaded_without_authorization"))
    }
}
