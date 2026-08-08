package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StudentModelsTest {
    @Test
    fun standardPathsMatchTheWindowsStudentWorkspaceContract() {
        val paths = StudentWorkspacePaths.standard("张三")
        assertEquals("张三知识库", paths.rootPath)
        assertEquals("张三知识库/张三原始资料库", paths.rawPath)
        assertEquals("张三知识库/张三学情分析汇总", paths.summaryPath)
        assertEquals("张三知识库/AGENT.md", paths.agentPath)
        assertEquals("张三知识库/输出结果", paths.outputPath)
    }

    @Test
    fun adoptedPathsAreRelativeToTheExplicitlyAuthorizedRoot() {
        val paths = StudentWorkspacePaths.adopted("张三")
        assertEquals("", paths.rootPath)
        assertEquals("张三原始资料库", paths.rawPath)
        assertEquals("张三学情分析汇总", paths.summaryPath)
        assertEquals("AGENT.md", paths.agentPath)
    }

    @Test
    fun jsonKeepsWindowsCompatibilityFieldsAndAndroidSafExtension() {
        val record = StudentRecord.create("张三", "八年级", "示例学校", "提升数学", "standard", "content://tree/root")
        val json = record.toJson()
        listOf("id", "name", "grade", "school", "goal", "knowledgeBaseMode", "rootPath", "rawPath", "summaryPath", "agentPath", "outputPath", "materialSources", "createdAt").forEach {
            assertTrue("missing $it", json.has(it))
        }
        assertEquals("android-saf-relative-v1", json.getString("pathDialect"))
        assertEquals("content://tree/root", json.getString("storageRootUri"))
        assertEquals("none", json.getString("remoteChannel"))
    }

    @Test
    fun sanitizesWindowsIllegalCharactersForCrossPlatformCompatibility() {
        assertEquals("张三测试", StudentNamePolicy.sanitize(" 张:三*测试 "))
    }
}
