package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Callable
import java.util.concurrent.Executors

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class TaskLedgerRoomTest {
    private fun task(id: String, student: String = "student-a") = TaskProtocol.envelope(JSONObject().put("id", id)
        .put("kind", "student_digest").put("sourceType", "student").put("sourceId", student)
        .put("input", JSONObject().put("studentId", student)))
    private fun <T> database(block: (Context, BusinessDatabase) -> T): T {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        return try { executor.submit(Callable { block(context, db) }).get() } finally { db.close(); executor.shutdownNow() }
    }
    @Test fun importsOncePreservesLegacyAndDoesNotReimportStaleJson() = database { context, db ->
        val state = PrivateStateStore(context)
        val original = JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray().put(task("old-1"))).put("history", JSONArray().put("old-history")).toString().toByteArray()
        state.writeBytes(RoomTaskLedgerStore.TASKS, original)
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        assertEquals("old-1", repo.list().single().getString("id"))
        repo.create(task("new-2"))
        assertArrayEquals(original, state.readBytes(RoomTaskLedgerStore.TASKS))
        state.writeBytes(RoomTaskLedgerStore.TASKS, "corrupted-after-migration".toByteArray())
        assertEquals(2, repo.list().size)
        assertNotNull(db.tasks().metadata(RoomTaskLedgerStore.MIGRATION_KEY))
    }
    @Test fun corruptJsonCannotBecomeEmptyWritableState() = database { context, db ->
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS, "{broken".toByteArray())
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        assertThrows(Exception::class.java) { repo.create(task("should-not-exist")) }
        assertTrue(db.tasks().all().isEmpty())
        assertNull(db.tasks().metadata(RoomTaskLedgerStore.MIGRATION_KEY))
    }
    @Test fun rowAndEventRollbackTogether() = database { context, db ->
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS,
            JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray()).toString().toByteArray())
        val actual = RoomTaskLedgerStore(context, db)
        val failing = object : TaskLedgerStore by actual {
            override fun event(event: JSONObject) { error("injected event failure") }
        }
        assertThrows(IllegalStateException::class.java) { TaskRepository(failing).create(task("atomic-task")) }
        assertTrue(db.tasks().all().isEmpty()); assertTrue(db.tasks().events().isEmpty())
    }
    @Test fun exactScopeCancellationAndLateResultAreEnforced() = database { context, db ->
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS,
            JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray()).toString().toByteArray())
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        repo.create(task("a")); repo.create(task("b", "student-b"))
        val conversation = task("conversation-a").put("sourceType", "conversation").put("sourceId", "record-1")
        repo.create(conversation)
        assertEquals(setOf("a", "conversation-a"), repo.listForStudent("student-a", emptyList()).map { it.getString("id") }.toSet())
        assertThrows(IllegalArgumentException::class.java) { repo.cancelQueued("b", "student-a") }
        repo.cancelQueued("a", "student-a")
        val running = repo.start("b")
        assertThrows(IllegalArgumentException::class.java) { repo.start("b") }
        val stale = JSONObject().put("protocolVersion", "1.2").put("taskId", "b").put("executionId", "old-execution").put("validation", JSONObject().put("passed", true))
        assertThrows(IllegalArgumentException::class.java) { repo.acceptResult("b", stale) }
        assertEquals("running", repo.requireExact("b").getString("status"))
        repo.acceptResult("b", stale.put("executionId", running.getString("executionId")))
        assertEquals("succeeded", repo.requireExact("b").getString("status"))
        assertFalse(repo.hasActiveForStudent("student-b", emptyList()))
    }
    @Test fun interruptedImportedRunBecomesNeedsUserNotAutomaticRetry() = database { context, db ->
        val old = task("interrupted").put("status", "running").put("executionId", "old")
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS,
            JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray().put(old)).toString().toByteArray())
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        val recovered = repo.list().single()
        assertEquals("failed", TaskCenterPolicy.viewState(recovered)); assertFalse(recovered.getBoolean("autoRetry"))
        val eventCount = db.tasks().events().size
        repo.list(); assertEquals(eventCount, db.tasks().events().size)
    }
    @Test fun automationBusinessKeysAreIdempotentAndConflictsDoNotOverwrite() = database { context, db ->
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS,
            JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray()).toString().toByteArray())
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        fun input(source: String) = JSONObject().put("id", "automation-stable").put("kind", "automation_validate_facts")
            .put("sourceType", "student").put("sourceId", "student-a").put("status", "queued")
            .put("idempotencyKey", "stable-key").put("input", JSONObject().put("studentId", "student-a").put("sourceFingerprint", source))
        assertEquals("automation-stable", repo.createOrGet(input("source-a")).getString("id"))
        assertEquals("automation-stable", repo.createOrGet(input("source-a")).getString("id"))
        assertEquals(1, repo.list().size)
        assertThrows(IllegalArgumentException::class.java) { repo.createOrGet(input("source-b")) }
        assertEquals("source-a", repo.list().single().getJSONObject("input").getString("sourceFingerprint"))
    }
    @Test fun interruptedAutomationWaitsForReceiptProbeInsteadOfBlindRetry() = database { context, db ->
        val old = task("automation-interrupted").put("kind", "automation_generate_learning_outputs")
            .put("status", "running").put("executionId", "old")
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS,
            JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray().put(old)).toString().toByteArray())
        val recovered = TaskRepository(RoomTaskLedgerStore(context, db)).list().single()
        assertEquals("waiting_result", recovered.getString("status"))
        assertEquals("execution_unknown", recovered.getJSONObject("error").getString("classification"))
        assertFalse(recovered.getBoolean("autoRetry"))
        assertEquals(AutomationReconciliationDecision.PROBE_UNKNOWN, AutomationReconciliationPolicy.decide(recovered))
    }
}
