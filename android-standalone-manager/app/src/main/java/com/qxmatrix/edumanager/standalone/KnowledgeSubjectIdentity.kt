package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import java.security.MessageDigest

/**
 * Keeps the business student ID unchanged while providing a portable ID for
 * LLM Wiki documents migrated from older Windows releases.
 */
object KnowledgeSubjectIdentity {
    private val portable = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

    fun canonicalize(businessStudentId: String): String {
        val original = businessStudentId.trim()
        require(original.isNotBlank()) { "学生 ID 不能为空" }
        if (portable.matches(original)) return original
        val digest = MessageDigest.getInstance("SHA-256").digest(original.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return "student-legacy-${digest.take(32)}"
    }

    fun mapping(businessStudentId: String): JSONObject = JSONObject()
        .put("schema", "edu-manager.knowledge-subject-map.v1")
        .put("businessStudentId", businessStudentId.trim())
        .put("knowledgeSubjectId", canonicalize(businessStudentId))
        .put("mapping", "deterministic-sha256-when-required")
}
