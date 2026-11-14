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
    @Test fun supersededDigestRetainsFailureAndExactReplacementReceipt() = database { context, db ->
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        repo.createOrGet(JSONObject().put("id", "old-digest").put("kind", "automation_digest_material")
            .put("sourceType", "student").put("sourceId", "student-a").put("status", "queued")
            .put("idempotencyKey", "old-digest-key").put("input", JSONObject().put("studentId", "student-a")))
        val run = repo.start("old-digest").getString("executionId")
        repo.failInternal("old-digest", JSONObject().put("message", "original failure").put("attentionRequired", true), executionId = run)
        val receipt = JSONObject().put("studentId", "student-a").put("replacementFingerprint", "verified-batch")
        assertThrows(IllegalArgumentException::class.java) { repo.supersedeFailedDigest("old-digest", "student-b", run, receipt) }
        assertThrows(IllegalArgumentException::class.java) { repo.supersedeFailedDigest("old-digest", "student-a", "wrong", receipt) }
        val archived = repo.supersedeFailedDigest("old-digest", "student-a", run, receipt)
        assertEquals("superseded", TaskCenterPolicy.viewState(archived))
        assertEquals("original failure", archived.getJSONObject("error").getString("message"))
        assertEquals("verified-batch", repo.requireExact("old-digest").getJSONObject("result").getJSONObject("supersededReceipt").getString("replacementFingerprint"))
        Unit
    }
    @Test fun interruptedProcessRecoversPersistedReceiptAndNeverReexecutes() = database { context, db ->
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS,
            JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray()).toString().toByteArray())
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        repo.createOrGet(JSONObject().put("id", "automation-fault-injection").put("kind", "automation_digest_material")
            .put("sourceType", "student").put("sourceId", "student-a").put("status", "queued")
            .put("idempotencyKey", "fault-key").put("input", JSONObject().put("studentId", "student-a")
                .put("sourceFingerprint", "synthetic-v1").put("sourceIds", JSONArray().put("material-a"))))
        val running = repo.start("automation-fault-injection")
        repo.recordInternalReceipt("automation-fault-injection", running.getString("executionId"), JSONObject().put("artifact", "synthetic-result"))
        val persisted = db.tasks().exact("automation-fault-injection")!!
        assertEquals(1, db.tasks().update(persisted.id, persisted.revision, persisted.status, persisted.updatedAt,
            "simulated-terminated-process", persisted.payload))
        val interrupted = repo.requireExact(persisted.id)
        assertEquals("waiting_result", interrupted.getString("status"))
        assertFalse(interrupted.getBoolean("autoRetry"))
        val proof = requireNotNull(AutomationReceiptPolicy.verifiedResult(interrupted))
        repo.recoverInternal(persisted.id, proof)
        assertEquals("succeeded", repo.requireExact(persisted.id).getString("status"))
        assertThrows(IllegalArgumentException::class.java) { repo.recoverInternal(persisted.id, proof) }
        assertEquals(1, repo.requireExact(persisted.id).getInt("attempt"))
        Unit
    }
    @Test fun anyModelCallBlocksNoDispatchProofEvenWhenFailed() = database { _, db ->
        val ledger = db.ledger()
        assertFalse(ledger.hasAnyCall("s1", "child-1"))
        ledger.recordCall(ModelCallEntity("call-1", "s1", "child-1", "local", "model", "host", "v1", "", 1L, 0L,
            "failed", "", null, null, null, "network", "old", "", "", false, 0))
        assertTrue(ledger.hasAnyCall("s1", "child-1"))
        assertFalse(ledger.hasAnyCall("s2", "child-1")); assertFalse(ledger.hasAnyCall("s1", "child-2"))
    }
    @Test fun provenUnsentRequeueRequiresTheSameExecutionAndHonorsAttemptLimit() = database { context, db ->
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS,
            JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray()).toString().toByteArray())
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        repo.createOrGet(JSONObject().put("id", "automation-unsent").put("kind", "automation_digest_material")
            .put("sourceType", "student").put("sourceId", "student-a").put("status", "queued").put("maxAttempts", 2)
            .put("input", JSONObject().put("studentId", "student-a")))
        val running = repo.start("automation-unsent")
        val execution = running.getString("executionId")
        repo.failInternal("automation-unsent", JSONObject().put("code", "interrupted"), resultUnknown = true, executionId = execution)
        assertThrows(IllegalArgumentException::class.java) { repo.requeueKnownNotDispatched("automation-unsent", "stale") }
        assertEquals("queued", repo.requeueKnownNotDispatched("automation-unsent", execution).getString("status"))
        assertEquals("queued", repo.requeueKnownNotDispatched("automation-unsent", execution).getString("status"))
        val second = repo.start("automation-unsent")
        repo.failInternal("automation-unsent", JSONObject(), resultUnknown = true, executionId = second.getString("executionId"))
        assertThrows(IllegalArgumentException::class.java) { repo.requeueKnownNotDispatched("automation-unsent", second.getString("executionId")) }
        Unit
    }
    @Test fun digestCompletionMetadataPagesStayWithinStudentScope() = database { _, db ->
        val dao = db.tasks()
        repeat(201) { index -> dao.metadata(BusinessMetadataEntity("digest-completion:s1:%04d".format(index), "{}")) }
        dao.metadata(BusinessMetadataEntity("digest-completion:s2:0000", "{}"))
        val prefix = "digest-completion:s1:"
        val first = dao.metadataPage(prefix, "", 100)
        val second = dao.metadataPage(prefix, first.last().name, 100)
        val last = dao.metadataPage(prefix, second.last().name, 100)
        assertEquals(listOf(100, 100, 1), listOf(first.size, second.size, last.size))
        assertTrue((first + second + last).all { it.name.startsWith(prefix) })
    }
    @Test fun taskPagesReachBeyondFiveHundredWithoutSkipping() = database { _, db ->
        val dao = db.tasks()
        repeat(1001) { index ->
            val id = "task-%04d".format(index)
            dao.insert(BusinessTaskEntity(id, "student-a", "", "failed", "", 0, "test", "{}"))
        }
        val first = dao.pageAfter("", 500)
        val second = dao.pageAfter(first.last().id, 500)
        val last = dao.pageAfter(second.last().id, 500)
        assertEquals(listOf(500, 500, 1), listOf(first.size, second.size, last.size))
        assertEquals(1001, (first + second + last).map { it.id }.toSet().size)
        assertEquals("task-1000", last.single().id)
    }
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
    @Test fun automationReceiptBindsExactExecutionAndSurvivesInterruptedStatus() = database { context, db ->
        PrivateStateStore(context).writeBytes(RoomTaskLedgerStore.TASKS,
            JSONObject().put("protocolVersion", "1.2").put("tasks", JSONArray()).toString().toByteArray())
        val repo = TaskRepository(RoomTaskLedgerStore(context, db))
        repo.createOrGet(JSONObject().put("id", "automation-receipt").put("kind", "automation_digest_material")
            .put("sourceType", "student").put("sourceId", "student-a").put("status", "queued")
            .put("idempotencyKey", "receipt-key").put("input", JSONObject().put("studentId", "student-a").put("sourceFingerprint", "v1")))
        val running = repo.start("automation-receipt")
        val execution = running.getString("executionId")
        assertThrows(IllegalArgumentException::class.java) { repo.recordInternalReceipt("automation-receipt", "stale", JSONObject()) }
        repo.recordInternalReceipt("automation-receipt", execution, JSONObject().put("artifact", "result-v1"))
        assertThrows(IllegalArgumentException::class.java) {
            repo.failInternal("automation-receipt", JSONObject(), executionId = "stale")
        }
        repo.failInternal("automation-receipt", JSONObject().put("code", "interrupted"), resultUnknown = true, executionId = execution)
        val waiting = repo.requireExact("automation-receipt")
        assertEquals("result-v1", AutomationReceiptPolicy.verifiedResult(waiting)?.getString("artifact"))
        val wrong = JSONObject(waiting.toString()).put("executionId", "another-execution")
        assertNull(AutomationReceiptPolicy.verifiedResult(wrong))
        wrong.put("executionId", execution).getJSONObject("input").put("studentId", "student-b")
        assertNull(AutomationReceiptPolicy.verifiedResult(wrong))
        assertThrows(IllegalArgumentException::class.java) {
            repo.recoverInternal("automation-receipt", JSONObject().put("recoveryTaskId", "automation-receipt")
                .put("recoveryExecutionId", "stale"))
        }
        repo.recoverInternal("automation-receipt", AutomationReceiptPolicy.verifiedResult(waiting)!!)
        assertEquals("succeeded", repo.requireExact("automation-receipt").getString("status"))
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
