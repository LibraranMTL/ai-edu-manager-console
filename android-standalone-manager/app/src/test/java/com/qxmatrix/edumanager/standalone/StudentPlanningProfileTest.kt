package com.qxmatrix.edumanager.standalone

import org.junit.Assert.*
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Locale

class StudentPlanningProfileTest {
    @Test fun ageDependsOnActualBirthdayAndNotGrade() {
        val now = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse("2026-10-01")!!
        assertEquals(12, StudentPlanningProfile(birthDate = "2014-10-01").ageAt(now))
        assertEquals(11, StudentPlanningProfile(birthDate = "2014-10-02").ageAt(now))
        assertNull(StudentPlanningProfile(manualAgeBand = "12—14岁").ageAt(now))
        assertNull(StudentPlanningProfile(birthDate = "2014-02-30").ageAt(now))
        assertNull(StudentPlanningProfile(birthDate = "2014-1-1").ageAt(now))
        assertNull(StudentPlanningProfile(birthDate = "2027-01-01").ageAt(now))
    }
}
