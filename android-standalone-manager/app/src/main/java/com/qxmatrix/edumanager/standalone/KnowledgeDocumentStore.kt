package com.qxmatrix.edumanager.standalone

interface KnowledgeDocumentStore {
    fun exists(relativePath: String): Boolean
    fun ensureDirectory(relativePath: String)
    fun readText(relativePath: String): String
    fun writeTextSafely(relativePath: String, content: String, mimeType: String = "application/json")
    fun listFileNames(relativeDirectory: String): List<String>
}

class SafKnowledgeDocumentStore(
    private val store: SafWorkspaceStore,
    private val workspaceRoot: String,
) : KnowledgeDocumentStore {
    override fun exists(relativePath: String): Boolean = store.exists(resolve(relativePath))

    override fun ensureDirectory(relativePath: String) {
        store.ensureDirectory(resolve(relativePath))
    }

    override fun readText(relativePath: String): String = store.readBytes(resolve(relativePath)).toString(Charsets.UTF_8)

    override fun writeTextSafely(relativePath: String, content: String, mimeType: String) {
        store.writeBytesSafely(resolve(relativePath), content.toByteArray(Charsets.UTF_8), mimeType)
    }

    override fun listFileNames(relativeDirectory: String): List<String> =
        store.listDirectory(resolve(relativeDirectory)).filter { it.isFile }.mapNotNull { it.name }.sorted()

    private fun resolve(relativePath: String): String =
        if (workspaceRoot.isBlank()) relativePath else "$workspaceRoot/$relativePath"
}
