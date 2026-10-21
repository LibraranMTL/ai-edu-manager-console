package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Review state for source-backed knowledge extracted from one immutable conversation. */
class ConversationCandidateRepository(context: Context) {
    private val appContext = context.applicationContext
    private val state = PrivateStateStore(context)

    fun list(studentId: String? = null, status: String? = null): List<JSONObject> = read().getJSONArray("candidates").toObjects()
        .map(::normalize)
        .filter { (studentId.isNullOrBlank() || it.optString("studentId") == studentId) && (status.isNullOrBlank() || it.optString("status") == status) }
        .sortedByDescending { it.optString("updatedAt") }

    fun forRecord(recordId: String): List<JSONObject> = list().filter { it.optString("recordId") == recordId }

    fun registerFromDigest(record: JSONObject, parsed: JSONObject): List<JSONObject> {
        val values = mutableListOf<CandidateInput>()
        parsed.optJSONArray("concepts").strings().forEach { values += CandidateInput("concept", it, it) }
        parsed.optJSONArray("entities").strings().forEach { values += CandidateInput("entity", it, it) }
        parsed.optJSONArray("claims").toObjects().forEach {
            val content = listOf(it.optString("predicate"), it.optString("value")).filter(String::isNotBlank).joinToString("：")
            if (content.isNotBlank()) values += CandidateInput("learning_fact", content, it.optString("excerpt"), it.optString("confidence"))
        }
        parsed.optJSONArray("qa").toObjects().forEach {
            val question = it.optString("question").trim(); val answer = it.optString("answer").trim()
            if (question.isNotBlank() && answer.isNotBlank()) values += CandidateInput("qa", "问：$question\n答：$answer", question)
        }
        parsed.optJSONArray("actionItems").strings().forEach { values += CandidateInput("action_item", it, it) }
        parsed.optJSONArray("growthEvidence").toObjects().forEach {
            val content = it.optString("observation").trim().ifBlank { it.optString("title").trim() }
            if (content.isNotBlank()) values += CandidateInput("growth_evidence", content, it.optString("excerpt"), it.optString("confidence"))
        }
        if (values.isEmpty()) return emptyList()

        val root = read(); val items = root.getJSONArray("candidates").toObjects().toMutableList(); val now = Timestamp.now()
        val output = values.distinctBy { "${it.type}|${it.content}" }.map { input ->
            val id = "conversation-candidate-${sha256("${record.getString("recordId")}|${input.type}|${input.content}").take(24)}"
            val existing = items.indexOfFirst { it.optString("id") == id }
            if (existing >= 0) normalize(items[existing]) else JSONObject()
                .put("schema", "edu-manager.conversation-candidate.v1")
                .put("id", id).put("recordId", record.getString("recordId"))
                .put("studentId", record.getString("studentId")).put("projectId", record.optString("projectId"))
                .put("type", input.type).put("content", input.content.take(4_000))
                .put("evidenceExcerpt", input.excerpt.take(1_000)).put("confidence", input.confidence.ifBlank { "unknown" })
                .put("sourceUri", "edu://student/${record.getString("studentId")}/conversation/${record.getString("recordId")}")
                .put("status", "pending").put("note", "").put("promotionTransactionId", "")
                .put("createdAt", now).put("updatedAt", now).also { items += it }
        }
        root.put("candidates", JSONArray(items)).put("updatedAt", now); write(root)
        return output
    }

    fun updateStatus(candidateId: String, status: String, note: String = "", transactionId: String = ""): JSONObject {
        require(status in setOf("pending", "confirmed", "rejected", "conflict", "expired", "revoked")) { "未知候选状态" }
        val root = read(); val items = root.getJSONArray("candidates").toObjects().toMutableList()
        val index = items.indexOfFirst { it.optString("id") == candidateId }; require(index >= 0) { "未找到候选知识" }
        val next = normalize(items[index]).put("status", status).put("note", note.take(500)).put("updatedAt", Timestamp.now())
        if (transactionId.isNotBlank()) next.put("promotionTransactionId", transactionId)
        if (status in setOf("pending", "rejected", "expired", "revoked")) next.put("promotionTransactionId", "")
        items[index] = next; root.put("candidates", JSONArray(items)).put("updatedAt", Timestamp.now()); write(root)
        return next
    }

    fun updateContent(candidateId: String, content: String, note: String = "人工编辑候选表达"): JSONObject {
        val normalized = content.trim(); require(normalized.isNotBlank()) { "候选内容不能为空" }; require(normalized.length <= 4_000) { "候选内容不能超过 4000 字" }
        val root = read(); val items = root.getJSONArray("candidates").toObjects().toMutableList()
        val index = items.indexOfFirst { it.optString("id") == candidateId }; require(index >= 0) { "未找到候选知识" }
        val current = normalize(items[index]); require(current.optString("status") !in setOf("confirmed")) { "已采用候选需先撤回再编辑" }
        val history = current.optJSONArray("editHistory") ?: JSONArray()
        history.put(JSONObject().put("content", current.optString("content")).put("editedAt", Timestamp.now()).put("reason", note.take(200)))
        val next = current.put("content", normalized).put("editHistory", history).put("status", "pending").put("note", note.take(500)).put("updatedAt", Timestamp.now())
        items[index] = next; root.put("candidates", JSONArray(items)).put("updatedAt", Timestamp.now()); write(root)
        return next
    }

    private fun read(): JSONObject = try {
        JSONObject(state.readBytes(PATH).toString(Charsets.UTF_8)).also {
            if (!it.has("candidates")) it.put("candidates", JSONArray())
            it.put("schema", "edu-manager.android-conversation-candidates.v1")
        }
    } catch (_: Exception) {
        JSONObject().put("schema", "edu-manager.android-conversation-candidates.v1").put("candidates", JSONArray()).put("updatedAt", "")
    }

    private fun write(value: JSONObject) {
        state.writeBytes(PATH, (value.toString(2) + "\n").toByteArray())
        value.getJSONArray("candidates").toObjects().groupBy { it.optString("studentId") }.forEach { (studentId, rows) ->
            HighGrowthRoomStore(appContext).mirrorAsync(studentId, HighGrowthRoomStore.CONVERSATION_CANDIDATE, rows)
        }
    }

    private fun normalize(input: JSONObject): JSONObject = JSONObject(input.toString()).apply {
        if (!has("note")) put("note", "")
        if (!has("promotionTransactionId")) put("promotionTransactionId", "")
        if (!has("updatedAt")) put("updatedAt", optString("createdAt"))
        if (!has("editHistory")) put("editHistory", JSONArray())
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private data class CandidateInput(val type: String, val content: String, val excerpt: String, val confidence: String = "")

    companion object { private const val PATH = "conversation-knowledge-candidates.json" }
}
