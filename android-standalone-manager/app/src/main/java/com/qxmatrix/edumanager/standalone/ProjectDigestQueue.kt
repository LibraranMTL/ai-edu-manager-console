package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException
import java.util.UUID

object ProjectAutoDigestPolicy {
    private val textExtensions = setOf("txt", "md", "markdown", "csv", "json")
    fun eligibleMaterial(row: JSONObject): Boolean = row.optString("adoption") == "accepted" &&
        row.optString("availability") == "available" && row.optJSONObject("processing")?.optString("state") == "pending" &&
        row.optString("title").substringAfterLast('.', "").lowercase() in textExtensions
    fun permitted(fullMode: Boolean, licensed: Boolean, configured: Boolean, studentCount: Int,
        projectStatus: String, lastStatus: String): Boolean = fullMode && licensed && configured && studentCount == 1 &&
        projectStatus !in setOf("sealed", "archived") && lastStatus !in setOf("queued", "running", "failed", "needs_user")
}

private object ProjectDigestLocks { val execution = Any() }

/** Durable, bounded queue for project knowledge digestion. Original files never live in this queue. */
class ProjectDigestQueue(context: Context) {
    private val appContext = context.applicationContext
    private val state = PrivateStateStore(appContext)

    fun enqueue(projectId: String, maximum: Int = 20, automatic: Boolean = false): JSONObject = synchronized(STATE_LOCK) {
        val project = ProjectRepository(appContext).requireExact(projectId)
        val selectedStudent = appContext.getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, Context.MODE_PRIVATE).getString(MainActivity.KEY_CURRENT_STUDENT_ID, "").orEmpty()
        val scopeStudent = selectedStudent.takeIf { it in project.studentIds } ?: project.studentIds.singleOrNull().orEmpty()
        if (scopeStudent.isNotBlank()) StudentIndexRepository(appContext).requireExact(scopeStudent)
        val root = read()
        root.getJSONArray("jobs").objects().lastOrNull {
            it.optString("projectId") == projectId && it.optString("status") in ACTIVE
        }?.let { return@synchronized JSONObject(it.toString()) }
        require(root.getJSONArray("jobs").objects().none { it.optString("projectId") == projectId && it.optString("status") == "needs_user" }) { "上次消化结果未知，请先核对并结束未知任务，不能自动重试" }
        val frozen = LocalProjectDigestService(appContext).freezePending(projectId, maximum, automatic)
        val job = JSONObject().put("jobId", "project-digest-${UUID.randomUUID()}").put("projectId", projectId)
            .put("studentId", scopeStudent)
            .put("status", "queued").put("attempt", 0).put("frozenMaterials", frozen)
            .put("createdAt", Timestamp.now()).put("updatedAt", Timestamp.now()).put("message", "等待系统执行")
        val jobs = root.getJSONArray("jobs"); jobs.put(job); trim(jobs); write(root); schedule(job)
        JSONObject(job.toString())
    }

    fun latest(projectId: String): JSONObject? = synchronized(STATE_LOCK) { read().getJSONArray("jobs").objects()
        .lastOrNull { it.optString("projectId") == projectId }?.let { JSONObject(it.toString()) }
    }

    fun enqueueAutomatic(projectId: String): JSONObject? = synchronized(STATE_LOCK) {
        val project = ProjectRepository(appContext).requireExact(projectId)
        val mode = AutomationMode.from(AutoDigestSettingsStore(appContext).load().automationMode)
        val last = latest(projectId)?.optString("status").orEmpty()
        if (!ProjectAutoDigestPolicy.permitted(mode == AutomationMode.FULL, LicenseManager(appContext).status().active,
                AgentConfigurationStore(appContext).load() != null, project.studentIds.size, project.status, last) ||
            project.materialStorageMode != "workspace-v1" || project.materialMigrationState == "running") return@synchronized null
        if (LocalProjectMaterialService(appContext).list(projectId, "materials").none(ProjectAutoDigestPolicy::eligibleMaterial)) return@synchronized null
        enqueue(projectId, automatic = true)
    }

    fun resumePending() = synchronized(STATE_LOCK) {
        val root = read(); var changed = false
        root.getJSONArray("jobs").objects().filter { it.optString("status") in ACTIVE }.forEach { job ->
            if (job.optString("status") == "running" && job.optString("processSession") != BusinessDatabase.processSession) {
                job.put("status", "needs_user").put("errorCode", "process_interrupted").put("message", "上次模型/写入结果未知，请核对知识文件和计费，不自动重试").put("updatedAt", Timestamp.now()); changed = true
            }
            if (job.optString("status") == "queued") schedule(job)
        }
        if (changed) write(root)
    }

    /** Only replay an exact locally persisted result; cacheOnly can never dispatch a model call. */
    fun reconcileUnknowns(projectId: String = ""): JSONObject = synchronized(ProjectDigestLocks.execution) {
        if (projectId.isNotBlank()) ProjectRepository(appContext).requireExact(projectId)
        val unknown = synchronized(STATE_LOCK) { read().getJSONArray("jobs").objects()
            .filter { it.optString("status") == "needs_user" && (projectId.isBlank() || it.optString("projectId") == projectId) }
            .map { JSONObject(it.toString()) } }
        var recovered = 0; var retained = 0
        unknown.forEach { old ->
            val result = runCatching {
                LocalProjectDigestService(appContext).digestFrozen(old.getString("projectId"), old.getJSONArray("frozenMaterials"),
                    old.optString("studentId"), cacheOnly = true)
            }.getOrNull()
            if (result == null) { retained++; return@forEach }
            synchronized(STATE_LOCK) state@{
                val root = read(); val job = root.getJSONArray("jobs").objects().singleOrNull { it.optString("jobId") == old.optString("jobId") }
                if (job == null || job.optString("status") != "needs_user" ||
                    job.getJSONArray("frozenMaterials").toString() != old.getJSONArray("frozenMaterials").toString()) {
                    retained++; return@state
                }
                job.put("status", "completed").put("result", result).put("recoveryMethod", "verified_local_checkpoint")
                    .put("message", "已核对本机检查点和固定来源并恢复产物；未再次调用模型")
                    .put("updatedAt", Timestamp.now()).put("completedAt", Timestamp.now())
                write(root); recovered++
            }
        }
        JSONObject().put("recovered", recovered).put("retainedUnknown", retained)
    }

    internal fun start(jobId: String): JSONObject? = synchronized(STATE_LOCK) {
        val root = read(); val job = root.getJSONArray("jobs").objects().singleOrNull { it.optString("jobId") == jobId } ?: return@synchronized null
        if (job.optString("status") == "running" && job.optString("processSession") != BusinessDatabase.processSession) {
            job.put("status", "needs_user").put("errorCode", "process_interrupted")
                .put("message", "上次执行结果未知，请核对资料和计费；不会自动重试").put("updatedAt", Timestamp.now())
            write(root); return@synchronized null
        }
        if (job.optString("status") != "queued") return@synchronized null
        job.put("status", "running").put("attempt", job.optInt("attempt") + 1)
            .put("processSession", BusinessDatabase.processSession)
            .put("message", "正在使用固定资料版本生成知识候选").put("updatedAt", Timestamp.now())
        write(root); JSONObject(job.toString())
    }

    internal fun complete(jobId: String, result: JSONObject) = finish(jobId, "completed",
        "已处理 ${result.optInt("processed")} 份固定资料", result)

    internal fun fail(jobId: String, error: Throwable) = finish(jobId, if (error is IllegalStateException && error.message.orEmpty().contains("结果未知")) "needs_user" else "failed",
        (error.message ?: "项目资料消化失败").take(600), null)

    private fun finish(jobId: String, status: String, message: String, result: JSONObject?) = synchronized(STATE_LOCK) {
        val root = read(); val job = root.getJSONArray("jobs").objects().singleOrNull { it.optString("jobId") == jobId } ?: return@synchronized
        require(job.optString("status") == "running" && job.optString("processSession") == BusinessDatabase.processSession) { "任务已变化，拒绝迟到结果" }
        job.put("status", status).put("message", message).put("updatedAt", Timestamp.now())
            .put("completedAt", Timestamp.now()).put("result", result ?: JSONObject.NULL)
        write(root)
    }

    fun acknowledgeUnknown(projectId: String, jobId: String) = synchronized(ProjectDigestLocks.execution) { synchronized(STATE_LOCK) {
        ProjectRepository(appContext).requireExact(projectId)
        val root = read(); val job = root.getJSONArray("jobs").objects().single { it.getString("jobId") == jobId && it.getString("projectId") == projectId }
        require(job.getString("status") == "needs_user")
        job.put("status", "cancelled").put("message", "用户已核对并结束未知任务；不自动重试").put("updatedAt", Timestamp.now())
        write(root)
    } }

    private fun schedule(job: JSONObject) {
        val request = OneTimeWorkRequestBuilder<ProjectDigestWorker>()
            .setInputData(Data.Builder().putString("jobId", job.getString("jobId")).build())
            .setConstraints(BackgroundWorkPolicy.remoteConstraints)
            .build()
        WorkManager.getInstance(appContext).enqueueUniqueWork(
            workName(job.getString("jobId")),
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    private fun read(): JSONObject {
        val bytes = state.readIfPresent(PATH) ?: return JSONObject().put("schema", SCHEMA).put("jobs", JSONArray())
        return JSONObject(bytes.toString(Charsets.UTF_8)).also {
            require(it.getString("schema") == SCHEMA)
            val jobs = it.getJSONArray("jobs")
            val ids = List(jobs.length()) { i -> jobs.getJSONObject(i).getString("jobId") }
            require(ids.all(String::isNotBlank) && ids.distinct().size == ids.size) { "队列损坏，原记录保留" }
        }
    }
    private fun write(root: JSONObject) { root.put("updatedAt", Timestamp.now()); state.writeBytes(PATH, (root.toString(2) + "\n").toByteArray()) }
    private fun trim(jobs: JSONArray) {
        val all = jobs.objects(); if (all.size <= MAX_JOBS) return
        val protected = all.filter { it.optString("status") in ACTIVE || it.optString("status") == "needs_user" }
        require(protected.size <= MAX_JOBS) { "队列已满，请先处理待核对任务" }
        val retained = protected + all.filterNot { it in protected }.takeLast(MAX_JOBS - protected.size)
        while (jobs.length() > 0) jobs.remove(jobs.length() - 1); retained.sortedBy { it.optString("createdAt") }.forEach(jobs::put)
    }
    private fun JSONArray.objects() = (0 until length()).mapNotNull(::optJSONObject)

    companion object {
        private const val PATH = "project-digest-queue.json"
        private const val SCHEMA = "edu-manager.android-project-digest-queue.v1"
        private const val MAX_JOBS = 100
        private val ACTIVE = setOf("queued", "running")
        private val STATE_LOCK = Any()
        private fun workName(jobId: String) = "android-standalone-$jobId"
    }
}

class ProjectDigestWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result = synchronized(ProjectDigestLocks.execution) {
        if (runCatching { BusinessRestoreRecovery.recover(applicationContext) }.isFailure) return@synchronized Result.failure()
        val jobId = inputData.getString("jobId") ?: return@synchronized Result.failure()
        val queue = ProjectDigestQueue(applicationContext)
        val job = queue.start(jobId) ?: return@synchronized Result.success()
        if (job.optString("status") !in setOf("queued", "running")) return@synchronized Result.success()
        return@synchronized runCatching {
            require(LicenseManager(applicationContext).status().active) { "产品尚未激活" }
            requireNotNull(AgentConfigurationStore(applicationContext).load()) { "尚未配置任务 Agent" }
            if (job.optString("studentId").isBlank()) LocalProjectDigestService(applicationContext).digestFrozen(job.getString("projectId"), job.getJSONArray("frozenMaterials"))
            else LocalProjectDigestService(applicationContext).digestFrozen(job.getString("projectId"), job.getJSONArray("frozenMaterials"), job.getString("studentId"))
        }.fold(onSuccess = {
            queue.complete(jobId, it)
            runCatching { queue.enqueueAutomatic(job.getString("projectId")) }
            Result.success()
        }, onFailure = { queue.fail(jobId, it); Result.success() })
    }

}
