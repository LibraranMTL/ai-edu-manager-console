package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject

/** Resolves digest text without treating image bytes as UTF-8 text. */
class MaterialDigestSourceResolver(
    context: Context,
    private val files: FileAssetService = FileAssetService(context),
) {
    fun resolve(studentId: String, material: JSONObject): String {
        val extension = material.optString("fileName").substringAfterLast('.', "").lowercase()
        if (extension in DIRECT_TEXT_EXTENSIONS) {
            return files.readMaterialBytes(studentId, material.getString("id")).toString(Charsets.UTF_8).trim()
        }
        val resultJson = material.optString("ocrPath").takeIf(String::isNotBlank)
            ?.let { path -> runCatching { files.readLogicalBytes(studentId, path).toString(Charsets.UTF_8) }.getOrDefault("") }
            .orEmpty()
        val markdown = material.optString("ocrMarkdownPath").takeIf(String::isNotBlank)
            ?.let { path -> runCatching { files.readLogicalBytes(studentId, path).toString(Charsets.UTF_8) }.getOrDefault("") }
            .orEmpty()
        return MaterialProcessingPolicy.recoveredOcrInput(resultJson, markdown)
    }

    companion object {
        private val DIRECT_TEXT_EXTENSIONS = setOf("txt", "md", "csv", "json")
    }
}
