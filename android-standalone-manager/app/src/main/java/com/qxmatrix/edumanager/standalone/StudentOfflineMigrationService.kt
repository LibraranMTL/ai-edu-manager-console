package com.qxmatrix.edumanager.standalone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.getSystemService
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/** Foreground, resumable directory migration for large exact-student exports. */
class StudentOfflineMigrationService : Service() {
    private val journal by lazy { StudentOfflineMigrationJournal(this) }
    private val notificationManager by lazy { requireNotNull(getSystemService<NotificationManager>()) }
    private var wakeLock: PowerManager.WakeLock? = null
    @Volatile private var activeState: StudentOfflineMigrationState? = null
    @Volatile private var lastProgressPersistAt = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notificationManager.createNotificationChannel(NotificationChannel(CHANNEL, "学生资料迁移", NotificationManager.IMPORTANCE_LOW))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val source = intent?.getStringExtra(EXTRA_SOURCE_URI).orEmpty()
        val target = intent?.getStringExtra(EXTRA_TARGET_URI).orEmpty()
        startForeground(NOTIFICATION_ID, notification("正在准备迁移", 0, 0))
        if (source.isBlank() || target.isBlank()) { stopSelf(startId); return START_NOT_STICKY }
        if (!running.compareAndSet(false, true)) {
            activeState?.let(::updateNotification)
            return START_REDELIVER_INTENT
        }
        val startedAt = System.currentTimeMillis()
        publishLive(StudentOfflineMigrationState(
            migrationId = "pending-$startedAt", sourceUri = source, targetUri = target, phase = "preparing",
            totalFiles = 0, completedFiles = 0, totalBytes = 0L, completedBytes = 0L, current = "",
            message = "正在准备迁移", completedKeys = emptySet(), updatedAt = Timestamp.now(), startedAtEpochMs = startedAt,
        ))
        Thread {
            wakeLock = getSystemService<PowerManager>()?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:student-offline-migration")?.apply { acquire(2 * 60 * 60 * 1000L) }
            try { migrate(Uri.parse(source), Uri.parse(target), startedAt) }
            catch (error: Throwable) {
                val previous = activeState
                if (previous != null) publishCheckpoint(previous.copy(
                    phase = "failed", message = error.message ?: "迁移失败", currentFileBytes = 0L,
                    currentFileTotalBytes = 0L, updatedAt = Timestamp.now(),
                ))
                notifyFinal("迁移未完成：${error.message ?: "未知错误"}")
            } finally {
                if (wakeLock?.isHeld == true) wakeLock?.release()
                wakeLock = null
                running.set(false)
                stopSelf(startId)
            }
        }.start()
        return START_REDELIVER_INTENT
    }

    private fun migrate(sourceUri: Uri, targetUri: Uri, startedAtEpochMs: Long) {
        publishLive(requireNotNull(activeState).copy(phase = "checking-license", message = "正在检查产品激活和学生席位", updatedAt = Timestamp.now()))
        LicenseManager(this).requireActive()
        publishLive(requireNotNull(activeState).copy(phase = "verifying", message = "正在检查迁移目录和文件清单", updatedAt = Timestamp.now()))
        val source = requireNotNull(DocumentFile.fromTreeUri(this, sourceUri)) { "无法读取迁移目录" }
        val descriptor = JSONObject(readSmall(requireFile(source, "migration.json"), 2 * 1024 * 1024).toString(Charsets.UTF_8))
        val manifestBytes = readSmall(requireFile(source, "manifest.json"), 16 * 1024 * 1024)
        val expectedManifest = readSmall(requireFile(source, "manifest.sha256"), 1024).toString(Charsets.UTF_8).trim().split(Regex("\\s+"))[0].lowercase()
        require(sha256(manifestBytes) == expectedManifest) { "迁移清单校验失败" }
        val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8))
        require(descriptor.getString("schema") == PACKAGE_SCHEMA && manifest.getString("schema") == MANIFEST_SCHEMA) { "不支持的迁移目录版本" }
        val migrationId = descriptor.getString("migrationId")
        require(manifest.getString("migrationId") == migrationId && !manifest.optBoolean("encrypted", true)) { "迁移目录身份或加密状态无效" }
        require(manifest.optString("profile") == PROFILE && manifest.optString("identityPolicy") == "preserve-exact-student-and-project-identities") { "迁移目录不是精确学生离线包" }
        val studentJson = manifest.getJSONObject("student")
        require(studentJson.getString("id") == manifest.getString("studentId")) { "学生身份不一致" }
        val importedStudent = StudentRecord.imported(
            id = studentJson.getString("id"), name = studentJson.getString("name"), grade = studentJson.optString("grade"),
            school = studentJson.optString("school"), goal = studentJson.optString("goal"), storageRootUri = targetUri.toString(),
            paths = StudentWorkspacePaths.adopted(studentJson.getString("name")),
        )
        val studentRepository = StudentIndexRepository(this)
        val existingStudent = studentRepository.list().singleOrNull { it.id == importedStudent.id }
        if (existingStudent == null) studentRepository.validateAdd(importedStudent)
        else require(existingStudent.name == importedStudent.name && existingStudent.storageRootUri == importedStudent.storageRootUri) { "该学生 ID 已绑定到其他目录" }
        val files = manifest.getJSONArray("files")
        require(files.length() in 1..MAX_FILES) { "迁移文件数量超出限制" }
        val totalBytes = (0 until files.length()).sumOf { files.getJSONObject(it).getLong("size") }
        require(totalBytes in 1..MAX_TOTAL_BYTES) { "迁移容量超出限制" }

        val target = SafWorkspaceStore(this, targetUri)
        requireTargetIsEmptyOrResuming(target, migrationId)
        val previous = journal.read(migrationId)?.takeIf { it.sourceUri == sourceUri.toString() && it.targetUri == targetUri.toString() }
        val completed = previous?.completedKeys?.toMutableSet() ?: linkedSetOf()
        var completedBytes = previous?.completedBytes ?: 0L
        var completedFiles = previous?.completedFiles ?: 0
        var state = StudentOfflineMigrationState(
            migrationId = migrationId, sourceUri = sourceUri.toString(), targetUri = targetUri.toString(), phase = "copying",
            totalFiles = files.length(), completedFiles = completedFiles, totalBytes = totalBytes, completedBytes = completedBytes,
            current = "", message = "正在复制并校验资料", completedKeys = completed, updatedAt = Timestamp.now(),
            startedAtEpochMs = startedAtEpochMs,
        )
        target.writeBytesSafely(IN_PROGRESS_MARKER, JSONObject().put("migrationId", migrationId).put("studentId", studentJson.getString("id")).put("startedAt", Timestamp.now()).toString(2).toByteArray(), "application/json")
        publishCheckpoint(state)

        var courseSnapshot: JSONObject? = null
        val courseCovers = linkedMapOf<String, ByteArray>()
        var sinceCheckpoint = 0
        for (index in 0 until files.length()) {
            val item = files.getJSONObject(index)
            val payloadPath = safePath(item.getString("payloadRelativePath"))
            val destination = safePath(item.optString("destinationRelativePath", item.getString("relativePath")))
            val key = "$payloadPath|${item.getString("sha256")}|${item.getLong("size")}"
            val category = item.getString("category")
            val courseEntry = category == "course" || category == "course-asset"
            if (!courseEntry && key in completed && target.exists(destination)) continue
            val document = resolveFile(source, "payload/$payloadPath")
            require(document.length() == item.getLong("size")) { "迁移文件大小不符：$destination" }
            state = state.copy(
                current = destination, currentFileBytes = 0L, currentFileTotalBytes = item.getLong("size"),
                message = if (courseEntry) "正在校验课程资料" else "正在复制并校验资料", updatedAt = Timestamp.now(),
            )
            publishLive(state)
            if (courseEntry) {
                val bytes = readSmall(document, CourseCatalogService.MAX_ENTRY_BYTES)
                require(sha256(bytes) == item.getString("sha256").lowercase()) { "课程文件校验失败：$destination" }
                if (category == "course") courseSnapshot = JSONObject(bytes.toString(Charsets.UTF_8))
                else courseCovers[item.getString("relativePath").substringAfterLast('/')] = bytes
            } else {
                val digest = MessageDigest.getInstance("SHA-256"); var copied = 0L
                var lastLiveUpdateAt = 0L
                target.writeStreamSafely(destination, mimeType(destination)) { output ->
                    contentResolver.openInputStream(document.uri)?.use { input ->
                        val buffer = ByteArray(128 * 1024)
                        while (true) {
                            val count = input.read(buffer); if (count < 0) break
                            output.write(buffer, 0, count); digest.update(buffer, 0, count); copied += count
                            val now = System.currentTimeMillis()
                            if (copied == item.getLong("size") || now - lastLiveUpdateAt >= LIVE_UPDATE_INTERVAL_MS) {
                                publishLive(state.copy(currentFileBytes = copied, updatedAt = Timestamp.now()), forcePersist = false)
                                lastLiveUpdateAt = now
                            }
                        }
                    } ?: error("无法读取迁移文件：$destination")
                    require(copied == item.getLong("size") && digest.digest().joinToString("") { "%02x".format(it) } == item.getString("sha256").lowercase()) { "迁移文件校验失败：$destination" }
                }
            }
            if (key !in completed) { completed += key; completedFiles += 1; completedBytes += item.getLong("size") }
            sinceCheckpoint += 1
            state = state.copy(
                completedFiles = completedFiles, completedBytes = completedBytes, current = destination,
                currentFileBytes = 0L, currentFileTotalBytes = 0L, completedKeys = completed, updatedAt = Timestamp.now(),
            )
            if (sinceCheckpoint >= 10 || index == files.length() - 1) { publishCheckpoint(state); sinceCheckpoint = 0 } else publishLive(state)
        }

        state = state.copy(phase = "importing-student", current = "", message = "正在接管学生档案", updatedAt = Timestamp.now())
        publishLive(state)
        val student = importedStudent
        studentRepository.addImportedIdempotent(student)
        val projects = manifest.optJSONArray("projects") ?: JSONArray()
        state = state.copy(phase = "importing-projects", message = "正在接管关联学习项目", updatedAt = Timestamp.now())
        publishLive(state)
        for (index in 0 until projects.length()) {
            val value = projects.getJSONObject(index); val name = value.getString("name")
            ProjectRepository(this).addImportedIdempotent(ProjectRecord(
                id = value.getString("id"), name = name, type = value.optString("type", "学习项目"), description = value.optString("description"), objective = value.optString("objective"),
                studentIds = listOf(student.id), studentNames = listOf(student.name), status = value.optString("status", "active"),
                projectRootUri = targetUri.toString(), knowledgeRootUri = targetUri.toString(), workspaceRootUri = targetUri.toString(), workspaceMode = "managed", knowledgeMode = "managed",
                knowledgeSpaceId = "", paths = ProjectPaths.managed(name), knowledgeAdoption = null, createdAt = Timestamp.now(),
            ))
        }
        state = state.copy(phase = "importing-courses", message = "正在导入平台和机构课程", updatedAt = Timestamp.now())
        publishLive(state)
        courseSnapshot?.let { CourseCatalogService(this).importOfflineSnapshot(student.id, it, courseCovers) }
        state = state.copy(phase = "completing", message = "正在完成接管并保存迁移状态", updatedAt = Timestamp.now())
        publishLive(state)
        target.writeBytesSafely(COMPLETE_MARKER, JSONObject().put("migrationId", migrationId).put("studentId", student.id).put("completedAt", Timestamp.now()).put("fileCount", completedFiles).put("totalBytes", completedBytes).toString(2).toByteArray(), "application/json")
        val done = state.copy(phase = "completed", completedFiles = files.length(), completedBytes = totalBytes, current = "", message = "迁移完成", updatedAt = Timestamp.now())
        publishCheckpoint(done); notifyFinal("${student.name} 迁移完成，共 ${files.length()} 个文件")
    }

    private fun requireTargetIsEmptyOrResuming(target: SafWorkspaceStore, migrationId: String) {
        val rootEntries = target.listRoot()
        if (rootEntries.isEmpty()) return
        val marker = runCatching { JSONObject(target.readBytes(IN_PROGRESS_MARKER).toString(Charsets.UTF_8)).optString("migrationId") }.getOrNull()
        require(marker == migrationId) { "目标目录不是空目录；请选择空目录，或重新选择本次未完成迁移的原目标目录" }
    }

    private fun publishCheckpoint(value: StudentOfflineMigrationState) {
        activeState = value; journal.write(value); updateNotification(value); broadcast(value)
    }
    private fun publishLive(value: StudentOfflineMigrationState, forcePersist: Boolean = true) {
        activeState = value
        val now = System.currentTimeMillis()
        if (forcePersist || now - lastProgressPersistAt >= LIVE_PERSIST_INTERVAL_MS) {
            journal.writeProgress(value)
            lastProgressPersistAt = now
        }
        updateNotification(value); broadcast(value)
    }
    private fun broadcast(value: StudentOfflineMigrationState) {
        sendBroadcast(Intent(ACTION_PROGRESS).setPackage(packageName).putExtra(EXTRA_STATE, value.toProgressJson().toString()))
    }
    private fun updateNotification(value: StudentOfflineMigrationState) { notificationManager.notify(NOTIFICATION_ID, notification(value)) }
    private fun notifyFinal(text: String) { notificationManager.notify(NOTIFICATION_ID, notification(text, 1, 1)) }
    private fun notification(value: StudentOfflineMigrationState): android.app.Notification {
        val liveBytes = (value.completedBytes + value.currentFileBytes).coerceAtMost(value.totalBytes)
        val progress = if (value.totalBytes > 0L) ((liveBytes * 1000L) / value.totalBytes).toInt() else 0
        val detail = if (value.totalFiles > 0) "${value.completedFiles}/${value.totalFiles} 个文件 · ${value.message}" else value.message
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("AI教育管家学生迁移").setContentText(detail)
            .setOnlyAlertOnce(true).setOngoing(value.phase !in setOf("completed", "failed"))
            .setProgress(1000, progress, value.totalBytes <= 0L)
            .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build()
    }
    private fun notification(text: String, completed: Int, total: Int) = NotificationCompat.Builder(this, CHANNEL)
        .setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("AI教育管家学生迁移").setContentText(text).setOnlyAlertOnce(true).setOngoing(total == 0 || completed < total)
        .setProgress(total, completed, total == 0).setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build()

    private fun requireFile(root: DocumentFile, name: String): DocumentFile = requireNotNull(root.findFile(name)?.takeIf { it.isFile }) { "迁移目录缺少 $name" }
    private fun resolveFile(root: DocumentFile, relative: String): DocumentFile {
        var current = root
        for (segment in WorkspacePath.segments(relative)) current = requireNotNull(current.findFile(segment)) { "迁移目录缺少 $relative" }
        require(current.isFile) { "迁移载荷不是文件：$relative" }; return current
    }
    private fun readSmall(document: DocumentFile, maximum: Int): ByteArray {
        val output = ByteArrayOutputStream(); contentResolver.openInputStream(document.uri)?.use { input ->
            val buffer = ByteArray(32 * 1024); var total = 0
            while (true) { val count = input.read(buffer); if (count < 0) break; total += count; require(total <= maximum) { "迁移元数据或课程文件过大" }; output.write(buffer, 0, count) }
        } ?: error("无法读取 ${document.name}"); return output.toByteArray()
    }
    private fun safePath(value: String): String = WorkspacePath.segments(value).joinToString("/")
    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) { "json" -> "application/json"; "md", "txt" -> "text/plain"; "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"; "webp" -> "image/webp"; "pdf" -> "application/pdf"; else -> "application/octet-stream" }

    companion object {
        const val ACTION_START = "com.qxmatrix.edumanager.standalone.START_STUDENT_OFFLINE_MIGRATION"
        const val ACTION_PROGRESS = "com.qxmatrix.edumanager.standalone.STUDENT_OFFLINE_MIGRATION_PROGRESS"
        const val EXTRA_SOURCE_URI = "sourceUri"; const val EXTRA_TARGET_URI = "targetUri"; const val EXTRA_STATE = "state"
        const val PACKAGE_SCHEMA = "edu-manager.student-portable-folder.v2"; const val MANIFEST_SCHEMA = "edu-manager.student-portable-manifest.v2"; const val PROFILE = "student-android-offline"
        private val running = AtomicBoolean(false)
        fun isRunning(): Boolean = running.get()
        private const val CHANNEL = "student-offline-migration"; private const val NOTIFICATION_ID = 4203
        private const val LIVE_UPDATE_INTERVAL_MS = 500L
        private const val LIVE_PERSIST_INTERVAL_MS = 5_000L
        private const val IN_PROGRESS_MARKER = ".edu-manager/migration-in-progress.json"; private const val COMPLETE_MARKER = ".edu-manager/migration-complete.json"
        private const val MAX_FILES = 100_000; private const val MAX_TOTAL_BYTES = 1L shl 40
    }
}
