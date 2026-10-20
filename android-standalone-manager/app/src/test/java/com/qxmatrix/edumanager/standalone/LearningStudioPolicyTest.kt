package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class LearningStudioPolicyTest {
    private fun cards() = JSONObject().put("items", JSONArray().put(JSONObject().put("question", "题目").put("answer", "secret-answer")
        .put("rationale", "原文依据").put("sourceIds", JSONArray(listOf("source-1")))))
    @Test fun canonicalFingerprintIgnoresObjectKeyOrderNotArrayOrder() {
        assertEquals(ScopedContentPolicy.fingerprint(JSONObject("{\"a\":1,\"b\":2}")), ScopedContentPolicy.fingerprint(JSONObject("{\"b\":2,\"a\":1}")))
        assertNotEquals(ScopedContentPolicy.fingerprint(JSONObject("{\"a\":[1,2]}")), ScopedContentPolicy.fingerprint(JSONObject("{\"a\":[2,1]}")))
    }
    @Test fun validatorsRejectWrongCountsBlankAnswersAndInventedSources() {
        LearningStudioPolicy.validate("cards", cards(), 1, setOf("source-1"))
        assertThrows(IllegalArgumentException::class.java) { LearningStudioPolicy.validate("cards", cards(), 2, setOf("source-1")) }
        assertThrows(IllegalArgumentException::class.java) { LearningStudioPolicy.validate("cards", cards(), 1, setOf("other")) }
        val blank = cards(); blank.getJSONArray("items").getJSONObject(0).put("answer", " ")
        assertThrows(IllegalArgumentException::class.java) { LearningStudioPolicy.validate("cards", blank, 1, setOf("source-1")) }
    }
    @Test fun printSharePayloadCannotIncludeAnswerOrHistory() {
        val root = JSONObject().put("module", "cards").put("result", cards()).put("attempts", "secret-history").put("inputSnapshot", "private-evidence")
        val clean = LearningStudioPolicy.questionsOnly(root)
        assertTrue(clean.contains("题目")); assertFalse(clean.contains("secret")); assertFalse(clean.contains("private"))
    }
    @Test fun publishedReportAndRedactionAreExplicit() {
        assertFalse(LearningStudioPolicy.recentPublished("status: draft\npublished_at: today"))
        assertFalse(LearningStudioPolicy.recentPublished("status: published"))
        assertTrue(LearningStudioPolicy.recentPublished("---\nstatus: active\npublication_mode: direct\npublished_at: 2026-10-02\n---"))
        val clean = LearningStudioPolicy.redact("张三 13812345678 a@example.com", "张三")
        assertFalse(clean.contains("张三")); assertFalse(clean.contains("13812345678")); assertFalse(clean.contains("a@example.com"))
    }
    @Test fun planningModulesHaveDistinctDecisionFields() {
        LearningStudioPolicy.fields.keys.forEach { ModelJsonSchema.validateDefinition(LearningStudioPolicy.schema(it, 3)) }
        assertTrue("eligibility" in LearningStudioPolicy.fields.getValue("competitions"))
        assertTrue("entryRequirements" in LearningStudioPolicy.fields.getValue("pathways"))
        assertTrue("trialAction" in LearningStudioPolicy.fields.getValue("careers"))
    }
    @Test fun fileValidationRejectsExtensionSpoofAndExecutable() {
        assertEquals("text/plain", AnswerFilePolicy.validate("answer.md", "答案".toByteArray()))
        assertEquals("application/pdf", AnswerFilePolicy.validate("answer.pdf", "%PDF-1.7".toByteArray()))
        assertThrows(IllegalArgumentException::class.java) { AnswerFilePolicy.validate("answer.pdf", "not pdf".toByteArray()) }
        assertThrows(IllegalStateException::class.java) { AnswerFilePolicy.validate("answer.exe", "MZ".toByteArray()) }
        assertThrows(IllegalArgumentException::class.java) { AnswerFilePolicy.validate("answer.txt", byteArrayOf(0, 1)) }
        assertThrows(Exception::class.java) { AnswerFilePolicy.validate("answer.txt", byteArrayOf(0xff.toByte())) }
    }
    private fun zip(vararg entries: String): ByteArray = ByteArrayOutputStream().also { out -> ZipOutputStream(out).use { zip -> entries.forEach { zip.putNextEntry(ZipEntry(it)); zip.write("content".toByteArray()); zip.closeEntry() } } }.toByteArray()
    @Test fun docxRequiresWordContentAndForbidsTraversalAndMacros() {
        assertTrue(AnswerFilePolicy.validate("answer.docx", zip("[Content_Types].xml", "word/document.xml")).contains("wordprocessing"))
        assertThrows(IllegalArgumentException::class.java) { AnswerFilePolicy.validate("answer.docx", zip("file.txt")) }
        assertThrows(IllegalArgumentException::class.java) { AnswerFilePolicy.validate("answer.docx", zip("../word/document.xml")) }
        assertThrows(IllegalArgumentException::class.java) { AnswerFilePolicy.validate("answer.docx", zip("[Content_Types].xml", "word/document.xml", "word/vbaProject.bin")) }
    }
}
