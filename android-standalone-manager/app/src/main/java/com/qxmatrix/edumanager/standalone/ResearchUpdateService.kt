package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object ResearchUpdatePolicy {
    val modules = setOf("overview", "pathways", "schools", "majors", "careers", "competitions")
    fun due(previous: JSONObject?, fingerprint: String): Boolean = previous == null ||
        (previous.optString("state") == "succeeded" && previous.optString("fingerprint") != fingerprint)
    fun expiryLabel(payload: JSONObject, today: String = Timestamp.now().take(10)): String {
        if (payload.optString("module") != "competitions") return ""
        val items = payload.optJSONObject("result")?.optJSONArray("items") ?: return ""
        val expired = (0 until items.length()).count { index ->
            val item = items.getJSONObject(index)
            val date = Regex("(?<!\\d)\\d{4}-\\d{2}-\\d{2}(?!\\d)").find(item.optString("deadline"))?.value
            date != null && runCatching {
                val format = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT).apply { isLenient = false; timeZone = java.util.TimeZone.getTimeZone("UTC") }
                format.parse(date); format.parse(today); date < today
            }.getOrDefault(false)
        }
        return if (expired > 0) "$expired 项候选截止日期已过（来源仍待核验）；历史收藏保留" else "截止日期请按来源人工核验"
    }
}

/** Separate explicit consent; no raw file selection. At most one research module per check.
 * Persist the attempt BEFORE a model call so process death never creates an automatic retry. */
class ResearchUpdateService(private val context: Context) {
    private val db = BusinessDatabase.get(context)
    private fun key(studentId: String) = "studio-auto:research:$studentId"
    fun setEnabled(studentId: String, module: String, enabled: Boolean) {
        StudentIndexRepository(context).requireExact(studentId); require(module in ResearchUpdatePolicy.modules)
        db.runInTransaction {
            val settings = db.tasks().metadata(key(studentId))?.let(::JSONObject) ?: JSONObject()
            val modules = settings.optJSONArray("modules")?.let { array -> List(array.length()) { array.getString(it) }.toMutableSet() } ?: mutableSetOf()
            if (enabled) modules += module else modules -= module
            settings.put("enabled", modules.isNotEmpty()).put("modules", JSONArray(modules.sorted())).put("consentedAt", Timestamp.now())
            db.tasks().metadata(BusinessMetadataEntity(key(studentId), settings.toString()))
        }
        if (enabled) StudioAutomation.schedule(context)
    }
    fun acknowledgeUnknown(studentId: String, module: String) {
        StudentIndexRepository(context).requireExact(studentId); require(module in ResearchUpdatePolicy.modules)
        val receiptKey = "research-update:$studentId:$module"
        db.runInTransaction {
            val previous = db.tasks().metadata(receiptKey)?.let(::JSONObject) ?: return@runInTransaction
            require(previous.optString("state") != "succeeded")
            // This clears only scheduler acknowledgement. Model receipt protection remains in force.
            db.tasks().metadata(BusinessMetadataEntity(receiptKey, previous.put("state", "succeeded").put("fingerprint", "acknowledged").toString()))
        }
    }
    fun check(studentId: String): String = synchronized(StudentWorkLocks.forStudent(studentId)) {
        StudentIndexRepository(context).requireExact(studentId)
        val settings = db.tasks().metadata(key(studentId))?.let(::JSONObject)
        if (settings == null || !settings.optBoolean("enabled", false)) return@synchronized "研究更新未授权"
        require(LicenseManager(context).status().active) { "产品未激活" }
        val modules = settings.getJSONArray("modules")
        for (index in 0 until modules.length()) {
            val module = modules.getString(index); require(module in ResearchUpdatePolicy.modules)
            val topic = "基于当前去标识档案更新建议；缺少证据明确待核验，不认定能力，不自动申请或报名"
            val input = StudioInputFactory(context).prepare(studentId, module, emptyList(), topic, 3, false).input
            val fingerprint = ScopedContentPolicy.fingerprint(input) // Includes month and profile/goal changes.
            val receiptKey = "research-update:$studentId:$module"
            val previous = db.tasks().metadata(receiptKey)?.let(::JSONObject)
            if (!ResearchUpdatePolicy.due(previous, fingerprint)) continue
            val config = requireNotNull(AgentConfigurationStore(context).load()) { "尚未配置研究模型" }
            val used = db.tasks().metadata("studio-budget:$studentId:${Timestamp.now().take(10)}")?.let(::JSONObject)?.getInt("reserved") ?: 0
            require(used >= 0)
            if (used >= StudioBudget.DAILY_CAP) return@synchronized "今日额度已用完，更新保留至次日检查（尚未发送请求）"
            val started = JSONObject().put("state", "unknown").put("fingerprint", fingerprint).put("startedAt", Timestamp.now())
            db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.toString()))
            try {
                val service = LearningStudioService(context, ModelRuntime.provider(context, config), config.model)
                val version = service.generate(studentId, module, emptyList(), topic, 3, false, ModelCancellation(), fingerprint)
                db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.put("state", "succeeded").put("versionId", version.id).put("completedAt", Timestamp.now()).toString()))
                return@synchronized "${LearningStudioService.moduleLabels[module]} 已更新候选；来源待人工核验"
            } catch (error: Exception) {
                db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.put("message", error.message ?: "结果需核对").toString()))
                throw error
            }
        }
        "本月档案未变化，或存在需要核对的请求；不重复调用"
    }
}
