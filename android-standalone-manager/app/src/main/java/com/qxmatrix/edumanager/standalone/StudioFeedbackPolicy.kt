package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject

/** Bounded observations, not diagnoses. Never export reviewer identity or answer attachments. */
object StudioFeedbackPolicy {
    fun observations(rows: List<ScopedContentEntity>, studentId: String, selectedHashes: Map<String, String>, name: String): JSONArray {
        val result = JSONArray(); val seen = mutableSetOf<String>()
        for (row in rows) {
            if (result.length() >= 10) break
            require(row.studentId == studentId && row.kind == "review")
            val review = JSONObject(row.payload)
            require(row.sourceSha256 == ScopedContentPolicy.fingerprint(review)) { "审核记录哈希不匹配" }
            val attemptId = review.getString("attemptId")
            if (!seen.add(attemptId)) continue // Caller supplies newest first; corrections supersede for this preview only.
            val version = review.getJSONObject("answerSnapshot").getJSONObject("evidenceSnapshot")
            val sources = version.getJSONObject("inputSnapshot").getJSONArray("sources")
            val matches = (0 until sources.length()).any { index ->
                val source = sources.getJSONObject(index)
                selectedHashes[source.getString("id")] == source.getString("sha256")
            }
            if (!matches) continue
            result.put(JSONObject().put("outcome", review.getString("outcome"))
                .put("note", LearningStudioPolicy.redact(review.getString("note").take(500), name))
                .put("reviewedAt", row.createdAt).put("identityVerified", false)
                .put("interpretation", "只评价一次作答；可能包含提示或自评，不代表掌握、能力、遗忘或退步"))
        }
        return result
    }
}
