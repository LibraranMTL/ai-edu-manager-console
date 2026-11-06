package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.work.*
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

object StudentWorkLocks {
    private val locks = ConcurrentHashMap<String, Any>()
    fun forStudent(id: String): Any = locks.getOrPut(id) { Any() }
}

/** Conservative per-day request cap, not a currency estimate. Unknown reservations are retained. */
class StudioBudget(private val context: Context) {
    fun reserve(studentId: String, calls: Int) {
        StudentIndexRepository(context).requireExact(studentId); require(calls in 1..2)
        val db = BusinessDatabase.get(context)
        db.runInTransaction {
            val key = "studio-budget:$studentId:${Timestamp.now().take(10)}"
            val previous = db.tasks().metadata(key)?.let(::JSONObject) ?: JSONObject().put("reserved", 0)
            val used = previous.getInt("reserved")
            require(used >= 0 && used + calls <= DAILY_CAP) { "今日自动更新额度已用完，系统将在下次检查时继续" }
            db.tasks().metadata(BusinessMetadataEntity(key, previous.put("reserved", used + calls).toString()))
        }
    }
    companion object { const val DAILY_CAP = 6 }
}

class StudioAutomation(private val context: Context) {
    private val db = BusinessDatabase.get(context)

    fun enabled(studentId: String): Boolean {
        StudentIndexRepository(context).requireExact(studentId)
        return db.tasks().metadata("studio-auto:$studentId")?.let { JSONObject(it).optBoolean("enabled", false) } ?: false
    }

    fun setEnabled(studentId: String, enabled: Boolean) {
        StudentIndexRepository(context).requireExact(studentId)
        db.runInTransaction {
            db.tasks().metadata(BusinessMetadataEntity("studio-auto:$studentId", JSONObject()
                .put("version", 2).put("enabled", enabled).put("updatedAt", Timestamp.now()).toString()))
        }
        if (enabled) {
            schedule(context)
            enqueueCheck(context, studentId)
        }
    }

    /** Refreshes the two non-research modules. Time-sensitive modules are handled by ResearchUpdateService. */
    fun check(studentId: String, requireEnabled: Boolean = true): String = synchronized(StudentWorkLocks.forStudent(studentId)) {
        if (requireEnabled && !enabled(studentId)) return@synchronized "智能参考建议未开启"
        require(LicenseManager(context).status().active) { "产品尚未激活，已有建议继续保留" }
        val config = requireNotNull(AgentConfigurationStore(context).load()) { "AI处理服务尚未配置，已有建议继续保留" }
        val repository = ScopedContentRepository(context)
        val outcomes = mutableListOf<String>()

        val indexed = runCatching { StudentContentIndexer(context).rebuild(studentId) }.getOrNull()
        val student = StudentIndexRepository(context).requireExact(studentId)
        val reportRows = if (indexed?.complete == true) repository.search(studentId, "published_at:").filter { row ->
            row.kind == "search" && row.projectId.isBlank() &&
                row.logicalPath.startsWith("${student.paths.summaryPath.trimEnd('/')}/") &&
                LearningStudioPolicy.recentPublished(row.bodyText)
        }.take(2) else emptyList()

        if (reportRows.isEmpty()) outcomes += "学习卡片等待学情报告整理完成"
        else outcomes += refreshModule(studentId, "cards", reportRows.map { it.id },
            "根据已发布报告提供复习练习；不认定弱项或掌握", true, config, repository)

        outcomes += refreshModule(studentId, "topics", emptyList(),
            "结合当前档案与项目经历提供项目灵感；只作参考，不替用户决定", false, config, repository)
        outcomes.joinToString("；")
    }

    private fun refreshModule(studentId: String, module: String, sourceIds: List<String>, topic: String,
        recent: Boolean, config: AgentConfiguration, repository: ScopedContentRepository): String {
        val input = StudioInputFactory(context, repository).prepare(studentId, module, sourceIds, topic, 3, recent).input
        val fingerprint = ScopedContentPolicy.fingerprint(input)
        val receiptKey = "reference-update:$studentId:$module"
        var previous = db.tasks().metadata(receiptKey)?.let(::JSONObject)

        if (previous?.optString("state") == "waiting_receipt") {
            val recovered = repository.versionByKey(studentId, previous.optString("fingerprint"))
            if (recovered == null) return "${LearningStudioService.moduleLabels.getValue(module)}等待系统确认"
            previous = JSONObject(previous.toString()).put("state", "succeeded")
                .put("versionId", recovered.id).put("completedAt", Timestamp.now())
            db.tasks().metadata(BusinessMetadataEntity(receiptKey, previous.toString()))
        }
        val due = previous == null || previous.optString("state") in setOf("queued", "failed") ||
            (previous.optString("state") == "succeeded" && previous.optString("fingerprint") != fingerprint)
        if (!due) return "${LearningStudioService.moduleLabels.getValue(module)}无需更新"

        val started = JSONObject().put("state", "waiting_receipt").put("fingerprint", fingerprint)
            .put("startedAt", Timestamp.now())
        db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.toString()))
        return try {
            val service = LearningStudioService(context, ModelRuntime.provider(context, config), config.model, repository)
            val version = service.generate(studentId, module, sourceIds, topic, 3, recent, ModelCancellation(), fingerprint)
            db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.put("state", "succeeded")
                .put("versionId", version.id).put("completedAt", Timestamp.now()).toString()))
            "${LearningStudioService.moduleLabels.getValue(module)}已更新"
        } catch (error: Exception) {
            val possibleResult = db.ledger().hasPossibleResult(studentId, "studio:$fingerprint")
            val state = if (possibleResult) "waiting_receipt" else "queued"
            db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.put("state", state)
                .put("message", "等待系统自动更新").put("updatedAt", Timestamp.now()).toString()))
            "${LearningStudioService.moduleLabels.getValue(module)}等待自动更新"
        }
    }

    companion object {
        const val UNIQUE_WORK = "standalone-reference-suggestions"

        fun schedule(context: Context) {
            runCatching {
                val request = PeriodicWorkRequestBuilder<StudioAutomationWorker>(24, TimeUnit.HOURS)
                    .setConstraints(BackgroundWorkPolicy.remoteConstraints).build()
                WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
            }
        }

        fun enqueueCheck(context: Context, studentId: String) {
            runCatching {
                val request = OneTimeWorkRequestBuilder<StudioAutomationWorker>()
                    .setInputData(Data.Builder().putString("studentId", studentId).build())
                    .setConstraints(BackgroundWorkPolicy.remoteConstraints).build()
                WorkManager.getInstance(context).enqueueUniqueWork(
                    BackgroundWorkPolicy.uniqueName("reference-suggestion-check", studentId), ExistingWorkPolicy.KEEP, request)
            }
        }
    }
}

class StudioAutomationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        try { BusinessRestoreRecovery.recover(applicationContext) } catch (_: Exception) { return Result.failure() }
        val db = BusinessDatabase.get(applicationContext)
        val automation = StudioAutomation(applicationContext)
        val requested = inputData.getString("studentId")
        val students = try {
            if (requested != null) listOf(StudentIndexRepository(applicationContext).requireExact(requested))
            else StudentIndexRepository(applicationContext).list().take(50)
        } catch (_: Exception) { return Result.failure() }

        students.forEach { student ->
            if (!runCatching { automation.enabled(student.id) }.getOrDefault(false)) return@forEach
            val local = runCatching { automation.check(student.id) }
            db.tasks().metadata(BusinessMetadataEntity("studio-auto-result:${student.id}", JSONObject()
                .put("checkedAt", Timestamp.now())
                .put("state", if (local.isSuccess) "succeeded" else "queued")
                .put("message", local.getOrElse { "等待自动更新" }).toString()))

            val research = runCatching { ResearchUpdateService(applicationContext).check(student.id) }
            db.tasks().metadata(BusinessMetadataEntity("research-update-result:${student.id}", JSONObject()
                .put("checkedAt", Timestamp.now())
                .put("state", if (research.isSuccess) "succeeded" else "queued")
                .put("message", research.getOrElse { "等待自动更新" }).toString()))
        }
        return Result.success()
    }
}
