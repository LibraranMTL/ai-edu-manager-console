package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import java.io.FileNotFoundException
import java.io.InputStream
import java.util.PriorityQueue
import java.util.UUID

/**
 * Filesystem adapter for the Windows-style logical library layout inside one SAF tree.
 * It never resolves absolute paths and never requests broad Android storage permission.
 */
class SafWorkspaceStore(
    context: Context,
    rootUri: Uri,
) {
    private val resolver = context.applicationContext.contentResolver
    private val root = requireNotNull(DocumentFile.fromTreeUri(context, rootUri)) {
        "The authorized workspace root is unavailable"
    }
    private val directoryCache = linkedMapOf("" to root)

    fun ensureDirectory(relativePath: String): DocumentFile =
        resolveDirectory(WorkspacePath.segments(relativePath), create = true)

    fun exists(relativePath: String): Boolean = find(WorkspacePath.segments(relativePath))?.exists() == true

    fun listRoot(): List<DocumentFile> = root.listFiles().toList()

    fun listDirectory(relativePath: String): List<DocumentFile> {
        val directory = find(WorkspacePath.segments(relativePath))
            ?: throw FileNotFoundException(relativePath)
        require(directory.isDirectory) { "Workspace path is not a directory: $relativePath" }
        return directory.listFiles().toList()
    }

    fun readBytes(relativePath: String): ByteArray {
        val document = find(WorkspacePath.segments(relativePath))
            ?: throw FileNotFoundException(relativePath)
        require(document.isFile) { "Workspace path is not a file: $relativePath" }
        return resolver.openInputStream(document.uri)?.use { it.readBytes() }
            ?: throw FileNotFoundException(relativePath)
    }

    fun openInputStream(relativePath: String): InputStream {
        val document = find(WorkspacePath.segments(relativePath))
            ?: throw FileNotFoundException(relativePath)
        require(document.isFile) { "Workspace path is not a file: $relativePath" }
        return resolver.openInputStream(document.uri) ?: throw FileNotFoundException(relativePath)
    }

    fun document(relativePath: String): DocumentFile? = find(WorkspacePath.segments(relativePath))

    data class WorkspaceFile(
        val name: String,
        val relativePath: String,
        val size: Long,
        val lastModified: Long,
        val mimeType: String,
    )

    /** Lists ordinary files for local project indexing. Hidden control folders are excluded by default. */
    fun listFiles(
        relativeRoot: String,
        maximum: Int = 5_000,
        maximumDepth: Int = 24,
        includeHidden: Boolean = false,
    ): List<WorkspaceFile> {
        require(maximum in 1..50_001 && maximumDepth in 1..32)
        val normalizedRoot = WorkspacePath.segments(relativeRoot).joinToString("/")
        val rootDocument = find(WorkspacePath.segments(normalizedRoot)) ?: return emptyList()
        val output = mutableListOf<WorkspaceFile>()
        fun add(document: DocumentFile, logical: String) {
            output += WorkspaceFile(document.name.orEmpty(), logical, document.length().coerceAtLeast(0),
                document.lastModified(), document.type.orEmpty())
        }
        fun walk(document: DocumentFile, prefix: String, depth: Int) {
            if (depth > maximumDepth || output.size >= maximum) return
            document.listFiles().sortedBy { it.name.orEmpty().lowercase() }.forEach { child ->
                if (output.size >= maximum) return
                val name = child.name.orEmpty()
                if (name.isBlank() || (!includeHidden && name.startsWith("."))) return@forEach
                val logical = if (prefix.isBlank()) name else "$prefix/$name"
                if (child.isDirectory) walk(child, logical, depth + 1) else if (child.isFile) add(child, logical)
            }
        }
        if (rootDocument.isFile) add(rootDocument, normalizedRoot)
        else if (rootDocument.isDirectory) walk(rootDocument, normalizedRoot, 0)
        return output
    }

    /** Lists bounded collaboration-safe text assets without exposing absolute provider paths. */
    fun listTextFiles(
        relativeRoot: String,
        excludedPrefixes: List<String> = emptyList(),
        maximum: Int = 2_000,
        maximumDepth: Int = 24,
    ): List<WorkspaceFile> {
        require(maximum in 1..50_001 && maximumDepth in 1..32)
        val normalizedRoot = WorkspacePath.segments(relativeRoot).joinToString("/")
        val excluded = excludedPrefixes.map { WorkspacePath.segments(it).joinToString("/").trimEnd('/') }.filter(String::isNotBlank)
        val rootDocument = find(WorkspacePath.segments(normalizedRoot)) ?: return emptyList()
        val output = mutableListOf<WorkspaceFile>()
        fun walk(document: DocumentFile, prefix: String, depth: Int) {
            if (depth > maximumDepth || output.size >= maximum) return
            document.listFiles().sortedBy { it.name.orEmpty().lowercase() }.forEach { child ->
                if (output.size >= maximum) return
                val name = child.name.orEmpty()
                if (name.isBlank() || name.startsWith(".")) return@forEach
                val logical = if (prefix.isBlank()) name else "$prefix/$name"
                if (excluded.any { logical == it || logical.startsWith("$it/") }) return@forEach
                if (child.isDirectory) walk(child, logical, depth + 1)
                else if (child.isFile && name.substringAfterLast('.', "").lowercase() in COLLABORATION_TEXT_EXTENSIONS) {
                    output += WorkspaceFile(name, logical, child.length(), child.lastModified(), child.type.orEmpty())
                }
            }
        }
        if (rootDocument.isFile) {
            val name = rootDocument.name.orEmpty()
            if (name.substringAfterLast('.', "").lowercase() in COLLABORATION_TEXT_EXTENSIONS) {
                output += WorkspaceFile(name, normalizedRoot, rootDocument.length(), rootDocument.lastModified(), rootDocument.type.orEmpty())
            }
        } else if (rootDocument.isDirectory) {
            walk(rootDocument, normalizedRoot, 0)
        }
        return output
    }

    /** Deletes one already-authorized logical file. Missing files make retries idempotent. */
    fun deleteFileIfExists(relativePath: String): Boolean {
        val document = find(WorkspacePath.segments(relativePath)) ?: return true
        require(document.isFile) { "Workspace path is not a file: $relativePath" }
        check(document.delete()) { "The document provider could not delete: $relativePath" }
        return true
    }

    data class TreeStats(val files: Int, val directories: Int, val bytes: Long)

    fun treeStats(relativePath: String, maximumEntries: Int = 100_000): TreeStats {
        require(relativePath.isNotBlank()) { "不能统计授权根目录本身" }
        val document = find(WorkspacePath.segments(relativePath)) ?: return TreeStats(0, 0, 0)
        var files = 0; var directories = 0; var bytes = 0L; var visited = 0
        fun walk(item: DocumentFile) {
            check(++visited <= maximumEntries) { "目录项目过多，已停止统计" }
            if (item.isDirectory) { directories += 1; item.listFiles().forEach(::walk) }
            else if (item.isFile) { files += 1; bytes += item.length().coerceAtLeast(0L) }
        }
        walk(document)
        return TreeStats(files, directories, bytes)
    }

    fun deleteDirectoryTree(relativePath: String): Boolean {
        require(relativePath.isNotBlank()) { "不能删除授权根目录本身" }
        val document = find(WorkspacePath.segments(relativePath)) ?: return true
        require(document.isDirectory) { "目标不是学生资料目录" }
        check(document.delete()) { "文档提供程序未能删除学生资料目录" }
        directoryCache.keys.filter { it == relativePath || it.startsWith("${relativePath.trimEnd('/')}/") }.forEach(directoryCache::remove)
        return true
    }

    data class MarkdownFile(
        val name: String,
        val relativePath: String,
        val lastModified: Long = 0L,
    )

    private data class ArchiveDirectory(
        val document: DocumentFile,
        val relativePath: String,
        val depth: Int,
        val priority: Int,
    )

    /** Lists bounded Markdown documents below already-authorized logical roots. */
    fun listMarkdownFiles(relativeRoots: List<String>, maximum: Int = 500, maximumDepth: Int = 12, allowRoot: Boolean = false): List<MarkdownFile> {
        require(maximum in 1..2_000 && maximumDepth in 1..24)
        val result = linkedMapOf<String, MarkdownFile>()
        relativeRoots.map { WorkspacePath.segments(it, allowRoot).joinToString("/") }
            .filter { allowRoot || it.isNotBlank() }.distinct().forEach { normalized ->
            if (result.size >= maximum) return@forEach
            val document = find(WorkspacePath.segments(normalized, allowRoot)) ?: return@forEach
            if (document.isFile) {
                val name = document.name.orEmpty()
                if (name.endsWith(".md", true) || name.endsWith(".markdown", true)) {
                    result[normalized] = MarkdownFile(name, normalized, document.lastModified())
                }
            } else if (document.isDirectory) {
                walkMarkdown(document, normalized, 0, maximumDepth, maximum, result)
            }
        }
        return result.values.sortedWith(compareBy<MarkdownFile>({ it.relativePath.lowercase() }, { it.name.lowercase() }))
    }

    private fun walkMarkdown(directory: DocumentFile, prefix: String, depth: Int, maximumDepth: Int, maximum: Int, output: MutableMap<String, MarkdownFile>) {
        if (depth >= maximumDepth || output.size >= maximum) return
        directory.listFiles().sortedBy { it.name.orEmpty().lowercase() }.forEach { child ->
            if (output.size >= maximum) return
            val name = child.name.orEmpty(); if (name.isBlank()) return@forEach
            if (name.startsWith(".")) return@forEach
            val relative = if (prefix.isBlank()) name else "$prefix/$name"
            if (child.isDirectory) walkMarkdown(child, relative, depth + 1, maximumDepth, maximum, output)
            else if (child.isFile && (name.endsWith(".md", true) || name.endsWith(".markdown", true))) {
                output[relative] = MarkdownFile(name, relative, child.lastModified())
            }
        }
    }

    /**
     * Finds legacy report/growth Markdown without recursively walking raw-material branches.
     * Independent directory and entry budgets keep a large adopted USB tree responsive.
     */
    fun findArchiveMarkdownFiles(
        relativeRoots: List<String>,
        expectedFileNames: Set<String>,
        pathTerms: Set<String>,
        preferredTerms: Set<String>,
        maximum: Int = 200,
        maximumDepth: Int = 10,
        maximumDirectories: Int = 120,
        maximumEntries: Int = 4_000,
        allowRoot: Boolean = false,
    ): List<MarkdownFile> {
        require(maximum in 1..500 && maximumDepth in 1..16)
        require(maximumDirectories in 1..500 && maximumEntries in 1..20_000)
        val normalizedNames = expectedFileNames.map(String::lowercase).toSet()
        val normalizedPathTerms = pathTerms.map(String::lowercase).filter(String::isNotBlank)
        val normalizedPreferredTerms = preferredTerms.map(String::lowercase).filter(String::isNotBlank)
        val output = linkedMapOf<String, MarkdownFile>()
        val queued = mutableSetOf<String>()
        val visited = mutableSetOf<String>()
        val queue = PriorityQueue(
            16,
            compareByDescending<ArchiveDirectory> { it.priority }
                .thenBy { it.depth }
                .thenBy { it.relativePath.lowercase() },
        )

        fun isMarkdown(name: String): Boolean = name.endsWith(".md", true) || name.endsWith(".markdown", true)
        fun matches(name: String, relativePath: String): Boolean {
            val normalizedName = name.lowercase()
            val normalizedPath = relativePath.replace('\\', '/').lowercase()
            return normalizedName in normalizedNames || normalizedPathTerms.any { normalizedPath.contains(it) }
        }
        fun priority(relativePath: String): Int {
            val normalized = relativePath.lowercase()
            return normalizedPreferredTerms.count { normalized.contains(it) } * 100 - normalized.count { it == '/' }
        }
        fun shouldDescend(name: String, relativePath: String): Boolean {
            if (name.isBlank() || name.startsWith('.')) return false
            val normalizedName = name.lowercase()
            val preferred = normalizedPreferredTerms.any {
                normalizedName.contains(it) || relativePath.lowercase().contains(it)
            }
            if (preferred) return true
            return ARCHIVE_SCAN_EXCLUDED_TERMS.none { normalizedName.contains(it) }
        }
        fun enqueue(document: DocumentFile, relativePath: String, depth: Int) {
            val key = relativePath.replace('\\', '/').trim('/')
            if (queued.add(key)) queue += ArchiveDirectory(document, key, depth, priority(key))
        }

        relativeRoots.map { WorkspacePath.segments(it, allowRoot).joinToString("/") }
            .filter { allowRoot || it.isNotBlank() }.distinct().forEach { normalized ->
                val document = find(WorkspacePath.segments(normalized, allowRoot)) ?: return@forEach
                val name = document.name.orEmpty()
                if (document.isFile && isMarkdown(name) && matches(name, normalized)) {
                    output[normalized] = MarkdownFile(name, normalized, document.lastModified())
                } else if (document.isDirectory) {
                    enqueue(document, normalized, 0)
                }
            }

        var visitedDirectories = 0
        var visitedEntries = 0
        while (queue.isNotEmpty() && output.size < maximum && visitedDirectories < maximumDirectories && visitedEntries < maximumEntries) {
            val directory = queue.remove()
            if (!visited.add(directory.relativePath)) continue
            visitedDirectories += 1
            val children = directory.document.listFiles()
            visitedEntries += children.size
            children.forEach { child ->
                if (output.size >= maximum || visitedEntries > maximumEntries) return@forEach
                val name = child.name.orEmpty()
                if (name.isBlank() || name.startsWith('.')) return@forEach
                val relative = if (directory.relativePath.isBlank()) name else "${directory.relativePath}/$name"
                if (child.isFile && isMarkdown(name) && matches(name, relative)) {
                    output[relative] = MarkdownFile(name, relative, child.lastModified())
                } else if (child.isDirectory && directory.depth < maximumDepth && shouldDescend(name, relative)) {
                    enqueue(child, relative, directory.depth + 1)
                }
            }
        }
        return output.values.sortedWith(compareBy<MarkdownFile>({ it.relativePath.lowercase() }, { it.name.lowercase() }))
    }

    /**
     * Writes a sibling temporary document, keeps the previous target as a backup, then renames.
     * Providers that cannot safely rename fail closed; the original is restored when possible.
     */
    fun writeBytesSafely(relativePath: String, bytes: ByteArray, mimeType: String): DocumentFile {
        return writeStreamSafely(relativePath, mimeType) { output -> output.write(bytes) }
    }

    /** Publishes a new file without replacing any existing user file. */
    fun writeStreamNewSafely(relativePath: String, mimeType: String, copy: (java.io.OutputStream) -> Unit): DocumentFile {
        val parts = WorkspacePath.segments(relativePath)
        val fileName = parts.last()
        val parent = resolveDirectory(parts.dropLast(1), create = true)
        require(parent.findFile(fileName) == null) { "目标文件已存在，未覆盖：$relativePath" }
        val token = UUID.randomUUID().toString().replace("-", "").take(12)
        val temporary = requireNotNull(parent.createFile(mimeType, "edu-new-$token")) {
            "目标目录无法创建临时文件：$relativePath"
        }
        try {
            resolver.openOutputStream(temporary.uri, "w")?.use { output -> copy(output); output.flush() }
                ?: error("The document provider could not open the temporary file")
            if (parent.findFile(fileName) != null || !temporary.renameTo(fileName)) {
                temporary.delete()
                error("目标文件在发布前已被占用，未覆盖：$relativePath")
            }
            return requireNotNull(parent.findFile(fileName)) { "Written file is not visible: $relativePath" }
        } catch (error: Throwable) {
            temporary.delete()
            throw error
        }
    }

    fun writeStreamSafely(relativePath: String, mimeType: String, copy: (java.io.OutputStream) -> Unit): DocumentFile {
        val parts = WorkspacePath.segments(relativePath)
        val fileName = parts.last()
        val parent = resolveDirectory(parts.dropLast(1), create = true)
        // Keep provider-facing helper names short and independent of the original name.
        // Some SAF providers enforce a byte-length limit on display names; appending a
        // UUID to a long Chinese/photo filename can make createFile() return null.
        val token = UUID.randomUUID().toString().replace("-", "").take(12)
        val temporaryName = "edu-write-$token"
        val backupName = "edu-backup-$token"
        val temporary = requireNotNull(parent.createFile(mimeType, temporaryName)) {
            "目标目录无法创建迁移临时文件：$relativePath。请确认目标目录仍有可用空间和写入权限"
        }

        try {
            resolver.openOutputStream(temporary.uri, "w")?.use { output ->
                copy(output)
                output.flush()
            } ?: error("The document provider could not open the temporary file")
        } catch (error: Throwable) {
            temporary.delete()
            throw error
        }

        val existing = parent.findFile(fileName)
        if (existing != null && !existing.renameTo(backupName)) {
            temporary.delete()
            error("The document provider cannot create a safe backup for $relativePath")
        }
        if (!temporary.renameTo(fileName)) {
            existing?.renameTo(fileName)
            temporary.delete()
            error("The document provider cannot safely replace $relativePath")
        }
        existing?.delete()
        return requireNotNull(parent.findFile(fileName)) { "Written file is not visible: $relativePath" }
    }

    private fun find(parts: List<String>): DocumentFile? {
        var current = root
        for (part in parts) current = current.findFile(part) ?: return null
        return current
    }

    private fun resolveDirectory(parts: List<String>, create: Boolean): DocumentFile {
        val fullKey = parts.joinToString("/")
        directoryCache[fullKey]?.takeIf { it.exists() && it.isDirectory }?.let { return it }
        var current = root
        var key = ""
        for (part in parts) {
            key = if (key.isBlank()) part else "$key/$part"
            val cached = directoryCache[key]?.takeIf { it.exists() && it.isDirectory }
            if (cached != null) {
                current = cached
                continue
            }
            val child = current.findFile(part)
            current = when {
                child?.isDirectory == true -> child
                child != null -> error("Workspace segment is not a directory: $part")
                create -> requireNotNull(current.createDirectory(part)) {
                    "The document provider could not create directory: $part"
                }
                else -> throw FileNotFoundException(parts.joinToString("/"))
            }
            directoryCache[key] = current
        }
        return current
    }

    companion object {
        private val ARCHIVE_SCAN_EXCLUDED_TERMS = setOf(
            "原始资料", "学习资料", "课程资料", "附件", "图片", "照片", "录音", "视频",
            "ocr", "缓存", "cache", "temp", "temporary", "raw", "materials", "media", "attachments",
        )
        private val COLLABORATION_TEXT_EXTENSIONS = setOf("md", "markdown", "json", "txt", "csv")
    }
}
