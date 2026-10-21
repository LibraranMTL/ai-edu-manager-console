package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

/** Keeps OCR readiness, optional visual enrichment and digest recovery as separate states. */
object MaterialProcessingPolicy {
    private val directDigestExtensions = setOf("txt", "md", "csv", "json")

    fun digestReady(material: JSONObject): Boolean {
        val extension = material.optString("fileName").substringAfterLast('.', "").lowercase()
        if (extension in directDigestExtensions) return true
        if (material.optBoolean("digestReady")) return true
        return material.optString("ocrStatus") == "completed" &&
            (material.optString("ocrPath").isNotBlank() || material.optString("ocrMarkdownPath").isNotBlank())
    }

    fun ocrNeedsHelp(material: JSONObject): Boolean {
        val ocrState = material.optString("ocrStatus")
        if (ocrState in setOf("failed", "needs_user")) return true
        val visualState = material.optString("visionStatus")
        return !digestReady(material) && visualState in setOf("failed", "unavailable", "needs_user")
    }

    fun digestNeedsHelp(material: JSONObject): Boolean =
        MaterialStatus.normalize(material.optString("status")) == MaterialStatus.FAILED ||
            material.optString("digestRecoveryState") == "needs_user"

    fun digestInput(result: JSONObject): String {
        result.optString("digestText").trim().takeIf(String::isNotBlank)?.let { return it }
        val ocr = result.optString("text").trim()
        val vision = result.optString("visionSummary").trim()
        return buildList {
            if (ocr.isNotBlank()) add("## OCR 识别文字\n\n$ocr")
            if (vision.isNotBlank()) add("## 视觉解析候选\n\n$vision")
        }.joinToString("\n\n")
    }

    /** Recovers usable OCR text from artifacts written by current and older builds. */
    fun recoveredOcrInput(resultJson: String, markdown: String): String {
        runCatching { digestInput(JSONObject(resultJson)) }.getOrNull()
            ?.takeIf(String::isNotBlank)?.let { return it }
        val recognized = markdownSection(markdown, "识别文字")
        val vision = markdownSection(markdown, "视觉理解")
            .takeUnless { it.startsWith("> 视觉模型未完成解析") }.orEmpty()
        return buildList {
            if (recognized.isNotBlank()) add("## OCR 识别文字\n\n$recognized")
            if (vision.isNotBlank()) add("## 视觉解析候选\n\n$vision")
        }.joinToString("\n\n")
    }

    private fun markdownSection(markdown: String, heading: String): String =
        Regex("(?ms)^##\\s+${Regex.escape(heading)}\\s*\\r?\\n(.*?)(?=^##\\s+|\\z)")
            .find(markdown)?.groupValues?.getOrNull(1)?.trim().orEmpty()

    fun inputKind(ocrText: String, visionText: String): String = when {
        ocrText.isNotBlank() && visionText.isNotBlank() -> "ocr+vision"
        ocrText.isNotBlank() -> "ocr"
        visionText.isNotBlank() -> "vision"
        else -> "none"
    }
}
