package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Entity(tableName = "collaboration_devices", indices = [Index(value = ["peerNodeId"], unique = true)])
data class CollaborationDeviceEntity(
    @PrimaryKey val deviceBindingId: String,
    val transportBindingId: String,
    val localNodeId: String,
    val peerNodeId: String,
    val peerDisplayName: String,
    val endpointsJson: String,
    val capabilitiesJson: String,
    val encryptedSecret: String,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
    val lastSeenAt: String,
)

@Entity(
    tableName = "collaboration_student_maps",
    indices = [
        Index(value = ["deviceBindingId"]),
        Index(value = ["localStudentId"]),
        Index(value = ["deviceBindingId", "localStudentId", "peerStudentId"], unique = true),
    ],
)
data class CollaborationStudentMapEntity(
    @PrimaryKey val studentMapId: String,
    val deviceBindingId: String,
    val transportBindingId: String,
    val localStudentId: String,
    val peerStudentId: String,
    val peerStudentName: String,
    val syncKindsJson: String,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
)

@Entity(tableName = "collaboration_saf_mappings")
data class CollaborationSafMappingEntity(
    @PrimaryKey val localStudentId: String,
    val treeUri: String,
    val rootPath: String,
    val rawPath: String,
    val summaryPath: String,
    val outputPath: String,
    val hasReadWriteGrant: Boolean,
    val updatedAt: String,
)

@Entity(
    tableName = "collaboration_revisions",
    primaryKeys = ["studentMapId", "objectId"],
    indices = [Index(value = ["localStudentId"]), Index(value = ["contentSha256"])],
)
data class CollaborationRevisionEntity(
    val studentMapId: String,
    val objectId: String,
    val localStudentId: String,
    val relativePath: String,
    val contentSha256: String,
    val revision: Long,
    val parentRevision: Long,
    val sizeBytes: Long,
    val originNodeId: String,
    val locallyModified: Boolean,
    val updatedAt: String,
)

@Entity(
    tableName = "collaboration_queue",
    indices = [Index(value = ["status", "nextAttemptAt"]), Index(value = ["localStudentId"])],
)
data class CollaborationQueueEntity(
    @PrimaryKey val jobId: String,
    val operation: String,
    val deviceBindingId: String,
    val studentMapId: String,
    val localStudentId: String,
    val payloadJson: String,
    val status: String,
    val attemptCount: Int,
    val nextAttemptAt: Long,
    val createdAt: String,
    val updatedAt: String,
    val lastError: String,
)

@Entity(tableName = "collaboration_conflicts", indices = [Index(value = ["localStudentId", "resolvedAt"])])
data class CollaborationConflictEntity(
    @PrimaryKey val conflictId: String,
    val studentMapId: String,
    val localStudentId: String,
    val objectId: String,
    val relativePath: String,
    val conflictCopyPath: String,
    val localSha256: String,
    val remoteSha256: String,
    val conflictType: String,
    val createdAt: String,
    val resolvedAt: String,
)

@Entity(tableName = "collaboration_package_checkpoints", indices = [Index(value = ["studentMapId", "status"])])
data class CollaborationPackageCheckpointEntity(
    @PrimaryKey val manifestId: String,
    val studentMapId: String,
    val status: String,
    val materializedAt: String,
    val acknowledgedAt: String,
)

@Entity(
    tableName = "collaboration_file_inventory",
    primaryKeys = ["localStudentId", "kind", "relativePath"],
    indices = [Index(value = ["localStudentId", "verifiedAtMillis"])],
)
data class CollaborationFileInventoryEntity(
    val localStudentId: String,
    val kind: String,
    val relativePath: String,
    val sizeBytes: Long,
    val lastModified: Long,
    val contentSha256: String,
    val verifiedAtMillis: Long,
)

data class CollaborationExceptionRow(
    val id: String,
    val localStudentId: String,
    val message: String,
    val createdAt: String,
)

@Dao
interface CollaborationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertDevice(value: CollaborationDeviceEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertStudentMap(value: CollaborationStudentMapEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSafMapping(value: CollaborationSafMappingEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertRevision(value: CollaborationRevisionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertQueue(value: CollaborationQueueEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertConflict(value: CollaborationConflictEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPackageCheckpoint(value: CollaborationPackageCheckpointEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFileInventory(values: List<CollaborationFileInventoryEntity>)

    @Query("SELECT * FROM collaboration_devices ORDER BY updatedAt DESC")
    suspend fun devices(): List<CollaborationDeviceEntity>

    @Query("SELECT * FROM collaboration_devices WHERE deviceBindingId = :deviceBindingId LIMIT 1")
    suspend fun device(deviceBindingId: String): CollaborationDeviceEntity?

    @Query("SELECT * FROM collaboration_devices WHERE peerNodeId = :peerNodeId AND status != 'revoked' LIMIT 1")
    suspend fun activeDeviceForPeer(peerNodeId: String): CollaborationDeviceEntity?

    @Query("UPDATE collaboration_devices SET status = :status, encryptedSecret = :encryptedSecret, updatedAt = :updatedAt WHERE deviceBindingId = :deviceBindingId")
    suspend fun updateDeviceStatus(deviceBindingId: String, status: String, encryptedSecret: String, updatedAt: String): Int

    @Query("UPDATE collaboration_student_maps SET status = :status, updatedAt = :updatedAt WHERE deviceBindingId = :deviceBindingId AND status != 'revoked'")
    suspend fun updateStudentMapsForDevice(deviceBindingId: String, status: String, updatedAt: String): Int

    @Query("UPDATE collaboration_queue SET status = 'cancelled', updatedAt = :updatedAt, lastError = '协作设备已撤销' WHERE deviceBindingId = :deviceBindingId AND status IN ('queued', 'retry', 'running')")
    suspend fun cancelQueueForDevice(deviceBindingId: String, updatedAt: String): Int

    @Query("SELECT * FROM collaboration_student_maps ORDER BY updatedAt DESC")
    suspend fun studentMaps(): List<CollaborationStudentMapEntity>

    @Query("SELECT * FROM collaboration_student_maps WHERE studentMapId = :studentMapId LIMIT 1")
    suspend fun studentMap(studentMapId: String): CollaborationStudentMapEntity?

    @Query("SELECT * FROM collaboration_student_maps WHERE status = 'active' ORDER BY updatedAt DESC")
    suspend fun activeStudentMaps(): List<CollaborationStudentMapEntity>

    @Query("SELECT * FROM collaboration_saf_mappings WHERE localStudentId = :studentId LIMIT 1")
    suspend fun safMapping(studentId: String): CollaborationSafMappingEntity?

    @Query("SELECT * FROM collaboration_revisions WHERE studentMapId = :studentMapId")
    suspend fun revisions(studentMapId: String): List<CollaborationRevisionEntity>

    @Query("SELECT * FROM collaboration_revisions WHERE studentMapId = :studentMapId AND objectId = :objectId LIMIT 1")
    suspend fun revision(studentMapId: String, objectId: String): CollaborationRevisionEntity?

    @Query("SELECT * FROM collaboration_package_checkpoints WHERE manifestId = :manifestId LIMIT 1")
    suspend fun packageCheckpoint(manifestId: String): CollaborationPackageCheckpointEntity?

    @Query("SELECT * FROM collaboration_file_inventory WHERE localStudentId = :studentId")
    suspend fun fileInventory(studentId: String): List<CollaborationFileInventoryEntity>

    @Query("DELETE FROM collaboration_file_inventory WHERE localStudentId = :studentId AND kind = :kind AND relativePath = :relativePath")
    suspend fun deleteFileInventory(studentId: String, kind: String, relativePath: String): Int

    @Query("SELECT * FROM collaboration_queue WHERE status IN ('queued', 'retry') AND nextAttemptAt <= :now ORDER BY createdAt LIMIT :limit")
    suspend fun dueJobs(now: Long, limit: Int): List<CollaborationQueueEntity>

    @Query("SELECT MIN(nextAttemptAt) FROM collaboration_queue WHERE status IN ('queued', 'retry')")
    suspend fun nextQueueAttemptAt(): Long?

    @Query("SELECT * FROM collaboration_queue WHERE jobId = :jobId LIMIT 1")
    suspend fun queueJob(jobId: String): CollaborationQueueEntity?

    @Query("UPDATE collaboration_queue SET status = 'running', updatedAt = :updatedAt WHERE jobId = :jobId AND status IN ('queued', 'retry')")
    suspend fun claimJob(jobId: String, updatedAt: String): Int

    @Query("UPDATE collaboration_queue SET status = 'queued', nextAttemptAt = :now, updatedAt = :updatedAt, lastError = '应用中断后已恢复等待' WHERE status = 'running'")
    suspend fun recoverInterrupted(now: Long, updatedAt: String): Int

    @Query("UPDATE collaboration_queue SET status = :status, attemptCount = :attemptCount, nextAttemptAt = :nextAttemptAt, updatedAt = :updatedAt, lastError = :lastError WHERE jobId = :jobId")
    suspend fun finishJob(jobId: String, status: String, attemptCount: Int, nextAttemptAt: Long, updatedAt: String, lastError: String): Int

    @Query("SELECT COUNT(*) FROM collaboration_queue WHERE status IN ('queued', 'retry', 'running')")
    suspend fun pendingQueueCount(): Int

    @Query("SELECT jobId AS id, localStudentId, lastError AS message, updatedAt AS createdAt FROM collaboration_queue WHERE status = 'failed' UNION ALL SELECT conflictId AS id, localStudentId, conflictType AS message, createdAt FROM collaboration_conflicts WHERE resolvedAt = '' ORDER BY createdAt DESC LIMIT 100")
    suspend fun exceptions(): List<CollaborationExceptionRow>
}

@Database(
    entities = [
        CollaborationDeviceEntity::class,
        CollaborationStudentMapEntity::class,
        CollaborationSafMappingEntity::class,
        CollaborationRevisionEntity::class,
        CollaborationQueueEntity::class,
        CollaborationConflictEntity::class,
        CollaborationPackageCheckpointEntity::class,
        CollaborationFileInventoryEntity::class,
    ],
    version = 4,
    exportSchema = true,
)
abstract class CollaborationDatabase : RoomDatabase() {
    abstract fun collaborationDao(): CollaborationDao

    companion object {
        @Volatile private var instance: CollaborationDatabase? = null

        fun get(context: Context): CollaborationDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                CollaborationDatabase::class.java,
                "knowledge-collaboration.db",
            ).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4).build().also { instance = it }
        }

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE collaboration_student_maps ADD COLUMN transportBindingId TEXT NOT NULL DEFAULT ''")
            }
        }


        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("CREATE TABLE IF NOT EXISTS `collaboration_package_checkpoints` (`manifestId` TEXT NOT NULL, `studentMapId` TEXT NOT NULL, `status` TEXT NOT NULL, `materializedAt` TEXT NOT NULL, `acknowledgedAt` TEXT NOT NULL, PRIMARY KEY(`manifestId`))")
                database.execSQL("CREATE INDEX IF NOT EXISTS `index_collaboration_package_checkpoints_studentMapId_status` ON `collaboration_package_checkpoints` (`studentMapId`, `status`)")
            }
        }

        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("CREATE TABLE IF NOT EXISTS `collaboration_file_inventory` (`localStudentId` TEXT NOT NULL, `kind` TEXT NOT NULL, `relativePath` TEXT NOT NULL, `sizeBytes` INTEGER NOT NULL, `lastModified` INTEGER NOT NULL, `contentSha256` TEXT NOT NULL, `verifiedAtMillis` INTEGER NOT NULL, PRIMARY KEY(`localStudentId`, `kind`, `relativePath`))")
                database.execSQL("CREATE INDEX IF NOT EXISTS `index_collaboration_file_inventory_localStudentId_verifiedAtMillis` ON `collaboration_file_inventory` (`localStudentId`, `verifiedAtMillis`)")
            }
        }
    }
}
