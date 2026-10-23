package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject

enum class GrowthRiskLevel { LOW, MEDIUM, HIGH }

data class GrowthRiskAssessment(
    val evidenceId: String,
    val level: GrowthRiskLevel,
    val suggestedStatus: String,
    val requiresIndividualAttention: Boolean,
    val reasons: List<String>,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("schema", GrowthEvidenceRiskPolicy.SCHEMA)
        .put("evidenceId", evidenceId)
        .put("level", level.name.lowercase())
        .put("suggestedStatus", suggestedStatus)
        .put("requiresIndividualAttention", requiresIndividualAttention)
        .put("reasons", JSONArray(reasons))
}

/** Kotlin port of the Windows growth-evidence-risk.v1 contract. */
object GrowthEvidenceRiskPolicy {
    const val SCHEMA = "edu-manager.growth-evidence-risk.v1"
    private val agent = Regex("agent|ai|模型|智能体", RegexOption.IGNORE_CASE)
    private val lowConfidence = Regex("low|低|不确定|待确认|unknown", RegexOption.IGNORE_CASE)
    private val subjective = setOf("student_self_report", "parent_observation", "teacher_assessment")
    private val attributionReasons = setOf(
        "attribution_conflict", "student_attribution_conflict", "project_attribution_conflict",
        "student_scope_mismatch", "project_scope_mismatch", "scope_conflict",
    )

    fun assess(source: JSONObject, legacyReviewIds: Set<String> = emptySet()): GrowthRiskAssessment {
        val item = JSONObject(source.toString())
        val reasons = mutableListOf<String>()
        var level = GrowthRiskLevel.LOW
        fun high(reason: String) { level = GrowthRiskLevel.HIGH; reasons += reason }
        fun medium(reason: String) { if (level != GrowthRiskLevel.HIGH) level = GrowthRiskLevel.MEDIUM; reasons += reason }
        val sourcePath = item.optString("sourceUri").ifBlank { item.optString("sourcePath") }.trim()
        if (hasAttributionConflict(item)) high("attribution_conflict")
        if (level != GrowthRiskLevel.HIGH && sourcePath.isBlank()) medium("missing_source")
        if (level != GrowthRiskLevel.HIGH && item.optString("automationAttentionReason") == "source_unavailable") medium("source_unavailable")
        if (level != GrowthRiskLevel.HIGH && (item.optBoolean("conflict") || item.optJSONArray("conflictWith")?.length()?.let { it > 0 } == true)) medium("evidence_conflict")
        if (level != GrowthRiskLevel.HIGH && (item.optString("sourceType") == "agent_inference" || agent.containsMatchIn(item.optString("generatedBy")))) medium("agent_inference")
        if (level != GrowthRiskLevel.HIGH && item.optString("id") in legacyReviewIds) medium("legacy_review_audit_missing")
        if (level != GrowthRiskLevel.HIGH && item.optString("sourceType") in subjective) medium("subjective_source")
        if (level != GrowthRiskLevel.HIGH && lowConfidence.containsMatchIn(item.optString("confidence"))) medium("low_confidence")
        if (level == GrowthRiskLevel.LOW && item.optString("projectId").isBlank()) medium("no_project_context")
        if (level == GrowthRiskLevel.LOW && item.optString("ability").let { it.isBlank() || "待标注" in it }) medium("ability_unlabeled")
        if (level == GrowthRiskLevel.LOW && item.has("migratedFrom")) medium("legacy_import")
        if (reasons.isEmpty()) reasons += "traceable_project_evidence"
        val status = when (level) { GrowthRiskLevel.LOW -> "confirmed"; GrowthRiskLevel.MEDIUM -> "watching"; GrowthRiskLevel.HIGH -> "needs_attention" }
        return GrowthRiskAssessment(item.optString("id"), level, status, level == GrowthRiskLevel.HIGH, reasons.distinct())
    }

    /** At this stage only an explicit student/project ownership mismatch needs user action. */
    private fun hasAttributionConflict(item: JSONObject): Boolean {
        if (item.optBoolean("attributionConflict") || item.optBoolean("studentAttributionConflict") ||
            item.optBoolean("projectAttributionConflict")) return true
        val reason = sequenceOf("automationAttentionReason", "conflictType", "scopeError", "errorCode")
            .map { item.optString(it).trim().lowercase() }.firstOrNull { it in attributionReasons }
        if (reason != null) return true
        val studentId = item.optString("studentId").trim()
        val declaredStudentId = sequenceOf("sourceStudentId", "declaredStudentId", "attributedStudentId")
            .map { item.optString(it).trim() }.firstOrNull(String::isNotBlank).orEmpty()
        if (studentId.isNotBlank() && declaredStudentId.isNotBlank() && studentId != declaredStudentId) return true
        val projectId = item.optString("projectId").trim()
        val declaredProjectId = sequenceOf("sourceProjectId", "declaredProjectId", "attributedProjectId")
            .map { item.optString(it).trim() }.firstOrNull(String::isNotBlank).orEmpty()
        return projectId.isNotBlank() && declaredProjectId.isNotBlank() && projectId != declaredProjectId
    }
}
