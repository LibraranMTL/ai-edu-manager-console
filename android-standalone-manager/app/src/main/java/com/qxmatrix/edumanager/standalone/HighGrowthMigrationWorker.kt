package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * Builds verified Room query indexes without deleting or rewriting the JSON/SAF recovery source.
 * A failed student migration leaves that student's legacy source authoritative.
 */
class HighGrowthMigrationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val failures = mutableListOf<String>()
        StudentIndexRepository(applicationContext).list().forEach { student ->
            runCatching { migrateStudent(student) }.onFailure { failures += "${student.id}:${it.message.orEmpty()}" }
        }
        return if (failures.isEmpty()) Result.success() else Result.failure(
            androidx.work.Data.Builder().putString("safeError", failures.joinToString(" | ").take(2_000)).build()
        )
    }

    private fun migrateStudent(student: StudentRecord) {
        val store = HighGrowthRoomStore(applicationContext)
        val growth = GrowthModelService(applicationContext)
        val evidence = growth.candidates(student.id)
        store.migrateAndPage(student.id, HighGrowthRoomStore.GROWTH_EVIDENCE, evidence, 1, 0)
        val snapshot = growth.rebuildIndex(student.id)
        val snapshotTime = snapshot.optString("updatedAt", Timestamp.now())
        store.migrateAndPage(student.id, HighGrowthRoomStore.GROWTH_SNAPSHOT, listOf(
            snapshot.put("sourceId", "growth-snapshot:current").put("time", snapshotTime)
        ), 1, 0)
        val conversation = ConversationCandidateRepository(applicationContext).list(student.id)
        store.migrateAndPage(student.id, HighGrowthRoomStore.CONVERSATION_CANDIDATE, conversation, 1, 0)
        LearningInsightsStore(applicationContext).reportRevisions(student.id)
        CloudSyncReceiptStore(applicationContext).list(student.id)
        // Learning events already live in the same Room database and need no JSON import.
    }

    companion object {
        private const val UNIQUE_NAME = "edu-high-growth-index-v1"

        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<HighGrowthMigrationWorker>()
                .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).setRequiresStorageNotLow(true).build())
                .addTag(UNIQUE_NAME)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}
