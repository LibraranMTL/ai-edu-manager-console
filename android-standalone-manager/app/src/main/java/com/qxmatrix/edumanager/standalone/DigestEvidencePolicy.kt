package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.json.JSONArray
import java.text.Normalizer

/** Validate every proposed observation before any knowledge or growth write. */
object DigestEvidencePolicy {
    /**
     * Keeps a useful digest when the model returns one or more unusable evidence candidates.
     * Invalid candidates are omitted instead of turning an already completed OCR/digest request
     * into an OCR retry. The summary and other non-evidence output remain available.
     */
    fun sanitized(result: JSONObject, sourceText: Map<String, String>): JSONObject {
        require(result.getString("summary").isNotBlank()) { "消化摘要为空，不写入结果" }
        require(result.toString().toByteArray().size <= 500_000) { "消化结果过大" }
        val output = JSONObject(result.toString())
        val warnings = JSONArray()
        listOf("claims", "growthEvidence").forEach { key ->
            val source = output.optJSONArray(key) ?: return@forEach
            require(source.length() <= 100) { "候选数量超过上限" }
            val accepted = JSONArray()
            for (index in 0 until source.length()) {
                val item = source.optJSONObject(index)
                if (item == null) {
                    warnings.put(JSONObject().put("kind", key).put("index", index).put("reason", "候选格式无效"))
                } else {
                    val reason = invalidReason(key, item, sourceText)
                    if (reason == null) accepted.put(item)
                    else warnings.put(JSONObject().put("kind", key).put("index", index).put("reason", reason))
                }
            }
            output.put(key, accepted)
        }
        output.put("evidenceValidation", JSONObject()
            .put("mode", "source-anchored-filter")
            .put("droppedCount", warnings.length())
            .put("warnings", warnings))
        validate(output, sourceText)
        return output
    }

    fun validate(result: JSONObject, sourceText: Map<String, String>) {
        require(result.getString("summary").isNotBlank()) { "消化摘要为空，不写入结果" }
        require(result.toString().toByteArray().size <= 500_000) { "消化结果过大" }
        listOf("claims", "growthEvidence").forEach { key ->
            if (!result.has(key)) return@forEach
            val items = result.getJSONArray(key); require(items.length() <= 100)
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val id = item.getString("sourceMaterialId")
                val text = requireNotNull(sourceText[id]) { "候选引用未提供的来源" }
                val excerpt = item.getString("excerpt")
                require(matchesExcerpt(text, excerpt)) { "候选摘录不在固定输入片段中" }
                val fields = if (key == "claims") listOf("predicate", "value") else listOf("title", "observation")
                fields.forEach { require(item.getString(it).isNotBlank()) }
            }
        }
    }

    /** Accepts only verbatim text after harmless Unicode and OCR line-wrap normalization. */
    fun matchesExcerpt(source: String, excerpt: String): Boolean {
        if (excerpt.isBlank()) return false
        if (source.contains(excerpt)) return true
        val normalizedSource = normalize(source)
        val normalizedExcerpt = normalize(excerpt)
        if (normalizedExcerpt.isBlank()) return false
        if (normalizedSource.contains(normalizedExcerpt)) return true
        return normalizedSource.replace(WHITESPACE, "").contains(normalizedExcerpt.replace(WHITESPACE, ""))
    }

    private fun invalidReason(key: String, item: JSONObject, sourceText: Map<String, String>): String? {
        val materialId = item.optString("sourceMaterialId")
        if (materialId.isBlank() || materialId !in sourceText) return "候选引用未提供的来源"
        if (!matchesExcerpt(sourceText.getValue(materialId), item.optString("excerpt"))) return "候选摘录不在固定输入片段中"
        val fields = if (key == "claims") listOf("predicate", "value") else listOf("title", "observation")
        if (fields.any { item.optString(it).isBlank() }) return "候选缺少必要字段"
        return null
    }

    private fun normalize(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .replace('\uFEFF', ' ')
        .replace('\u200B', ' ')
        .replace('\u00A0', ' ')
        .replace(WHITESPACE, " ")
        .trim()

    private val WHITESPACE = Regex("\\s+")
}
