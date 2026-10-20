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
class UnknownOutcomeRecoveryRoomTest {
    @Test fun scopedCasAuthorizationPersistsAuditAndCannotBeRepeated() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(Callable {
            val recovery = UnknownOutcomeRecovery(context, db) { require(it in setOf("a", "b")) }
            val payload = JSONObject().put("state", "unknown")
            db.tasks().metadata(BusinessMetadataEntity("digest-request:a:hash", payload.toString()))
            assertTrue(recovery.pending("b").isEmpty())
            assertEquals(1, recovery.pending("a").size)
            assertThrows(IllegalArgumentException::class.java) { recovery.authorize("a", "digest-request:a:hash", "stale", "已核对账单") }
            recovery.authorize("a", "digest-request:a:hash", ScopedContentPolicy.fingerprint(payload), "已核对账单和文件，允许手动重试")
            assertEquals("authorized_retry", JSONObject(db.tasks().metadata("digest-request:a:hash")!!).getString("state"))
            assertEquals(1, db.tasks().metadataPrefix("recovery-audit:a:", "recovery-audit:a:\uffff").size)
            assertTrue(recovery.pending("a").isEmpty())
            assertThrows(IllegalArgumentException::class.java) { recovery.authorize("a", "digest-request:a:hash", ScopedContentPolicy.fingerprint(payload), "已核对账单") }
            Unit
        }).get() } finally { db.close(); executor.shutdownNow() }
    }
}
