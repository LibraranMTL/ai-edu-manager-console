package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.Calendar
import java.util.concurrent.TimeUnit

data class AutoDigestSettings(
    val enabled: Boolean = true,
    val hour: Int = 21,
    val minute: Int = 30,
    val wifiOnly: Boolean = true,
    val chargingOnly: Boolean = false,
    val maximumPerStudent: Int = 20,
    val automationMode: String = AutomationMode.FULL.wireValue,
)

class AutoDigestSettingsStore(private val context: Context) {
    private val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load() = AutoDigestSettings(
        enabled = preferences.getBoolean("enabled", true),
        hour = preferences.getInt("hour", 21).coerceIn(0, 23),
        minute = preferences.getInt("minute", 30).coerceIn(0, 59),
        wifiOnly = preferences.getBoolean("wifi_only", true),
        chargingOnly = preferences.getBoolean("charging_only", false),
        maximumPerStudent = preferences.getInt("maximum", 20).coerceIn(1, 100),
        automationMode = AutomationMode.from(preferences.getString("automation_mode", AutomationMode.FULL.wireValue).orEmpty()).wireValue,
    )

    fun save(value: AutoDigestSettings) {
        preferences.edit().putBoolean("enabled", value.enabled).putInt("hour", value.hour)
            .putInt("minute", value.minute).putBoolean("wifi_only", value.wifiOnly)
            .putBoolean("charging_only", value.chargingOnly).putInt("maximum", value.maximumPerStudent)
            .putString("automation_mode", AutomationMode.from(value.automationMode).wireValue).apply()
        schedule(context, value)
    }

    fun summary(): String {
        val value = load(); val last = preferences.getString("last_summary", "").orEmpty()
        val mode = AutomationMode.from(value.automationMode)
        return if (!value.enabled && mode == AutomationMode.OFF) "已关闭" else "%02d:%02d · %s · %s · 每名学生最多 %d 份 · %s%s".format(
            value.hour, value.minute, if (value.wifiOnly) "仅 Wi-Fi" else "任意网络",
            if (value.chargingOnly) "仅充电时" else "无需充电", value.maximumPerStudent, mode.label,
            if (last.isBlank()) "" else "\n最近：$last",
        )
    }

    fun ensureScheduled() = schedule(context, load())

    internal fun record(summary: String) {
        preferences.edit().putString("last_summary", "${Timestamp.now()} · ${summary.take(500)}").apply()
    }

    companion object {
        private const val PREFS = "auto_digest_settings"
        private const val UNIQUE_WORK = "android-standalone-auto-digest"

        fun schedule(context: Context, value: AutoDigestSettings) {
            val manager = WorkManager.getInstance(context)
            if (!value.enabled) { manager.cancelUniqueWork(UNIQUE_WORK); return }
            val now = Calendar.getInstance()
            val next = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, value.hour); set(Calendar.MINUTE, value.minute); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
                if (!after(now)) add(Calendar.DAY_OF_YEAR, 1)
            }
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (value.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(value.chargingOnly).setRequiresBatteryNotLow(true).setRequiresStorageNotLow(true).build()
            val request = PeriodicWorkRequestBuilder<AutoDigestWorker>(24, TimeUnit.HOURS)
                .setInitialDelay((next.timeInMillis - now.timeInMillis).coerceAtLeast(1_000L), TimeUnit.MILLISECONDS)
                .setConstraints(constraints).build()
            manager.enqueueUniquePeriodicWork(UNIQUE_WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}

class AutoDigestWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val store = AutoDigestSettingsStore(applicationContext)
        val settings = store.load()
        if (!settings.enabled) return Result.success()
        if (!LicenseManager(applicationContext).status().active) {
            store.record("未执行：产品尚未激活")
            notifyResult("自动消化未执行", "产品尚未激活")
            return Result.success()
        }
        if (AgentConfigurationStore(applicationContext).load() == null) {
            store.record("未执行：尚未配置任务 Agent")
            notifyResult("自动消化未执行", "尚未配置任务 Agent")
            return Result.success()
        }
        var processed = 0
        val failures = mutableListOf<String>()
        val files = FileAssetService(applicationContext)
        StudentIndexRepository(applicationContext).list().forEach { student ->
            val busy = TaskRepository(applicationContext).list().any {
                it.optString("sourceId") == student.id && it.optString("status") in setOf("queued", "approved", "running", "reviewing")
            }
            if (busy) { failures += "${student.name}：已有资料任务运行中"; return@forEach }
            val eligible = runCatching { files.materials(student.id) }.getOrDefault(emptyList()).filter {
                MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PENDING_DIGEST &&
                    MaterialProcessingPolicy.digestReady(it) && it.optString("digestRecoveryState") != "authorized_retry"
            }.take(settings.maximumPerStudent)
            if (eligible.isEmpty()) return@forEach
            runCatching { StudentDigestOrchestrator(applicationContext).digestSelected(student.id, eligible.map { it.getString("id") }.toSet(), explicitUserAction = false) }
                .onSuccess { result ->
                    processed += result.optInt("processed")
                    val batchFailures = result.optJSONArray("failures")
                    if (batchFailures != null) for (index in 0 until batchFailures.length()) {
                        failures += "${student.name} · 第 ${batchFailures.optJSONObject(index)?.optInt("batch")} 批：" +
                            batchFailures.optJSONObject(index)?.optString("message").orEmpty().ifBlank { "消化失败" }
                    }
                }
                .onFailure { failures += "${student.name}：${it.message ?: "消化失败"}" }
        }
        val summary = "处理 $processed 份${if (failures.isEmpty()) "" else "；未完成 ${failures.size} 组"}"
        store.record(summary)
        notifyResult("自动消化已完成", summary)
        return Result.success()
    }

    private fun notifyResult(title: String, message: String) {
        runCatching {
            val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "资料自动消化", NotificationManager.IMPORTANCE_DEFAULT))
            val builder = if (Build.VERSION.SDK_INT >= 26) android.app.Notification.Builder(applicationContext, CHANNEL_ID) else android.app.Notification.Builder(applicationContext)
            manager.notify(NOTIFICATION_ID, builder.setSmallIcon(android.R.drawable.ic_menu_info_details).setContentTitle(title).setContentText(message).setAutoCancel(true).build())
        }
    }

    companion object { private const val CHANNEL_ID = "auto_digest"; private const val NOTIFICATION_ID = 5302 }
}
