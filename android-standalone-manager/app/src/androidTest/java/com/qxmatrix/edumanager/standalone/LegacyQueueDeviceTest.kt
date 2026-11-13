package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.provider.DocumentsContract
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class LegacyQueueDeviceTest {
    @Test fun blockedLegacyQueueRescuesLocalTaskExactlyOnce() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assumeTrue(BuildConfig.FAULT_HARNESS && context.packageName.endsWith(".faulttest"))
        val root = DocumentsContract.buildTreeDocumentUri("${context.packageName}.faultdocuments", "root")
        val student = StudentRecord.create("r26合成队列学生", "", "", "", "standard", root.toString())
        val store = SafWorkspaceStore(context, root)
        listOf(student.paths.rootPath, student.paths.rawPath, student.paths.summaryPath, "${student.paths.summaryPath}/摘要库", student.paths.outputPath).forEach(store::ensureDirectory)
        store.writeBytesSafely(student.paths.agentPath, "Synthetic only".toByteArray(), "text/markdown")
        store.writeBytesSafely("${student.paths.summaryPath}/index.md", "# Synthetic\n".toByteArray(), "text/markdown")
        store.writeBytesSafely("${student.paths.summaryPath}/log.md", "# Synthetic\n".toByteArray(), "text/markdown")
        PrivateStateStore(context).writeBytes("students.json", JSONArray().put(student.toJson()).toString().toByteArray())
        val mat = FileAssetService(context).importValidatedBytes(student.id, "queue-synthetic.txt", "synthetic queue material".toByteArray(), "text/plain", "r26-fixture", sourceEventId = "r26-${UUID.randomUUID()}").getJSONObject("material")
        val id = "automation-fixture-${UUID.randomUUID()}"
        val input = JSONObject().put("studentId", student.id).put("actionType", "classify_material")
            .put("sourceFingerprint", "synthetic-queue").put("sourceIds", JSONArray().put(mat.getString("id")))
        val repo = TaskRepository(context)
        val task = repo.createOrGet(JSONObject().put("id", id).put("kind", "automation_classify_material")
            .put("sourceType", "student").put("sourceId", student.id).put("status", "queued")
            .put("idempotencyKey", id).put("maxAttempts", 4).put("input", input))
        val manager = WorkManager.getInstance(context)
        val blocker = OneTimeWorkRequestBuilder<AutomationActionWorker>()
            .setInputData(workDataOf("taskId" to "unrelated-blocker"))
            .setConstraints(Constraints.Builder().setRequiresDeviceIdle(true).build()).build()
        val local = OneTimeWorkRequestBuilder<AutomationActionWorker>().setInputData(workDataOf("taskId" to id))
            .addTag("automation-task:$id").build()
        val legacy = BackgroundWorkPolicy.uniqueName("automation-action", student.id)
        try {
            manager.beginUniqueWork(legacy, ExistingWorkPolicy.KEEP, blocker).then(local).enqueue().result.get(15, TimeUnit.SECONDS)
            assertTrue("local should be rescued", AutomationOrchestrator.ensureScheduled(context, task))
            val deadline = System.currentTimeMillis() + 45000
            while (System.currentTimeMillis() < deadline && repo.requireExact(id).optString("status") == "queued") Thread.sleep(250)
            while (System.currentTimeMillis() < deadline && repo.requireExact(id).optString("status") == "running") Thread.sleep(250)
            val finalTask = repo.requireExact(id)
            assertEquals(finalTask.toString(), "succeeded", finalTask.optString("status"))
            assertEquals(1, finalTask.optInt("attempt"))
            assertTrue(manager.getWorkInfosForUniqueWork(legacy).get().any { !it.state.isFinished })
            assertFalse("rescheduled task must not execute again", AutomationOrchestrator.ensureScheduled(context, finalTask))
        } finally { manager.cancelUniqueWork(legacy).result.get(15, TimeUnit.SECONDS) }
    }
}
