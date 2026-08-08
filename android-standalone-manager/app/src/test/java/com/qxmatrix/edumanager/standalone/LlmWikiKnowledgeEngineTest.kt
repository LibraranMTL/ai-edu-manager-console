package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LlmWikiKnowledgeEngineTest {
    private val subjectId = "student-synthetic-a"

    @Test
    fun reportsTheWindowsKnowledgeEngineV1ContractAndLayout() {
        val store = InMemoryKnowledgeDocumentStore()
        val engine = LlmWikiKnowledgeEngine(subjectId, store)
        val health = engine.health()
        assertEquals("edu-manager.knowledge-engine.v1", health.getString("contractVersion"))
        assertEquals("llm-wiki-local", health.getString("engineId"))
        listOf("sources", "claims", "claim-history", "relationships", "exports").forEach {
            assertTrue(store.exists(".edu-manager/knowledge-engine-v1/$it"))
        }
    }

    @Test
    fun sourceImportIsIdempotentAndImmutable() {
        val engine = LlmWikiKnowledgeEngine(subjectId, InMemoryKnowledgeDocumentStore())
        val source = source()
        assertFalse(engine.importAsset(source).getBoolean("duplicate"))
        assertTrue(engine.importAsset(source).getBoolean("duplicate"))
        val error = assertThrows(KnowledgeEngineException::class.java) {
            engine.importAsset(JSONObject(source.toString()).put("content", "changed"))
        }
        assertEquals("IMMUTABLE_SOURCE_CONFLICT", error.code)
    }

    @Test
    fun confirmedClaimsNeedEvidenceAndSearchCannotCrossStudents() {
        val engine = LlmWikiKnowledgeEngine(subjectId, InMemoryKnowledgeDocumentStore())
        val noEvidence = claim().put("evidence", JSONArray())
        assertEquals(
            "CONFIRMED_WITHOUT_EVIDENCE",
            assertThrows(KnowledgeEngineException::class.java) { engine.upsertClaim(noEvidence) }.code,
        )
        engine.upsertClaim(claim())
        assertEquals(1, engine.search("画图").getJSONArray("results").length())
        assertEquals(
            "SUBJECT_SCOPE_MISMATCH",
            assertThrows(KnowledgeEngineException::class.java) {
                engine.search("画图", requestedSubjectId = "student-synthetic-b")
            }.code,
        )
    }

    @Test
    fun revisionsEventsRelationshipsAndPortableExportRemainAuditable() {
        val store = InMemoryKnowledgeDocumentStore()
        val engine = LlmWikiKnowledgeEngine(subjectId, store)
        engine.importAsset(source())
        engine.upsertClaim(claim())
        engine.upsertClaim(JSONObject(claim().toString()).put("value", "第二次观察"))
        assertEquals(1, store.listFileNames(".edu-manager/knowledge-engine-v1/claim-history/claim-diagram-001").size)
        engine.appendEvent(JSONObject().put("id", "event-observation-001").put("type", "observation_recorded"))
        engine.upsertRelationship(JSONObject()
            .put("id", "relationship-claim-source-001")
            .put("fromId", "claim-diagram-001")
            .put("toId", "source-observation-001")
            .put("type", "supported_by"))
        val exported = engine.exportSnapshot("synthetic-export").getJSONObject("snapshot")
        assertEquals(1, exported.getJSONArray("sources").length())
        assertEquals(1, exported.getJSONArray("claims").length())
        assertEquals(1, exported.getJSONArray("relationships").length())
        assertEquals(1, exported.getJSONArray("events").length())
        assertNotNull(store.readText(".edu-manager/knowledge-engine-v1/exports/synthetic-export/README.md"))
    }

    @Test
    fun rejectsPathTraversalIds() {
        val engine = LlmWikiKnowledgeEngine(subjectId, InMemoryKnowledgeDocumentStore())
        val error = assertThrows(KnowledgeEngineException::class.java) {
            engine.upsertClaim(JSONObject(claim().toString()).put("id", "../escape"))
        }
        assertEquals("INVALID_ID", error.code)
    }

    private fun source() = JSONObject()
        .put("id", "source-observation-001")
        .put("uri", "fixture://education/student-a/observation-001")
        .put("title", "数学学习观察")
        .put("mediaType", "text/markdown")
        .put("content", "学生在三次练习中使用画图整理条件。")
        .put("synthetic", true)

    private fun claim() = JSONObject()
        .put("id", "claim-diagram-001")
        .put("subjectId", subjectId)
        .put("predicate", "uses_diagram_to_structure_problem")
        .put("value", "在指定练习中使用画图整理条件")
        .put("status", "confirmed")
        .put("confidence", "medium")
        .put("evidence", JSONArray().put(JSONObject()
            .put("id", "evidence-observation-001")
            .put("sourceUri", "fixture://education/student-a/observation-001")
            .put("excerpt", "三次练习中使用画图整理条件")
            .put("observedAt", "2026-07-01T00:00:00.000Z")))
}
