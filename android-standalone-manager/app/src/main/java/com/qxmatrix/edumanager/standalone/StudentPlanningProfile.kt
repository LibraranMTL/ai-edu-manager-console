package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Additive Windows-compatible fields; no inference from grade and no mandatory onboarding. */
data class StudentPlanningProfile(
    val birthDate: String = "",
    val manualAgeBand: String = "",
    val currentRegion: String = "",
    val targetRegions: List<String> = emptyList(),
    val planningRoutes: List<String> = emptyList(),
    val targetStage: String = "",
    val planningPreferences: List<String> = emptyList(),
    val interests: List<String> = emptyList(),
    val subjectStrengths: List<String> = emptyList(),
    val careerDirections: List<String> = emptyList(),
) {
    fun ageAt(now: Date = Date()): Int? {
        if (birthDate.isBlank()) return null
        val format = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }
        val parsed = runCatching { format.parse(birthDate) }.getOrNull() ?: return null
        if (format.format(parsed) != birthDate || parsed.after(now)) return null
        val birth = Calendar.getInstance().apply { time = parsed }
        val today = Calendar.getInstance().apply { time = now }
        var age = today.get(Calendar.YEAR) - birth.get(Calendar.YEAR)
        if (today.get(Calendar.MONTH) < birth.get(Calendar.MONTH) ||
            (today.get(Calendar.MONTH) == birth.get(Calendar.MONTH) && today.get(Calendar.DAY_OF_MONTH) < birth.get(Calendar.DAY_OF_MONTH))) age--
        return age.takeIf { it in 0..120 }
    }

    fun toJson() = JSONObject().apply {
        require(birthDate.isBlank() || ageAt() != null) { "出生日期须为有效的 yyyy-MM-dd，不能晚于今天" }
        require(planningRoutes.all { it in setOf("domestic", "hongkong_macau", "international") }) { "未知规划路径" }
        put("birthDate", birthDate); put("manualAgeBand", manualAgeBand); put("currentRegion", currentRegion)
        put("targetRegions", JSONArray(targetRegions)); put("planningRoutes", JSONArray(planningRoutes))
        put("targetStage", targetStage); put("planningPreferences", JSONArray(planningPreferences))
        put("interests", JSONArray(interests)); put("subjectStrengths", JSONArray(subjectStrengths))
        put("careerDirections", JSONArray(careerDirections)); put("planningProfileSchemaVersion", 2)
    }

    companion object {
        val keys = setOf("birthDate", "manualAgeBand", "currentRegion", "targetRegions", "planningRoutes", "targetStage",
            "planningPreferences", "interests", "subjectStrengths", "careerDirections", "planningProfileSchemaVersion")
        fun fromJson(json: JSONObject): StudentPlanningProfile {
            fun strings(key: String): List<String> {
                if (!json.has(key)) return emptyList()
                val array = json.getJSONArray(key)
                return List(array.length()) { array.getString(it) }
            }
            return StudentPlanningProfile(json.optString("birthDate"), json.optString("manualAgeBand"),
                json.optString("currentRegion"), strings("targetRegions"), strings("planningRoutes"), json.optString("targetStage"),
                strings("planningPreferences"), strings("interests"), strings("subjectStrengths"), strings("careerDirections"))
        }
    }
}
