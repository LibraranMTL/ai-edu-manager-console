package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/** New business ledger, independent of the existing collaboration database and JSON indexes. */
@Entity(tableName = "model_calls", indices = [Index(value = ["studentId", "startedAt"]), Index(value = ["state"])])
data class ModelCallEntity(
    @PrimaryKey val callId: String, val studentId: String, val taskId: String,
    val provider: String, val model: String, val endpointHost: String,
    val promptVersion: String, val schemaVersion: String, val startedAt: Long, val elapsedMs: Long,
    val state: String, val requestId: String, val inputTokens: Long?, val outputTokens: Long?, val totalTokens: Long?,
    val errorCode: String,
    val processSession: String,
    val region: String, val thinkingMode: String, val searchEnabled: Boolean, val sourceCount: Int,
)

@Entity(tableName = "file_operation_intents", indices = [Index(value = ["studentId", "state"])])
data class FileOperationIntentEntity(
    @PrimaryKey val operationId: String, val studentId: String, val kind: String,
    val sourceRef: String, val targetRef: String, val expectedSha256: String,
    val state: String, val createdAt: Long, val updatedAt: Long,
)

@Dao
interface BusinessLedgerDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun recordCall(call: ModelCallEntity)
    @Query("SELECT * FROM model_calls WHERE studentId = :studentId ORDER BY startedAt DESC LIMIT :limit")
    fun calls(studentId: String, limit: Int = 50): List<ModelCallEntity>
    @Query("UPDATE model_calls SET state = 'unknown', errorCode = 'process_interrupted' WHERE state = 'running' AND processSession != :session")
    fun recoverInterruptedCalls(session: String): Int
    @Query("SELECT EXISTS(SELECT 1 FROM model_calls WHERE studentId = :studentId AND taskId IN (:taskIds) AND state IN ('running','unknown'))")
    fun hasUnresolvedCall(studentId: String, taskIds: List<String>): Boolean
    @Query("SELECT EXISTS(SELECT 1 FROM model_calls WHERE studentId = :studentId AND taskId = :taskId AND state IN ('running','unknown','succeeded'))")
    fun hasPossibleResult(studentId: String, taskId: String): Boolean
    @Insert(onConflict = OnConflictStrategy.ABORT) fun prepareIntent(intent: FileOperationIntentEntity)
    @Query("UPDATE file_operation_intents SET state = :next, updatedAt = :now WHERE operationId = :id AND studentId = :studentId AND state = :expected")
    fun compareAndSetIntent(id: String, studentId: String, expected: String, next: String, now: Long): Int
    @Query("SELECT * FROM file_operation_intents WHERE studentId = :studentId AND state NOT IN ('committed', 'rolled_back') ORDER BY createdAt LIMIT 100")
    fun pendingIntents(studentId: String): List<FileOperationIntentEntity>
    @Query("SELECT * FROM file_operation_intents WHERE studentId = :studentId AND operationId = :id")
    fun exactIntent(studentId: String, id: String): FileOperationIntentEntity?
}

@Entity(tableName = "business_tasks", indices = [Index(value = ["studentId", "updatedAt"]), Index(value = ["projectId", "updatedAt"]), Index(value = ["status"])])
data class BusinessTaskEntity(@PrimaryKey val id: String, val studentId: String, val projectId: String,
    val status: String, val updatedAt: String, val revision: Long, val processSession: String, val payload: String)

@Entity(tableName = "task_events", indices = [Index(value = ["taskId", "at"])])
data class TaskEventEntity(@PrimaryKey val id: String, val taskId: String, val at: String, val payload: String)

@Entity(tableName = "business_metadata")
data class BusinessMetadataEntity(@PrimaryKey val name: String, val payload: String)

@Dao
interface BusinessTaskDao {
    @Query("SELECT * FROM business_tasks ORDER BY updatedAt DESC, id") fun all(): List<BusinessTaskEntity>
    @Query("SELECT * FROM business_tasks WHERE processSession != :session AND status IN ('running', 'waiting_result', 'reviewing')")
    fun interrupted(session: String): List<BusinessTaskEntity>
    @Query("SELECT * FROM business_tasks WHERE studentId = :studentId OR (studentId = '' AND projectId IN (:projectIds)) ORDER BY updatedAt DESC, id LIMIT :limit")
    fun scoped(studentId: String, projectIds: List<String>, limit: Int): List<BusinessTaskEntity>
    @Query("SELECT EXISTS(SELECT 1 FROM business_tasks WHERE (studentId = :studentId OR (studentId = '' AND projectId IN (:projectIds))) AND status IN ('draft','pending','approved','queued','running','waiting_result','reviewing'))")
    fun hasActive(studentId: String, projectIds: List<String>): Boolean
    @Query("SELECT * FROM business_tasks WHERE id = :id") fun exact(id: String): BusinessTaskEntity?
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insert(task: BusinessTaskEntity)
    @Query("UPDATE business_tasks SET status = :status, updatedAt = :updatedAt, revision = revision + 1, processSession = :session, payload = :payload WHERE id = :id AND revision = :expected")
    fun update(id: String, expected: Long, status: String, updatedAt: String, session: String, payload: String): Int
    @Insert(onConflict = OnConflictStrategy.ABORT) fun event(event: TaskEventEntity)
    @Query("SELECT * FROM task_events ORDER BY at, id") fun events(): List<TaskEventEntity>
    @Query("SELECT * FROM task_events WHERE taskId = :taskId ORDER BY at DESC, id LIMIT :limit") fun eventsFor(taskId: String, limit: Int): List<TaskEventEntity>
    @Query("SELECT payload FROM business_metadata WHERE name = :name") fun metadata(name: String): String?
    @Query("SELECT * FROM business_metadata WHERE name >= :prefix AND name < :end ORDER BY name LIMIT 100")
    fun metadataPrefix(prefix: String, end: String): List<BusinessMetadataEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun metadata(value: BusinessMetadataEntity)
}

/** Additive migration: the V1 model receipts and file intents are never dropped. */
@Database(entities = [ModelCallEntity::class, FileOperationIntentEntity::class, BusinessTaskEntity::class,
    TaskEventEntity::class, BusinessMetadataEntity::class, ScopedContentEntity::class], version = 3, exportSchema = true)
abstract class BusinessDatabase : RoomDatabase() {
    abstract fun ledger(): BusinessLedgerDao
    abstract fun tasks(): BusinessTaskDao
    abstract fun content(): ScopedContentDao
    companion object {
        @Volatile private var instance: BusinessDatabase? = null
        val processSession = java.util.UUID.randomUUID().toString()
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS scoped_content (id TEXT NOT NULL PRIMARY KEY, studentId TEXT NOT NULL, kind TEXT NOT NULL, sourceKey TEXT NOT NULL, title TEXT NOT NULL, bodyText TEXT NOT NULL, rootUri TEXT NOT NULL, logicalPath TEXT NOT NULL, sourceSha256 TEXT NOT NULL, projectId TEXT NOT NULL, state TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, payload TEXT NOT NULL)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_scoped_content_studentId_kind_sourceKey ON scoped_content(studentId,kind,sourceKey)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_scoped_content_studentId_kind_updatedAt ON scoped_content(studentId,kind,updatedAt)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_scoped_content_studentId_projectId ON scoped_content(studentId,projectId)")
            }
        }
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS business_tasks (id TEXT NOT NULL PRIMARY KEY, studentId TEXT NOT NULL, projectId TEXT NOT NULL, status TEXT NOT NULL, updatedAt TEXT NOT NULL, revision INTEGER NOT NULL, processSession TEXT NOT NULL, payload TEXT NOT NULL)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_business_tasks_studentId_updatedAt ON business_tasks(studentId, updatedAt)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_business_tasks_projectId_updatedAt ON business_tasks(projectId, updatedAt)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_business_tasks_status ON business_tasks(status)")
                db.execSQL("CREATE TABLE IF NOT EXISTS task_events (id TEXT NOT NULL PRIMARY KEY, taskId TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_task_events_taskId_at ON task_events(taskId, at)")
                db.execSQL("CREATE TABLE IF NOT EXISTS business_metadata (name TEXT NOT NULL PRIMARY KEY, payload TEXT NOT NULL)")
            }
        }
        fun get(context: Context): BusinessDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, BusinessDatabase::class.java, "education-business-v1.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build().also { instance = it }
        }
    }
}

/** No prompts, answers, API keys, full URLs, or student names are stored in the call ledger. */
class RoomModelReceiptSink(private val context: Context) : ModelReceiptSink {
    private val db = BusinessDatabase.get(context)
    override fun record(receipt: ModelCallReceipt) {
        if (!db.inTransaction()) BusinessRestoreRecovery.recover(context, db)
        val row = with(receipt) { ModelCallEntity(callId, studentId, taskId, provider, model, endpointHost,
            promptVersion, schemaVersion, startedAt, elapsedMs, state, requestId,
            usage.inputTokens, usage.outputTokens, usage.totalTokens, errorCode, BusinessDatabase.processSession,
            region, thinkingMode, searchEnabled, sourceCount) }
        db.runInTransaction { db.ledger().recordCall(row) }
    }
}
