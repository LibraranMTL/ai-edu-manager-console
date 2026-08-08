package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class CourseCaptureRepository(private val context: Context) {
    fun appendCompleted(
        studentId: String,
        courseId: String,
        provider: String,
        url: String,
        sessionId: String,
        startedAt: Long,
        completedAt: Long,
        rootUri: String,
        rawPath: String,
        capturedFiles: JSONArray,
    ): JSONObject {
        StudentIndexRepository(context).requireExact(studentId)
        val sessionPath = "$rawPath/课程采集/$sessionId"
        val record = JSONObject().put("schema", ProtocolBaseline.COURSE_CAPTURE_SCHEMA)
            .put("studentId", studentId).put("courseId", courseId).put("provider", provider).put("url", url)
            .put("targetType", "student_raw_library").put("targetId", studentId).put("captureSessionId", sessionId)
            .put("startedAt", iso(startedAt)).put("completedAt", iso(completedAt)).put("submittedAt", iso(completedAt))
            .put("filePath", sessionPath).put("fileHash", combinedHash(capturedFiles)).put("capturedFiles", capturedFiles)
        record.put("idempotencyKey", fingerprint(record))
        val store = SafWorkspaceStore(context, Uri.parse(rootUri))
        val ledgerPath = "$rawPath/.edu-manager/course-captures.json"
        val current = try { JSONArray(store.readBytes(ledgerPath).toString(Charsets.UTF_8)) } catch (_: Exception) { JSONArray() }
        if ((0 until current.length()).none { current.getJSONObject(it).optString("idempotencyKey") == record.getString("idempotencyKey") }) current.put(record)
        store.writeBytesSafely(ledgerPath, current.toString(2).toByteArray(), "application/json")
        return record
    }

    private fun fingerprint(record: JSONObject): String = sha256(listOf(
        "studentId", "courseId", "provider", "url", "targetType", "targetId", "captureSessionId", "fileHash",
    ).joinToString("\n") { record.optString(it) }.toByteArray())

    private fun combinedHash(files: JSONArray): String = sha256((0 until files.length()).joinToString("\n") {
        val item = files.getJSONObject(it); "${item.optString("path")}|${item.optString("sha256")}"
    }.toByteArray())

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun iso(epoch: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(epoch))
}
