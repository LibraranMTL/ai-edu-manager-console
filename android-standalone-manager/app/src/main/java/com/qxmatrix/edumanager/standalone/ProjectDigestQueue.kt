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
    private val textExtensions = setOf("txt", "md", "markdown", "csv", "json", "jpg", "jpeg", "png", "webp", "pdf")
    fun eligibleMaterial(row: JSONObject): Boolean = row.optString("adoption") == "accepted" &&
        row.optString("availability") == "available" && row.optJSONObject("processing")?.optString("state") == "pending" &&
        row.optString("title").substringAfterLast('.', "").lowercase() in textExtensions
    fun permitted(fullMode: Boolean, licensed: Boolean, configured: Boolean, studentCount: Int,
        projectStatus: String, lastStatus: String): Boolean = fullMode && licensed && configured && studentCount >= 1 &&
        projectStatus !in setOf("sealed", "archived") && lastStatus !in setOf("queued", "running", "failed", "needs_user")
    fun scope(automatic: Boolean, students: List<String>, selected: String): String =
        if (automatic && students.size > 1) "" else selected.takeIf { it in students } ?: students.singleOrNull().orEmpty()
    fun sameMembership(expected: List<String>, actual: List<String>): Boolean = expected.isNotEmpty() &&
        expected.none(String::isBlank) && expected.distinct().size == expected.size &&
        actual.distinct().size == actual.size && expected.sorted() == actual.sorted()
}

object ProjectLegacyRecoveryPolicy {
    fun eligible(job: JSONObject, projectId: String, operation: String): Boolean {
        if (job.optString("projectId") != projectId || job.optString("status") != "completed" ||
            !operation.matches(Regex("project-digest-[0-9a-f]{32}"))) return false
        val frozen = job.optJSONArray("frozenMaterials") ?: return false
        val result = job.optJSONObject("result") ?: return false
        return frozen.length() in 1..50 && result.optString("operationId") == operation &&
            result.optInt("processed") == frozen.length() &&
            result.optString("artifactPath").endsWith("/资料消化-$operation.md")
    }
}

private object ProjectDigestLocks { val execution = Any() }

/** Durable, bounded queue for project knowledge digestion. Original files never live in this queue. */
class ProjectDigestQueue(context: Context) {
    private val appContext = context.applicationContext
    private val state = PrivateStateStore(appContext)

    fun enqueue(projectId: String, maximum: Int = 20, automatic: Boolean = false): JSONObject = synchronized(STATE_LOCK) {
        val project = ProjectRepository(appContext).requireExact(projectId)
        val selectedStudent = appContext.getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, Context.MODE_PRIVATE).getString(MainActivity.KEY_CURRENT_STUDENT_ID, "").orEmpty()
        val scopeStudent = ProjectAutoDigestPolicy.scope(automatic, project.studentIds, selectedStudent)
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
        if (automatic) job.put("boundStudentIds", JSONArray(project.studentIds.sorted()))
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
        project.studentIds.forEach { StudentIndexRepository(appContext).requireExact(it) }
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
        root.getJSONArray("jobs").objects().filter { it.optString("status") == "completed" }
            .map { it.optString("projectId") }.filter(String::isNotBlank).distinct().forEach(::scheduleLegacyRecovery)
    }

    fun scheduleLegacyRecovery(projectId: String) {
        val work = OneTimeWorkRequestBuilder<ProjectLegacyProvenanceWorker>()
            .setInputData(Data.Builder().putString("projectId", projectId).build()).build()
        WorkManager.getInstance(appContext).enqueueUniqueWork("android-standalone-project-provenance-$projectId", ExistingWorkPolicy.KEEP, work)
    }

    /** Reconstruct only a completed, unique job using its exact cached response and unchanged sources. */
    fun recoverCompletedProvenance(projectId: String): JSONObject = synchronized(ProjectDigestLocks.execution) {
        val project = ProjectRepository(appContext).requireExact(projectId)
        val jobs = synchronized(STATE_LOCK) { read().getJSONArray("jobs").objects()
            .filter { it.optString("projectId") == projectId && it.optString("status") == "completed" }
            .map { JSONObject(it.toString()) } }
        val groups = jobs.filter { it.optJSONObject("result")?.optString("operationId")?.matches(Regex("project-digest-[0-9a-f]{32}")) == true }
            .groupBy { it.getJSONObject("result").getString("operationId") }
        var restored = 0; var retained = 0
        val reasons = mutableMapOf<String, Int>()
        fun recordReason(reason: String) { reasons[reason] = (reasons[reason] ?: 0) + 1 }
        val store = SafWorkspaceStore(appContext, android.net.Uri.parse(project.projectRootUri))
        groups.forEach { (operation, candidates) ->
            val path = "${project.paths.managerPath}/project-materials/digest-provenance/$operation.json"
            if (store.exists(path)) return@forEach
            val job = candidates.singleOrNull()
            if (job == null || !ProjectLegacyRecoveryPolicy.eligible(job, projectId, operation)) {
                retained++; recordReason("ambiguous_or_incomplete_job"); return@forEach
            }
            val frozen = job.getJSONArray("frozenMaterials")
            val attempt = runCatching {
                LocalProjectDigestService(appContext).digestFrozen(projectId, frozen, job.optString("studentId"),
                    cacheOnly = true, expectedOperationId = operation, provenanceOnly = true)
            }
            if (attempt.getOrNull()?.optString("operationId") == operation && store.exists(path)) restored++ else {
                retained++
                val message = attempt.exceptionOrNull()?.message.orEmpty()
                val reason = when {
                    message.contains("任务检查点与历史产物") -> "configuration_or_operation_changed"
                    message.contains("没有可核验的项目模型检查点") -> "checkpoint_missing"
                    message.contains("检查点与固定来源") -> "checkpoint_source_mismatch"
                    message.contains("项目原件") || message.contains("固定版本") || message.contains("固定快照") -> "source_unavailable_or_changed"
                    message.contains("已有项目知识产物") || message.contains("历史项目产物缺失") -> "artifact_missing_or_changed"
                    else -> "other_verification_failure"
                }
                recordReason(reason)
            }
        }
        android.util.Log.i("ProjectLegacyRecovery", "completedJobs=${jobs.size} operations=${groups.size} restored=$restored retained=$retained reasons=$reasons")
        JSONObject().put("restored", restored).put("retained", retained)
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

    /** An explicit user decision creates exactly one job bound to the original frozen sources. */
    fun authorizeUnknownRetry(projectId: String, jobId: String): JSONObject = synchronized(ProjectDigestLocks.execution) { synchronized(STATE_LOCK) {
        val project = ProjectRepository(appContext).requireExact(projectId)
        val root = read(); val jobs = root.getJSONArray("jobs"); val old = jobs.objects().single { it.optString("jobId") == jobId && it.optString("projectId") == projectId }
        require(old.optString("status") == "needs_user") { "原任务已变化，不重复授权" }
        require(jobs.objects().none { it.optString("projectId") == projectId && it.optString("status") in ACTIVE }) { "项目已有运行中的消化任务" }
        require(jobs.objects().count { it.optString("projectId") == projectId && it.optString("status") == "needs_user" } == 1) { "项目有多项未知任务，请逐项核对" }
        val studentId = old.optString("studentId")
        require(studentId.isNotBlank() && studentId in project.studentIds) { "原任务学生范围已变化" }
        StudentIndexRepository(appContext).requireExact(studentId)
        val frozen = JSONArray(old.getJSONArray("frozenMaterials").toString()); require(frozen.length() in 1..50)
        val materials = LocalProjectMaterialService(appContext)
        for (i in 0 until frozen.length()) {
            val item = frozen.getJSONObject(i)
            materials.readFrozenVersionBytes(projectId, item.getString("materialId"), item.getInt("version"), item.getString("sha256"))
        }
        val newId = "project-digest-${UUID.randomUUID()}"; val now = Timestamp.now()
        val ticket = JSONObject().put("state", "authorized").put("jobId", newId).put("projectId", projectId)
            .put("studentId", studentId).put("originalJobId", jobId).put("authorizedAt", now)
            .put("frozenFingerprint", ScopedContentPolicy.fingerprint(JSONObject().put("frozen", frozen)))
        BusinessDatabase.get(appContext).tasks().metadata(BusinessMetadataEntity("project-digest-retry:$newId", ticket.toString()))
        old.put("status", "cancelled").put("message", "用户授权固定资料单次重试；原结果仍为未知")
            .put("retryJobId", newId).put("updatedAt", now)
        val job = JSONObject().put("jobId", newId).put("projectId", projectId).put("studentId", studentId)
            .put("status", "queued").put("attempt", 0).put("frozenMaterials", frozen).put("retryOriginalJobId", jobId)
            .put("createdAt", now).put("updatedAt", now).put("message", "用户授权单次重试，等待系统执行")
        jobs.put(job); trim(jobs); write(root); schedule(job); JSONObject(job.toString())
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
            job.optJSONArray("boundStudentIds")?.let { expected ->
                val ids = (0 until expected.length()).map { expected.getString(it) }.sorted()
                require(ProjectAutoDigestPolicy.sameMembership(ids, ProjectRepository(applicationContext).requireExact(job.getString("projectId")).studentIds)) {
                    "项目学生关联在执行前变化，保留固定资料并停止自动消化"
                }
            }
            val retryJobId = if (job.optString("retryOriginalJobId").isNotBlank()) jobId else ""
            if (job.optString("studentId").isBlank()) LocalProjectDigestService(applicationContext).digestFrozen(job.getString("projectId"), job.getJSONArray("frozenMaterials"), retryJobId = retryJobId)
            else LocalProjectDigestService(applicationContext).digestFrozen(job.getString("projectId"), job.getJSONArray("frozenMaterials"), job.getString("studentId"), retryJobId = retryJobId)
        }.fold(onSuccess = {
            queue.complete(jobId, it)
            runCatching { queue.enqueueAutomatic(job.getString("projectId")) }
            Result.success()
        }, onFailure = { queue.fail(jobId, it); Result.success() })
    }

}

/** Runs only local cached verification; never starts a model request. */
class ProjectLegacyProvenanceWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val projectId = inputData.getString("projectId") ?: return Result.failure()
        return runCatching { ProjectDigestQueue(applicationContext).recoverCompletedProvenance(projectId) }
            .fold(onSuccess = { Result.success() }, onFailure = { Result.retry() })
    }
}
