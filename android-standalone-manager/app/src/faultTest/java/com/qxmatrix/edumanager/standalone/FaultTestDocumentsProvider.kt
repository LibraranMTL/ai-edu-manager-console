package com.qxmatrix.edumanager.standalone

import android.database.Cursor
import android.database.MatrixCursor
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import java.io.File

/** Test-build-only document tree, confined to this isolated app's private files. */
class FaultTestDocumentsProvider : DocumentsProvider() {
    private lateinit var root: File
    override fun onCreate(): Boolean {
        root = File(requireNotNull(context).filesDir, "synthetic-fault-workspace").canonicalFile
        return root.mkdirs() || root.isDirectory
    }
    private fun resolve(id: String): File {
        require(id == "root" || id.startsWith("root/"))
        val file = File(root, id.removePrefix("root").trimStart('/')).canonicalFile
        require(file == root || file.path.startsWith(root.path + File.separator))
        return file
    }
    private fun id(file: File): String = if (file == root) "root" else "root/" + file.relativeTo(root).invariantSeparatorsPath
    override fun queryRoots(projection: Array<out String>?): Cursor {
        val cols = projection ?: arrayOf(Root.COLUMN_ROOT_ID, Root.COLUMN_DOCUMENT_ID, Root.COLUMN_TITLE, Root.COLUMN_FLAGS)
        return MatrixCursor(cols).apply {
            val row = newRow()
            cols.forEach { column -> row.add(when (column) {
                Root.COLUMN_ROOT_ID, Root.COLUMN_DOCUMENT_ID -> "root"
                Root.COLUMN_TITLE -> "Synthetic fault test"
                Root.COLUMN_FLAGS -> Root.FLAG_SUPPORTS_CREATE
                else -> null
            }) }
        }
    }
    private fun include(cursor: MatrixCursor, file: File) {
        val row = cursor.newRow()
        cursor.columnNames.forEach { column -> row.add(when (column) {
            Document.COLUMN_DOCUMENT_ID -> id(file)
            Document.COLUMN_DISPLAY_NAME -> if (file == root) "Synthetic fault test" else file.name
            Document.COLUMN_MIME_TYPE -> if (file.isDirectory) Document.MIME_TYPE_DIR else "application/octet-stream"
            Document.COLUMN_FLAGS -> if (file.isDirectory) Document.FLAG_DIR_SUPPORTS_CREATE or Document.FLAG_SUPPORTS_DELETE or Document.FLAG_SUPPORTS_RENAME
                else Document.FLAG_SUPPORTS_WRITE or Document.FLAG_SUPPORTS_DELETE or Document.FLAG_SUPPORTS_RENAME
            Document.COLUMN_SIZE -> file.length()
            Document.COLUMN_LAST_MODIFIED -> file.lastModified()
            else -> null
        }) }
    }
    private fun columns(projection: Array<out String>?) = projection ?: arrayOf(Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_FLAGS, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED)
    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor = MatrixCursor(columns(projection)).apply {
        val file = resolve(documentId); require(file.exists()); include(this, file)
    }
    override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?): Cursor =
        MatrixCursor(columns(projection)).apply { resolve(parentDocumentId).listFiles().orEmpty().sortedBy { it.name }.forEach { include(this, it) } }
    override fun isChildDocument(parentDocumentId: String, documentId: String): Boolean =
        resolve(documentId).path.startsWith(resolve(parentDocumentId).path + File.separator)
    override fun openDocument(documentId: String, mode: String, signal: android.os.CancellationSignal?): ParcelFileDescriptor =
        ParcelFileDescriptor.open(resolve(documentId), ParcelFileDescriptor.parseMode(mode))
    override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
        require(displayName.isNotBlank() && !displayName.contains('/') && !displayName.contains('\\'))
        val target = resolve("$parentDocumentId/$displayName")
        require(if (mimeType == Document.MIME_TYPE_DIR) target.mkdir() else target.createNewFile())
        return id(target)
    }
    override fun renameDocument(documentId: String, displayName: String): String {
        require(displayName.isNotBlank() && !displayName.contains('/') && !displayName.contains('\\'))
        val source = resolve(documentId); val target = File(requireNotNull(source.parentFile), displayName).canonicalFile
        require(target.path.startsWith(root.path + File.separator) && !target.exists() && source.renameTo(target))
        return id(target)
    }
    override fun deleteDocument(documentId: String) { val file = resolve(documentId); require(file != root && file.delete()) }
}
