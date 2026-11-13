package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.SocketTimeoutException
import java.time.Instant
import java.util.concurrent.TimeUnit

enum class AutomationMode(val wireValue: String, val label: String) {
    OFF("off", "关闭"), CONSERVATIVE("conservative", "保守自动"), FULL("full", "完整自动");
    companion object { fun from(value: String) = entries.firstOrNull { it.wireValue == value } ?: OFF }
}

enum class AutomationEventType(val wireValue: String) {
    MATERIAL_IMPORTED("material_imported"), OCR_COMPLETED("ocr_completed"), DIGEST_COMPLETED("digest_completed"),
    SOURCE_CONFLICT("source_conflict"), ATTRIBUTION_UNCLEAR("attribution_unclear"), SENSITIVE_CONTENT("sensitive_content"),
    QUALITY_FAILED("quality_failed"), LEARNING_SNAPSHOT_CHANGED("learning_snapshot_changed"),
    PROJECT_SNAPSHOT_CHANGED("project_snapshot_changed"), LEARNING_CARD_ANSWERED("learning_card_answered"),
    DAILY_RECONCILIATION("daily_reconciliation"), PUBLIC_CONTENT_CHANGED("public_content_changed");
}

enum class AutomationAction(val wireValue: String, val label: String, val remote: Boolean) {
    CLASSIFY_MATERIAL("classify_material", "资料分类", false), OCR_MATERIAL("ocr_material", "OCR与文档解析", false),
    DIGEST_MATERIAL("digest_material", "资料消化", true),
    VALIDATE_FACTS("validate_facts", "事实与来源校验", false), GENERATE_LEARNING_OUTPUTS("generate_learning_outputs", "学习卡与行动更新", true),
    GENERATE_REPORTS("generate_reports", "学情报告更新", true), GENERATE_PROJECT_OUTPUTS("generate_project_outputs", "项目进展报告更新", false),
    RECONCILE_LEARNING_CARD("reconcile_learning_card", "学习卡作答回流", true), RESOLVE_SOURCE_CONFLICT("resolve_source_conflict", "来源冲突处理", false),
    RESOLVE_ATTRIBUTION("resolve_attribution", "资料归属处理", false), REDACT_PROJECTION("redact_projection", "敏感内容脱敏", false),
    REPAIR_OUTPUT("repair_output", "质量修复", false), RECONCILE_ALL("reconcile_all", "失败对账", false),
    SYNC_PUBLIC_CONTENT("sync_public_content", "公共内容同步", true);
    companion object { fun from(value: String) = entries.single { it.wireValue == value } }
}

/** The matrix is deterministic and has no side effects; screen refreshes never call it. */
object AutomationTriggerPolicy {
    fun actions(event: AutomationEventType, mode: AutomationMode): List<AutomationAction> {
        if (event == AutomationEventType.DAILY_RECONCILIATION) return listOf(AutomationAction.RECONCILE_ALL)
        if (event == AutomationEventType.PUBLIC_CONTENT_CHANGED) return listOf(AutomationAction.SYNC_PUBLIC_CONTENT)
        if (mode == AutomationMode.OFF) return emptyList()
        val common = when (event) {
            AutomationEventType.MATERIAL_IMPORTED -> listOf(AutomationAction.CLASSIFY_MATERIAL, AutomationAction.OCR_MATERIAL)
            AutomationEventType.OCR_COMPLETED -> listOf(AutomationAction.DIGEST_MATERIAL)
            AutomationEventType.DIGEST_COMPLETED -> listOf(AutomationAction.VALIDATE_FACTS, AutomationAction.GENERATE_LEARNING_OUTPUTS)
            AutomationEventType.SOURCE_CONFLICT -> listOf(AutomationAction.RESOLVE_SOURCE_CONFLICT)
            AutomationEventType.ATTRIBUTION_UNCLEAR -> listOf(AutomationAction.RESOLVE_ATTRIBUTION)
            AutomationEventType.SENSITIVE_CONTENT -> listOf(AutomationAction.REDACT_PROJECTION)
            AutomationEventType.QUALITY_FAILED -> listOf(AutomationAction.REPAIR_OUTPUT)
            AutomationEventType.LEARNING_SNAPSHOT_CHANGED -> listOf(AutomationAction.GENERATE_LEARNING_OUTPUTS)
            AutomationEventType.PROJECT_SNAPSHOT_CHANGED -> emptyList()
            AutomationEventType.LEARNING_CARD_ANSWERED -> listOf(AutomationAction.RECONCILE_LEARNING_CARD)
            else -> emptyList()
        }
        if (mode != AutomationMode.FULL) return common
        return when (event) {
            AutomationEventType.DIGEST_COMPLETED, AutomationEventType.LEARNING_SNAPSHOT_CHANGED -> common + AutomationAction.GENERATE_REPORTS
            AutomationEventType.PROJECT_SNAPSHOT_CHANGED -> listOf(AutomationAction.GENERATE_PROJECT_OUTPUTS)
            else -> common
        }
    }
}

enum class AutomationFailureClass(val wireValue: String) {
    TRANSIENT("transient"), CAPABILITY_MISSING("capability_missing"), INPUT_PROBLEM("input_problem"),
    EXECUTION_UNKNOWN("execution_unknown"), PERMANENT("permanent")
}

class AutomationExecutionException(val code: String, val classification: AutomationFailureClass,
    val resultUnknown: Boolean = false, message: String) : IllegalStateException(message)

data class AutomationFailureDecision(val classification: AutomationFailureClass, val code: String,
    val resultUnknown: Boolean, val autoRetry: Boolean, val attentionRequired: Boolean, val nextRetryAt: String)

object AutomationFailurePolicy {
    private val delays = longArrayOf(5 * 60, 30 * 60, 2 * 60 * 60)
    fun decide(error: Throwable, attempt: Int, maxAttempts: Int, nowMillis: Long = System.currentTimeMillis()): AutomationFailureDecision {
        val classified = classify(error)
        val retryLimit = when (classified.first) {
            AutomationFailureClass.INPUT_PROBLEM -> 2
            AutomationFailureClass.EXECUTION_UNKNOWN, AutomationFailureClass.PERMANENT -> 0
            else -> maxAttempts
        }
        val retry = !classified.third && attempt < retryLimit
        val attention = when (classified.first) {
            AutomationFailureClass.PERMANENT -> true
            AutomationFailureClass.INPUT_PROBLEM -> !retry
            AutomationFailureClass.TRANSIENT, AutomationFailureClass.CAPABILITY_MISSING -> attempt >= maxAttempts
            AutomationFailureClass.EXECUTION_UNKNOWN -> false
        }
        val delay = delays.getOrElse((attempt - 1).coerceAtLeast(0)) { delays.last() }
        return AutomationFailureDecision(classified.first, classified.second, classified.third, retry, attention,
            if (retry) Instant.ofEpochMilli(nowMillis + delay * 1_000).toString() else "")
    }

    private fun classify(error: Throwable): Triple<AutomationFailureClass, String, Boolean> {
        if (error is AutomationExecutionException) return Triple(error.classification, error.code, error.resultUnknown)
        val message = error.message.orEmpty()
        if (message.contains("结果未知") || message.contains("可能已计费")) return Triple(AutomationFailureClass.EXECUTION_UNKNOWN, "execution_unknown", true)
        if (error is SocketTimeoutException || error is IOException) return Triple(AutomationFailureClass.TRANSIENT, "transport_unavailable", false)
        if (message.contains("尚未配置") || message.contains("尚未激活") || message.contains("不可用")) return Triple(AutomationFailureClass.CAPABILITY_MISSING, "capability_unavailable", false)
        if (error is IllegalArgumentException || error is NoSuchElementException) return Triple(AutomationFailureClass.INPUT_PROBLEM, "input_invalid", false)
        return Triple(AutomationFailureClass.PERMANENT, "unclassified_permanent", false)
    }
}

enum class AutomationReconciliationDecision { NONE, RESCHEDULE, REQUEUE, PROBE_UNKNOWN, NEEDS_ATTENTION }

object AutomationReconciliationPolicy {
    fun decide(task: JSONObject, now: String = Timestamp.now()): AutomationReconciliationDecision {
        if (!task.optString("kind").startsWith("automation_")) return AutomationReconciliationDecision.NONE
        if (task.optJSONObject("error")?.optBoolean("attentionRequired") == true) return AutomationReconciliationDecision.NONE
        if (task.optString("status") == "queued") return AutomationReconciliationDecision.RESCHEDULE
        if (task.optString("status") == "waiting_result") {
            val expired = runCatching {
                val started = Instant.parse(task.getString("startedAt")); val current = Instant.parse(now)
                current.toEpochMilli() - started.toEpochMilli() >= 24 * 60 * 60 * 1_000L
            }.getOrDefault(false)
            return if (expired) AutomationReconciliationDecision.NEEDS_ATTENTION else AutomationReconciliationDecision.PROBE_UNKNOWN
        }
        if (task.optString("status") !in setOf("failed", "blocked", "timed_out") || !task.optBoolean("autoRetry")) return AutomationReconciliationDecision.NONE
        if (task.optInt("attempt") >= task.optInt("maxAttempts")) return AutomationReconciliationDecision.NEEDS_ATTENTION
        val due = task.optString("nextRetryAt")
        return if (due.isBlank() || due <= now) AutomationReconciliationDecision.REQUEUE else AutomationReconciliationDecision.NONE
    }
}

class AutomationOrchestrator(private val context: Context) {
    private val tasks = TaskRepository(context)

    fun emit(event: AutomationEventType, studentId: String, sourceFingerprint: String,
        sourceIds: List<String> = emptyList(), projectId: String = ""): List<JSONObject> {
        require(sourceFingerprint.isNotBlank()) { "自动化事件缺少稳定来源指纹" }
        if (studentId.isNotBlank()) StudentIndexRepository(context).requireExact(studentId)
        val mode = AutomationMode.from(AutoDigestSettingsStore(context).load().automationMode)
        return AutomationTriggerPolicy.actions(event, mode).map { action ->
            val key = BackgroundWorkPolicy.idempotencyKey("${event.wireValue}:${action.wireValue}", studentId.ifBlank { "system" }, sourceFingerprint)
            val input = JSONObject().put("studentId", studentId).put("projectId", projectId)
                .put("eventType", event.wireValue).put("actionType", action.wireValue)
                .put("sourceFingerprint", sourceFingerprint).put("sourceIds", JSONArray(sourceIds))
            val task = tasks.createOrGet(JSONObject().put("id", "automation-${key.take(40)}")
                .put("title", action.label).put("kind", "automation_${action.wireValue}")
                .put("sourceType", if (projectId.isNotBlank()) "project" else if (studentId.isNotBlank()) "student" else "system")
                .put("sourceId", projectId.ifBlank { studentId.ifBlank { "system" } })
                .put("status", "queued").put("trigger", event.wireValue).put("idempotencyKey", key)
                .put("completionPolicy", "automatic_validated").put("riskLevel", "low")
                .put("maxAttempts", 4).put("input", input))
            if (task.optString("status") == "queued") ensureScheduled(context, task)
            task
        }
    }

    companion object {
        internal fun workName(action: AutomationAction, studentId: String, taskId: String): String =
            if (studentId.isNotBlank()) BackgroundWorkPolicy.uniqueName(if (action.remote) "automation-remote" else "automation-local", studentId)
            else "automation-action-$taskId"

        internal fun enqueue(context: Context, task: JSONObject) {
            val action = AutomationAction.from(task.getJSONObject("input").getString("actionType"))
            val builder = OneTimeWorkRequestBuilder<AutomationActionWorker>()
                .setInputData(workDataOf("taskId" to task.getString("id")))
                .addTag("automation-task:${task.getString("id")}")
            if (action.remote) BackgroundWorkPolicy.applyRemote(builder) else builder.setConstraints(BackgroundWorkPolicy.localConstraints)
            val studentId = task.getJSONObject("input").optString("studentId")
            val workName = workName(action, studentId, task.getString("id"))
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                workName, ExistingWorkPolicy.APPEND_OR_REPLACE, builder.build())
        }

        internal fun ensureScheduled(context: Context, task: JSONObject): Boolean {
            val manager = WorkManager.getInstance(context.applicationContext)
            val active = manager.getWorkInfosByTag("automation-task:${task.getString("id")}").get()
                .any { !it.state.isFinished }
            if (active) return false
            enqueue(context, task)
            return true
        }
    }
}

class AutomationActionExecutor(private val context: Context) {
    fun execute(task: JSONObject): JSONObject {
        val input = task.getJSONObject("input")
        val studentId = input.optString("studentId")
        val action = AutomationAction.from(input.getString("actionType"))
        val sourceIds = input.optJSONArray("sourceIds")?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty()
        val adapters = AutomationTriggerAdapters(context)
        val result = when (action) {
            AutomationAction.CLASSIFY_MATERIAL -> adapters.classify(studentId, sourceIds)
            AutomationAction.OCR_MATERIAL -> adapters.runOcrOrParser(studentId, sourceIds)
            AutomationAction.VALIDATE_FACTS -> validateMaterials(studentId, sourceIds)
            AutomationAction.DIGEST_MATERIAL -> StudentDigestOrchestrator(context).digestSelected(studentId, sourceIds.toSet(),
                explicitUserAction = false, automationTaskId = task.getString("id"), automationExecutionId = task.getString("executionId"))
            AutomationAction.GENERATE_LEARNING_OUTPUTS, AutomationAction.RECONCILE_LEARNING_CARD ->
                JSONObject().put("message", StudioAutomation(context).check(studentId, requireEnabled = false))
            AutomationAction.GENERATE_REPORTS -> GrowthModelService(context).generateAndPublishReportsIfChanged(studentId)
            AutomationAction.RECONCILE_ALL -> AutomationReconciliationService(context).reconcile()
            AutomationAction.SYNC_PUBLIC_CONTENT -> PublicCourseSyncService(context).sync()
            AutomationAction.GENERATE_PROJECT_OUTPUTS -> adapters.generateProjectSnapshot(input.getString("projectId"), input.getString("sourceFingerprint"))
            AutomationAction.RESOLVE_SOURCE_CONFLICT -> adapters.resolveSourceConflict(studentId, sourceIds)
            AutomationAction.RESOLVE_ATTRIBUTION -> adapters.resolveAttribution(studentId, sourceIds)
            AutomationAction.REDACT_PROJECTION -> adapters.redactProjection(studentId, sourceIds, input.getString("sourceFingerprint"))
            AutomationAction.REPAIR_OUTPUT -> adapters.repairQuality(studentId, sourceIds)
        }
        return JSONObject().put("action", action.wireValue).put("completedAt", Timestamp.now()).put("result", result)
    }

    private fun validateMaterials(studentId: String, sourceIds: List<String>): JSONObject {
        require(studentId.isNotBlank() && sourceIds.isNotEmpty()) { "资料校验缺少学生或来源" }
        val indexed = FileAssetService(context).materials(studentId).associateBy { it.getString("id") }
        val selected = sourceIds.map { requireNotNull(indexed[it]) { "来源资料不存在" } }
        require(selected.all { MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PROCESSED }) { "资料尚未全部完成消化" }
        return JSONObject().put("validated", selected.size)
    }
}

class AutomationActionWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val taskId = inputData.getString("taskId") ?: return Result.failure()
        val tasks = TaskRepository(applicationContext)
        val running = runCatching { tasks.start(taskId) }.getOrElse { return Result.success() }
        val studentId = running.getJSONObject("input").optString("studentId")
        return runCatching {
            if (studentId.isBlank()) AutomationActionExecutor(applicationContext).execute(running)
            else synchronized(StudentWorkLocks.forStudent(studentId)) { AutomationActionExecutor(applicationContext).execute(running) }
        }.fold(
            onSuccess = {
                tasks.recordInternalReceipt(taskId, running.getString("executionId"), it)
                tasks.completeInternal(taskId, running.getString("executionId"), it)
                Result.success()
            },
            onFailure = { error ->
                val decision = AutomationFailurePolicy.decide(error, running.optInt("attempt"), running.optInt("maxAttempts"))
                val payload = JSONObject().put("code", decision.code).put("classification", decision.classification.wireValue)
                    .put("message", (error.message ?: "自动任务未完成").take(600)).put("attentionRequired", decision.attentionRequired)
                tasks.failInternal(taskId, payload, decision.nextRetryAt, decision.autoRetry, decision.resultUnknown,
                    executionId = running.getString("executionId"))
                if (decision.autoRetry) {
                    val delay = runCatching { Instant.parse(decision.nextRetryAt).toEpochMilli() - System.currentTimeMillis() }.getOrDefault(0L)
                    AutomationReconciliationWorker.enqueueAfter(applicationContext, taskId, delay.coerceAtLeast(1_000L))
                }
                if (decision.resultUnknown) AutomationReconciliationWorker.enqueueAfter(applicationContext, taskId, 5_000L)
                Result.success()
            },
        )
    }
}

class AutomationReconciliationService(private val context: Context) {
    private val tasks = TaskRepository(context)
    fun reconcile(): JSONObject {
        var requeued = 0; var rescheduled = 0; var recovered = 0; var attention = 0; var waiting = 0; var errors = 0
        val events = AutomationEventRecovery(context).recover()
        errors += events.optInt("errors")
        var cursor = ""
        do {
            val page = tasks.pageAfter(cursor, 500)
            page.filter { it.optString("kind").startsWith("automation_") }.forEach { task ->
            when (AutomationReconciliationPolicy.decide(task)) {
                AutomationReconciliationDecision.RESCHEDULE -> runCatching {
                    if (AutomationOrchestrator.ensureScheduled(context, task)) rescheduled++
                }.onFailure { errors++ }
                AutomationReconciliationDecision.REQUEUE -> runCatching {
                    val queued = tasks.requeueInternal(task.getString("id")); AutomationOrchestrator.enqueue(context, queued); requeued++
                }.onFailure { errors++ }
                AutomationReconciliationDecision.PROBE_UNKNOWN -> {
                    val proof = probe(task)
                    if (proof != null) { runCatching { tasks.recoverInternal(task.getString("id"), proof) }.onSuccess { recovered++ }.onFailure { errors++ } }
                    else waiting++
                }
                AutomationReconciliationDecision.NEEDS_ATTENTION -> {
                    val proof = if (task.optString("status") == "waiting_result") probe(task) else null
                    if (proof != null) runCatching { tasks.recoverInternal(task.getString("id"), proof) }.onSuccess { recovered++ }.onFailure { errors++ }
                    else runCatching {
                        tasks.markInternalAttention(task.getString("id"), "结果无法确认或达到自动重试上限，原资料和旧版本均已保留"); attention++
                    }.onFailure { errors++ }
                }
                else -> Unit
            }
            }
            if (page.isNotEmpty()) cursor = page.last().getString("id")
        } while (page.size == 500)
        return JSONObject().put("requeued", requeued).put("rescheduled", rescheduled).put("errors", errors).put("recovered", recovered).put("waitingReceipt", waiting).put("eventRecovery", events)
            .put("needsAttention", attention).put("checkedAt", Timestamp.now())
    }

    private fun probe(task: JSONObject): JSONObject? {
        return AutomationReceiptPolicy.verifiedResult(task) ?: DigestBatchRecovery(context).receiptForTask(task)
    }
}

object AutomationReceiptPolicy {
    fun verifiedResult(task: JSONObject): JSONObject? {
        val receipt = task.optJSONObject("result") ?: return null
        if (receipt.optString("schema") != "automation-receipt-v1" ||
            receipt.optString("taskId") != task.optString("id") ||
            receipt.optString("executionId").isBlank() || receipt.optString("executionId") != task.optString("executionId") ||
            receipt.optString("idempotencyKey") != task.optString("idempotencyKey") ||
            receipt.optJSONObject("input")?.toString() != task.optJSONObject("input")?.toString()) return null
        val result = receipt.optJSONObject("result") ?: return null
        return JSONObject(result.toString()).put("recoveryTaskId", task.optString("id"))
            .put("recoveryExecutionId", task.optString("executionId"))
    }
}

class AutomationReconciliationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result = runCatching { AutomationReconciliationService(applicationContext).reconcile() }
        .fold(onSuccess = { summary ->
            if (summary.optInt("errors") > 0 && runAttemptCount < 3) Result.retry() else Result.success()
        }, onFailure = { if (runAttemptCount < 3) Result.retry() else Result.failure() })

    companion object {
        private const val IMMEDIATE = "android-automation-reconciliation-immediate-v1"
        private const val PERIODIC = "android-automation-reconciliation-periodic-v1"
        fun schedule(context: Context) {
            val manager = WorkManager.getInstance(context.applicationContext)
            manager.enqueueUniqueWork(IMMEDIATE, ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<AutomationReconciliationWorker>().setConstraints(BackgroundWorkPolicy.localConstraints).build())
            manager.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<AutomationReconciliationWorker>(24, TimeUnit.HOURS)
                    .setConstraints(BackgroundWorkPolicy.localConstraints).build())
        }
        internal fun retryWorkName(taskId: String): String {
            require(taskId.isNotBlank())
            return "android-automation-reconciliation-retry-${ScopedContentPolicy.hash(taskId.toByteArray()).take(32)}"
        }
        fun enqueueAfter(context: Context, taskId: String, delayMillis: Long) {
            val request = OneTimeWorkRequestBuilder<AutomationReconciliationWorker>()
                .setInitialDelay(delayMillis.coerceIn(1_000L, 2 * 60 * 60 * 1_000L), TimeUnit.MILLISECONDS)
                .setConstraints(BackgroundWorkPolicy.localConstraints).build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                retryWorkName(taskId), ExistingWorkPolicy.REPLACE, request)
        }
    }
}
