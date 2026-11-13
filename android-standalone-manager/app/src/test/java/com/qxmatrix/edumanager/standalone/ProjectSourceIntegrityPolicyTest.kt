package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProjectSourceIntegrityPolicyTest {
    @Test fun fixedSourceRequiresMatchingCurrentIdentityVersionAndOriginalBytes() {
        val hash = "a".repeat(64)
        val source = JSONObject().put("materialId", "material-1").put("version", 2).put("sha256", hash)
        val item = JSONObject().put("materialId", "material-1").put("version", 2).put("sha256", hash).put("adoption", "accepted")
        assertTrue(ProjectSourceIntegrityPolicy.matches(source, item, hash))
        assertFalse(ProjectSourceIntegrityPolicy.matches(source, item, null))
        assertFalse(ProjectSourceIntegrityPolicy.matches(source, item, "b".repeat(64)))
        assertFalse(ProjectSourceIntegrityPolicy.matches(source, JSONObject(item.toString()).put("version", 3), hash))
        assertFalse(ProjectSourceIntegrityPolicy.matches(source, JSONObject(item.toString()).put("materialId", "other"), hash))
        assertFalse(ProjectSourceIntegrityPolicy.matches(source, JSONObject(item.toString()).put("adoption", "rejected"), hash))
    }
}
