package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectModelsTest {
    @Test
    fun agentSelectionSurvivesAndroidReadWriteWithoutBeingReplacedByQClaw() {
        val json = ProjectRecord.create("测试", "研究", "", "", emptyList(), "content://base").toJson()
        assertEquals("workbuddy", json.getString("agentTool"))
        for (agent in listOf("codex", "workbuddy", "qclaw", "claude-code")) {
            json.put("agentTool", agent)
            assertEquals(agent, ProjectRecord.fromJson(json).toJson().getString("agentTool"))
        }
    }

    @Test
    fun managedPathsMatchWindowsProjectWorkspaceAndKnowledgeSchema() {
        val p = ProjectPaths.managed("火星研究")
        assertEquals("学习项目/火星研究项目知识库/项目工作空间", p.workspacePath)
        assertEquals("学习项目/火星研究项目知识库/项目工作空间/研究暂存", p.stagingPath)
        assertEquals("学习项目/火星研究项目知识库/项目知识空间/火星研究项目原始资料库", p.rawPath)
        assertEquals("学习项目/火星研究项目知识库/项目知识空间/问答精华库", p.qaPath)
        assertEquals("学习项目/火星研究项目知识库/项目知识空间/知识贡献", p.contributionPath)
    }

    @Test
    fun projectKeepsMultipleStudentIdsAndCompatibilityFields() {
        val students = listOf(student("student-a", "学生甲"), student("student-b", "学生乙"))
        val record = ProjectRecord.create("火星研究", "研究项目", "说明", "目标", students, "content://base")
        val json = record.toJson()
        assertEquals(listOf("student-a", "student-b"), json.getJSONArray("studentIds").strings())
        listOf("workspaceMode", "knowledgeMode", "knowledgeSpaceId", "projectRootPath", "managerPath", "workspacePath", "stagingPath", "knowledgeRootPath", "rawPath", "conceptPath", "entityPath", "summaryPath", "qaPath", "synthesisPath", "reportPath", "contributionPath", "agentPath", "outputPath").forEach { assertTrue(json.has(it)) }
    }

    @Test
    fun adoptedKnowledgeUsesSeparateControlAndKnowledgeRoots() {
        val paths = AdoptedKnowledgePaths("已有原始资料库", "概念库", "实体库", "摘要库", "问答精华库", "综合汇总库")
        val record = ProjectRecord.create("接管项目", "学习项目", "", "", emptyList(), "content://control", "content://knowledge", paths, "project-kb-stable", JSONObject())
        assertEquals("adopted", record.knowledgeMode)
        assertEquals("content://control", record.projectRootUri)
        assertEquals("content://knowledge", record.knowledgeRootUri)
        assertEquals("已有原始资料库", record.paths.rawPath)
    }

    private fun student(id: String, name: String) = StudentRecord(id, name, "", "", "", "standard", "content://base", StudentWorkspacePaths.standard(name), "", Timestamp.now())
}
