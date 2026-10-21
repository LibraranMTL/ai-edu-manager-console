package com.qxmatrix.edumanager.standalone

/** Validates logical paths before they are resolved inside a user-authorized SAF tree. */
object WorkspacePath {
    fun segments(relativePath: String, allowRoot: Boolean = false): List<String> {
        if (relativePath.isBlank() && allowRoot) return emptyList()
        require(relativePath.isNotBlank()) { "Workspace path must not be blank" }
        require('\u0000' !in relativePath) { "Workspace path contains a null byte" }
        require(!relativePath.startsWith('/') && !relativePath.startsWith('\\')) {
            "Workspace path must be relative"
        }
        require(!WINDOWS_DRIVE.matches(relativePath)) { "Workspace path must not contain a drive prefix" }

        return relativePath.replace('\\', '/').split('/').also { parts ->
            require(parts.none { it.isBlank() || it == "." || it == ".." }) {
                "Workspace path contains an empty or traversal segment"
            }
            require(parts.all { it.length <= 255 }) { "Workspace path segment is too long" }
        }
    }

    fun normalized(relativePath: String): String = segments(relativePath).joinToString("/")

    private val WINDOWS_DRIVE = Regex("^[A-Za-z]:.*")
}
