package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class IndependentWebSearchTest {
    private val response = """{"results":[{"title":"Official","url":"https://example.org/admissions","content":"Applications open in June"},{"title":"Bad","url":"http://example.org/","content":"unsafe"},{"title":"Bad","url":"https://127.0.0.1/","content":"unsafe"}]}"""
    @Test fun parsesOnlyStructuredPublicHttpsSources() {
        val sources = IndependentSearchPolicy.parse(response)
        assertEquals(1, sources.size)
        assertEquals("https://example.org/admissions", sources.single().url)
        assertThrows(IllegalArgumentException::class.java) { IndependentSearchPolicy.parse("""{"results":[]}""") }
    }
    @Test fun searchNeverReceivesStudentDataAndModelReceivesEvidence() {
        var query = ""
        val search = TavilySearch("secret", ModelTransport { endpoint, _, payload, _ ->
            assertEquals("https://api.tavily.com/search", endpoint)
            query = payload.getString("query")
            ModelHttpResponse(200, response, "")
        })
        var calls = 0
        val delegate = object : ModelProvider {
            override fun generate(request: ModelRequest): ModelResponse {
                calls++
                assertFalse(request.webResearch)
                assertTrue(request.messages.toString().contains("https://example.org/admissions"))
                return ModelResponse("""{"items":[{"title":"Official","sourceIds":["search-1"],"fieldSources":{"title":"search-1"}}]}""", "", ModelUsage(null, null, null), emptyList())
            }
        }
        val messages = JSONArray().put(JSONObject().put("role", "system").put("content", "system"))
            .put(JSONObject().put("role", "user").put("content", JSONObject().put("module", "pathways").put("name", "private-student").toString()))
        val result = IndependentResearchProvider(delegate, search) { true }.generate(ModelRequest("model", messages, webResearch = true))
        assertFalse(query.contains("private-student"))
        assertEquals(1, calls)
        assertEquals("https://example.org/admissions", result.sources.single().url)
    }
    @Test fun withdrawnPermissionStopsModelCall() {
        var permitted = true
        val search = TavilySearch("secret", ModelTransport { _, _, _, _ ->
            permitted = false
            ModelHttpResponse(200, response, "")
        })
        val delegate = object : ModelProvider {
            override fun generate(request: ModelRequest): ModelResponse = error("must not call model")
        }
        val messages = JSONArray().put(JSONObject()).put(JSONObject().put("content", """{"module":"pathways"}"""))
        assertThrows(IllegalArgumentException::class.java) {
            IndependentResearchProvider(delegate, search) { permitted }.generate(ModelRequest("model", messages, webResearch = true))
        }
    }
    @Test fun mapsKnownAliasesAndMarksUnsupportedFieldsForReview() {
        val search = TavilySearch("secret", ModelTransport { _, _, _, _ -> ModelHttpResponse(200, response, "") })
        val delegate = object : ModelProvider {
            override fun generate(request: ModelRequest) = ModelResponse(
                """{"items":[{"title":"Official","route":"unverified","sourceIds":["search-1","invented"],"fieldSources":{"title":"search-1","route":"invented"}}]}""",
                "", ModelUsage(null, null, null), emptyList())
        }
        val messages = JSONArray().put(JSONObject()).put(JSONObject().put("content", """{"module":"pathways"}"""))
        val item = JSONObject(IndependentResearchProvider(delegate, search) { true }
            .generate(ModelRequest("model", messages, webResearch = true)).text).getJSONArray("items").getJSONObject(0)
        assertEquals("https://example.org/admissions", item.getJSONArray("sourceIds").getString(0))
        assertEquals(1, item.getJSONArray("sourceIds").length())
        assertEquals("https://example.org/admissions", item.getJSONObject("fieldSources").getString("title"))
        assertEquals("", item.getJSONObject("fieldSources").getString("route"))
        assertTrue(item.getString("route").contains("待核验"))
    }
    @Test fun searchPageTitleIsNotPromotedToCompetition() {
        val search = TavilySearch("secret", ModelTransport { _, _, _, _ -> ModelHttpResponse(200, response, "") })
        val delegate = object : ModelProvider {
            override fun generate(request: ModelRequest) = ModelResponse(
                """{"items":[{"title":"invented","sourceIds":["unknown"],"fieldSources":{"title":"unknown"}}]}""",
                "", ModelUsage(null, null, null), emptyList())
        }
        val messages = JSONArray().put(JSONObject()).put(JSONObject().put("content", """{"module":"competitions"}"""))
        assertThrows(IllegalArgumentException::class.java) {
            IndependentResearchProvider(delegate, search) { true }.generate(ModelRequest("model", messages, webResearch = true))
        }
    }
    @Test fun modelCannotAttachUnsupportedClaimToRealUrl() {
        val search = TavilySearch("secret", ModelTransport { _, _, _, _ -> ModelHttpResponse(200, response, "") })
        val delegate = object : ModelProvider {
            override fun generate(request: ModelRequest) = ModelResponse(
                """{"items":[{"title":"Official","route":"Invented admission claim","sourceIds":["search-1"],"fieldSources":{"title":"search-1","route":"search-1"}}]}""",
                "", ModelUsage(null, null, null), emptyList())
        }
        val messages = JSONArray().put(JSONObject()).put(JSONObject().put("content", """{"module":"pathways"}"""))
        val result = JSONObject(IndependentResearchProvider(delegate, search) { true }
            .generate(ModelRequest("model", messages, webResearch = true)).text).getJSONArray("items").getJSONObject(0)
        assertTrue(result.getString("route").contains("待核验"))
        assertEquals("", result.getJSONObject("fieldSources").getString("route"))
    }
    @Test fun exactSourceExcerptIsRetainedWithItsSource() {
        val search = TavilySearch("secret", ModelTransport { _, _, _, _ -> ModelHttpResponse(200, response, "") })
        val delegate = object : ModelProvider {
            override fun generate(request: ModelRequest) = ModelResponse(
                """{"items":[{"title":"Official","route":"Applications open in June","sourceIds":["search-1"],"fieldSources":{"title":"search-1","route":"search-1"}}]}""",
                "", ModelUsage(null, null, null), emptyList())
        }
        val messages = JSONArray().put(JSONObject()).put(JSONObject().put("content", """{"module":"pathways"}"""))
        val result = IndependentResearchProvider(delegate, search) { true }
            .generate(ModelRequest("model", messages, webResearch = true))
        val item = JSONObject(result.text).getJSONArray("items").getJSONObject(0)
        assertEquals("Applications open in June", item.getString("route"))
        assertEquals("https://example.org/admissions", item.getJSONObject("fieldSources").getString("route"))
        assertEquals("Applications open in June", result.sources.single().excerpt)
    }
    @Test fun blocksExplicitHighSchoolOnlySearchForGradeThree() {
        val search = TavilySearch("secret", ModelTransport { _, _, _, _ -> ModelHttpResponse(200,
            """{"results":[{"title":"High school students only","url":"https://example.org/competition","content":"For grades 9-12"}]}""", "") })
        val delegate = object : ModelProvider { override fun generate(request: ModelRequest): ModelResponse = error("should not call") }
        val messages = JSONArray().put(JSONObject()).put(JSONObject().put("content", """{"module":"competitions","profile":{"grade":"3"}}"""))
        assertThrows(IllegalArgumentException::class.java) {
            IndependentResearchProvider(delegate, search) { true }.generate(ModelRequest("model", messages, webResearch = true))
        }
    }
    @Test fun blocksHighSchoolersAndGradeRangeForChinesePrimaryGrade() {
        listOf("Best Science Competitions for High Schoolers", "USABO is for grades 9 to 12").forEach { title ->
            val search = TavilySearch("secret", ModelTransport { _, _, _, _ -> ModelHttpResponse(200,
                JSONObject().put("results", JSONArray().put(JSONObject().put("title", title)
                    .put("url", "https://example.org/competition").put("content", title))).toString(), "") })
            val delegate = object : ModelProvider { override fun generate(request: ModelRequest): ModelResponse = error("should not call") }
            val messages = JSONArray().put(JSONObject()).put(JSONObject().put("content", """{"module":"competitions","profile":{"grade":"三年级"}}"""))
            assertThrows(IllegalArgumentException::class.java) {
                IndependentResearchProvider(delegate, search) { true }.generate(ModelRequest("model", messages, webResearch = true))
            }
        }
    }
    @Test fun onlyExcludesAgeRangeWhenStudentAgeIsKnown() {
        val source = SearchEvidence("Science Fair", "https://example.org", "Students must be 13-18 years old")
        val known = JSONObject("""{"module":"competitions","profile":{"grade":"三年级","age":8}}""")
        val unknown = JSONObject("""{"module":"competitions","profile":{"grade":"三年级"}}""")
        assertTrue(IndependentSearchPolicy.contradictsGrade(known, source))
        assertFalse(IndependentSearchPolicy.contradictsGrade(unknown, source))
    }
    @Test fun fillsMissingFieldsWithoutInventingItemsOrFacts() {
        val search = TavilySearch("secret", ModelTransport { _, _, _, _ -> ModelHttpResponse(200, response, "") })
        val delegate = object : ModelProvider {
            override fun generate(request: ModelRequest): ModelResponse {
                assertTrue(request.deferSchemaValidation)
                return ModelResponse("""{"result":{"items":[{"title":"Official","sourceIds":["search-1"],"fieldSources":{"title":"search-1","extra":"discard"}}]}}""",
                    "", ModelUsage(null, null, null), emptyList())
            }
        }
        val messages = JSONArray().put(JSONObject()).put(JSONObject().put("content", """{"module":"pathways","count":3}"""))
        val normalized = JSONObject(IndependentResearchProvider(delegate, search) { true }
            .generate(ModelRequest("model", messages, webResearch = true)).text)
        LearningStudioPolicy.validate("pathways", normalized, 3, setOf("https://example.org/admissions"))
        val item = normalized.getJSONArray("items").getJSONObject(0)
        assertEquals(1, normalized.getJSONArray("items").length())
        assertTrue(item.getString("entryRequirements").contains("待核验"))
        assertFalse(item.getJSONObject("fieldSources").has("extra"))
    }
    @Test fun incompletePriorResultsAreExplicitlySourceLeads() {
        val payload = JSONObject("""{"module":"competitions","result":{"items":[{"title":"Directory","eligibility":"待核验","edition":"待核验","deadline":"待核验","fee":"待核验","safetyRisks":"待核验"}]}}""")
        assertTrue(LearningStudioPolicy.researchIsSourceLeadOnly(payload))
    }
}
