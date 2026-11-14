package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Test

class CloudSourceIntegrityPolicyTest {
    @Test fun integrityRequestsUseTheSameNamespacedMaterialIdAsUploads() {
        val localId = "material-intake-" + "a".repeat(64)
        assertEquals("learning_material:$localId", CloudSourceIntegrityPolicy.objectId("learning_material", localId))
        assertEquals("*", CloudSourceIntegrityPolicy.objectId("learning_report", "*"))
    }
}
