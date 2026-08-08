package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WorkspacePathTest {
    @Test
    fun normalizesWindowsSeparatorsWithoutChangingNames() {
        assertEquals("学生甲知识库/AGENT.md", WorkspacePath.normalized("学生甲知识库\\AGENT.md"))
    }

    @Test
    fun acceptsExistingWindowsLibraryNamesAsLogicalPaths() {
        assertEquals(
            listOf("学生甲原始资料库", "数学", "函数.pdf"),
            WorkspacePath.segments("学生甲原始资料库/数学/函数.pdf"),
        )
    }

    @Test
    fun rejectsTraversalAbsoluteAndDrivePaths() {
        listOf("../secret", "a/../secret", "/root/file", "\\server\\share", "C:\\data\\file").forEach { path ->
            assertThrows(IllegalArgumentException::class.java) { WorkspacePath.segments(path) }
        }
    }

    @Test
    fun rejectsAmbiguousEmptySegments() {
        listOf("a//b", "a/./b", "a/", " ").forEach { path ->
            assertThrows(IllegalArgumentException::class.java) { WorkspacePath.segments(path) }
        }
    }
}
