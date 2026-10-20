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
        students.requireExact(studentId)
        val metadata = sourceMetadata(sourceUri)
        require(metadata.size in -1..MAX_FILE_BYTES) { "单个文件不能超过 100 MB" }
        val bytes = context.contentResolver.openInputStream(sourceUri)?.use { it.readBytesBounded(MAX_FILE_BYTES.toInt()) }
            ?: error("无法读取所选文件")
        return importValidatedBytes(studentId, metadata.name, bytes, context.contentResolver.getType(sourceUri) ?: mimeType(metadata.name), sourceName, sourceUri.toString())
    }

    /** Imports exactly the bytes validated by the caller; never re-opens a mutable provider URI. */
    fun importValidatedBytes(studentId: String, name: String, bytes: ByteArray, mime: String, sourceName: String, sourceRef: String = "", sourceEventId: String = ""): JSONObject = synchronized(StudentWorkLocks.forStudent(studentId)) {
        val student = students.requireExact(studentId)
        require(bytes.size.toLong() <= MAX_FILE_BYTES) { "单个文件不能超过 100 MB" }
        val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
        // Default content idempotency; capture/import adapters may supply their stable event ID.
        val hash = ScopedContentPolicy.hash(bytes)
        val eventKey = ScopedContentPolicy.hash("$studentId:${sourceEventId.ifBlank { hash }}".toByteArray())
        val operationId = "intake:$eventKey"
        val db = BusinessDatabase.get(context); BusinessRestoreRecovery.recover(context, db)
        val previous = db.ledger().exactIntent(studentId, operationId)
        val intent = previous ?: FileOperationIntentEntity(operationId, studentId, "intake", eventKey,
            "${student.paths.rawPath}/${uniqueFilename(store, student.paths.rawPath, safeFilename(name))}", hash, "prepared", System.currentTimeMillis(), System.currentTimeMillis())
            .also { db.ledger().prepareIntent(it) }
        require(intent.kind == "intake" && intent.expectedSha256 == hash && intent.state in setOf("prepared", "committed")) { "相同来源事件内容冲突或需要人工恢复；不覆盖原件" }
        require(intent.targetRef.startsWith("${student.paths.rawPath}/")) { "目录已变化，请核对原导入任务" }
        val logicalPath = intent.targetRef; val filename = logicalPath.substringAfterLast('/')
        val materialId = "material-intake-$eventKey"
        if (store.exists(logicalPath)) require(store.openInputStream(logicalPath).use { ScopedContentPolicy.hash(it.readBytesBounded(MAX_FILE_BYTES.toInt())) } == hash) { "已归档原件已修改，不覆盖" }
        else { require(intent.state != "committed") { "已登记原件缺失，请先恢复来源" }; store.writeBytesSafely(logicalPath, bytes, mime) }
        if (intent.state == "committed") {
            val existing = StudentMaterialRepository(context, student).list().singleOrNull { it.getString("id") == materialId } ?: error("导入已提交但登记缺失，请核对，不重复创建")
            val asset = assets.forStudent(studentId).singleOrNull { it.optString("sha1") == existing.getString("sha1") } ?: error("导入资产登记缺失，请核对")
            IntakeRegistry(context).register(studentId, sourceName, "$sourceRef:${sourceEventId.ifBlank { hash }}", hash, logicalPath, student.storageRootUri, existing.getString("uploadedAt"))
            return@synchronized JSONObject().put("ok", true).put("reused", true).put("material", existing).put("asset", asset)
        }
        val sha1 = digest("SHA-1", bytes)
        val now = Timestamp.now()
        val material = JSONObject()
            .put("id", materialId).put("studentId", student.id).put("studentName", student.name)
            .put("fileName", filename).put("path", filename).put("absolutePath", logicalPath)
            .put("size", bytes.size).put("sha1", sha1).put("uploadedAt", now)
            .put("sourceSha256", hash).put("sourceEventId", eventKey).put("intakeOperationId", operationId)
            .put("sourceDevice", "Android 平板").put("sourceDeviceId", "android-local")
            .put("sourcePath", sourceRef).put("sourceName", sourceName)
            .put("status", MaterialStatus.PENDING_DIGEST.wireValue).put("statusUpdatedAt", now)
            .put("digestedAt", "").put("digestBatchId", "")
        StudentMaterialRepository(context, student).list().singleOrNull { it.optString("id") == materialId }?.let { retained ->
            require(retained.optString("sourceSha256") == hash && retained.getString("absolutePath") == logicalPath) { "导入恢复登记冲突" }
            retained.keys().forEach { key -> material.put(key, retained.get(key)) }
        }
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
            .put("references", JSONArray().put(reference)).put("sourcePath", sourceRef)
            .put("sourceName", sourceName).put("sourceType", if (sourceName.contains("拍照")) "camera_photo" else "local_file")
            .put("captureSessionId", "").put("captureItemId", "").put("courseId", "")
            .put("courseProvider", "").put("courseUrl", "").put("courseStartedAt", "").put("courseCompletedAt", "")
            .put("uploadedAt", now).put("updatedAt", now).put("status", "active")
        val indexed = assets.upsertBySha1(asset)
        IntakeRegistry(context).register(studentId, sourceName, "$sourceRef:${sourceEventId.ifBlank { hash }}", hash, logicalPath, student.storageRootUri, now)
        require(db.ledger().compareAndSetIntent(operationId, studentId, "prepared", "committed", System.currentTimeMillis()) == 1) { "导入登记状态已变化，原件保留" }
        JSONObject().put("ok", true).put("material", material).put("asset", indexed)
    }

    fun materials(studentId: String): List<JSONObject> {
        val student = students.requireExact(studentId)
        return StudentMaterialRepository(context, student).list()
    }

    fun assets(studentId: String): List<JSONObject> {
        students.requireExact(studentId)
        return assets.forStudent(studentId)
    }

    /** Registers course screenshots created by older builds without moving or rewriting originals. */
    fun reconcileLegacyCourseCaptures(studentId: String): JSONObject {
        val student = students.requireExact(studentId)
        val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
        val ledgerPath = "${student.paths.rawPath}/.edu-manager/course-captures.json"
        if (!store.exists(ledgerPath)) return JSONObject().put("registered", 0).put("failed", 0)
        val sessions = JSONArray(store.readBytes(ledgerPath).toString(Charsets.UTF_8))
        val existingIds = materials(student.id).map { it.optString("id") }.toMutableSet()
        var registered = 0
        val failures = JSONArray()
        for (sessionIndex in 0 until sessions.length()) {
            val session = sessions.optJSONObject(sessionIndex) ?: continue
            val captured = session.optJSONArray("capturedFiles") ?: continue
            for (fileIndex in 0 until captured.length()) {
                val item = captured.optJSONObject(fileIndex) ?: continue
                val captureItemId = item.optString("captureItemId")
                val materialId = "material-$captureItemId"
                if (captureItemId.isBlank() || materialId in existingIds) continue
                val logicalPath = item.optString("path")
                if (!logicalPath.startsWith("${student.paths.rawPath.trimEnd('/')}/")) {
                    failures.put(JSONObject().put("path", logicalPath).put("error", "路径超出学生原始资料库")); continue
                }
                runCatching {
                    val bytes = store.readBytes(logicalPath)
                    registerCapturedFile(
                        studentId = student.id,
                        logicalPath = logicalPath,
                        bytes = bytes,
                        captureSessionId = session.optString("captureSessionId"),
                        captureItemId = captureItemId,
                        projectId = item.optString("projectId"),
                        projectName = item.optString("projectName"),
                        courseId = item.optString("courseId").ifBlank { session.optString("courseId") },
                        courseProvider = item.optString("courseProvider").ifBlank { session.optString("provider") },
                        courseUrl = item.optString("courseUrl").ifBlank { session.optString("url") },
                    )
                    existingIds += materialId; registered += 1
                }.onFailure { failures.put(JSONObject().put("path", logicalPath).put("error", it.message ?: "登记失败")) }
            }
        }
        return JSONObject().put("registered", registered).put("failed", failures.length()).put("failures", failures)
    }

    fun registerCapturedFile(
        studentId: String,
        logicalPath: String,
        bytes: ByteArray,
        captureSessionId: String,
        captureItemId: String,
        projectId: String = "",
        projectName: String = "",
        courseId: String = "",
        courseProvider: String = "",
        courseUrl: String = "",
    ): JSONObject {
        val student = students.requireExact(studentId)
        require(logicalPath.startsWith("${student.paths.rawPath.trimEnd('/')}/")) { "采集文件必须位于当前学生原始资料库" }
        require(bytes.size.toLong() <= MAX_FILE_BYTES) { "单个采集文件不能超过 100 MB" }
        val filename = logicalPath.substringAfterLast('/')
        val relativePath = logicalPath.removePrefix(student.paths.rawPath).trimStart('/')
        val sha1 = digest("SHA-1", bytes); val now = Timestamp.now(); val materialId = "material-$captureItemId"
        val courseCapture = courseId.isNotBlank()
        val sourceName = if (courseCapture) "Android 课程连续屏幕采集" else "Android 连续屏幕采集"
        val material = JSONObject()
            .put("id", materialId).put("studentId", student.id).put("studentName", student.name)
            .put("fileName", filename).put("path", relativePath).put("absolutePath", logicalPath)
            .put("size", bytes.size).put("sha1", sha1).put("uploadedAt", now)
            .put("sourceDevice", "Android 平板").put("sourceDeviceId", "android-local")
            .put("sourcePath", logicalPath).put("sourceName", sourceName)
            .put("status", MaterialStatus.PENDING_DIGEST.wireValue).put("statusUpdatedAt", now)
            .put("digestedAt", "").put("digestBatchId", "").put("captureSessionId", captureSessionId)
            .put("captureItemId", captureItemId).put("projectId", projectId).put("projectName", projectName)
            .put("courseId", courseId).put("courseProvider", courseProvider).put("courseUrl", courseUrl)
        val contentHash = ScopedContentPolicy.hash(bytes)
        material.put("sourceSha256", contentHash).put("sourceEventId", captureItemId).put("sourceChannel", if (courseCapture) "course_screen" else "screen")
        val prior = StudentMaterialRepository(context, student).list().singleOrNull { it.optString("id") == materialId }
        if (prior != null) require((if (prior.optString("sourceSha256").isBlank()) prior.optString("sha1") == sha1 else prior.getString("sourceSha256") == contentHash) && prior.getString("absolutePath") == logicalPath) { "采集事件原件冲突" }
        IntakeRegistry(context).register(studentId, if (courseCapture) "course_screen" else "screen", captureItemId, contentHash, logicalPath, student.storageRootUri, prior?.optString("uploadedAt") ?: now, projectId)
        StudentMaterialRepository(context, student).upsert(prior?.apply { put("sourceSha256", contentHash) } ?: material)
        val reference = JSONObject().put("id", materialId).put("spaceType", "student").put("spaceId", student.id)
            .put("spaceName", student.name).put("workspaceId", student.id).put("logicalPath", "@RAW_DIR/$relativePath")
            .put("role", "student_raw").put("path", logicalPath).put("source", sourceName).put("linkedAt", now)
        val asset = JSONObject().put("assetId", "asset-${sha1.take(16)}").put("filename", filename).put("sha1", sha1)
            .put("size", bytes.size).put("type", "image").put("path", logicalPath)
            .put("ownerStudentId", student.id).put("ownerStudentName", student.name)
            .put("linkedStudents", JSONArray().put(student.id)).put("linkedProjects", JSONArray().also { if (projectId.isNotBlank()) it.put(projectId) })
            .put("references", JSONArray().put(reference)).put("sourcePath", logicalPath).put("sourceName", sourceName)
            .put("sourceType", if (courseCapture) "course_screen_capture" else "android_screenshot").put("captureSessionId", captureSessionId).put("captureItemId", captureItemId)
            .put("courseId", courseId).put("courseProvider", courseProvider).put("courseUrl", courseUrl).put("courseStartedAt", "").put("courseCompletedAt", "")
            .put("uploadedAt", now).put("updatedAt", now).put("status", "active")
        return JSONObject().put("ok", true).put("material", material).put("asset", assets.upsertBySha1(asset))
    }

    fun readMaterialBytes(studentId: String, materialId: String, maximum: Int = MAX_FILE_BYTES.toInt()): ByteArray {
        val student = students.requireExact(studentId)
        val material = StudentMaterialRepository(context, student).list().singleOrNull { it.optString("id") == materialId }
            ?: throw NoSuchElementException("未找到指定资料")
        val logicalPath = material.optString("absolutePath")
        require(logicalPath == student.paths.rawPath || logicalPath.startsWith("${student.paths.rawPath}/")) { "资料路径超出学生原始资料库" }
        return SafWorkspaceStore(context, Uri.parse(student.storageRootUri)).openInputStream(logicalPath).use { it.readBytesBounded(maximum) }
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
