package com.qxmatrix.edumanager.standalone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.DocumentsContract
import androidx.core.app.NotificationCompat
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Directory-based, unencrypted whole-device migration for large family libraries.
 * It intentionally excludes licenses, API keys, Keystore material, SAF grants and device bindings.
 */
class StandaloneDeviceMigrationService : Service() {
    private val running = AtomicBoolean(false)
    private val journal by lazy { StandaloneDeviceMigrationJournal(this) }
    private val notificationManager by lazy { getSystemService(NotificationManager::class.java) }
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate(); createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action.orEmpty()
        val source = intent?.getStringExtra(EXTRA_SOURCE_URI).orEmpty()
        val target = intent?.getStringExtra(EXTRA_TARGET_URI).orEmpty()
        startForeground(NOTIFICATION_ID, notification("正在准备整机迁移", 0, 0))
        if (!running.compareAndSet(false, true)) return START_REDELIVER_INTENT
        Thread {
            acquireWakeLock()
            try {
                when (action) {
                    ACTION_EXPORT -> exportTo(Uri.parse(target))
                    ACTION_IMPORT -> importFrom(Uri.parse(source), Uri.parse(target))
                    else -> error("未知整机迁移操作")
                }
            } catch (error: Throwable) {
                val previous = journal.latest()
                if (previous != null) update(previous.copy(phase = "failed", message = error.message ?: "整机迁移失败", updatedAt = Timestamp.now()))
            } finally {
                releaseWakeLock(); running.set(false); stopForeground(false); stopSelf()
            }
        }.start()
        return START_REDELIVER_INTENT
    }

    private fun exportTo(destinationUri: Uri) {
        val license = LicenseManager(this).requireActive()
        val roots = collectRoots()
        require(roots.isNotEmpty()) { "请先授权单机版资料根目录" }
        requireOutsideManagedRoots(destinationUri, roots)
        val previous = journal.latest()?.takeIf { it.operation == OPERATION_EXPORT && it.targetUri == destinationUri.toString() && it.phase != "completed" }
        val migrationId = previous?.migrationId ?: "device-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}"
        val destination = SafWorkspaceStore(this, destinationUri)
        requireEmptyOrResumable(destination, migrationId, previous != null)
        writeMarker(destination, migrationId, OPERATION_EXPORT, "copying")

        val sources = collectManagedSources(roots) + collectStateSources()
        require(sources.size <= MAX_FILES) { "整机迁移文件超过 $MAX_FILES 个，请先归档不再使用的资料" }
        var totalBytes = 0L
        sources.forEach { source ->
            require(source.size in 0..(MAX_BYTES - totalBytes)) { "整机迁移容量超过 1 TB，请拆分历史资料" }
            totalBytes += source.size
        }
        val completed = previous?.completedKeys?.toMutableSet() ?: linkedSetOf()
        val entries = JSONArray(); var completedBytes = 0L; var completedFiles = 0
        var state = StandaloneDeviceMigrationState(migrationId, OPERATION_EXPORT, "", destinationUri.toString(), "copying",
            sources.size, 0, totalBytes, 0, "", "正在导出整机资料", completed, Timestamp.now())
        update(state)

        sources.forEachIndexed { index, source ->
            val key = source.resumeKey()
            val payloadPath = payloadPath(source)
            val hash: String
            if (key in completed && source.modified > 0 && destination.exists(payloadPath)) {
                hash = destination.openInputStream(payloadPath).use(::sha256)
            } else {
                val digest = MessageDigest.getInstance("SHA-256"); var copied = 0L
                destination.writeStreamSafely(payloadPath, "application/octet-stream") { output ->
                    source.open().use { input -> copied = copyAndHash(input, output, digest) }
                }
                val afterSize = source.currentSize()
                val afterModified = source.currentModified()
                if ((source.size >= 0 && copied != source.size) || (afterSize >= 0 && afterSize != source.size) ||
                    (source.modified > 0 && afterModified > 0 && afterModified != source.modified)) {
                    runCatching { destination.deleteFileIfExists(payloadPath) }
                    error("导出期间源文件发生变化：${source.relativePath}")
                }
                hash = digest.digest().hex(); completed += key
            }
            entries.put(source.toManifest(payloadPath, hash))
            completedFiles = index + 1; completedBytes += source.size.coerceAtLeast(0)
            state = state.copy(completedFiles = completedFiles, completedBytes = completedBytes,
                current = source.relativePath, message = "正在导出 $completedFiles/${sources.size}", completedKeys = completed.toSet(), updatedAt = Timestamp.now())
            if (completedFiles % JOURNAL_INTERVAL == 0 || completedFiles == sources.size) update(state) else updateNotification(state)
        }

        val createdAt = Timestamp.now()
        val manifest = JSONObject().put("schema", StandaloneDeviceMigrationContract.MANIFEST_SCHEMA)
            .put("profile", StandaloneDeviceMigrationContract.PROFILE).put("migrationId", migrationId)
            .put("appVersion", appVersion()).put("createdAt", createdAt).put("encrypted", false)
            .put("identityPolicy", "preserve-business-ids-remap-device-uris")
            .put("roots", JSONArray().also { array -> roots.forEach { array.put(it.toJson()) } }).put("files", entries)
            .put("excludedSensitiveData", JSONArray(EXCLUSIONS))
        val manifestBytes = (manifest.toString(2) + "\n").toByteArray()
        destination.writeBytesSafely(StandaloneDeviceMigrationContract.MANIFEST_PATH, manifestBytes, "application/json")
        destination.writeBytesSafely(StandaloneDeviceMigrationContract.MANIFEST_HASH_PATH, (sha256(bytes = manifestBytes) + "  manifest.json\n").toByteArray(), "text/plain")
        val descriptor = JSONObject().put("schema", StandaloneDeviceMigrationContract.PACKAGE_SCHEMA)
            .put("profile", StandaloneDeviceMigrationContract.PROFILE).put("migrationId", migrationId)
            .put("appVersion", appVersion()).put("createdAt", createdAt).put("encrypted", false)
            .put("fileCount", entries.length()).put("totalBytes", totalBytes)
            .put("studentCount", StudentIndexRepository(this).list().size).put("projectCount", ProjectRepository(this).list().size)
            .put("licenseSeatCountAtExport", license.maxActiveStudents)
            .put("ui", JSONObject().put("skin", UiPreferences(this).skin().wireValue).put("layout", UiPreferences(this).layoutMode().wireValue))
            .put("agentPublic", AgentConfigurationStore(this).publicProfile()?.toJson() ?: JSONObject.NULL)
            .put("requiresNewDeviceActivation", true).put("requiresAgentApiKey", true)
        destination.writeBytesSafely(StandaloneDeviceMigrationContract.DESCRIPTOR_PATH, (descriptor.toString(2) + "\n").toByteArray(), "application/json")
        writeMarker(destination, migrationId, OPERATION_EXPORT, "completed")
        val done = state.copy(phase = "completed", current = "", message = "整机迁移目录导出完成", completedKeys = completed.toSet(), updatedAt = Timestamp.now())
        update(done)
    }

    private fun importFrom(sourceUri: Uri, targetUri: Uri) {
        val license = LicenseManager(this).requireActive()
        require(StudentIndexRepository(this).list().isEmpty() && ProjectRepository(this).list().isEmpty()) {
            "新平板接管只允许导入到没有学生档案和学习项目的单机版；请勿合并两个家庭资料库"
        }
        require(sourceUri != targetUri) { "迁移源目录和新资料目录不能相同" }
        val source = SafWorkspaceStore(this, sourceUri)
        val descriptor = JSONObject(source.readBytes(StandaloneDeviceMigrationContract.DESCRIPTOR_PATH).toString(Charsets.UTF_8))
        require(descriptor.getString("schema") == StandaloneDeviceMigrationContract.PACKAGE_SCHEMA &&
            descriptor.getString("profile") == StandaloneDeviceMigrationContract.PROFILE && !descriptor.optBoolean("encrypted", true)) { "不是受支持的 Android 单机版整机迁移目录" }
        require(compareVersions(appVersion(), descriptor.getString("appVersion")) >= 0) { "迁移目录来自更高版本，请先升级本机 APK" }
        val migrationId = descriptor.getString("migrationId")
        require(migrationId.matches(Regex("[A-Za-z0-9._-]{1,100}"))) { "整机迁移 ID 无效" }
        require(descriptor.optInt("studentCount") <= license.maxActiveStudents) {
            "迁移目录包含 ${descriptor.optInt("studentCount")} 名学生，当前激活码只允许 ${license.maxActiveStudents} 名；请先更换足够席位的激活码"
        }
        val manifestBytes = source.readBytes(StandaloneDeviceMigrationContract.MANIFEST_PATH)
        val expectedManifestHash = source.readBytes(StandaloneDeviceMigrationContract.MANIFEST_HASH_PATH).toString(Charsets.UTF_8).trim().substringBefore(' ')
        require(sha256(manifestBytes) == expectedManifestHash) { "整机迁移清单校验失败" }
        val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8))
        require(manifest.getString("schema") == StandaloneDeviceMigrationContract.MANIFEST_SCHEMA &&
            manifest.getString("profile") == StandaloneDeviceMigrationContract.PROFILE && manifest.getString("migrationId") == migrationId) { "整机迁移清单结构无效" }
        val roots = manifest.getJSONArray("roots"); validateRoots(roots)
        val files = manifest.getJSONArray("files")
        require(files.length() <= MAX_FILES) { "整机迁移文件数量超限" }
        require(files.length() == descriptor.getInt("fileCount")) { "整机迁移说明与文件清单数量不一致" }
        val totalBytes = descriptor.getLong("totalBytes"); require(totalBytes <= MAX_BYTES) { "整机迁移容量超限" }
        var manifestBytesTotal = 0L; var stateBytes = 0L; val destinations = linkedSetOf<String>()
        for (index in 0 until files.length()) {
            val entry = files.getJSONObject(index); validateEntry(entry); val size = entry.getLong("size")
            val destinationKey = if (entry.getString("category") == "managed") "managed:${entry.getString("destinationRelativePath")}" else "state:${entry.getString("relativePath")}"
            require(destinations.add(destinationKey)) { "整机迁移清单包含重复目标：$destinationKey" }
            require(size <= MAX_BYTES - manifestBytesTotal) { "整机迁移清单容量溢出" }; manifestBytesTotal += size
            if (entry.getString("category") == "state") stateBytes += size
        }
        require(manifestBytesTotal == totalBytes) { "整机迁移说明与文件清单容量不一致" }
        require(cacheDir.usableSpace >= stateBytes + 10L * 1024 * 1024) { "本机状态暂存空间不足，请至少释放 ${stateBytes + 10L * 1024 * 1024} 字节" }
        val previous = journal.latest()?.takeIf { it.operation == OPERATION_IMPORT && it.sourceUri == sourceUri.toString() && it.targetUri == targetUri.toString() && it.migrationId == migrationId && it.phase != "completed" }
        val target = SafWorkspaceStore(this, targetUri)
        requireEmptyOrResumable(target, migrationId, previous != null)
        writeMarker(target, migrationId, OPERATION_IMPORT, "copying")
        val completed = previous?.completedKeys?.toMutableSet() ?: linkedSetOf()
        val stage = File(cacheDir, "standalone-device-$migrationId").apply { deleteRecursively(); mkdirs() }
        var completedBytes = 0L; var state = StandaloneDeviceMigrationState(migrationId, OPERATION_IMPORT, sourceUri.toString(), targetUri.toString(), "copying",
            files.length(), 0, totalBytes, 0, "", "正在接管整机资料", completed, Timestamp.now())
        update(state)
        try {
            for (index in 0 until files.length()) {
                val entry = files.getJSONObject(index); validateEntry(entry)
                val category = entry.getString("category"); val key = entryKey(entry)
                val size = entry.getLong("size"); val payload = entry.getString("payloadRelativePath")
                if (category == "managed" && key in completed && target.exists(entry.getString("destinationRelativePath")) &&
                    target.openInputStream(entry.getString("destinationRelativePath")).use(::sha256) == entry.getString("sha256")) {
                    // Verified resumable target.
                } else if (category == "managed") {
                    val digest = MessageDigest.getInstance("SHA-256"); var copied = 0L
                    target.writeStreamSafely(entry.getString("destinationRelativePath"), "application/octet-stream") { output ->
                        source.openInputStream(payload).use { input -> copied = copyAndHash(input, output, digest) }
                    }
                    if (copied != size || digest.digest().hex() != entry.getString("sha256")) {
                        runCatching { target.deleteFileIfExists(entry.getString("destinationRelativePath")) }
                        error("载荷校验失败：${entry.getString("relativePath")}")
                    }
                    completed += key
                } else {
                    val local = safeLocal(stage, entry.getString("relativePath")); local.parentFile?.mkdirs()
                    val digest = MessageDigest.getInstance("SHA-256"); var copied = 0L
                    source.openInputStream(payload).use { input -> local.outputStream().use { output -> copied = copyAndHash(input, output, digest) } }
                    require(copied == size && digest.digest().hex() == entry.getString("sha256")) { "状态载荷校验失败：${entry.getString("relativePath")}" }
                }
                completedBytes += size; state = state.copy(completedFiles = index + 1, completedBytes = completedBytes,
                    current = entry.getString("relativePath"), message = "正在接管 ${index + 1}/${files.length()}", completedKeys = completed.toSet(), updatedAt = Timestamp.now())
                if ((index + 1) % JOURNAL_INTERVAL == 0 || index + 1 == files.length()) update(state) else updateNotification(state)
            }
            remapStagedState(stage, roots, targetUri.toString())
            val stagedStudentsFile = File(stage, "students.json")
            val stagedStudentCount = if (stagedStudentsFile.isFile) JSONArray(stagedStudentsFile.readText()).length() else 0
            require(stagedStudentCount == descriptor.getInt("studentCount")) { "迁移说明与实际学生索引数量不一致" }
            require(stagedStudentCount <= license.maxActiveStudents) { "实际学生数量超过当前激活码席位" }
            val stagedProjectsFile = File(stage, "projects.json")
            val stagedProjectCount = if (stagedProjectsFile.isFile) JSONObject(stagedProjectsFile.readText()).optJSONArray("projects")?.length() ?: 0 else 0
            require(stagedProjectCount == descriptor.getInt("projectCount")) { "迁移说明与实际项目索引数量不一致" }
            val snapshot = snapshotState(); val applied = mutableListOf<String>()
            val oldRoot = SafRootGrant(this).currentRootUri()
            val oldSkin = UiPreferences(this).skin(); val oldLayout = UiPreferences(this).layoutMode()
            val oldAgent = AgentConfigurationStore(this).snapshotForRollback()
            try {
                stage.walkTopDown().filter(File::isFile).forEach { file ->
                    val relative = file.relativeTo(stage).invariantSeparatorsPath; PrivateStateStore(this).writeBytes(relative, file.readBytes()); applied += relative
                }
                val ui = descriptor.optJSONObject("ui")
                if (ui != null) {
                    UiPreferences(this).setSkin(UiSkin.from(ui.optString("skin")))
                    UiPreferences(this).setLayoutMode(UiLayoutMode.from(ui.optString("layout")))
                }
                val agent = descriptor.optJSONObject("agentPublic")
                AgentConfigurationStore(this).restorePublicProfile(agent?.let(AgentPublicConfiguration::fromJson))
                SafRootGrant(this).setDefaultRoot(targetUri)
            } catch (error: Throwable) {
                rollbackState(snapshot, applied)
                UiPreferences(this).setSkin(oldSkin); UiPreferences(this).setLayoutMode(oldLayout)
                AgentConfigurationStore(this).restoreSnapshot(oldAgent)
                if (oldRoot != null) runCatching { SafRootGrant(this).setDefaultRoot(oldRoot) }
                throw error
            }
            val report = JSONObject().put("schema", "edu-manager.standalone-device-migration-report.v1").put("migrationId", migrationId)
                .put("restoredAt", Timestamp.now()).put("fileCount", files.length()).put("totalBytes", totalBytes)
                .put("targetRootUri", targetUri.toString()).put("businessIdsPreserved", true)
                .put("newDeviceActivationRetained", true).put("agentApiKeyRequired", true)
            target.writeBytesSafely(StandaloneDeviceMigrationContract.REPORT_PATH, (report.toString(2) + "\n").toByteArray(), "application/json")
            writeMarker(target, migrationId, OPERATION_IMPORT, "completed")
            update(state.copy(phase = "completed", current = "", message = "新平板整机接管完成，请重新填写 Agent API Key", updatedAt = Timestamp.now()))
        } finally { stage.deleteRecursively() }
    }

    private fun collectRoots(): List<RootSpec> {
        val uris = linkedSetOf<String>(); SafRootGrant(this).currentRootUri()?.toString()?.let(uris::add)
        StudentIndexRepository(this).list().forEach { uris += it.storageRootUri }
        ProjectRepository(this).list().forEach { uris += it.projectRootUri; uris += it.workspaceRootUri; uris += it.knowledgeRootUri }
        return uris.filter(String::isNotBlank).mapIndexed { index, uri -> RootSpec("root-$index", uri, if (index == 0) "" else ".edu-manager/migrated-external/root-$index") }
    }

    private fun collectManagedSources(roots: List<RootSpec>): List<Source> = buildList {
        roots.forEach { root ->
            val tree = requireNotNull(DocumentFile.fromTreeUri(this@StandaloneDeviceMigrationService, Uri.parse(root.originalUri))) { "已授权资料根目录不可用" }
            walk(tree, "", 0) { file, relative ->
                if (relative in MIGRATION_METADATA_PATHS) return@walk
                add(Source("managed", root.id, relative, child(root.destinationPrefix, relative), file.length(), file.lastModified(),
                    { contentResolver.openInputStream(file.uri) ?: error("无法读取 $relative") }, { file.length() }, { file.lastModified() }))
            }
        }
    }

    private fun collectStateSources(): List<Source> {
        val root = File(filesDir, "education-manager-state"); if (!root.isDirectory) return emptyList()
        return root.walkTopDown().filter(File::isFile).mapNotNull { file ->
            val relative = file.relativeTo(root).invariantSeparatorsPath
            if (file.name.endsWith(".bak") || file.name.endsWith(".new") || StandaloneDeviceMigrationContract.excludedStatePrefixes.any { relative.startsWith(it) }) null
            else Source("state", "app-state", relative, relative, file.length(), file.lastModified(), { FileInputStream(file) }, { file.length() }, { file.lastModified() })
        }.toList()
    }

    private fun walk(directory: DocumentFile, prefix: String, depth: Int, accept: (DocumentFile, String) -> Unit) {
        require(depth <= MAX_DEPTH) { "资料目录层级超过 $MAX_DEPTH 层，请先整理异常嵌套目录" }
        directory.listFiles().sortedBy { it.name.orEmpty().lowercase() }.forEach { child ->
            val name = child.name?.trim().orEmpty()
            require(name.isNotBlank() && name !in setOf(".", "..") && !name.contains('/') && !name.contains('\\')) { "资料目录包含不可迁移名称" }
            if (name.matches(Regex("^\\..+\\.(write|backup)-.+$"))) return@forEach
            val relative = child(prefix, name)
            if (child.isDirectory) walk(child, relative, depth + 1, accept) else if (child.isFile) accept(child, relative)
        }
    }

    private fun requireOutsideManagedRoots(destination: Uri, roots: List<RootSpec>) {
        val destinationId = runCatching { DocumentsContract.getTreeDocumentId(destination) }.getOrNull() ?: return
        roots.forEach { root ->
            val uri = Uri.parse(root.originalUri); if (uri.authority != destination.authority) return@forEach
            val rootId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull() ?: return@forEach
            require(destinationId != rootId && !destinationId.startsWith("$rootId/")) { "整机迁移目录不能放在正在导出的资料根目录内" }
        }
    }

    private fun requireEmptyOrResumable(store: SafWorkspaceStore, migrationId: String, hasLocalJournal: Boolean) {
        val root = store.listRoot()
        if (root.isEmpty()) return
        val marker = runCatching { JSONObject(store.readBytes(StandaloneDeviceMigrationContract.MARKER_PATH).toString(Charsets.UTF_8)) }.getOrNull()
        require((hasLocalJournal || marker?.optString("migrationId") == migrationId) && marker?.optString("phase") != "completed") {
            "请选择空目录；已有完成的迁移目录或普通资料目录不能被覆盖"
        }
    }

    private fun writeMarker(store: SafWorkspaceStore, migrationId: String, operation: String, phase: String) {
        val marker = JSONObject().put("schema", "edu-manager.standalone-device-marker.v1").put("migrationId", migrationId)
            .put("operation", operation).put("phase", phase).put("updatedAt", Timestamp.now())
        store.writeBytesSafely(StandaloneDeviceMigrationContract.MARKER_PATH, (marker.toString(2) + "\n").toByteArray(), "application/json")
    }

    private fun validateEntry(entry: JSONObject) {
        require(entry.getString("category") in setOf("managed", "state")) { "迁移清单包含未知文件类别" }
        safePath(entry.getString("relativePath")); safePath(entry.getString("payloadRelativePath"))
        if (entry.getString("category") == "managed") safePath(entry.getString("destinationRelativePath"))
        else require(StandaloneDeviceMigrationContract.excludedStatePrefixes.none { entry.getString("relativePath").startsWith(it) }) { "迁移清单包含不允许恢复的设备状态" }
        require(entry.getLong("size") in 0..MAX_BYTES && entry.getString("sha256").matches(Regex("[0-9a-f]{64}"))) { "迁移清单文件元数据无效" }
    }

    private fun validateRoots(roots: JSONArray) {
        val ids = linkedSetOf<String>(); val uris = linkedSetOf<String>()
        for (index in 0 until roots.length()) {
            val root = roots.getJSONObject(index); val id = root.getString("id"); val uri = root.getString("originalUri"); val prefix = root.getString("destinationPrefix")
            require(id.matches(Regex("[A-Za-z0-9._-]{1,100}")) && ids.add(id)) { "迁移清单根目录 ID 无效或重复" }
            require(uri.isNotBlank() && uris.add(uri)) { "迁移清单根目录 URI 为空或重复" }
            if (prefix.isNotBlank()) safePath(prefix)
        }
    }

    private fun remapStagedState(stage: File, rootsArray: JSONArray, targetUri: String) {
        val roots = mutableMapOf<String, JSONObject>()
        for (index in 0 until rootsArray.length()) roots[rootsArray.getJSONObject(index).getString("originalUri")] = rootsArray.getJSONObject(index)
        val replacements = mutableListOf<Pair<String, String>>()
        val studentsFile = File(stage, "students.json")
        if (studentsFile.isFile) {
            val students = JSONArray(studentsFile.readText())
            for (index in 0 until students.length()) {
                val student = students.getJSONObject(index); val prefix = roots[student.getString("storageRootUri")]?.getString("destinationPrefix") ?: error("学生资料根目录不在迁移清单")
                for (key in listOf("rootPath", "rawPath", "summaryPath", "agentPath", "outputPath")) {
                    val old = student.optString(key); val next = child(prefix, old); if (old.isNotBlank() && old != next) replacements += old to next; student.put(key, next)
                }
                student.put("storageRootUri", targetUri).put("pathDialect", "android-saf-relative-v1")
            }
            studentsFile.writeText(students.toString(2))
        }
        val projectsFile = File(stage, "projects.json")
        if (projectsFile.isFile) {
            val rootJson = JSONObject(projectsFile.readText()); val projects = rootJson.getJSONArray("projects")
            for (index in 0 until projects.length()) {
                val project = projects.getJSONObject(index)
                val projectPrefix = roots[project.getString("projectRootUri")]?.getString("destinationPrefix") ?: error("项目根目录不在迁移清单")
                val knowledgePrefix = roots[project.getString("knowledgeRootUri")]?.getString("destinationPrefix") ?: error("项目知识根目录不在迁移清单")
                mapOf(projectPrefix to listOf("projectRootPath", "managerPath", "workspacePath", "stagingPath", "agentPath", "outputPath"),
                    knowledgePrefix to listOf("knowledgeRootPath", "rawPath", "conceptPath", "entityPath", "summaryPath", "qaPath", "synthesisPath", "reportPath", "contributionPath", "promotionPath"))
                    .forEach { (prefix, keys) -> keys.forEach { key -> val old = project.optString(key); val next = child(prefix, old); if (old.isNotBlank() && old != next) replacements += old to next; project.put(key, next) } }
                project.put("projectRootUri", targetUri).put("workspaceRootUri", targetUri).put("knowledgeRootUri", targetUri).put("pathDialect", "android-saf-relative-v1")
            }
            projectsFile.writeText(rootJson.toString(2))
        }
        val assets = File(stage, "asset-index.json")
        if (assets.isFile && replacements.isNotEmpty()) { val json = JSONObject(assets.readText()); rewriteStrings(json, replacements.sortedByDescending { it.first.length }); assets.writeText(json.toString(2)) }
    }

    private fun rewriteStrings(value: Any?, replacements: List<Pair<String, String>>): Any? {
        when (value) {
            is JSONObject -> value.keys().forEach { key -> value.put(key, rewriteStrings(value.opt(key), replacements)) }
            is JSONArray -> for (index in 0 until value.length()) value.put(index, rewriteStrings(value.opt(index), replacements))
            is String -> replacements.firstOrNull { value == it.first || value.startsWith("${it.first}/") }?.let { return it.second + value.removePrefix(it.first) }
        }
        return value
    }

    private fun snapshotState(): Map<String, ByteArray> {
        val root = File(filesDir, "education-manager-state")
        return if (!root.isDirectory) emptyMap() else root.walkTopDown().filter(File::isFile).associate { it.relativeTo(root).invariantSeparatorsPath to it.readBytes() }
    }

    private fun rollbackState(snapshot: Map<String, ByteArray>, applied: List<String>) {
        val root = File(filesDir, "education-manager-state").canonicalFile
        applied.filterNot(snapshot::containsKey).forEach { relative -> runCatching { safeLocal(root, relative).delete() } }
        snapshot.forEach { (relative, bytes) -> PrivateStateStore(this).writeBytes(relative, bytes) }
    }

    private fun safeLocal(root: File, relative: String): File {
        val normalized = safePath(relative); val file = File(root, normalized).canonicalFile
        require(file.path.startsWith(root.canonicalPath + File.separator)) { "迁移状态路径越界" }; return file
    }

    private fun safePath(value: String): String = value.replace('\\', '/').also { path ->
        require(path.isNotBlank() && !path.startsWith('/') && !Regex("^[A-Za-z]:").containsMatchIn(path) && path.split('/').none { it in setOf("", ".", "..") }) { "迁移路径无效" }
    }

    private fun payloadPath(source: Source): String {
        val digest = sha256("${source.category}\u0000${source.scopeId}\u0000${source.relativePath}".toByteArray())
        return "payload/${digest.take(2)}/$digest.bin"
    }

    private fun entryKey(entry: JSONObject) = "${entry.getString("category")}|${entry.getString("scopeId")}|${entry.getString("relativePath")}|${entry.getLong("size")}|${entry.optLong("lastModified")}"
    private fun child(prefix: String, path: String) = when { prefix.isBlank() -> path; path.isBlank() -> prefix; else -> "$prefix/$path" }
    private fun copyAndHash(input: InputStream, output: java.io.OutputStream, digest: MessageDigest): Long { var count = 0L; val buffer = ByteArray(128 * 1024); while (true) { val read = input.read(buffer); if (read < 0) break; output.write(buffer, 0, read); digest.update(buffer, 0, read); count += read }; return count }
    private fun sha256(input: InputStream): String { val digest = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(128 * 1024); while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read) }; return digest.digest().hex() }
    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).hex()
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
    private fun compareVersions(left: String, right: String): Int { val a = left.split(Regex("[.+-]")).map { it.toIntOrNull() ?: 0 }; val b = right.split(Regex("[.+-]")).map { it.toIntOrNull() ?: 0 }; for (index in 0 until maxOf(a.size, b.size)) { val value = (a.getOrNull(index) ?: 0).compareTo(b.getOrNull(index) ?: 0); if (value != 0) return value }; return 0 }
    @Suppress("DEPRECATION")
    private fun appVersion(): String = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()

    private fun update(value: StandaloneDeviceMigrationState) { journal.write(value); updateNotification(value); sendBroadcast(Intent(ACTION_PROGRESS).setPackage(packageName).putExtra(EXTRA_STATE, value.toJson().toString())) }
    private fun updateNotification(value: StandaloneDeviceMigrationState) { notificationManager.notify(NOTIFICATION_ID, notification(value.message, value.completedFiles, value.totalFiles)) }
    private fun notification(text: String, progress: Int, max: Int): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("AI教育管家 · 整机迁移").setContentText(text)
        .setOngoing(progress < max || max == 0).setOnlyAlertOnce(true)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .setProgress(max, progress, max == 0).build()
    private fun createChannel() { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) notificationManager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "整机迁移", NotificationManager.IMPORTANCE_LOW)) }
    private fun acquireWakeLock() { wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:device-migration").apply { acquire(6 * 60 * 60 * 1000L) } }
    private fun releaseWakeLock() { wakeLock?.takeIf { it.isHeld }?.release(); wakeLock = null }

    private data class RootSpec(val id: String, val originalUri: String, val destinationPrefix: String) {
        fun toJson() = JSONObject().put("id", id).put("originalUri", originalUri).put("destinationPrefix", destinationPrefix)
    }
    private data class Source(
        val category: String, val scopeId: String, val relativePath: String, val destinationRelativePath: String,
        val size: Long, val modified: Long, val open: () -> InputStream, val currentSize: () -> Long, val currentModified: () -> Long,
    ) {
        fun resumeKey() = "$category|$scopeId|$relativePath|$size|$modified"
        fun toManifest(payload: String, hash: String) = JSONObject().put("category", category).put("scopeId", scopeId)
            .put("relativePath", relativePath).put("destinationRelativePath", destinationRelativePath)
            .put("payloadRelativePath", payload).put("size", size).put("lastModified", modified)
            .put("sha256", hash).put("storedSha256", hash)
    }

    companion object {
        const val ACTION_EXPORT = "com.qxmatrix.edumanager.standalone.EXPORT_DEVICE_MIGRATION"
        const val ACTION_IMPORT = "com.qxmatrix.edumanager.standalone.IMPORT_DEVICE_MIGRATION"
        const val ACTION_PROGRESS = "com.qxmatrix.edumanager.standalone.DEVICE_MIGRATION_PROGRESS"
        const val EXTRA_SOURCE_URI = "sourceUri"
        const val EXTRA_TARGET_URI = "targetUri"
        const val EXTRA_STATE = "state"
        const val OPERATION_EXPORT = "export"
        const val OPERATION_IMPORT = "import"
        private const val CHANNEL_ID = "standalone-device-migration"
        private const val NOTIFICATION_ID = 4208
        private const val JOURNAL_INTERVAL = 10
        private const val MAX_FILES = 100_000
        private const val MAX_DEPTH = 64
        private const val MAX_BYTES = 1024L * 1024 * 1024 * 1024
        private val MIGRATION_METADATA_PATHS = setOf(StandaloneDeviceMigrationContract.MARKER_PATH, StandaloneDeviceMigrationContract.REPORT_PATH)
        val EXCLUSIONS = listOf("license-token", "device-id", "agent-api-key", "android-keystore-key", "saf-grants", "media-projection-grant", "cache", "migration-journals", "collaboration-device-bindings")
    }
}
