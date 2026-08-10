package com.qxmatrix.edumanager.standalone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit

class CollaborationRecoveryWorker(appContext: Context, parameters: WorkerParameters) : CoroutineWorker(appContext, parameters) {
    override suspend fun doWork(): Result = workerMutex.withLock {
        if (inputData.getBoolean(CollaborationWorkScheduler.KEY_FOREGROUND, false)) setForeground(foregroundInfo())
        val dao = CollaborationDatabase.get(applicationContext).collaborationDao()
        val now = System.currentTimeMillis()
        dao.recoverInterrupted(now, utcNow())
        CollaborationRepository(applicationContext).enqueueActiveSyncJobs()
        var processed = 0
        val deadline = System.currentTimeMillis() + MAX_RUN_MILLIS
        while (processed < MAX_JOBS_PER_RUN && System.currentTimeMillis() < deadline) {
            val due = dao.dueJobs(System.currentTimeMillis(), JOB_BATCH_SIZE)
            if (due.isEmpty()) break
            for (job in due) {
                if (dao.claimJob(job.jobId, utcNow()) != 1) continue
                processed += 1
                runCatching {
                    when (job.operation) {
                        CollaborationQueuePolicy.VALIDATE_STUDENT_SCOPE -> CollaborationRepository(applicationContext).validateStudentScope(job.localStudentId)
                        CollaborationQueuePolicy.SYNC_STUDENT_ARCHIVE -> CollaborationSyncService(applicationContext).synchronize(job.studentMapId)
                        else -> error("当前版本尚不支持该协作队列操作")
                    }
                }.onSuccess {
                    dao.finishJob(job.jobId, "completed", job.attemptCount, 0L, utcNow(), "")
                }.onFailure { error ->
                    val (status, attempts, nextAt) = CollaborationQueuePolicy.nextFailure(job.attemptCount, System.currentTimeMillis())
                    dao.finishJob(job.jobId, status, attempts, nextAt, utcNow(), (error.message ?: "协作任务失败").take(500))
                }
                if (processed >= MAX_JOBS_PER_RUN || System.currentTimeMillis() >= deadline) break
            }
        }
        dao.nextQueueAttemptAt()?.let { nextAt ->
            CollaborationWorkScheduler.scheduleFollowUp(
                applicationContext,
                CollaborationQueuePolicy.followUpDelay(nextAt, System.currentTimeMillis()),
            )
        }
        Result.success()
    }

    private fun foregroundInfo(): ForegroundInfo {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "知识协作同步", NotificationManager.IMPORTANCE_LOW))
        }
        val intent = Intent(applicationContext, CollaborationActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            applicationContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("正在同步学生知识")
            .setContentText("正在校验版本并传输已确认知识、成长模型、报告和教育档案")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(0, 0, true)
            .build()
        return if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        /** One-time recovery and periodic recovery use different WorkManager names, so serialize them in-process. */
        private val workerMutex = Mutex()
        private const val CHANNEL_ID = "knowledge-collaboration-sync"
        private const val NOTIFICATION_ID = 4312
        private const val JOB_BATCH_SIZE = 25
        private const val MAX_JOBS_PER_RUN = 250
        private const val MAX_RUN_MILLIS = 8 * 60 * 1000L
    }
}

object CollaborationWorkScheduler {
    private const val RECOVERY_WORK = "knowledge-collaboration-recovery"
    private const val MANUAL_WORK = "knowledge-collaboration-manual"
    private const val FOLLOW_UP_WORK = "knowledge-collaboration-follow-up"
    private const val PERIODIC_WORK = "knowledge-collaboration-periodic"
    internal const val KEY_FOREGROUND = "foreground"

    fun scheduleRecovery(context: Context, foreground: Boolean = false) {
        val request = OneTimeWorkRequestBuilder<CollaborationRecoveryWorker>()
            .setInputData(workDataOf(KEY_FOREGROUND to foreground))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        val name = if (foreground) MANUAL_WORK else RECOVERY_WORK
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)
    }

    fun scheduleFollowUp(context: Context, delayMillis: Long) {
        val targetSecond = (System.currentTimeMillis() + delayMillis.coerceAtLeast(0L)) / 1000L
        val request = OneTimeWorkRequestBuilder<CollaborationRecoveryWorker>()
            .setInputData(workDataOf(KEY_FOREGROUND to false))
            .setInitialDelay(delayMillis.coerceAtLeast(0L), TimeUnit.MILLISECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork("$FOLLOW_UP_WORK-$targetSecond", ExistingWorkPolicy.KEEP, request)
    }

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<CollaborationRecoveryWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }
}
