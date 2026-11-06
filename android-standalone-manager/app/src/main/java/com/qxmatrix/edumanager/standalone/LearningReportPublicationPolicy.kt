package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject

/** Pure contract for one active, immutable four-report set. */
object LearningReportPublicationPolicy {
    const val SCHEMA = "edu-manager.learning-report-set.v1"

    fun evidenceFingerprint(evidence: List<JSONObject>): String {
        val stable = evidence.sortedBy { it.optString("id") }.map { item -> JSONObject()
            .put("id", item.optString("id")).put("status", item.optString("status"))
            .put("content", item.optString("content")).put("ability", item.optString("ability"))
            .put("sourceUri", item.optString("sourceUri")).put("updatedAt", item.optString("updatedAt"))
        }
        return ScopedContentPolicy.fingerprint(JSONObject().put("evidence", JSONArray(stable)))
    }

    fun pointer(studentId: String, publicationId: String, evidenceFingerprint: String,
        paths: Map<String, String>, contents: Map<String, String>, activatedAt: String): JSONObject {
        require(studentId.isNotBlank() && publicationId.isNotBlank() && evidenceFingerprint.isNotBlank())
        require(paths.keys == GrowthModelService.REPORTS.map { it.id }.toSet() && contents.keys == paths.keys) { "四份报告必须整组激活" }
        val items = JSONArray(GrowthModelService.REPORTS.map { definition -> JSONObject()
            .put("reportId", definition.id).put("path", paths.getValue(definition.id))
            .put("sha256", EducationPublicationPolicy.sha256(contents.getValue(definition.id)))
        })
        return JSONObject().put("schema", SCHEMA).put("studentId", studentId).put("publicationId", publicationId)
            .put("evidenceFingerprint", evidenceFingerprint).put("activatedAt", activatedAt).put("items", items)
    }

    fun requireEntry(pointer: JSONObject, studentId: String, reportId: String): JSONObject {
        require(pointer.optString("schema") == SCHEMA && pointer.optString("studentId") == studentId) { "学情报告活动版本指针无效" }
        require(pointer.optString("publicationId").isNotBlank() && pointer.optString("evidenceFingerprint").isNotBlank()) { "学情报告活动版本缺少修订信息" }
        val items = pointer.optJSONArray("items") ?: error("学情报告活动版本缺少报告清单")
        require(items.length() == GrowthModelService.REPORTS.size) { "学情报告活动版本不是完整四件套" }
        val entries = (0 until items.length()).map { items.getJSONObject(it) }
        require(entries.map { it.getString("reportId") }.toSet() == GrowthModelService.REPORTS.map { it.id }.toSet()) { "学情报告活动版本包含未知或重复报告" }
        return entries.single { it.getString("reportId") == reportId }.also { entry ->
            val path = entry.getString("path").replace('\\', '/')
            val inVersionDirectory = path.startsWith("${GrowthModelService.REPORT_SET_DIRECTORY}/") ||
                path.contains("/${GrowthModelService.REPORT_SET_DIRECTORY}/")
            require(inVersionDirectory && !path.startsWith('/') && path.split('/').none { it == ".." }) {
                "学情报告路径不在版本目录"
            }
            require(entry.getString("sha256").matches(Regex("^[a-f0-9]{64}$"))) { "学情报告哈希无效" }
        }
    }
}
