package com.qxmatrix.edumanager.standalone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class ReportSchedule(val cadence: String, val mode: String, val lastRunAt: String, val lastMessage: String)

class ReportScheduleStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("report_schedule_v1", Context.MODE_PRIVATE)

    fun ensureDefaults(studentId: String) {
        StudentIndexRepository(context).requireExact(studentId)
        CADENCES.forEach { cadence -> if (!prefs.contains(key(studentId, cadence))) set(studentId, cadence, "reminder") }
    }

    fun list(studentId: String): List<ReportSchedule> {
        StudentIndexRepository(context).requireExact(studentId)
        return CADENCES.map { cadence -> ReportSchedule(cadence, prefs.getString(key(studentId, cadence), "reminder").orEmpty(),
            prefs.getString("last:$studentId:$cadence", "").orEmpty(), prefs.getString("message:$studentId:$cadence", "").orEmpty()) }
    }

    fun set(studentId: String, cadence: String, mode: String) {
        StudentIndexRepository(context).requireExact(studentId)
        require(cadence in CADENCES && mode in setOf("off", "reminder", "auto"))
        prefs.edit().putString(key(studentId, cadence), mode).apply()
        val manager = WorkManager.getInstance(context)
        if (mode == "off") { manager.cancelUniqueWork(workName(studentId, cadence)); return }
        val constraints = if (mode == "auto") BackgroundWorkPolicy.unmeteredChargingConstraints
            else Constraints.NONE
        val request = PeriodicWorkRequestBuilder<ReportScheduleWorker>(days(cadence), TimeUnit.DAYS)
            .setInputData(workDataOf("studentId" to studentId, "cadence" to cadence, "mode" to mode))
            .setConstraints(constraints).build()
        manager.enqueueUniquePeriodicWork(workName(studentId, cadence), ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun record(studentId: String, cadence: String, message: String) {
        prefs.edit().putString("last:$studentId:$cadence", Timestamp.now()).putString("message:$studentId:$cadence", message.take(300)).apply()
    }

    fun mode(studentId: String, cadence: String) = prefs.getString(key(studentId, cadence), "off").orEmpty()
    fun autoOutcomeUnknown(studentId: String, cadence: String) = prefs.getBoolean("unknown:$studentId:$cadence", false)
    fun markAutoAttempt(studentId: String, cadence: String) {
        prefs.edit().putBoolean("unknown:$studentId:$cadence", true)
            .putString("attempt:$studentId:$cadence", Timestamp.now()).commit()
    }
    fun markAutoDelivered(studentId: String, cadence: String) {
        prefs.edit().putBoolean("unknown:$studentId:$cadence", false).remove("attempt:$studentId:$cadence").commit()
    }
    fun acknowledgeUnknown(studentId: String, cadence: String, note: String) {
        require(note.trim().length >= 4) { "请填写至少4字的核对依据" }
        prefs.edit().putBoolean("unknown:$studentId:$cadence", false).remove("attempt:$studentId:$cadence")
            .putString("message:$studentId:$cadence", "已人工核对：${note.trim().take(200)}").commit()
    }
    private fun key(studentId: String, cadence: String) = "mode:$studentId:$cadence"

    companion object {
        val CADENCES = listOf("weekly", "monthly", "semester")
        fun label(value: String) = when (value) { "weekly" -> "周报"; "monthly" -> "月报"; else -> "学期报告" }
        private fun days(value: String) = when (value) { "weekly" -> 7L; "monthly" -> 30L; else -> 120L }
        private fun workName(studentId: String, cadence: String) = "report-schedule-$studentId-$cadence"
    }
}

class ReportScheduleWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val studentId = inputData.getString("studentId") ?: return Result.failure()
        val cadence = inputData.getString("cadence") ?: return Result.failure()
        val expectedMode = inputData.getString("mode") ?: return Result.failure()
        val store = ReportScheduleStore(applicationContext)
        if (store.mode(studentId, cadence) != expectedMode) return Result.success()
        return runCatching {
            StudentIndexRepository(applicationContext).requireExact(studentId)
            if (expectedMode == "auto") {
                if (store.autoOutcomeUnknown(studentId, cadence)) {
                    store.record(studentId, cadence, "上次自动生成结果未知；请先在任务中心和报告历史核对，未重复调用模型")
                    return Result.success()
                }
                store.markAutoAttempt(studentId, cadence)
                val result = GrowthModelService(applicationContext).generateAndPublishReports(studentId)
                store.markAutoDelivered(studentId, cadence)
                store.record(studentId, cadence, result.optString("message", "自动报告已生成"))
            } else {
                notifyReminder(studentId, cadence)
                store.record(studentId, cadence, "已提醒生成${ReportScheduleStore.label(cadence)}；未自动调用模型")
            }
        }.fold(onSuccess = { Result.success() }, onFailure = {
            // Unknown model outcomes are not repeated by this worker. The next periodic window remains independent.
            store.record(studentId, cadence, "未完成：${it.message ?: "请在任务中心核对"}")
            Result.success()
        })
    }

    private fun notifyReminder(studentId: String, cadence: String) {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "学情报告提醒", NotificationManager.IMPORTANCE_DEFAULT))
        val name = StudentIndexRepository(applicationContext).requireExact(studentId).name
        manager.notify((studentId + cadence).hashCode(), NotificationCompat.Builder(applicationContext, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("${name} · ${ReportScheduleStore.label(cadence)}")
            .setContentText("已有新周期，可在教育管家确认后生成报告。未自动调用模型。")
            .setAutoCancel(true).build())
    }

    companion object { private const val CHANNEL = "education-report-reminders" }
}
