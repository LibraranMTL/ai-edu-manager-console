package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

class FileAssetService(private val context: Context) {
    private val students = StudentIndexRepository(context)
    private val assets = AssetIndexRepository(context)

    fun importToStudent(studentId: String, sourceUri: Uri, sourceName: String = "Android 手动导入"): JSONObject {
        val student = students.requireExact(studentId)
        val metadata = sourceMetadata(sourceUri)
        require(metadata.size in 0..MAX_FILE_BYTES) { "单个文件不能超过 100 MB" }
        val bytes = context.contentResolver.openInputStream(sourceUri)?.use { it.readBytes() }
            ?: error("无法读取所选文件")
        require(bytes.size.toLong() <= MAX_FILE_BYTES) { "单个文件不能超过 100 MB" }
        val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
        val filename = uniqueFilename(store, student.paths.rawPath, safeFilename(metadata.name))
        val logicalPath = "${student.paths.rawPath}/$filename"
        val mimeType = context.contentResolver.getType(sourceUri) ?: mimeType(filename)
        store.writeBytesSafely(logicalPath, bytes, mimeType)
        val sha1 = digest("SHA-1", bytes)
        val now = Timestamp.now()
        val materialId = "material-${UUID.randomUUID()}"
        val material = JSONObject()
            .put("id", materialId).put("studentId", student.id).put("studentName", student.name)
            .put("fileName", filename).put("path", filename).put("absolutePath", logicalPath)
            .put("size", bytes.size).put("sha1", sha1).put("uploadedAt", now)
            .put("sourceDevice", "Android 平板").put("sourceDeviceId", "android-local")
            .put("sourcePath", sourceUri.toString()).put("sourceName", sourceName)
            .put("status", MaterialStatus.PENDING_DIGEST.wireValue).put("statusUpdatedAt", now)
            .put("digestedAt", "").put("digestBatchId", "")
        StudentMaterialRepository(context, student).upsert(material)

        val reference = JSONObject()
            .put("id", materialId).put("spaceType", "student").put("spaceId", student.id)
            .put("spaceName", student.name).put("workspaceId", student.id)
            .put("logicalPath", "@RAW_DIR/$filename").put("role", "student_raw")
            .put("path", logicalPath).put("source", sourceName).put("linkedAt", now)
        val asset = JSONObject()
            .put("assetId", "asset-${sha1.take(16)}").put("filename", filename).put("sha1", sha1)
            .put("size", bytes.size).put("type", materialType(filename)).put("path", logicalPath)
            .put("ownerStudentId", student.id).put("ownerStudentName", student.name)
            .put("linkedStudents", JSONArray().put(student.id)).put("linkedProjects", JSONArray())
            .put("references", JSONArray().put(reference)).put("sourcePath", sourceUri.toString())
            .put("sourceName", sourceName).put("sourceType", if (sourceName.contains("拍照")) "camera_photo" else "local_file")
            .put("captureSessionId", "").put("captureItemId", "").put("courseId", "")
            .put("courseProvider", "").put("courseUrl", "").put("courseStartedAt", "").put("courseCompletedAt", "")
            .put("uploadedAt", now).put("updatedAt", now).put("status", "active")
        val indexed = assets.upsertBySha1(asset)
        return JSONObject().put("ok", true).put("material", material).put("asset", indexed)
    }

    fun materials(studentId: String): List<JSONObject> {
        val student = students.requireExact(studentId)
        return StudentMaterialRepository(context, student).list()
    }

    fun assets(studentId: String): List<JSONObject> {
        students.requireExact(studentId)
        return assets.forStudent(studentId)
    }

    fun registerCapturedFile(
        studentId: String,
        logicalPath: String,
        bytes: ByteArray,
        captureSessionId: String,
        captureItemId: String,
        projectId: String = "",
        projectName: String = "",
    ): JSONObject {
        val student = students.requireExact(studentId)
        require(logicalPath.startsWith("${student.paths.rawPath.trimEnd('/')}/")) { "采集文件必须位于当前学生原始资料库" }
        require(bytes.size.toLong() <= MAX_FILE_BYTES) { "单个采集文件不能超过 100 MB" }
        val filename = logicalPath.substringAfterLast('/')
        val relativePath = logicalPath.removePrefix(student.paths.rawPath).trimStart('/')
        val sha1 = digest("SHA-1", bytes); val now = Timestamp.now(); val materialId = "material-$captureItemId"
        val material = JSONObject()
            .put("id", materialId).put("studentId", student.id).put("studentName", student.name)
            .put("fileName", filename).put("path", relativePath).put("absolutePath", logicalPath)
            .put("size", bytes.size).put("sha1", sha1).put("uploadedAt", now)
            .put("sourceDevice", "Android 平板").put("sourceDeviceId", "android-local")
            .put("sourcePath", logicalPath).put("sourceName", "Android 连续屏幕采集")
            .put("status", MaterialStatus.PENDING_DIGEST.wireValue).put("statusUpdatedAt", now)
            .put("digestedAt", "").put("digestBatchId", "").put("captureSessionId", captureSessionId)
            .put("captureItemId", captureItemId).put("projectId", projectId).put("projectName", projectName)
        StudentMaterialRepository(context, student).upsert(material)
        val reference = JSONObject().put("id", materialId).put("spaceType", "student").put("spaceId", student.id)
            .put("spaceName", student.name).put("workspaceId", student.id).put("logicalPath", "@RAW_DIR/$relativePath")
            .put("role", "student_raw").put("path", logicalPath).put("source", "Android 连续屏幕采集").put("linkedAt", now)
        val asset = JSONObject().put("assetId", "asset-${sha1.take(16)}").put("filename", filename).put("sha1", sha1)
            .put("size", bytes.size).put("type", "image").put("path", logicalPath)
            .put("ownerStudentId", student.id).put("ownerStudentName", student.name)
            .put("linkedStudents", JSONArray().put(student.id)).put("linkedProjects", JSONArray().also { if (projectId.isNotBlank()) it.put(projectId) })
            .put("references", JSONArray().put(reference)).put("sourcePath", logicalPath).put("sourceName", "Android 连续屏幕采集")
            .put("sourceType", "android_screenshot").put("captureSessionId", captureSessionId).put("captureItemId", captureItemId)
            .put("courseId", "").put("courseProvider", "").put("courseUrl", "").put("courseStartedAt", "").put("courseCompletedAt", "")
            .put("uploadedAt", now).put("updatedAt", now).put("status", "active")
        return JSONObject().put("ok", true).put("material", material).put("asset", assets.upsertBySha1(asset))
    }

    fun readMaterialBytes(studentId: String, materialId: String): ByteArray {
        val student = students.requireExact(studentId)
        val material = StudentMaterialRepository(context, student).list().singleOrNull { it.optString("id") == materialId }
            ?: throw NoSuchElementException("未找到指定资料")
        val logicalPath = material.optString("absolutePath")
        require(logicalPath == student.paths.rawPath || logicalPath.startsWith("${student.paths.rawPath}/")) { "资料路径超出学生原始资料库" }
        return SafWorkspaceStore(context, Uri.parse(student.storageRootUri)).readBytes(logicalPath)
    }

    fun transitionMaterial(studentId: String, materialId: String, next: MaterialStatus): JSONObject {
        val student = students.requireExact(studentId)
        return StudentMaterialRepository(context, student).transition(materialId, next)
    }

    fun patchMaterial(studentId: String, materialId: String, values: JSONObject): JSONObject {
        val student = students.requireExact(studentId)
        return StudentMaterialRepository(context, student).patch(materialId, values)
    }

    fun readLogicalBytes(studentId: String, logicalPath: String): ByteArray {
        val student = students.requireExact(studentId)
        val allowed = listOf(student.paths.rawPath, student.paths.summaryPath, child(student.paths.rootPath, ".edu-manager"))
        require(allowed.any { logicalPath == it || logicalPath.startsWith("${it.trimEnd('/')}/") }) { "文件路径超出学生授权范围" }
        return SafWorkspaceStore(context, Uri.parse(student.storageRootUri)).readBytes(logicalPath)
    }

    private fun sourceMetadata(uri: Uri): SourceMetadata {
        var name = "资料-${System.currentTimeMillis()}"
        var size = -1L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        return SourceMetadata(name, size)
    }

    private fun uniqueFilename(store: SafWorkspaceStore, rawPath: String, filename: String): String {
        if (!store.exists("$rawPath/$filename")) return filename
        val dot = filename.lastIndexOf('.')
        val stem = if (dot > 0) filename.substring(0, dot) else filename
        val extension = if (dot > 0) filename.substring(dot) else ""
        var sequence = 2
        while (store.exists("$rawPath/$stem-$sequence$extension")) sequence += 1
        return "$stem-$sequence$extension"
    }

    private fun safeFilename(value: String): String = value.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "_").trim().take(180)
        .ifBlank { "资料-${System.currentTimeMillis()}" }

    private fun materialType(filename: String): String = when (filename.substringAfterLast('.', "").lowercase()) {
        "jpg", "jpeg", "png", "gif", "webp", "bmp" -> "image"
        "pdf" -> "pdf"; "doc", "docx" -> "word"; "xls", "xlsx", "csv" -> "sheet"
        "ppt", "pptx" -> "slide"; "md", "txt" -> "text"; "zip" -> "archive"; else -> "file"
    }

    private fun mimeType(filename: String): String = MimeTypeMap.getSingleton()
        .getMimeTypeFromExtension(filename.substringAfterLast('.', "")) ?: "application/octet-stream"

    private fun digest(algorithm: String, bytes: ByteArray): String = MessageDigest.getInstance(algorithm)
        .digest(bytes).joinToString("") { "%02x".format(it) }

    private data class SourceMetadata(val name: String, val size: Long)

    private fun child(root: String, path: String) = if (root.isBlank()) path else "$root/$path"

    companion object { private const val MAX_FILE_BYTES = 100L * 1024 * 1024 }
}
