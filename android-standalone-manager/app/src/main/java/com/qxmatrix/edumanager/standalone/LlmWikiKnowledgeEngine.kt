package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class KnowledgeEngineException(val code: String, message: String) : IllegalArgumentException(message)

class LlmWikiKnowledgeEngine(
    val subjectId: String,
    private val documents: KnowledgeDocumentStore,
) {
    val contractVersion = ProtocolBaseline.KNOWLEDGE_ENGINE_CONTRACT_VERSION
    val engineId = "llm-wiki-local"
    val engineVersion = "1.0.0"

    init {
        portableId(subjectId, "subjectId")
        listOf(SOURCES, CLAIMS, CLAIM_HISTORY, RELATIONSHIPS, EXPORTS).forEach(documents::ensureDirectory)
    }

    fun health(): JSONObject = JSONObject().apply {
        put("ok", true)
        put("contractVersion", contractVersion)
        put("engineId", engineId)
        put("engineVersion", engineVersion)
        put("subjectId", subjectId)
        put("readOnly", false)
        put("writable", true)
        put("counts", JSONObject()
            .put("sources", jsonFileNames(SOURCES).size)
            .put("claims", jsonFileNames(CLAIMS).size)
            .put("relationships", jsonFileNames(RELATIONSHIPS).size))
    }

    /** Preserve legacy IDs when they identify the same URI, disambiguate equal bytes from distinct records. */
    fun sourceIdForRecord(legacyId: String, sourceUri: String): String {
        val id = portableId(legacyId, "asset.id")
        val path = "$SOURCES/$id.json"
        if (!documents.exists(path) || JSONObject(documents.readText(path)).optString("uri") == sourceUri.trim()) return id
        return "source-${ScopedContentPolicy.hash("$id:$sourceUri".toByteArray()).take(40)}"
    }

    fun importAsset(input: JSONObject): JSONObject {
        val asset = JSONObject(input.toString())
        val id = portableId(asset.optString("id"), "asset.id")
        val uri = asset.optString("uri").trim()
        if (uri.isBlank()) fail("MISSING_SOURCE_URI", "asset.uri 不能为空")
        asset.put("id", id)
        asset.put("uri", uri)
        asset.put("title", asset.optString("title", id))
        asset.put("mediaType", asset.optString("mediaType", "text/markdown"))
        asset.put("content", asset.optString("content"))
        asset.put("importedAt", asset.optString("importedAt", timestamp()))
        asset.put("synthetic", asset.optBoolean("synthetic", false))
        val hashInput = JSONObject().put("uri", uri).put("content", asset.getString("content"))
        val sha256 = contentHash(hashInput)
        val metadataPath = "$SOURCES/$id.json"
        val markdownPath = "$SOURCES/$id.md"
        if (documents.exists(metadataPath)) {
            val existing = JSONObject(documents.readText(metadataPath))
            if (existing.optString("sha256") != sha256) {
                fail("IMMUTABLE_SOURCE_CONFLICT", "同一来源 ID 已存在不同内容；原始资料不可覆盖")
            }
            if (!documents.exists(markdownPath)) documents.writeTextSafely(markdownPath, sourceMarkdown(existing), "text/markdown")
            return JSONObject().put("ok", true).put("duplicate", true).put("source", existing).put("markdownPath", markdownPath)
        }
        val source = JSONObject(asset.toString()).apply {
            put("schema", "edu-manager.source.v1")
            put("subjectId", subjectId)
            put("sha256", sha256)
        }
        documents.writeTextSafely(metadataPath, source.toString(2) + "\n")
        documents.writeTextSafely(markdownPath, sourceMarkdown(source), "text/markdown")
        return JSONObject().put("ok", true).put("duplicate", false).put("source", source).put("markdownPath", markdownPath)
    }

    fun upsertClaim(input: JSONObject): JSONObject {
        val claim = normalizeClaim(input)
        val id = claim.getString("id")
        val claimPath = "$CLAIMS/$id.json"
        if (documents.exists(claimPath)) {
            val previous = JSONObject(documents.readText(claimPath))
            val revision = contentHash(previous)
            val historyDirectory = "$CLAIM_HISTORY/$id"
            val historyPath = "$historyDirectory/$revision.json"
            documents.ensureDirectory(historyDirectory)
            if (!documents.exists(historyPath)) documents.writeTextSafely(historyPath, previous.toString(2) + "\n")
            claim.put("createdAt", previous.optString("createdAt", claim.getString("createdAt")))
        }
        val revisionInput = JSONObject(claim.toString()).apply { remove("revision") }
        claim.put("revision", contentHash(revisionInput))
        documents.writeTextSafely(claimPath, claim.toString(2) + "\n")
        documents.writeTextSafely("$CLAIMS/$id.md", claimMarkdown(claim), "text/markdown")
        return JSONObject().put("ok", true).put("claim", claim).put("path", claimPath)
    }

    fun getClaim(id: String): JSONObject? {
        val claimId = portableId(id, "claim.id")
        val path = "$CLAIMS/$claimId.json"
        return if (documents.exists(path)) JSONObject(documents.readText(path)) else null
    }

    /** Repair a missing projection without changing the authoritative claim. */
    fun ensureClaimProjection(id: String) {
        val claimId = portableId(id, "claim.id")
        val claim = requireNotNull(getClaim(claimId)) { "知识声明不存在" }
        require(claim.optString("subjectId") == subjectId) { "知识声明学生范围不匹配" }
        val markdownPath = "$CLAIMS/$claimId.md"
        if (!documents.exists(markdownPath)) documents.writeTextSafely(markdownPath, claimMarkdown(claim), "text/markdown")
    }

    fun search(
        query: String,
        statuses: Set<String> = setOf("confirmed"),
        requestedSubjectId: String = subjectId,
        limit: Int = 20,
    ): JSONObject {
        if (requestedSubjectId != subjectId) fail("SUBJECT_SCOPE_MISMATCH", "不得跨学生检索知识声明")
        val text = query.trim().lowercase(Locale.CHINA)
        val results = jsonFileNames(CLAIMS).map { JSONObject(documents.readText("$CLAIMS/$it")) }
            .filter { it.optString("subjectId") == subjectId && it.optString("status") in statuses }
            .mapNotNull { claim ->
                val evidence = claim.optJSONArray("evidence") ?: JSONArray()
                val excerpts = buildString {
                    for (index in 0 until evidence.length()) append(evidence.getJSONObject(index).optString("excerpt")).append('\n')
                }
                val haystack = "${claim.optString("predicate")}\n${claim.opt("value")}\n$excerpts".lowercase(Locale.CHINA)
                val score = if (text.isBlank()) 1 else if (haystack.contains(text)) 10 + haystack.split(text).size - 1 else 0
                if (score == 0) null else SearchHit(score, claim)
            }
            .sortedWith(compareByDescending<SearchHit> { it.score }.thenByDescending { it.claim.optString("updatedAt") })
            .take(limit.coerceIn(1, 100))
        val output = JSONArray()
        results.forEach { hit ->
            val citations = JSONArray()
            val evidence = hit.claim.optJSONArray("evidence") ?: JSONArray()
            for (index in 0 until evidence.length()) {
                val item = evidence.getJSONObject(index)
                citations.put(JSONObject().put("evidenceId", item.getString("id")).put("sourceUri", item.getString("sourceUri")))
            }
            output.put(JSONObject().put("score", hit.score).put("claim", hit.claim).put("citations", citations))
        }
        return JSONObject().put("query", query).put("engineId", engineId).put("results", output)
    }

    fun appendEvent(input: JSONObject): JSONObject {
        val event = JSONObject(input.toString())
        event.put("schema", "edu-manager.knowledge-event.v1")
        event.put("id", portableId(event.optString("id"), "event.id"))
        event.put("subjectId", subjectId)
        val type = event.optString("type").trim()
        if (type.isBlank()) fail("MISSING_EVENT_TYPE", "event.type 不能为空")
        event.put("type", type)
        event.put("occurredAt", event.optString("occurredAt", timestamp()))
        val prior = if (documents.exists(EVENTS)) documents.readText(EVENTS).trimEnd() else ""
        val next = if (prior.isBlank()) event.toString() + "\n" else "$prior\n${event}\n"
        documents.writeTextSafely(EVENTS, next, "application/x-ndjson")
        return JSONObject().put("ok", true).put("event", event)
    }

    fun upsertRelationship(input: JSONObject): JSONObject {
        val relationship = JSONObject(input.toString())
        val id = portableId(relationship.optString("id"), "relationship.id")
        relationship.put("schema", "edu-manager.relationship.v1")
        relationship.put("id", id)
        relationship.put("subjectId", subjectId)
        relationship.put("fromId", portableId(relationship.optString("fromId"), "relationship.fromId"))
        relationship.put("toId", portableId(relationship.optString("toId"), "relationship.toId"))
        val type = relationship.optString("type").trim()
        if (type.isBlank()) fail("MISSING_RELATIONSHIP_TYPE", "relationship.type 不能为空")
        relationship.put("type", type)
        relationship.put("updatedAt", relationship.optString("updatedAt", timestamp()))
        val path = "$RELATIONSHIPS/$id.json"
        documents.writeTextSafely(path, relationship.toString(2) + "\n")
        return JSONObject().put("ok", true).put("relationship", relationship).put("path", path)
    }

    fun exportSnapshot(exportIdInput: String = ""): JSONObject {
        val exportId = portableId(exportIdInput.ifBlank { "snapshot-${timestamp().filter(Char::isDigit).take(14)}" }, "export.id")
        val exportDirectory = "$EXPORTS/$exportId"
        documents.ensureDirectory(exportDirectory)
        val snapshot = JSONObject()
            .put("schema", "edu-manager.knowledge-export.v1")
            .put("contractVersion", contractVersion)
            .put("engineId", engineId)
            .put("subjectId", subjectId)
            .put("exportedAt", timestamp())
            .put("sources", jsonArray(SOURCES))
            .put("claims", jsonArray(CLAIMS))
            .put("relationships", jsonArray(RELATIONSHIPS))
            .put("events", eventArray())
        documents.writeTextSafely("$exportDirectory/snapshot.json", snapshot.toString(2) + "\n")
        val summary = """
            # KnowledgeEngine Export

            - Contract: $contractVersion
            - Engine: $engineId
            - Subject: $subjectId
            - Sources: ${snapshot.getJSONArray("sources").length()}
            - Claims: ${snapshot.getJSONArray("claims").length()}
            - Relationships: ${snapshot.getJSONArray("relationships").length()}
            - Events: ${snapshot.getJSONArray("events").length()}

            该导出使用稳定业务 ID，脱离原引擎后仍可审计。
        """.trimIndent() + "\n"
        documents.writeTextSafely("$exportDirectory/README.md", summary, "text/markdown")
        return JSONObject().put("ok", true).put("exportId", exportId).put("exportDir", exportDirectory).put("snapshot", snapshot)
    }

    private fun normalizeClaim(input: JSONObject): JSONObject {
        val claim = JSONObject(input.toString())
        claim.put("schema", "edu-manager.claim.v1")
        claim.put("id", portableId(claim.optString("id"), "claim.id"))
        val requestedSubjectId = portableId(claim.optString("subjectId"), "claim.subjectId")
        if (requestedSubjectId != subjectId) fail("SUBJECT_SCOPE_MISMATCH", "不得把声明写入其他学生档案")
        claim.put("subjectId", subjectId)
        val predicate = claim.optString("predicate").trim()
        if (predicate.isBlank()) fail("MISSING_PREDICATE", "claim.predicate 不能为空")
        if (!claim.has("value") || claim.isNull("value")) fail("MISSING_VALUE", "claim.value 不能为空")
        claim.put("predicate", predicate)
        val status = claim.optString("status", "candidate")
        if (status !in CLAIM_STATUSES) fail("INVALID_STATUS", "不支持的 Claim 状态：$status")
        claim.put("status", status)
        val evidence = claim.optJSONArray("evidence") ?: JSONArray()
        for (index in 0 until evidence.length()) {
            val item = evidence.optJSONObject(index) ?: fail("INVALID_EVIDENCE", "evidence[$index] 必须是对象")
            item.put("id", portableId(item.optString("id"), "evidence[$index].id"))
            if (item.optString("sourceUri").isBlank()) fail("MISSING_SOURCE", "evidence[$index].sourceUri 不能为空")
            item.put("excerpt", item.optString("excerpt"))
            item.put("observedAt", item.optString("observedAt"))
        }
        if (status == "confirmed" && evidence.length() == 0) fail("CONFIRMED_WITHOUT_EVIDENCE", "已确认 Claim 必须至少包含一条 Evidence")
        claim.put("evidence", evidence)
        claim.put("confidence", claim.optString("confidence", "unknown"))
        claim.put("createdAt", claim.optString("createdAt", timestamp()))
        claim.put("updatedAt", claim.optString("updatedAt", timestamp()))
        return claim
    }

    private fun jsonArray(directory: String): JSONArray = JSONArray().also { array ->
        jsonFileNames(directory).forEach { array.put(JSONObject(documents.readText("$directory/$it"))) }
    }

    private fun eventArray(): JSONArray = JSONArray().also { array ->
        if (documents.exists(EVENTS)) documents.readText(EVENTS).lineSequence().filter { it.isNotBlank() }.forEach { array.put(JSONObject(it)) }
    }

    private fun jsonFileNames(directory: String): List<String> =
        documents.listFileNames(directory).filter { it.endsWith(".json") }.sorted()

    private fun sourceMarkdown(source: JSONObject): String = """
        ---
        schema: edu-manager.source.v1
        id: ${source.getString("id")}
        uri: ${source.getString("uri")}
        media_type: ${source.getString("mediaType")}
        sha256: ${source.getString("sha256")}
        synthetic: ${source.getBoolean("synthetic")}
        ---

        # ${source.getString("title")}

        ${source.getString("content")}
    """.trimIndent() + "\n"

    private fun claimMarkdown(claim: JSONObject): String {
        val evidence = claim.getJSONArray("evidence")
        val evidenceText = if (evidence.length() == 0) "- 暂无证据；仅可保持候选状态。" else buildString {
            for (index in 0 until evidence.length()) {
                val item = evidence.getJSONObject(index)
                append("- [${item.getString("id")}] ${item.getString("sourceUri")}")
                if (item.optString("excerpt").isNotBlank()) append(" — ${item.getString("excerpt")}")
                append('\n')
            }
        }.trimEnd()
        val value = claim.opt("value")
        val valueText = if (value is String) value else "```json\n${canonicalJson(value)}\n```"
        return """
            ---
            schema: ${claim.getString("schema")}
            id: ${claim.getString("id")}
            subject_id: ${claim.getString("subjectId")}
            predicate: ${claim.getString("predicate")}
            status: ${claim.getString("status")}
            confidence: ${claim.getString("confidence")}
            updated_at: ${claim.getString("updatedAt")}
            ---

            # ${claim.getString("predicate")}

            $valueText

            ## Evidence

            $evidenceText
        """.trimIndent() + "\n"
    }

    private fun portableId(value: String, field: String): String {
        val id = value.trim()
        if (!PORTABLE_ID.matches(id)) fail("INVALID_ID", "$field 必须是 1-128 位稳定 ID")
        return id
    }

    private fun contentHash(value: Any?): String = MessageDigest.getInstance("SHA-256")
        .digest(canonicalJson(value).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun canonicalJson(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") {
            "${JSONObject.quote(it)}:${canonicalJson(value.opt(it))}"
        }
        is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonicalJson(value.opt(it)) }
        is Number, is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }

    private fun timestamp(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date())

    private fun fail(code: String, message: String): Nothing = throw KnowledgeEngineException(code, message)

    private data class SearchHit(val score: Int, val claim: JSONObject)

    companion object {
        private val CLAIM_STATUSES = setOf("candidate", "confirmed", "rejected", "superseded")
        private val PORTABLE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
        private const val ROOT = ".edu-manager/knowledge-engine-v1"
        private const val SOURCES = "$ROOT/sources"
        private const val CLAIMS = "$ROOT/claims"
        private const val CLAIM_HISTORY = "$ROOT/claim-history"
        private const val RELATIONSHIPS = "$ROOT/relationships"
        private const val EVENTS = "$ROOT/events.jsonl"
        private const val EXPORTS = "$ROOT/exports"
    }
}
