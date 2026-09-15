package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class EducationPublicationRecord(
    val id: String,
    val studentId: String,
    val studentName: String,
    val sourceId: String,
    val sourceTitle: String,
    val sourceHash: String,
    val templateId: String,
    val templateName: String,
    val format: String,
    val colorMode: String,
    val outputPath: String,
    val outputUri: String,
    val generatedAt: String,
    val edited: Boolean,
    val generationMethod: String,
) {
    fun toJson() = JSONObject().put("schema", EducationPublicationPolicy.PUBLICATION_SCHEMA).put("id", id)
        .put("studentId", studentId).put("studentName", studentName).put("sourceType", "learning_report")
        .put("sourceId", sourceId).put("sourceTitle", sourceTitle).put("sourceHash", sourceHash)
        .put("templateId", templateId).put("templateName", templateName).put("format", format)
        .put("colorMode", colorMode).put("outputPath", outputPath).put("outputUri", outputUri).put("generatedAt", generatedAt)
        .put("edited", edited).put("generationMethod", generationMethod)

    companion object {
        fun fromJson(value: JSONObject) = EducationPublicationRecord(
            value.getString("id"), value.getString("studentId"), value.optString("studentName"),
            value.optString("sourceId"), value.optString("sourceTitle"), value.optString("sourceHash"),
            value.optString("templateId"), value.optString("templateName"), value.optString("format"),
            value.optString("colorMode"), value.optString("outputPath"), value.optString("outputUri"), value.optString("generatedAt"),
            value.optBoolean("edited"), value.optString("generationMethod", "source"),
        )
    }
}

class EducationPublicationRepository(private val context: Context) {
    private val state = PrivateStateStore(context)

    fun list(studentId: String): List<EducationPublicationRecord> = readAll().filter { it.studentId == studentId }

    fun add(
        student: StudentRecord,
        reportId: String,
        sourceTitle: String,
        sourceHash: String,
        template: EducationPublicationTemplate,
        format: String,
        colorMode: String,
        output: File,
        edited: Boolean,
        generationMethod: String,
    ): EducationPublicationRecord {
        require(output.canonicalPath.startsWith(cacheRoot().canonicalPath + File.separator)) { "输出文件不在应用出版目录" }
        val record = EducationPublicationRecord(
            "publication-${UUID.randomUUID()}", student.id, student.name, reportId, sourceTitle, sourceHash,
            template.id, template.name, format, colorMode, output.absolutePath,
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", output).toString(),
            Timestamp.now(), edited, generationMethod,
        )
        write(listOf(record) + readAll().filterNot { it.id == record.id }.take(199))
        return record
    }

    fun requireExact(studentId: String, recordId: String): EducationPublicationRecord = list(studentId).singleOrNull { it.id == recordId }
        ?: error("未找到指定输出记录")

    fun delete(studentId: String, recordId: String) {
        val record = requireExact(studentId, recordId)
        val output = File(record.outputPath)
        require(output.canonicalPath.startsWith(cacheRoot().canonicalPath + File.separator)) { "只能删除应用生成的输出文件" }
        if (output.exists()) check(output.delete()) { "无法删除输出文件" }
        write(readAll().filterNot { it.id == record.id })
    }

    fun cacheFile(stem: String, extension: String): File {
        val cleanStem = stem.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "-").take(80).ifBlank { "学情报告" }
        val root = cacheRoot().apply { mkdirs() }
        return File(root, "$cleanStem-${System.currentTimeMillis()}.$extension")
    }

    private fun cacheRoot() = File(context.filesDir, "report-publications")

    private fun readAll(): List<EducationPublicationRecord> = runCatching {
        val values = JSONArray(state.readBytes(INDEX_PATH).toString(Charsets.UTF_8))
        buildList { for (index in 0 until values.length()) values.optJSONObject(index)?.let { add(EducationPublicationRecord.fromJson(it)) } }
    }.getOrDefault(emptyList())

    private fun write(records: List<EducationPublicationRecord>) {
        val values = JSONArray(); records.forEach { values.put(it.toJson()) }
        state.writeBytes(INDEX_PATH, (values.toString(2) + "\n").toByteArray(Charsets.UTF_8))
    }

    companion object { private const val INDEX_PATH = "education-publications.json" }
}
