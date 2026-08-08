package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import java.io.FileNotFoundException
import java.io.InputStream
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

    /** Deletes one already-authorized logical file. Missing files make retries idempotent. */
    fun deleteFileIfExists(relativePath: String): Boolean {
        val document = find(WorkspacePath.segments(relativePath)) ?: return true
        require(document.isFile) { "Workspace path is not a file: $relativePath" }
        check(document.delete()) { "The document provider could not delete: $relativePath" }
        return true
    }

    data class MarkdownFile(val name: String, val relativePath: String)

    /** Lists bounded Markdown documents below already-authorized logical roots. */
    fun listMarkdownFiles(relativeRoots: List<String>, maximum: Int = 500, maximumDepth: Int = 12): List<MarkdownFile> {
        require(maximum in 1..2_000 && maximumDepth in 1..24)
        val result = linkedMapOf<String, MarkdownFile>()
        relativeRoots.filter { it.isNotBlank() }.distinct().forEach { logicalRoot ->
            if (result.size >= maximum) return@forEach
            val normalized = WorkspacePath.segments(logicalRoot).joinToString("/")
            val document = find(WorkspacePath.segments(normalized)) ?: return@forEach
            if (document.isFile) {
                val name = document.name.orEmpty()
                if (name.endsWith(".md", true) || name.endsWith(".markdown", true)) result[normalized] = MarkdownFile(name, normalized)
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
            val relative = if (prefix.isBlank()) name else "$prefix/$name"
            if (child.isDirectory) walkMarkdown(child, relative, depth + 1, maximumDepth, maximum, output)
            else if (child.isFile && (name.endsWith(".md", true) || name.endsWith(".markdown", true))) output[relative] = MarkdownFile(name, relative)
        }
    }

    /**
     * Writes a sibling temporary document, keeps the previous target as a backup, then renames.
     * Providers that cannot safely rename fail closed; the original is restored when possible.
     */
    fun writeBytesSafely(relativePath: String, bytes: ByteArray, mimeType: String): DocumentFile {
        return writeStreamSafely(relativePath, mimeType) { output -> output.write(bytes) }
    }

    fun writeStreamSafely(relativePath: String, mimeType: String, copy: (java.io.OutputStream) -> Unit): DocumentFile {
        val parts = WorkspacePath.segments(relativePath)
        val fileName = parts.last()
        val parent = resolveDirectory(parts.dropLast(1), create = true)
        val token = UUID.randomUUID().toString()
        val temporaryName = ".$fileName.write-$token"
        val backupName = ".$fileName.backup-$token"
        val temporary = requireNotNull(parent.createFile(mimeType, temporaryName)) {
            "The document provider could not create a temporary file"
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
        var current = root
        for (part in parts) {
            val child = current.findFile(part)
            current = when {
                child?.isDirectory == true -> child
                child != null -> error("Workspace segment is not a directory: $part")
                create -> requireNotNull(current.createDirectory(part)) {
                    "The document provider could not create directory: $part"
                }
                else -> throw FileNotFoundException(parts.joinToString("/"))
            }
        }
        return current
    }
}
