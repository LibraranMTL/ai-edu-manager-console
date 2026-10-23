package com.qxmatrix.edumanager.standalone

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Optional, local-only reminder for unfinished learning cards and next steps. */
class LearningReminderStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("learning-reminder-v1", Context.MODE_PRIVATE)

    fun enabled(studentId: String): Boolean {
        StudentIndexRepository(context).requireExact(studentId)
        return prefs.getBoolean(studentId, false)
    }

    fun setEnabled(studentId: String, enabled: Boolean) {
        StudentIndexRepository(context).requireExact(studentId)
        prefs.edit().putBoolean(studentId, enabled).apply()
        runCatching {
            val manager = WorkManager.getInstance(context)
            if (!enabled) {
                manager.cancelUniqueWork(workName(studentId))
            } else {
                val request = PeriodicWorkRequestBuilder<LearningReminderWorker>(24, TimeUnit.HOURS)
                    .setInputData(workDataOf("studentId" to studentId))
                    .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
                    .build()
                manager.enqueueUniquePeriodicWork(workName(studentId), ExistingPeriodicWorkPolicy.UPDATE, request)
            }
        }
    }

    companion object { private fun workName(studentId: String) = "learning-reminder-$studentId" }
}

class LearningReminderWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val studentId = inputData.getString("studentId") ?: return Result.failure()
        val store = LearningReminderStore(applicationContext)
        if (!runCatching { store.enabled(studentId) }.getOrDefault(false)) return Result.success()

        val repository = ScopedContentRepository(applicationContext)
        val artifacts = runCatching { repository.list(studentId, listOf("artifact"), 100) }.getOrElse { return Result.retry() }
        val attempts = runCatching { repository.list(studentId, listOf("attempt"), 100) }.getOrElse { return Result.retry() }
        val actions = runCatching { repository.list(studentId, listOf("action"), 100) }.getOrElse { return Result.retry() }
        val answered = attempts.mapNotNull { runCatching { JSONObject(it.payload).optString("versionId") }.getOrNull() }
            .filter(String::isNotBlank).toSet()
        val cardCount = artifacts.count {
            it.id !in answered && runCatching { JSONObject(it.payload).optString("module") == "cards" }.getOrDefault(false)
        }
        val nextCount = actions.count { it.state in setOf("planned", "doing") }
        if (cardCount + nextCount == 0) return Result.success()
        notify(studentId, cardCount, nextCount)
        return Result.success()
    }

    private fun notify(studentId: String, cardCount: Int, nextCount: Int) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        if (!NotificationManagerCompat.from(applicationContext).areNotificationsEnabled()) return
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "学习行动提醒", NotificationManager.IMPORTANCE_DEFAULT))
        val intent = Intent(applicationContext, LearningStudioActivity::class.java)
            .putExtra(LearningStudioActivity.EXTRA_STUDENT_ID, studentId)
            .putExtra(LearningStudioActivity.EXTRA_INITIAL_MODE, "today")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(applicationContext, studentId.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val student = StudentIndexRepository(applicationContext).requireExact(studentId)
        val details = listOfNotNull(
            cardCount.takeIf { it > 0 }?.let { "$it 张学习卡片" },
            nextCount.takeIf { it > 0 }?.let { "$it 项下一步" },
        ).joinToString("、")
        manager.notify(("learning:$studentId").hashCode(), NotificationCompat.Builder(applicationContext, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("${student.name} · 今日学习")
            .setContentText("有 $details 可以继续")
            .setContentIntent(pending).setAutoCancel(true).build())
    }

    companion object { private const val CHANNEL = "education-learning-reminders" }
}
