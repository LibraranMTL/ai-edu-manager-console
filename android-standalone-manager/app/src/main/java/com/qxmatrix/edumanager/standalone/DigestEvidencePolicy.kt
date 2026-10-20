package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

/** Validate every proposed observation before any knowledge or growth write. */
object DigestEvidencePolicy {
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
                require(excerpt.isNotBlank() && text.contains(excerpt)) { "候选摘录不在固定输入片段中" }
                val fields = if (key == "claims") listOf("predicate", "value") else listOf("title", "observation")
                fields.forEach { require(item.getString(it).isNotBlank()) }
            }
        }
    }
}
