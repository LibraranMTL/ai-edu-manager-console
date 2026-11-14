package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class WorkbenchMaterialStatsTest {
    @Test fun sevenLocalDaysAreScopedDeduplicatedAndIgnoreConflicts() {
        fun row(id: String, student: String, time: String) = JSONObject().put("id", id).put("studentId", student)
            .put("uploadedAt", time).put("status", "pending_digest")
        val a = row("a", "student-a", "2026-11-11T17:00:00Z")
        val result = WorkbenchMaterialStatsPolicy.calculate("student-a", listOf(a, JSONObject(a.toString()),
            row("b", "student-b", "2026-11-12T00:00:00Z"),
            row("c", "student-a", "2026-11-12T00:00:00Z").put("attributionConflict", true),
            row("d", "student-a", "unknown")), LocalDate.parse("2026-11-12"), ZoneId.of("Asia/Shanghai"))
        assertEquals(7, result.days.size); assertEquals(1, result.days.last().count)
        assertEquals(2, result.total); assertEquals(1, result.excludedWithoutDate)
    }
}
