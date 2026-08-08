package com.qxmatrix.edumanager.standalone

class InMemoryKnowledgeDocumentStore : KnowledgeDocumentStore {
    private val directories = mutableSetOf<String>()
    private val files = mutableMapOf<String, String>()

    override fun exists(relativePath: String): Boolean = relativePath in directories || relativePath in files

    override fun ensureDirectory(relativePath: String) {
        directories += relativePath.trimEnd('/')
    }

    override fun readText(relativePath: String): String = files[relativePath]
        ?: throw NoSuchElementException(relativePath)

    override fun writeTextSafely(relativePath: String, content: String, mimeType: String) {
        files[relativePath] = content
    }

    override fun listFileNames(relativeDirectory: String): List<String> {
        val prefix = relativeDirectory.trimEnd('/') + "/"
        return files.keys.filter { it.startsWith(prefix) && '/' !in it.removePrefix(prefix) }
            .map { it.removePrefix(prefix) }
            .sorted()
    }
}
