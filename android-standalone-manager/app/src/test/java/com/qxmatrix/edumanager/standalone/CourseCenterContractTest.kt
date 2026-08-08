package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CourseCenterContractTest {
    @Test fun authoritativeCourseProtocolsRemainStable() {
        assertEquals("edu-manager.course-package.v3", ProtocolBaseline.COURSE_PACKAGE_SCHEMA)
        assertEquals("edu-manager.course-capture.v1", ProtocolBaseline.COURSE_CAPTURE_SCHEMA)
        assertEquals(1, ProtocolBaseline.CAPTURE_PROTOCOL_VERSION)
    }

    @Test fun platformCatalogHasBoundedImportLimits() {
        assertEquals(250L * 1024 * 1024, CourseCatalogService.MAX_PACKAGE_BYTES)
        assertEquals(5 * 1024 * 1024, CourseCatalogService.MAX_ENTRY_BYTES)
        assertTrue(CourseCatalogService.LAST_GOOD.contains("last-good"))
    }
}
