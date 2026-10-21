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
    private val sensitive = Regex("身份证|证件|住址|地址|电话|手机号|健康|医疗|病史|心理|诊断|收入|家庭关系|敏感|identity|medical|health|diagnosis|psycholog", RegexOption.IGNORE_CASE)
    private val agent = Regex("agent|ai|模型|智能体", RegexOption.IGNORE_CASE)
    private val lowConfidence = Regex("low|低|不确定|待确认|unknown", RegexOption.IGNORE_CASE)
    private val subjective = setOf("student_self_report", "parent_observation", "teacher_assessment")

    fun assess(source: JSONObject, legacyReviewIds: Set<String> = emptySet()): GrowthRiskAssessment {
        val item = JSONObject(source.toString())
        val reasons = mutableListOf<String>()
        var level = GrowthRiskLevel.LOW
        fun high(reason: String) { level = GrowthRiskLevel.HIGH; reasons += reason }
        fun medium(reason: String) { if (level != GrowthRiskLevel.HIGH) level = GrowthRiskLevel.MEDIUM; reasons += reason }
        val sourcePath = item.optString("sourceUri").ifBlank { item.optString("sourcePath") }.trim()
        val combined = listOf("title", "content", "ability", "predicate", "note").joinToString("\n") { item.optString(it) }
        if (sourcePath.isBlank()) high("missing_source")
        if (item.optString("automationAttentionReason") == "source_unavailable") high("source_unavailable")
        if (sensitive.containsMatchIn(combined)) high("sensitive_content")
        if (item.optBoolean("conflict") || item.optJSONArray("conflictWith")?.length()?.let { it > 0 } == true) high("conflict")
        if (item.optString("sourceType") == "agent_inference" || agent.containsMatchIn(item.optString("generatedBy"))) high("agent_inference")
        if (item.optString("id") in legacyReviewIds) high("legacy_review_audit_missing")
        if (level != GrowthRiskLevel.HIGH && item.optString("sourceType") in subjective) medium("subjective_source")
        if (level != GrowthRiskLevel.HIGH && lowConfidence.containsMatchIn(item.optString("confidence"))) medium("low_confidence")
        if (level == GrowthRiskLevel.LOW && item.optString("projectId").isBlank()) medium("no_project_context")
        if (level == GrowthRiskLevel.LOW && item.optString("ability").let { it.isBlank() || "待标注" in it }) medium("ability_unlabeled")
        if (level == GrowthRiskLevel.LOW && item.has("migratedFrom")) medium("legacy_import")
        if (reasons.isEmpty()) reasons += "traceable_project_evidence"
        val status = when (level) { GrowthRiskLevel.LOW -> "confirmed"; GrowthRiskLevel.MEDIUM -> "watching"; GrowthRiskLevel.HIGH -> "needs_attention" }
        return GrowthRiskAssessment(item.optString("id"), level, status, level == GrowthRiskLevel.HIGH, reasons.distinct())
    }
}
