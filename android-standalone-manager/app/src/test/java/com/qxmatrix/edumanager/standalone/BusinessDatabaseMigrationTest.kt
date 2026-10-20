package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Executors

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class BusinessDatabaseMigrationTest {
    @Test fun realRoomMigrationPreservesV1RowsAndValidatesV3Schema() = migrate(1)
    @Test fun realRoomMigrationPreservesV2RowsAndAddsContentWithoutDestructiveReset() = migrate(2)
    private fun migrate(version: Int) {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val name = "migration-test-${java.util.UUID.randomUUID()}.db"
        // SQLite4java on Windows has a MAX_PATH limitation, unlike the Android target filesystem.
        val path = java.io.File.createTempFile("edu-migration-", ".db")
        val context = object : ContextWrapper(base) {
            override fun getApplicationContext(): Context = this
            override fun getDatabasePath(databaseName: String) = if (databaseName == name) path else super.getDatabasePath(databaseName)
        }
        val schema = JSONObject(requireNotNull(javaClass.classLoader!!.getResourceAsStream("com.qxmatrix.edumanager.standalone.BusinessDatabase/$version.json"))
            .bufferedReader().use { it.readText() }).getJSONObject("database")
        SQLiteDatabase.openOrCreateDatabase(path, null).use { old ->
            val entities = schema.getJSONArray("entities")
            for (index in 0 until entities.length()) {
                val entity = entities.getJSONObject(index); val table = entity.getString("tableName")
                old.execSQL(entity.getString("createSql").replace("${'$'}{TABLE_NAME}", table))
                val indices = entity.getJSONArray("indices")
                for (i in 0 until indices.length()) old.execSQL(indices.getJSONObject(i).getString("createSql").replace("${'$'}{TABLE_NAME}", table))
            }
            old.execSQL("INSERT INTO file_operation_intents VALUES ('intent-1','student-a','move','a','b','hash','prepared',1,1)")
            if (version == 2) old.execSQL("INSERT INTO business_metadata VALUES ('old-v2', 'retained-v2')")
            old.version = version
        }
        val db = Room.databaseBuilder(context, BusinessDatabase::class.java, name).addMigrations(BusinessDatabase.MIGRATION_1_2, BusinessDatabase.MIGRATION_2_3).build()
        val executor = Executors.newSingleThreadExecutor()
        try {
            executor.submit {
                assertEquals("intent-1", db.ledger().pendingIntents("student-a").single().operationId)
                assertTrue(db.tasks().all().isEmpty()) // Forces Room's migration and schema validation.
                assertTrue(db.content().list("student-a", listOf("artifact"), 10, 0).isEmpty())
                if (version == 2) assertEquals("retained-v2", db.tasks().metadata("old-v2"))
                db.tasks().metadata(BusinessMetadataEntity("test", "retained"))
            }.get()
        } finally { db.close(); executor.shutdownNow(); path.delete(); java.io.File(path.path + "-wal").delete(); java.io.File(path.path + "-shm").delete() }
    }
}
