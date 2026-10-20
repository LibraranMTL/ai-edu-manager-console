package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.work.*
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

object StudentWorkLocks { private val locks = ConcurrentHashMap<String, Any>(); fun forStudent(id: String): Any = locks.getOrPut(id) { Any() } }

/** Conservative per-day request cap, not a currency estimate. Failed/unknown reservations are
 * not refunded automatically. Shares the same Room transaction and backup boundary. */
class StudioBudget(private val context: Context) {
    fun reserve(studentId: String, calls: Int) {
        StudentIndexRepository(context).requireExact(studentId); require(calls in 1..2)
        val db = BusinessDatabase.get(context)
        db.runInTransaction {
            val key = "studio-budget:$studentId:${Timestamp.now().take(10)}"
            val previous = db.tasks().metadata(key)?.let(::JSONObject) ?: JSONObject().put("reserved", 0)
            val used = previous.getInt("reserved"); require(used >= 0 && used + calls <= DAILY_CAP) { "今日学习/规划请求额度已用完，请次日再试（失败与未知请求不自动退还额度）" }
            db.tasks().metadata(BusinessMetadataEntity(key, previous.put("reserved", used + calls).toString()))
        }
    }
    companion object { const val DAILY_CAP = 6 }
}

class StudioAutomation(private val context: Context) {
    private val db = BusinessDatabase.get(context)
    fun enabled(studentId: String): Boolean {
        StudentIndexRepository(context).requireExact(studentId)
        return db.tasks().metadata("studio-auto:$studentId")?.let { JSONObject(it).getBoolean("enabled") } ?: false
    }
    fun setEnabled(studentId: String, enabled: Boolean) {
        StudentIndexRepository(context).requireExact(studentId)
        db.runInTransaction { db.tasks().metadata(BusinessMetadataEntity("studio-auto:$studentId", JSONObject().put("enabled", enabled).put("consentedAt", Timestamp.now()).toString())) }
        if (enabled) schedule(context)
    }
    fun check(studentId: String): String = synchronized(StudentWorkLocks.forStudent(studentId)) {
        if (!enabled(studentId)) return@synchronized "自动练习未授权"
        require(LicenseManager(context).status().active) { "产品尚未激活" }
        val index = StudentContentIndexer(context).rebuild(studentId)
        require(index.complete) { "索引不完整，不自动发送资料" }
        val repo = ScopedContentRepository(context)
        // Named published report content is the only automatic source, never arbitrary raw files.
        val student = StudentIndexRepository(context).requireExact(studentId)
        val rows = repo.search(studentId, "published_at:").filter { row ->
            row.kind == "search" && row.projectId.isBlank() && row.logicalPath.startsWith("${student.paths.summaryPath.trimEnd('/')}/") &&
                LearningStudioPolicy.recentPublished(row.bodyText)
        }.take(2)
        require(rows.isNotEmpty()) { "尚无已发布报告，保留空白，不推断弱项" }
        val config = requireNotNull(AgentConfigurationStore(context).load()) { "尚未配置模型" }
        val service = LearningStudioService(context, ModelRuntime.provider(context, config), config.model)
        service.generate(studentId, "cards", rows.map { it.id }, "根据已发布报告提供复习练习；不认定弱项或掌握", 3, true, ModelCancellation())
        "自动练习候选已保存（或复用同日相同输入版本），作答仍需审核"
    }
    companion object {
        const val UNIQUE_WORK = "standalone-studio-daily"
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<StudioAutomationWorker>(24, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).setRequiresStorageNotLow(true).build()).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        }
        fun enqueueCheck(context: Context, studentId: String) {
            val request = OneTimeWorkRequestBuilder<StudioAutomationWorker>().setInputData(Data.Builder().putString("studentId", studentId).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).setRequiresStorageNotLow(true).build()).build()
            WorkManager.getInstance(context).enqueueUniqueWork("studio-check:$studentId", ExistingWorkPolicy.KEEP, request)
        }
    }
}

class StudioAutomationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        try { BusinessRestoreRecovery.recover(applicationContext) } catch (_: Exception) { return Result.failure() }
        val db = BusinessDatabase.get(applicationContext)
        val service = StudioAutomation(applicationContext)
        val requested = inputData.getString("studentId")
        val students = try { if (requested != null) listOf(StudentIndexRepository(applicationContext).requireExact(requested)) else StudentIndexRepository(applicationContext).list().take(50) } catch (_: Exception) { return Result.failure() }
        students.forEach { student ->
            val outcome = runCatching { service.check(student.id) }
            db.tasks().metadata(BusinessMetadataEntity("studio-auto-result:${student.id}", JSONObject().put("checkedAt", Timestamp.now())
                .put("state", if (outcome.isSuccess) "succeeded" else "needs_user").put("message", outcome.getOrElse { it.message ?: "未完成" }).toString()))
            val research = runCatching { ResearchUpdateService(applicationContext).check(student.id) }
            db.tasks().metadata(BusinessMetadataEntity("research-update-result:${student.id}", JSONObject().put("checkedAt", Timestamp.now())
                .put("state", if (research.isSuccess) "succeeded" else "needs_user").put("message", research.getOrElse { it.message ?: "未完成" }).toString()))
        }
        return Result.success() // Unknown model results never cause WorkManager retry.
    }
}
