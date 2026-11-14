package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.Executors

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class BusinessDatabaseBackupTest {
    @Test fun legacyV2SnapshotRestoresWithoutRequiringNewContentTable() {
        val source = isolated(); val target = isolated()
        val sourceDb = Room.inMemoryDatabaseBuilder(source, BusinessDatabase::class.java).build()
        val targetDb = Room.inMemoryDatabaseBuilder(target, BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(Callable {
            val snapshot = JSONObject(BusinessDatabaseBackup(source, sourceDb).exportBytes().toString(Charsets.UTF_8))
            snapshot.put("schema", "edu-manager.business-database-snapshot.v2").put("databaseVersion", 2)
            snapshot.getJSONObject("tables").remove("scoped_content")
            val stage = File(target.cacheDir, "legacy-stage-${java.util.UUID.randomUUID()}").apply { mkdirs() }
            File(stage, BusinessDatabaseBackup.SNAPSHOT_PATH).apply { parentFile!!.mkdirs(); writeText(snapshot.toString()) }
            File(stage, "students.json").writeText("[]")
            BusinessDatabaseBackup(target, targetDb).restoreStaged(stage) {
                stage.walkTopDown().filter(File::isFile).forEach { PrivateStateStore(target).writeBytes(it.relativeTo(stage).invariantSeparatorsPath, it.readBytes()) }
            }
            assertTrue(targetDb.content().list("student-a", listOf("artifact"), 10, 0).isEmpty())
            assertNotNull(targetDb.tasks().metadata(RoomTaskLedgerStore.MIGRATION_KEY))
        }).get() } finally { sourceDb.close(); targetDb.close(); executor.shutdownNow() }
    }
    private fun isolated(): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val files = File(base.cacheDir, "business-test-${java.util.UUID.randomUUID()}").apply { mkdirs() }
        return object : ContextWrapper(base) {
            override fun getFilesDir() = files
            override fun getApplicationContext(): Context = this
        }
    }
    @Test fun logicalSnapshotPreservesNullableUsageAndRejectsReplacingExistingRecords() {
        val source = isolated(); val target = isolated()
        val sourceDb = Room.inMemoryDatabaseBuilder(source, BusinessDatabase::class.java).build()
        val targetDb = Room.inMemoryDatabaseBuilder(target, BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(Callable {
            val repo = TaskRepository(RoomTaskLedgerStore(source, sourceDb))
            repo.create(TaskProtocol.envelope(JSONObject().put("id", "task-a").put("sourceType", "student").put("sourceId", "student-a")))
            sourceDb.ledger().recordCall(ModelCallEntity("call-a", "student-a", "task-a", "provider", "model", "example.com", "v1", "v1", 1, 10,
                "succeeded", "req", null, null, null, "", "source", "cn", "disabled", false, 0))
            sourceDb.tasks().metadata(BusinessMetadataEntity("restore-operation", "previous-device-operation"))
            sourceDb.tasks().metadata(BusinessMetadataEntity("digest-stage:student-a:exec-a",
                JSONObject().put("state", "prepared").put("allowAutoNoDispatch", true).toString()))
            val versionPayload = JSONObject().put("module", "cards").put("result", JSONObject()).put("historicalPath", "old-device/path")
            sourceDb.content().insert(ScopedContentEntity("version-a", "student-a", "artifact", "source-key", "version", "", "", "", ScopedContentPolicy.fingerprint(versionPayload), "", "candidate", "today", "today", versionPayload.toString()))
            val bytes = BusinessDatabaseBackup(source, sourceDb).exportBytes()
            val stage = File(target.cacheDir, "stage-${java.util.UUID.randomUUID()}").apply { mkdirs() }
            File(stage, BusinessDatabaseBackup.SNAPSHOT_PATH).apply { parentFile!!.mkdirs(); writeBytes(bytes) }
            BusinessDatabaseBackup.remapSnapshot(File(stage, BusinessDatabaseBackup.SNAPSHOT_PATH)) { value ->
                if (value is JSONObject && value.has("historicalPath")) value.put("historicalPath", "new-device/path")
                value
            }
            File(stage, "students.json").writeText(JSONArray().put(JSONObject().put("id", "student-a")).toString())
            BusinessDatabaseBackup(target, targetDb).restoreStaged(stage) {
                stage.walkTopDown().filter(File::isFile).forEach { PrivateStateStore(target).writeBytes(it.relativeTo(stage).invariantSeparatorsPath, it.readBytes()) }
            }
            assertEquals("task-a", targetDb.tasks().all().single().id)
            assertFalse(JSONObject(targetDb.tasks().metadata("digest-stage:student-a:exec-a")!!).getBoolean("allowAutoNoDispatch"))
            assertNull(targetDb.ledger().calls("student-a").single().totalTokens)
            assertEquals(versionPayload.toString(), targetDb.content().exact("student-a", "version-a")!!.payload)
            assertFalse(BusinessRestoreRecovery.pending(target))
            assertThrows(IllegalArgumentException::class.java) { BusinessDatabaseBackup(target, targetDb).restoreStaged(stage) {} }
            assertEquals("task-a", targetDb.tasks().all().single().id)
        }).get() } finally { sourceDb.close(); targetDb.close(); executor.shutdownNow() }
    }
    @Test fun failedRestoreRollsBackDbPrivateFilesAndSettings() {
        val context = isolated(); val db = Room.inMemoryDatabaseBuilder(context, BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(Callable {
            val state = PrivateStateStore(context); state.writeBytes("original.json", "original".toByteArray())
            val stage = File(context.cacheDir, "rollback-stage-${java.util.UUID.randomUUID()}").apply { mkdirs() }
            File(stage, "original.json").writeText("changed"); File(stage, "new.json").writeText("new")
            assertThrows(IllegalStateException::class.java) {
                BusinessDatabaseBackup(context, db).restoreStaged(stage) {
                    state.writeBytes("original.json", "changed".toByteArray()); state.writeBytes("new.json", "new".toByteArray())
                    db.tasks().metadata(BusinessMetadataEntity("not-committed", "value")); error("injected restore failure")
                }
            }
            assertEquals("original", state.readBytes("original.json").toString(Charsets.UTF_8))
            assertNull(state.readIfPresent("new.json")); assertNull(db.tasks().metadata("not-committed"))
            assertFalse(BusinessRestoreRecovery.pending(context))
        }).get() } finally { db.close(); executor.shutdownNow() }
    }
    @Test fun pendingUncommittedCheckpointIsRecoveredIdempotently() {
        val context = isolated(); val db = Room.inMemoryDatabaseBuilder(context, BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(Callable {
            val state = PrivateStateStore(context)
            state.writeBytes("original.json", "partially-restored".toByteArray())
            state.writeBytes("business-restore/rollback/interrupted/original.json", "before".toByteArray())
            val agent = JSONObject().put("endpoint", "").put("model", "").put("visionModel", "").put("encryptedCredential", "")
            val journal = JSONObject().put("id", "interrupted").put("phase", "applying")
                .put("previous", JSONArray(listOf("original.json"))).put("planned", JSONArray(listOf("original.json")))
                .put("preferences", JSONObject().put("root", "").put("skin", UiPreferences(context).skin().wireValue)
                    .put("layout", UiPreferences(context).layoutMode().wireValue).put("agent", agent))
            state.writeBytes("business-restore/journal.json", journal.toString().toByteArray())
            BusinessRestoreRecovery.recover(context, db); BusinessRestoreRecovery.recover(context, db)
            assertEquals("before", state.readBytes("original.json").toString(Charsets.UTF_8))
            assertFalse(BusinessRestoreRecovery.pending(context))
        }).get() } finally { db.close(); executor.shutdownNow() }
    }
    @Test fun committedDatabaseFinalizesJournalWithoutUndoingPrivateState() {
        val context = isolated(); val db = Room.inMemoryDatabaseBuilder(context, BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(Callable {
            val state = PrivateStateStore(context)
            state.writeBytes("original.json", "after-commit".toByteArray())
            state.writeBytes("business-restore/journal.json", JSONObject().put("id", "committed-operation").put("phase", "applying").toString().toByteArray())
            db.tasks().metadata(BusinessMetadataEntity("restore-operation", "committed-operation"))
            BusinessRestoreRecovery.recover(context, db)
            assertEquals("after-commit", state.readBytes("original.json").toString(Charsets.UTF_8))
            assertFalse(BusinessRestoreRecovery.pending(context))
        }).get() } finally { db.close(); executor.shutdownNow() }
    }
}
