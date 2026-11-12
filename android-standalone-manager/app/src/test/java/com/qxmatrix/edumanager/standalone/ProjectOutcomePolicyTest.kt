package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProjectOutcomePolicyTest {
    @Test fun schemasUseSupportedStrictSubset() {
        ModelJsonSchema.validateDefinition(ProjectOutcomePolicy.reportSchema())
        ModelJsonSchema.validateDefinition(ProjectOutcomePolicy.mentorSchema())
    }

    @Test fun deterministicReportUsesOnlySnapshotEvidenceAndDoesNotClaimMasteryOrContribution() {
        val evidence = JSONArray()
            .put(evidence("project-registry:abc", "registry", "资料登记"))
            .put(evidence("project-knowledge:def", "knowledge", "阶段摘要"))
            .put(evidence("project-output:ghi", "output", "演示成果.pdf"))
        val metrics = JSONObject().put("materials", 4).put("pendingMaterials", 1)
            .put("pendingDigest", 1).put("unavailable", 0)
        val report = ProjectOutcomePolicy.deterministicReport(project(), metrics, evidence)
        val allowed = ProjectOutcomePolicy.evidenceIds(evidence)
        ProjectOutcomePolicy.validateReport(report, allowed)
        val text = report.toString()
        assertFalse(text.contains("已掌握")); assertFalse(text.contains("贡献已确认"))
        assertEquals("available", report.getJSONArray("deliverables").getJSONObject(0).getString("status"))
        assertTrue(report.getJSONArray("risks").length() >= 2)
    }

    @Test fun fallbackMentorRemainsEvidenceBoundedAndUnknownEvidenceIsRejected() {
        val evidence = JSONArray().put(evidence("project-registry:abc", "registry", "资料登记"))
        val report = ProjectOutcomePolicy.deterministicReport(project(),
            JSONObject().put("materials", 0).put("pendingMaterials", 0).put("pendingDigest", 0).put("unavailable", 0), evidence)
        val mentor = ProjectOutcomePolicy.fallbackMentor(report)
        ProjectOutcomePolicy.validateMentor(mentor, setOf("project-registry:abc"))
        mentor.getJSONArray("suggestions").getJSONObject(0).put("evidenceIds", JSONArray(listOf("outside-snapshot")))
        assertThrows(IllegalArgumentException::class.java) {
            ProjectOutcomePolicy.validateMentor(mentor, setOf("project-registry:abc"))
        }
    }

    @Test fun reportReuseRequiresMatchingProjectFingerprintEvidenceAndContent() {
        val evidence = JSONArray().put(evidence("project-registry:abc", "registry", "资料登记"))
        val report = ProjectOutcomePolicy.deterministicReport(project(),
            JSONObject().put("materials", 0).put("pendingMaterials", 0).put("pendingDigest", 0).put("unavailable", 0), evidence)
        val bytes = "合成报告".toByteArray(Charsets.UTF_8)
        val entry = JSONObject().put("id", "report-a").put("fingerprint", "snapshot-a")
        val payload = JSONObject().put("schema", "edu-manager.project-progress-report.v1").put("projectId", "project-test")
            .put("reportId", "report-a").put("evidenceFingerprint", "snapshot-a").put("report", report).put("evidence", evidence)
            .put("markdownSha256", ScopedContentPolicy.hash(bytes))
        ProjectOutcomePolicy.validateStoredReport("project-test", entry, payload, bytes, "")
        assertThrows(IllegalArgumentException::class.java) { ProjectOutcomePolicy.validateStoredReport("other-project", entry, payload, bytes, "") }
        assertThrows(IllegalArgumentException::class.java) { ProjectOutcomePolicy.validateStoredReport("project-test", entry, payload, "被修改".toByteArray(), "") }
        payload.remove("markdownSha256")
        ProjectOutcomePolicy.validateStoredReport("project-test", entry, payload, bytes, ScopedContentPolicy.hash(bytes))
        assertThrows(IllegalArgumentException::class.java) { ProjectOutcomePolicy.validateStoredReport("project-test", entry, payload, bytes, "") }
    }

    private fun evidence(id: String, kind: String, title: String) = JSONObject().put("id", id).put("kind", kind)
        .put("title", title).put("path", "").put("sha256", "hash-$id").put("excerpt", "摘要")

    private fun project() = ProjectRecord(
        id = "project-test", name = "测试项目", type = "学习项目", description = "", objective = "完成可核验成果",
        studentIds = listOf("student-test"), studentNames = listOf("学生"), status = "active",
        projectRootUri = "content://project", knowledgeRootUri = "content://project", workspaceRootUri = "content://project",
        workspaceMode = "managed", knowledgeMode = "managed", knowledgeSpaceId = "", paths = ProjectPaths.managed("测试项目"),
        knowledgeAdoption = null, createdAt = "2026-11-06T00:00:00Z", materialStorageMode = "workspace-v1",
        materialRegistryVersion = 1, materialMigrationState = "complete",
    )
}
