package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MaterialProcessingPolicyTest {
    @Test fun optionalVisionFailureDoesNotBlockUsableOcr() {
        val material = JSONObject().put("fileName", "page.jpg").put("ocrStatus", "completed")
            .put("digestReady", true).put("visionStatus", "unavailable")
        assertTrue(MaterialProcessingPolicy.digestReady(material))
        assertFalse(MaterialProcessingPolicy.ocrNeedsHelp(material))
    }

    @Test fun emptyOcrReturnsToSupplementProcessing() {
        val material = JSONObject().put("fileName", "page.jpg").put("ocrStatus", "needs_user")
            .put("digestReady", false).put("visionStatus", "unavailable")
        assertFalse(MaterialProcessingPolicy.digestReady(material))
        assertFalse(MaterialProcessingPolicy.ocrNeedsHelp(material))
        assertTrue(MaterialProcessingPolicy.awaitingAutomaticRecovery(material))
    }

    @Test fun unknownDigestIsNotReportedAsOcrFailure() {
        val material = JSONObject().put("fileName", "page.jpg").put("ocrStatus", "completed")
            .put("digestReady", true).put("visionStatus", "unavailable")
            .put("status", "failed").put("digestRecoveryState", "needs_user")
        assertFalse(MaterialProcessingPolicy.digestNeedsHelp(material))
        assertFalse(MaterialProcessingPolicy.ocrNeedsHelp(material))
        assertTrue(MaterialProcessingPolicy.awaitingAutomaticRecovery(material))
    }

    @Test fun onlyAttributionConflictNeedsUserHelp() {
        val material = JSONObject().put("fileName", "page.jpg")
            .put("status", "failed").put("errorCode", "student_scope_mismatch")
        assertTrue(MaterialProcessingPolicy.digestNeedsHelp(material))
        assertFalse(MaterialProcessingPolicy.awaitingAutomaticRecovery(material))
    }

    @Test fun digestInputKeepsBothMachineObservedSources() {
        val input = MaterialProcessingPolicy.digestInput(JSONObject().put("text", "识别文字").put("visionSummary", "图表说明"))
        assertTrue(input.contains("识别文字"))
        assertTrue(input.contains("图表说明"))
    }

    @Test fun completedLegacyArtifactOverridesStaleDigestFlag() {
        val material = JSONObject().put("fileName", "page.jpg").put("ocrStatus", "completed")
            .put("digestReady", false).put("ocrMarkdownPath", ".edu-manager/ocr/page.md")
        assertTrue(MaterialProcessingPolicy.digestReady(material))
    }

    @Test fun recoveredMarkdownProvidesDigestInputWithoutRepeatingOcr() {
        val markdown = "# page OCR 结果\n\n## 识别文字\n\n第一行\n第二行\n\n## 视觉理解\n\n图中有表格\n"
        val input = MaterialProcessingPolicy.recoveredOcrInput("", markdown)
        assertTrue(input.contains("第一行"))
        assertTrue(input.contains("图中有表格"))
    }
}
