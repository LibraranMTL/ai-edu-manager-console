package com.qxmatrix.edumanager.standalone

object ConversationSourceIdentityPolicy {
    fun key(hash: String, scopeType: String, scopeId: String, studentId: String): String {
        require(Regex("^[a-f0-9]{64}$").matches(hash) && scopeType in setOf("student", "project") && scopeId.isNotBlank() && studentId.isNotBlank())
        if (scopeType == "student") require(scopeId == studentId)
        return "conversation-record-${ScopedContentPolicy.hash("$hash|$scopeType|$scopeId|$studentId".toByteArray()).take(24)}"
    }
}
