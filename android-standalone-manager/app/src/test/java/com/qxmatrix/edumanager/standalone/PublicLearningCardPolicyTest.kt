package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class PublicLearningCardPolicyTest {
    @Test fun attemptDetailsShowOnlyTheStudentsOwnAnswerWithoutTechnicalMetadata() {
        val payload = JSONObject().put("evidenceSnapshot", JSONObject().put("result", JSONObject().put("items", JSONArray().put(JSONObject().put("question", "7 + 5?").put("answer", "12")))))
            .put("answer", JSONObject().put("text", "11")).put("versionId", "private-internal-id")
        val result = LearningStudioPolicy.readableAttempt(payload)
        assert(result.contains("7 + 5?") && result.contains("11"))
        assertFalse(result.contains("private-internal-id"))
        assertFalse(result.contains("\"answer\""))
    }

    @Test fun exactAnswerFeedbackComparesOnlySingleQuestionWithoutClaimingMastery() {
        val item = JSONObject().put("question", "7 + 5?").put("answer", "12").put("rationale", "Seven plus five.")
        val snapshot = JSONObject().put("answerPolicy", "exact").put("result", JSONObject().put("items", JSONArray().put(item)))
        val payload = JSONObject().put("evidenceSnapshot", snapshot).put("answer", JSONObject().put("text", " 12 "))
        val correct = LearningStudioPolicy.readableAttempt(payload)
        assert(correct.contains("与参考答案一致") && correct.contains("尚未形成掌握程度结论"))
        payload.put("answer", JSONObject().put("text", "11"))
        assert(LearningStudioPolicy.readableAttempt(payload).contains("与参考答案不一致"))
        snapshot.getJSONObject("result").getJSONArray("items").put(JSONObject(item.toString()))
        assertFalse(LearningStudioPolicy.readableAttempt(payload).contains("答案比对"))
        snapshot.put("answerPolicy", "rubric")
        assertFalse(LearningStudioPolicy.readableAttempt(payload).contains("答案比对"))
    }
    @Test fun filtersSignedPublicTemplatesByExactLocaleAndGrade() {
        val manifest = manifest()
        assertEquals(1, PublicLearningCardPolicy.eligible(manifest, "en-US", "3").size)
        assertEquals(0, PublicLearningCardPolicy.eligible(manifest, "en-GB", "3").size)
        assertEquals(0, PublicLearningCardPolicy.eligible(manifest, "en-US", "4").size)
        assertEquals(0, PublicLearningCardPolicy.eligible(manifest, "en-US", "").size)
        assertEquals(1, PublicLearningCardPolicy.eligible(manifest, "zh-CN", "3", includeOtherLanguages = true).size)
        assertEquals(0, PublicLearningCardPolicy.eligible(manifest, "zh-CN", "4", includeOtherLanguages = true).size)
    }

    @Test fun createsAStudentFreeImmutableInstancePayload() {
        val choice = PublicLearningCardPolicy.eligible(manifest(), "en-US", "3").single()
        val payload = PublicLearningCardPolicy.instancePayload(choice)
        assertEquals("cards", payload.getString("module"))
        assertEquals("public_template", payload.getString("origin"))
        assertEquals("card-template-rev-math-place-value-01", payload.getString("templateRevision"))
        assertEquals("4", payload.getJSONObject("result").getJSONArray("items").getJSONObject(0).getString("answer"))
        assertEquals("public-card:card-template-rev-math-place-value-01", PublicLearningCardPolicy.sourceKey(choice))
        assertFalse(payload.toString().contains("studentId"))
        assertEquals(payload.toString(), PublicLearningCardPolicy.instancePayload(choice).toString())
    }

    @Test fun rejectsAnExactAnswerTemplateWithoutAnAnswer() {
        val manifest = manifest()
        manifest.getJSONArray("cardPacks").getJSONObject(0).getJSONArray("templates")
            .getJSONObject(0).put("answer", "")
        assertThrows(IllegalArgumentException::class.java) { PublicLearningCardPolicy.validateManifest(manifest) }
    }

    @Test fun rejectsTemplateCoursesOutsideThePack() {
        val manifest = manifest()
        manifest.getJSONArray("cardPacks").getJSONObject(0).getJSONArray("templates")
            .getJSONObject(0).put("courseIds", JSONArray().put("platform:codeorg-k12-computing"))
        assertThrows(IllegalArgumentException::class.java) { PublicLearningCardPolicy.validateManifest(manifest) }
    }

    private fun manifest(): JSONObject {
        val courseId = "platform:starfall-k5-math"
        val templateId = "platform:card-template:math-place-value-01"
        val template = JSONObject()
            .put("templateId", templateId)
            .put("templateRevision", "card-template-rev-math-place-value-01")
            .put("templateType", "single_choice")
            .put("subject", "Mathematics")
            .put("knowledgePointIds", JSONArray().put("kp:place-value"))
            .put("difficulty", "basic")
            .put("gradeBands", JSONArray().put("3"))
            .put("locale", "en-US")
            .put("prompt", "Which digit represents the tens place in 245?")
            .put("answerPolicy", "exact")
            .put("answer", "4")
            .put("rubric", "")
            .put("explanation", "The tens digit is second from the right.")
            .put("hintPolicy", "on_request")
            .put("sourceRefs", JSONArray().put("public:math-place-value-v1"))
            .put("courseIds", JSONArray().put(courseId))
            .put("tags", JSONArray().put("place-value"))
            .put("generatorVersion", "human-authored")
        val pack = JSONObject()
            .put("packId", "platform:card-pack:math-place-value-01")
            .put("packRevision", "card-pack-rev-math-place-value-01")
            .put("title", "Place Value Practice")
            .put("summary", "Short practice")
            .put("locale", "en-US")
            .put("gradeBands", JSONArray().put("3"))
            .put("courseIds", JSONArray().put(courseId))
            .put("templateIds", JSONArray().put(templateId))
            .put("templates", JSONArray().put(template))
        return JSONObject()
            .put("manifestRevision", "manifest-rev-learning-card-test")
            .put("issuedAt", "2026-11-06T00:00:00.000Z")
            .put("expiresAt", "2026-11-07T00:00:00.000Z")
            .put("courses", JSONArray().put(JSONObject().put("courseId", courseId)))
            .put("cardPacks", JSONArray().put(pack))
    }
}
