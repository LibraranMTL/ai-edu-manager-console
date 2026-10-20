package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import java.security.MessageDigest

/** Actual workspace folder names are authoritative, not a global template enumeration. */
object WorkspaceCategoryPolicy {
    private val excluded = setOf("收件箱", "研究暂存", "待整理", "回收站")
    private val legacyIds = mapOf("资料" to "reference", "方案设计" to "design", "进展" to "progress",
        "成果" to "deliverable", "团队成员" to "team", "其他资料" to "other")

    fun categories(directoryNames: List<String>): LinkedHashMap<String, String> {
        val result = linkedMapOf<String, String>()
        directoryNames.filter { it.isNotBlank() && it !in excluded && !it.startsWith('.') && '/' !in it && '\\' !in it }
            .distinct().sorted().forEach { name ->
                val legacy = legacyIds[name]
                // Identity does not change when a neighbouring folder is added or removed.
                val id = legacy ?: "workspace-" + MessageDigest.getInstance("SHA-256")
                    .digest(name.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }.take(24)
                result[id] = name
            }
        return result
    }

    fun categoryAt(relativeFile: String, workspacePath: String, categories: Map<String, String>): String? {
        val prefix = workspacePath.trimEnd('/') + "/"
        if (!relativeFile.startsWith(prefix)) return null
        val suffix = relativeFile.removePrefix(prefix)
        if ('/' !in suffix) return null
        val folder = suffix.substringBefore('/')
        return categories.entries.singleOrNull { it.value == folder }?.key
    }

    fun adoptExplicitDirectory(item: JSONObject, categoryId: String): Boolean {
        val classification = item.getJSONObject("classification")
        if (classification.optBoolean("manualLocked") && classification.optString("source") != "user_directory") return false
        if (classification.optString("categoryId") == categoryId && classification.optString("source") == "user_directory") return false
        classification.put("categoryId", categoryId).put("source", "user_directory").put("status", "user_classified")
            .put("manualLocked", true).put("suggestedCategoryId", "").put("suggestionReason", "")
        item.put("organizationState", "classified")
        return true
    }

    fun needsOrganization(item: JSONObject, availableIds: Set<String>? = null): Boolean = item.optString("adoption") != "accepted" ||
        item.optJSONObject("classification")?.optString("categoryId").isNullOrBlank() ||
        (availableIds != null && item.optJSONObject("classification")?.optString("categoryId") !in availableIds) ||
        item.optString("availability", "available") != "available"
}
