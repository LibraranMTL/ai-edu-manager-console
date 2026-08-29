package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.util.UUID

/** Promotes reviewed candidates into one reversible, source-linked managed Markdown ledger. */
class ConversationKnowledgeGovernanceService(private val context: Context) {
    private val conversations = ConversationImportService(context)
    private val candidates = ConversationCandidateRepository(context)
    private val students = StudentIndexRepository(context)
    private val projects = ProjectRepository(context)

    fun confirm(candidateId: String): JSONObject {
        val candidate = candidates.list().singleOrNull { it.optString("id") == candidateId } ?: error("未找到候选知识")
        require(candidate.optString("status") in setOf("pending", "conflict", "revoked")) { "当前候选状态不能采用" }
        val record = conversations.requireExact(candidate.getString("recordId"))
        conversations.readContent(record.getString("recordId"))
        val target = target(record); val store = SafWorkspaceStore(context, Uri.parse(target.rootUri))
        val tx = "conversation-promotion-${UUID.randomUUID()}"; val marker = "conversation-promotion:$tx"
        val old = if (store.exists(target.path)) store.readBytes(target.path).toString(Charsets.UTF_8) else "# 已审核智能体对话知识\n"
        val block = buildString {
            appendLine(); appendLine("<!-- $marker:start -->")
            appendLine("## ${candidateTypeLabel(candidate.optString("type"))}")
            appendLine(); appendLine(candidate.optString("content")); appendLine()
            appendLine("- 来源：${candidate.optString("sourceUri")}")
            appendLine("- 原文 SHA-256：${record.optString("contentHash")}")
            appendLine("- 审核时间：${Timestamp.now()}")
            candidate.optString("evidenceExcerpt").takeIf(String::isNotBlank)?.let { appendLine("- 证据摘录：$it") }
            appendLine("<!-- $marker:end -->")
        }
        store.writeBytesSafely(target.path, (old.trimEnd() + block + "\n").toByteArray(), "text/markdown")
        candidates.updateStatus(candidateId, "confirmed", transactionId = tx)
        return JSONObject().put("ok", true).put("transactionId", tx).put("targetPath", target.path)
    }

    fun rollback(candidateId: String): JSONObject {
        val candidate = candidates.list().singleOrNull { it.optString("id") == candidateId } ?: error("未找到候选知识")
        val tx = candidate.optString("promotionTransactionId"); require(tx.isNotBlank()) { "该候选没有可撤回的采用记录" }
        val record = conversations.requireExact(candidate.getString("recordId")); val target = target(record)
        val store = SafWorkspaceStore(context, Uri.parse(target.rootUri)); require(store.exists(target.path)) { "采用记录文件不存在" }
        val marker = Regex("(?s)\\n?<!-- conversation-promotion:${Regex.escape(tx)}:start -->.*?<!-- conversation-promotion:${Regex.escape(tx)}:end -->\\n?")
        val old = store.readBytes(target.path).toString(Charsets.UTF_8); require(marker.containsMatchIn(old)) { "没有找到对应采用事务" }
        store.writeBytesSafely(target.path, marker.replace(old, "\n").trimEnd().plus("\n").toByteArray(), "text/markdown")
        candidates.updateStatus(candidateId, "revoked", "用户撤回采用")
        return JSONObject().put("ok", true).put("transactionId", tx)
    }

    fun permanentlyDelete(recordId: String): JSONObject {
        val dependencies = candidates.forRecord(recordId).filter { it.optString("status") !in setOf("rejected", "expired", "revoked") }
        require(dependencies.isEmpty()) { "该对话仍有 ${dependencies.size} 条候选或已采用知识，不能永久删除；请先驳回或撤回" }
        return conversations.delete(recordId)
    }

    private fun target(record: JSONObject): Target = if (record.optString("scopeType") == "project") {
        val project = projects.requireExact(record.getString("scopeId"))
        Target(project.knowledgeRootUri, "${project.paths.summaryPath}/已审核智能体对话知识.md")
    } else {
        val student = students.requireExact(record.getString("studentId"))
        Target(student.storageRootUri, "${student.paths.summaryPath}/摘要库/已审核智能体对话知识.md")
    }

    private fun candidateTypeLabel(type: String) = when (type) {
        "concept" -> "核心概念"; "entity" -> "关键实体"; "qa" -> "问答精华"; "action_item" -> "学习行动"
        "growth_evidence" -> "成长证据候选"; else -> "学习事实"
    }
    private data class Target(val rootUri: String, val path: String)
}
