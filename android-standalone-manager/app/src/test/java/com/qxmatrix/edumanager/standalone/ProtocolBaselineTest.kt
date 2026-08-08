package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolBaselineTest {
    private fun fixture(): JSONObject {
        val stream = checkNotNull(javaClass.classLoader?.getResourceAsStream("windows-w0-baseline.json"))
        return JSONObject(stream.bufferedReader(Charsets.UTF_8).use { it.readText() })
    }

    @Test
    fun protocolVersionsMatchWindowsBaseline() {
        assertEquals("1.2", ProtocolBaseline.TASK_PROTOCOL_VERSION)
        assertEquals("edu-manager.knowledge-engine.v1", ProtocolBaseline.KNOWLEDGE_ENGINE_CONTRACT_VERSION)
        assertEquals("edu-manager.education-domain.v1", ProtocolBaseline.EDUCATION_DOMAIN_PROTOCOL_VERSION)
        assertEquals("edu-manager.course-capture.v1", ProtocolBaseline.COURSE_CAPTURE_SCHEMA)
        assertEquals("edu-manager.course-package.v3", ProtocolBaseline.COURSE_PACKAGE_SCHEMA)
        assertEquals(1, ProtocolBaseline.CAPTURE_PROTOCOL_VERSION)
    }

    @Test
    fun materialStatusesRemainCompatible() {
        assertEquals(
            setOf("pending_digest", "submitted", "digesting", "processed", "ignored", "invalid", "failed", "removed"),
            ProtocolBaseline.materialStatuses,
        )
    }

    @Test
    fun windowsFixtureRetainsStableIdsPathsAndUnknownFields() {
        val original = fixture()
        val roundTrip = JSONObject(original.toString())
        val student = roundTrip.getJSONObject("student")
        val asset = roundTrip.getJSONObject("assetIndex").getJSONArray("assets").getJSONObject(0)
        val project = roundTrip.getJSONObject("projectIndex").getJSONArray("projects").getJSONObject(0)

        assertEquals("student-w0-001", student.getString("id"))
        assertEquals("must-be-preserved", student.getString("futureCompatibleField"))
        assertTrue(student.getString("rawPath").endsWith("测试学生原始资料库"))
        assertEquals("asset-0123456789abcdef", asset.getString("assetId"))
        assertEquals("project-w0-001", project.getString("id"))
        assertEquals("student-w0-001", project.getJSONArray("studentIds").getString(0))
        assertEquals("1.2", roundTrip.getJSONObject("taskResult").getString("protocolVersion"))
    }
}
