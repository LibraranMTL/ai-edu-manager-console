package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.documentfile.provider.DocumentFile
import java.io.File

data class StorageCategoryUsage(val key: String, val label: String, val bytes: Long, val files: Int, val truncated: Boolean = false)
data class StorageUsageSnapshot(val categories: List<StorageCategoryUsage>, val measuredAt: String) {
    val totalBytes: Long get() = categories.sumOf { it.bytes }
}

/** Read-only accounting plus an allowlisted cache cleaner. Student originals and valid reports are never deleted here. */
class StorageManagementService(private val context: Context) {
    fun snapshot(): StorageUsageSnapshot {
        val students = StudentIndexRepository(context).list()
        val original = students.map { measureSaf(it, it.paths.rawPath) }.fold(Count()) { a, b -> a + b }
        val reports = students.flatMap { student -> listOf(
            measureSaf(student, "${student.paths.summaryPath}/学情报告"),
            measureSaf(student, "${student.paths.summaryPath}/成长模型"),
        ) }.fold(Count()) { a, b -> a + b }
        val cache = measureFile(context.cacheDir) { file ->
            file.name != "updates" && !file.name.startsWith("edu-audio-") && file.parentFile?.name != "audio-capture"
        }
        val audio = measureFile(context.cacheDir) { file -> file.name.startsWith("edu-audio-") || file.parentFile?.name == "audio-capture" }
        val updates = measureFile(File(context.cacheDir, "updates")) { true }
        val migration = context.cacheDir.listFiles().orEmpty().filter {
            it.name.startsWith("edu-restore-") || it.name.startsWith("student-migration-") || it.name.startsWith("standalone-device-")
        }.map { measureFile(it) { true } }.fold(Count()) { a, b -> a + b }
        return StorageUsageSnapshot(listOf(
            original.usage("original", "原始资料"),
            reports.usage("reports", "报告和成长快照"),
            cache.usage("cache", "OCR及预览缓存"),
            audio.usage("audio", "录音暂存"),
            updates.usage("updates", "更新安装包"),
            migration.usage("migration", "备份和迁移暂存"),
        ), Timestamp.now())
    }

    fun clearRebuildableCache(now: Long = System.currentTimeMillis()): Long {
        var removed = 0L
        fun delete(file: File) {
            if (!file.exists()) return
            val bytes = if (file.isDirectory) file.walkTopDown().filter(File::isFile).sumOf(File::length) else file.length()
            val ok = if (file.isDirectory) file.deleteRecursively() else file.delete()
            if (ok) removed += bytes
        }
        File(context.cacheDir, "updates").listFiles().orEmpty().forEach(::delete)
        File(context.cacheDir, "camera-import").listFiles().orEmpty().filter { now - it.lastModified() >= DAY_MS }.forEach(::delete)
        context.cacheDir.listFiles().orEmpty().filter { file ->
            val stale = now - file.lastModified() >= DAY_MS
            stale && (file.name.startsWith("ocr-") || file.name.startsWith("edu-restore-") ||
                file.name.startsWith("student-migration-") || file.name.startsWith("standalone-device-"))
        }.forEach(::delete)
        return removed
    }

    private fun measureSaf(student: StudentRecord, logicalPath: String): Count {
        val root = DocumentFile.fromTreeUri(context, android.net.Uri.parse(student.storageRootUri)) ?: return Count(truncated = true)
        val target = WorkspacePath.segments(logicalPath).fold(root as DocumentFile?) { parent, segment -> parent?.findFile(segment) }
            ?: return Count()
        return measureDocument(target)
    }

    private fun measureDocument(root: DocumentFile): Count {
        var bytes = 0L; var files = 0; var visited = 0; var truncated = false
        val queue = ArrayDeque<DocumentFile>(); queue.add(root)
        while (queue.isNotEmpty()) {
            val current = queue.removeFirst(); visited += 1
            if (visited > MAX_ENTRIES) { truncated = true; break }
            if (current.isDirectory) queue.addAll(current.listFiles()) else { bytes += current.length().coerceAtLeast(0L); files += 1 }
        }
        return Count(bytes, files, truncated)
    }

    private fun measureFile(root: File, include: (File) -> Boolean): Count {
        if (!root.exists()) return Count()
        var bytes = 0L; var files = 0; var visited = 0; var truncated = false
        root.walkTopDown().forEach { file ->
            if (visited >= MAX_ENTRIES) { truncated = true; return@forEach }
            visited += 1
            if (file.isFile && include(file)) { bytes += file.length(); files += 1 }
        }
        return Count(bytes, files, truncated)
    }

    private data class Count(val bytes: Long = 0, val files: Int = 0, val truncated: Boolean = false) {
        operator fun plus(other: Count) = Count(bytes + other.bytes, files + other.files, truncated || other.truncated)
        fun usage(key: String, label: String) = StorageCategoryUsage(key, label, bytes, files, truncated)
    }

    companion object { private const val MAX_ENTRIES = 50_000; private const val DAY_MS = 24L * 60 * 60 * 1000 }
}
