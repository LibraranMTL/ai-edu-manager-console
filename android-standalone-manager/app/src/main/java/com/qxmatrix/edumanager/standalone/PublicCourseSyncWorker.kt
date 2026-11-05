package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class PublicCourseSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        runCatching { PublicCourseSyncService(applicationContext).sync() }
            .fold(onSuccess = { Result.success() }, onFailure = { if (runAttemptCount < 4) Result.retry() else Result.failure() })
    }

    companion object {
        private const val IMMEDIATE_WORK = "public-course-sync-immediate-v1"
        private const val PERIODIC_WORK = "public-course-sync-periodic-v1"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val manager = WorkManager.getInstance(context.applicationContext)
            manager.enqueueUniqueWork(IMMEDIATE_WORK, ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<PublicCourseSyncWorker>().setConstraints(constraints).build())
            manager.enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<PublicCourseSyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build())
        }
    }
}
