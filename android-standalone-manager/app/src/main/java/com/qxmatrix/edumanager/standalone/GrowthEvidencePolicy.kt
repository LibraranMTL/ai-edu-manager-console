package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import java.security.MessageDigest

/** Compatibility and safety rules shared by migrated and locally generated growth evidence. */
object GrowthEvidencePolicy {
    fun normalizeCandidate(studentId: String, source: JSONObject): JSONObject {
        val item = JSONObject(source.toString())
        val legacyPath = listOf("sourcePath", "migratedFrom", "originalSourcePath")
            .asSequence().map { item.optString(it).trim() }.firstOrNull(String::isNotBlank).orEmpty()
        val sourceUri = item.optString("sourceUri").trim().ifBlank { legacySourceUri(legacyPath) }
        if (sourceUri.isNotBlank()) item.put("sourceUri", sourceUri)
        if (legacyPath.isNotBlank()) {
            if (item.optString("sourcePath").isBlank()) item.put("sourcePath", legacyPath)
            if (item.optString("originalSourcePath").isBlank()) item.put("originalSourcePath", legacyPath)
        }
        if (item.optString("studentId").isBlank()) item.put("studentId", studentId)
        if (item.optString("sourceVerification").isBlank()) {
            item.put("sourceVerification", if (isHistoricalReportCandidate(item)) "historical_secondary_source" else if (sourceUri.isBlank()) "missing" else "declared")
        }
        if (item.optString("primarySourceStatus").isBlank()) {
            item.put("primarySourceStatus", if (isHistoricalReportCandidate(item)) "required" else if (sourceUri.isBlank()) "missing" else "provided")
        }
        return item
    }

    fun requiresPrimarySource(item: JSONObject): Boolean =
        item.optString("sourceUri").isBlank() ||
            item.optString("primarySourceStatus") in setOf("missing", "required") ||
            (isHistoricalReportCandidate(item) && item.optString("sourceVerification") != "provided_by_local_user")

    fun automaticId(studentId: String, sourceUri: String, title: String, content: String): String =
        "growth-evidence-${sha256("$studentId|${sourceUri.trim()}|${title.trim()}|${content.trim()}").take(24)}"

    private fun isHistoricalReportCandidate(item: JSONObject): Boolean =
        item.optString("migrationKind") == "learning_report_candidate" ||
            item.optString("confidence").contains("历史报告待核验") ||
            item.optString("title").startsWith("历史学情报告待核验")

    private fun legacySourceUri(path: String): String {
        if (path.isBlank()) return ""
        if ("://" in path) return path
        val normalized = path.replace('\\', '/')
        return when {
            normalized.matches(Regex("^[A-Za-z]:/.*")) -> "file:///$normalized".replace(" ", "%20")
            normalized.startsWith('/') -> "file://$normalized".replace(" ", "%20")
            else -> "legacy-path://sha256/${sha256(path)}"
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
