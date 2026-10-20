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
class RoomConversationStoreTest {
    @Test fun registryMigrationStatusAndTombstonesSurviveProjectionFailure() {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(Callable {
            val store = RoomConversationStore(db) { ids -> require(ids.all { it == "a" }) }
            val record = JSONObject().put("recordId", "record").put("studentId", "a").put("contentPath", "raw/conversation.md")
                .put("contentHash", "hash").put("importedAt", "today").put("lifecycleStatus", "active")
            val legacy = JSONObject().put("imports", JSONArray().put(record)).put("deletions", JSONArray()).put("schema", "v2")
            val first = store.read { legacy }; assertEquals(1, first.getJSONArray("imports").length())
            store.read { error("never read damaged legacy again") }
            record.put("lifecycleStatus", "trashed"); store.write(legacy)
            assertEquals("trashed", store.read { error("unused") }.getJSONArray("imports").getJSONObject(0).getString("lifecycleStatus"))
            legacy.put("imports", JSONArray()).getJSONArray("deletions").put(JSONObject().put("recordId", "record"))
            store.write(legacy); val deleted = store.read { error("unused") }
            assertEquals(0, deleted.getJSONArray("imports").length()); assertEquals(1, deleted.getJSONArray("deletions").length())
            assertEquals("pending", db.tasks().metadata("conversation-projection"))
            assertThrows(IllegalArgumentException::class.java) { store.write(JSONObject(legacy.toString()).put("imports", JSONArray().put(JSONObject(record.toString()).put("studentId", "b")))) }
            Unit
        }).get() } finally { db.close(); executor.shutdownNow() }
    }
}
