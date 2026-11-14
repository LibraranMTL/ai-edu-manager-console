package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class WorkbenchDay(val date: LocalDate, val count: Int)
data class WorkbenchMaterialStats(val total: Int, val days: List<WorkbenchDay>, val excludedWithoutDate: Int)

object WorkbenchMaterialStatsPolicy {
    fun calculate(studentId: String, materials: List<JSONObject>, today: LocalDate, zone: ZoneId): WorkbenchMaterialStats {
        require(studentId.isNotBlank())
        val unique = materials.filter { row ->
            row.optString("studentId") == studentId && row.optString("id").isNotBlank() &&
                MaterialStatus.normalize(row.optString("status")) !in setOf(MaterialStatus.REMOVED, MaterialStatus.INVALID, MaterialStatus.IGNORED) &&
                !MaterialProcessingPolicy.attributionConflict(row) && !AutomationMaterialPolicy.sourceConflict(row)
        }.distinctBy { it.optString("id") }
        val dates = unique.mapNotNull { row ->
            val uploaded = row.optString("uploadedAt")
            runCatching { Instant.parse(uploaded).atZone(zone).toLocalDate() }.getOrNull()
                ?: runCatching { LocalDate.parse(uploaded) }.getOrNull()
        }
        val days = (6 downTo 0).map { offset -> today.minusDays(offset.toLong()) }.map { date -> WorkbenchDay(date, dates.count { it == date }) }
        return WorkbenchMaterialStats(unique.size, days, unique.size - dates.size)
    }
}
