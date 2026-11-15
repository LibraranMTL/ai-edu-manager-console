package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.documentfile.provider.DocumentFile
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

internal data class CollectionTarget(val studentId: String, val projectId: String = "") {
    val key get() = ScopedContentPolicy.hash("$studentId:$projectId".toByteArray())
}

internal class CollectionIntake(private val context: Context) {
    private val state = PrivateStateStore(context)
    private val blobs = File(context.filesDir, "system-share-inbox")

    data class Item(val hash: String, val name: String, val mime: String, val receivedAt: Long,
                    val source: String, val target: CollectionTarget? = null)
    data class Rule(val target: CollectionTarget, val tree: String, val enabled: Boolean, val status: String)

    private fun read(path: String) = state.readIfPresent(path)?.let { JSONObject(it.toString(Charsets.UTF_8)) } ?: JSONObject()
    private fun write(path: String, data: JSONObject) = state.writeBytes(path, data.toString().toByteArray())

    private fun name(uri: Uri): String =
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }?.takeIf { it.isNotBlank() } ?: "分享文件"

    private fun bytes(uri: Uri): ByteArray =
        context.contentResolver.openInputStream(uri)?.use { it.readBytesBounded(MAX_BYTES) }
            ?: error("无法读取资料")

    fun stage(uri: Uri): Item = synchronized(inboxLock) {
        require(uri.scheme == "content") { "分享来源不是可授权的文件" }
        val data = bytes(uri)
        val hash = ScopedContentPolicy.hash(data)
        val index = read(INBOX)
        val existing = index.optJSONObject(hash)
        if (existing != null && File(blobs, hash).isFile) return@synchronized item(hash, existing)
        val entry = existing ?: JSONObject().put("name", name(uri))
            .put("mime", context.contentResolver.getType(uri) ?: "application/octet-stream")
            .put("receivedAt", System.currentTimeMillis()).put("source", uri.authority.orEmpty())
        check(blobs.isDirectory || blobs.mkdirs()) { "无法建立收件箱" }
        val temporary = File(blobs, "$hash.part")
        temporary.outputStream().use { it.write(data); it.fd.sync() }
        check(temporary.renameTo(File(blobs, hash))) { "保存分享文件失败" }
        index.put(hash, entry)
        write(INBOX, index)
        item(hash, entry)
    }

    fun pending(): List<Item> = synchronized(inboxLock) {
        val index = read(INBOX)
        index.keys().asSequence().map { item(it, index.getJSONObject(it)) }
            .sortedByDescending { it.receivedAt }.toList()
    }

    private fun item(hash: String, entry: JSONObject) = Item(hash, entry.getString("name"), entry.getString("mime"),
        entry.getLong("receivedAt"), entry.optString("source"), entry.optString("student").takeIf { it.isNotBlank() }
            ?.let { CollectionTarget(it, entry.optString("project")) })

    fun remove(hash: String) = synchronized(inboxLock) {
        val index = read(INBOX)
        if (index.remove(hash) != null) {
            write(INBOX, index)
            File(blobs, hash).delete()
        }
    }

    fun deliverShared(hash: String, target: CollectionTarget) = synchronized(inboxLock) {
        val index = read(INBOX)
        val entry = index.getJSONObject(hash)
        val record = item(hash, entry)
        require(record.target == null || record.target == target) { "重试必须使用最初确认的投递目标" }
        entry.put("student", target.studentId).put("project", target.projectId)
        write(INBOX, index)
        val data = File(blobs, hash).inputStream().use { it.readBytesBounded(MAX_BYTES) }
        require(ScopedContentPolicy.hash(data) == hash) { "收件副本校验失败" }
        deliver(target, record.name, record.mime, data, "Android 系统分享", record.source)
        remove(hash)
    }

    fun assignShared(hashes: List<String>, target: CollectionTarget) = synchronized(inboxLock) {
        val index = read(INBOX)
        hashes.forEach { hash ->
            val entry = index.getJSONObject(hash)
            val existing = item(hash, entry).target
            require(existing == null || existing == target) { "文件已确认了其他投递目标" }
            entry.put("student", target.studentId).put("project", target.projectId)
        }
        write(INBOX, index)
    }

    fun deliverUri(target: CollectionTarget, uri: Uri, label: String) {
        val displayName = name(uri)
        deliver(target, displayName, context.contentResolver.getType(uri) ?: "application/octet-stream", bytes(uri), label, uri.authority.orEmpty())
    }

    private fun deliver(target: CollectionTarget, name: String, mime: String, data: ByteArray, label: String, source: String) {
        val student = StudentIndexRepository(context).requireExact(target.studentId)
        if (target.projectId.isBlank()) {
            FileAssetService(context).importValidatedBytes(student.id, name, data, mime, label, source)
        } else {
            LocalProjectMaterialService(context).importCollectionBytes(target.projectId, student.id, name, mime, data)
        }
    }

    fun rule(target: CollectionTarget): Rule = synchronized(ruleLock) {
        val row = read(RULES).optJSONObject(target.key)
        Rule(target, row?.optString("tree").orEmpty(), row?.optBoolean("enabled") == true, row?.optString("status").orEmpty())
    }

    fun configure(target: CollectionTarget, tree: String, enabled: Boolean) = synchronized(ruleLock) {
        val index = read(RULES)
        require(!enabled || tree.isNotBlank()) { "请先授权文件夹" }
        index.put(target.key, JSONObject().put("student", target.studentId).put("project", target.projectId)
            .put("tree", tree).put("enabled", enabled))
        write(RULES, index)
    }

    fun scan(target: CollectionTarget): String = synchronized(scanLock) {
        val configured = rule(target)
        check(configured.enabled) { "请先开启自动投递" }
        val tree = Uri.parse(configured.tree)
        require(context.contentResolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission }) { "文件夹授权已失效" }
        val directory = DocumentFile.fromTreeUri(context, tree)?.takeIf { it.isDirectory && it.canRead() }
            ?: error("无法读取自动投递目录")
        val receiptsPath = "collection/auto-${target.key}.json"
        val receipts = read(receiptsPath)
        var delivered = 0
        var failed = 0
        var waiting = 0
        val now = System.currentTimeMillis()
        for (file in directory.listFiles()) {
            if (rule(target).let { !it.enabled || it.tree != configured.tree }) break
            if (!file.isFile) continue
            val stamp = "${file.length()}:${file.lastModified()}"
            val key = ScopedContentPolicy.hash(file.uri.toString().toByteArray())
            if (receipts.optString(key) == stamp && file.lastModified() > 0) continue
            if (receipts.optString(key) != stamp || file.lastModified() <= 0) {
                val observed = receipts.optJSONObject("$key:seen")
                if (observed == null || observed.optString("stamp") != stamp || observed.optLong("at") > now - 30_000) {
                    if (observed?.optString("stamp") != stamp) {
                        receipts.put("$key:seen", JSONObject().put("stamp", stamp).put("at", now))
                        write(receiptsPath, receipts)
                    }
                    waiting++
                    continue
                }
            }
            runCatching {
                deliverUri(target, file.uri, "Android 自动投递")
                receipts.put(key, stamp)
                if (file.lastModified() > 0) receipts.remove("$key:seen")
                write(receiptsPath, receipts)
            }.onSuccess { delivered++ }.onFailure { failed++ }
        }
        val summary = "本次投递 $delivered 份，失败 $failed 份。"
        if (waiting == 0) summary else "$summary 另有 $waiting 份正在等待文件写入稳定，可稍后检查。"
    }

    fun scanAndRecord(target: CollectionTarget): String {
        val before = rule(target)
        val status = runCatching { scan(target) }.getOrElse { it.message ?: "自动投递失败" }
        synchronized(ruleLock) {
            val index = read(RULES)
            index.optJSONObject(target.key)?.takeIf { it.optString("tree") == before.tree && it.optBoolean("enabled") }
                ?.let { it.put("status", status); write(RULES, index) }
        }
        return status
    }

    fun scanEnabled() {
        val targets = synchronized(ruleLock) {
            val index = read(RULES)
            index.keys().asSequence().map { index.getJSONObject(it) }.filter { it.optBoolean("enabled") }
                .map { CollectionTarget(it.getString("student"), it.optString("project")) }.toList()
        }
        targets.forEach { scanAndRecord(it) }
    }

    companion object {
        private const val MAX_BYTES = 100 * 1024 * 1024
        private const val INBOX = "collection/share-inbox.json"
        private const val RULES = "collection/auto-rules.json"
        private val inboxLock = Any()
        private val ruleLock = Any()
        private val scanLock = Any()

        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "standalone-auto-delivery", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<StandaloneAutoDeliveryWorker>(15, TimeUnit.MINUTES).build(),
            )
        }
    }
}

class StandaloneAutoDeliveryWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        if (!LicenseManager(applicationContext).status().active) return Result.success()
        return runCatching { CollectionIntake(applicationContext).scanEnabled(); Result.success() }
            .getOrElse { Result.retry() }
    }
}
