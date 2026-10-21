package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Test

class StandaloneNavigationTest {
    @Test fun sevenDomainsRemainStable() {
        assertEquals(
            listOf("HOME", "ARCHIVES", "MATERIALS", "LEARNING", "REPORTS", "PROJECTS", "SETTINGS"),
            AppSection.entries.map(AppSection::name),
        )
    }

    @Test fun legacySectionsRestoreToNewDomains() {
        assertEquals(AppSection.LEARNING, AppSection.restore("COURSES"))
        assertEquals(AppSection.LEARNING, AppSection.restore("GROWTH"))
        assertEquals(AppSection.PROJECTS, AppSection.restore("PLANNING"))
        assertEquals(AppSection.MATERIALS, AppSection.restore("KNOWLEDGE"))
        assertEquals(AppSection.HOME, AppSection.restore("ASSISTANT"))
    }
}
