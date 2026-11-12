package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.provider.DocumentsContract
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.net.ServerSocket
import java.util.UUID
import kotlin.concurrent.thread

/** The host runs each phase separately; abort phases intentionally kill this isolated app process. */
@RunWith(AndroidJUnit4::class)
class FaultRecoveryInstrumentationTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val prefs by lazy { context.getSharedPreferences("fault-harness", Context.MODE_PRIVATE) }
    private val root by lazy { DocumentsContract.buildTreeDocumentUri("${context.packageName}.faultdocuments", "root") }
    private val sample = "Synthetic study: draw a diagram and label axes."

    @Test fun phase() {
        assumeTrue(BuildConfig.FAULT_HARNESS && context.packageName.endsWith(".faulttest"))
        when (InstrumentationRegistry.getArguments().getString("phase", "")) {
            "bootstrap" -> bootstrap()
            "import_abort" -> importAbort()
            "import_verify" -> importVerify()
            "digest_checkpoint_abort" -> digestAbort("digest_checkpoint")
            "knowledge_registered_abort" -> digestAbort("knowledge_registered")
            "digest_verify" -> digestVerify()
            "digest_repair" -> digestRepair()
            "report_setup" -> reportSetup()
            "report_abort" -> reportAbort()
            "report_verify" -> reportVerify()
            else -> error("Unknown fault-test phase")
        }
    }
    private fun student() = StudentIndexRepository(context).requireExact(prefs.getString("studentId", "")!!)
    private fun bootstrap() {
        check(StudentIndexRepository(context).list().isEmpty()) { "Fixture already exists; no data is overwritten" }
        val a = StudentRecord.create("合成测试甲", "", "", "", "standard", root.toString())
        val b = StudentRecord.create("合成测试乙", "", "", "", "standard", root.toString())
        val store = SafWorkspaceStore(context, root)
        listOf(a, b).forEach { s ->
            listOf(s.paths.rootPath, s.paths.rawPath, s.paths.summaryPath, "${s.paths.summaryPath}/摘要库", s.paths.outputPath).forEach(store::ensureDirectory)
            store.writeBytesSafely(s.paths.agentPath, "Only synthetic evidence.".toByteArray(), "text/markdown")
            store.writeBytesSafely("${s.paths.summaryPath}/index.md", "# Synthetic index\n".toByteArray(), "text/markdown")
            store.writeBytesSafely("${s.paths.summaryPath}/log.md", "# Synthetic log\n".toByteArray(), "text/markdown")
        }
        PrivateStateStore(context).writeBytes("students.json", JSONArray().put(a.toJson()).put(b.toJson()).toString().toByteArray())
        GrowthModelService(context).ensure(a.id); GrowthModelService(context).ensure(b.id)
        check(prefs.edit().putString("studentId", a.id).putString("otherStudentId", b.id).commit())
        assertTrue(FileAssetService(context).materials(b.id).isEmpty())
    }
    private fun importSynthetic(event: String): JSONObject = FileAssetService(context).importValidatedBytes(
        student().id, "$event.txt", sample.toByteArray(), "text/plain", "synthetic-fault-test", sourceEventId = event)
    private fun arm(boundary: String) { check(prefs.edit().putString("stopAt", boundary).remove("reached").commit()) }
    private fun importAbort() { arm("import_committed"); importSynthetic("fault-import"); error("Expected process termination") }
    private fun importVerify() {
        assertEquals("import_committed", prefs.getString("reached", ""))
        val imported = importSynthetic("fault-import")
        assertTrue(imported.getBoolean("reused"))
        assertEquals(1, FileAssetService(context).materials(student().id).count { it.optString("sourceName") == "synthetic-fault-test" })
    }
    private fun digestAbort(boundary: String) {
        val material = importSynthetic("material-$boundary-v2").getJSONObject("material")
        val id = material.getString("id")
        val server = mockModel(id)
        AgentConfigurationStore(context).save("http://127.0.0.1:${server.localPort}/v1", "synthetic-fault-model", "synthetic-key")
        val taskId = "automation-fixture-${UUID.randomUUID()}"
        val task = TaskRepository(context).createOrGet(JSONObject().put("id", taskId).put("kind", "automation_digest_material")
            .put("sourceType", "student").put("sourceId", student().id).put("status", "queued")
            .put("idempotencyKey", taskId)
            .put("input", JSONObject().put("studentId", student().id).put("actionType", "digest_material")
                .put("sourceFingerprint", boundary).put("sourceIds", JSONArray().put(id))))
        val running = TaskRepository(context).start(task.getString("id"))
        check(prefs.edit().putString("materialId", id).putString("parentTask", taskId).commit())
        arm(boundary)
        StudentDigestOrchestrator(context).digestSelected(student().id, setOf(id), false, taskId, running.getString("executionId"))
        error("Expected process termination")
    }
    private fun digestVerify() {
        val expected = InstrumentationRegistry.getArguments().getString("expected", "")
        assertTrue(expected.isNotBlank())
        assertEquals(expected, prefs.getString("reached", ""))
        val id = prefs.getString("materialId", "")!!
        val summary = DigestBatchRecovery(context).recover(student().id)
        assertEquals(summary.toString(), 0, summary.optInt("needsAttention"))
        val material = FileAssetService(context).materials(student().id).single { it.getString("id") == id }
        assertEquals("processed", material.getString("status"))
        val parent = TaskRepository(context).requireExact(prefs.getString("parentTask", "")!!)
        val proof = requireNotNull(DigestBatchRecovery(context).receiptForTask(parent))
        TaskRepository(context).recoverInternal(parent.getString("id"), proof)
        assertTrue(FileAssetService(context).materials(prefs.getString("otherStudentId", "")!!).isEmpty())
    }
    private fun digestRepair() {
        val summary = DigestBatchRecovery(context).recover(student().id)
        assertEquals(summary.toString(), 0, summary.optInt("needsAttention"))
        val material = FileAssetService(context).materials(student().id).single { it.getString("id") == prefs.getString("materialId", "") }
        assertEquals("processed", material.getString("status"))
        val parent = TaskRepository(context).requireExact(prefs.getString("parentTask", "")!!)
        TaskRepository(context).recoverInternal(parent.getString("id"), requireNotNull(DigestBatchRecovery(context).receiptForTask(parent)))
    }
    private fun reportSetup() {
        val growth = GrowthModelService(context)
        val candidate = growth.candidates(student().id).first { it.optString("sourceUri").isNotBlank() }
        growth.reviewCandidate(student().id, candidate.getString("id"), "confirmed", "Synthetic test fixture")
        AgentConfigurationStore(context).clear()
        val result = growth.generateAndPublishReports(student().id)
        assertEquals("published", result.getString("status"))
        val path = "${student().paths.summaryPath}/学情报告/active-report-set.json"
        val before = FileAssetService(context).readLogicalBytes(student().id, path)
        check(prefs.edit().putString("reportBefore", before.toString(Charsets.UTF_8))
            .putString("reportBeforeSha256", ScopedContentPolicy.hash(before)).commit())
    }
    private fun reportAbort() { arm("report_before_activation"); GrowthModelService(context).generateAndPublishReports(student().id); error("Expected process termination") }
    private fun reportVerify() {
        assertEquals("report_before_activation", prefs.getString("reached", ""))
        val path = "${student().paths.summaryPath}/学情报告/active-report-set.json"
        val currentBytes = FileAssetService(context).readLogicalBytes(student().id, path)
        val beforeHash = prefs.getString("reportBeforeSha256", "").orEmpty()
        if (beforeHash.isNotBlank()) assertEquals(beforeHash, ScopedContentPolicy.hash(currentBytes))
        else assertEquals(JSONObject(prefs.getString("reportBefore", "")!!).toString(), JSONObject(currentBytes.toString(Charsets.UTF_8)).toString())
        assertEquals("published", GrowthModelService(context).generateAndPublishReports(student().id).getString("status"))
        val pointer = JSONObject(FileAssetService(context).readLogicalBytes(student().id, path).toString(Charsets.UTF_8))
        assertEquals(4, pointer.getJSONArray("items").length())
        GrowthModelService.REPORTS.forEach { definition ->
            val entry = LearningReportPublicationPolicy.requireEntry(pointer, student().id, definition.id)
            val bytes = FileAssetService(context).readLogicalBytes(student().id, entry.getString("path"))
            assertEquals(entry.getString("sha256"), ScopedContentPolicy.hash(bytes))
        }
    }
    private fun mockModel(id: String): ServerSocket {
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            server.accept().use { socket ->
                val input = socket.getInputStream(); val header = StringBuilder(); var suffix = ""
                while (!suffix.endsWith("\r\n\r\n")) { val c = input.read(); if (c < 0) break; header.append(c.toChar()); suffix = (suffix + c.toChar()).takeLast(4) }
                val length = Regex("(?i)content-length:\\s*(\\d+)").find(header)?.groupValues?.get(1)?.toInt() ?: 0
                repeat(length) { input.read() }
                val evidence = JSONObject().put("sourceMaterialId", id).put("excerpt", "draw a diagram")
                val result = JSONObject().put("summary", "Synthetic summary").put("concepts", JSONArray()).put("entities", JSONArray())
                    .put("claims", JSONArray().put(JSONObject(evidence.toString()).put("predicate", "diagram").put("value", "draw a diagram")))
                    .put("growthEvidence", JSONArray().put(JSONObject(evidence.toString()).put("title", "Synthetic observation")
                        .put("ability", "表达").put("observation", "draw a diagram").put("confidence", "medium")))
                val body = JSONObject().put("choices", JSONArray().put(JSONObject().put("finish_reason", "stop")
                    .put("message", JSONObject().put("content", result.toString())))).toString().toByteArray()
                socket.getOutputStream().apply { write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(body); flush() }
            }
            server.close()
        }
        return server
    }
}
