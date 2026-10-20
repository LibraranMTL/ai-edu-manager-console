package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
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
class RoomMaterialStoreTest {
    private fun <T> database(action: (BusinessDatabase) -> T): T {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        return try { executor.submit(Callable { action(db) }).get() } finally { db.close(); executor.shutdownNow() }
    }
    private fun record(student: String = "a") = JSONObject().put("id", "one").put("studentId", student).put("fileName", "原件.txt").put("status", "pending_digest").put("absolutePath", "raw/original.txt")
    @Test fun strictMigrationIsAtomicOnceAndRoomSurvivesLostProjection() = database { db ->
        val store = RoomMaterialStore(db, "a")
        assertThrows(IllegalArgumentException::class.java) { store.migrate { listOf(record(), record("b")) } }
        assertTrue(store.list().isEmpty())
        store.migrate { listOf(record()) }
        store.migrate { error("legacy damaged, must not re-read") }
        store.change { it.single().put("status", "processed") }
        assertEquals("processed", store.list().single().getString("status"))
        assertEquals("pending", db.tasks().metadata("material-projection:a"))
        store.projectionComplete(); assertEquals("completed", db.tasks().metadata("material-projection:a"))
        assertTrue(RoomMaterialStore(db, "b").list().isEmpty())
    }
    @Test fun mutationRollbackKeepsOldStatusAndOriginalPath() = database { db ->
        val store = RoomMaterialStore(db, "a"); store.migrate { listOf(record()) }
        assertThrows(IllegalStateException::class.java) { store.change { it.single().put("status", "processed"); error("injected") } }
        assertEquals("pending_digest", store.list().single().getString("status"))
        assertEquals("raw/original.txt", store.list().single().getString("absolutePath"))
        Unit
    }
}
