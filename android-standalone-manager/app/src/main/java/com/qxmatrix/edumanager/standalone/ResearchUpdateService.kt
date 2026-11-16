package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object ResearchUpdatePolicy {
    val modules = linkedSetOf("overview", "pathways", "schools", "majors", "careers", "competitions")

    fun due(previous: JSONObject?, fingerprint: String): Boolean = previous == null ||
        previous.optString("state") in setOf("queued", "failed") ||
        (previous.optString("state") == "succeeded" && previous.optString("fingerprint") != fingerprint)

    fun expiryLabel(payload: JSONObject, today: String = Timestamp.now().take(10)): String {
        if (payload.optString("module") != "competitions") return ""
        val items = payload.optJSONObject("result")?.optJSONArray("items") ?: return ""
        val expired = (0 until items.length()).count { index ->
            val item = items.getJSONObject(index)
            val date = Regex("(?<!\\d)\\d{4}-\\d{2}-\\d{2}(?!\\d)").find(item.optString("deadline"))?.value
            date != null && runCatching {
                val format = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT).apply {
                    isLenient = false
                    timeZone = java.util.TimeZone.getTimeZone("UTC")
                }
                format.parse(date); format.parse(today); date < today
            }.getOrDefault(false)
        }
        return if (expired > 0) "$expired 项截止日期已过；历史建议仍保留" else "日期和资格请以官方最新通知为准"
    }
}


/**
 * One student-level network permission covers every time-sensitive reference module. Existing
 * per-module settings are read as an enabled legacy consent and normalized on the next write.
 * Unknown outcomes are reconciled against the immutable local version before any new request.
 */
class ResearchUpdateService(private val context: Context) {
    private val db = BusinessDatabase.get(context)
    private fun key(studentId: String) = "studio-auto:research:$studentId"


    fun networkEnabled(studentId: String): Boolean {
        StudentIndexRepository(context).requireExact(studentId)
        val settings = db.tasks().metadata(key(studentId))?.let(::JSONObject) ?: return false
        return settings.optBoolean("enabled", false) || settings.optJSONArray("modules")?.length()?.let { it > 0 } == true
    }

    fun setNetworkEnabled(studentId: String, enabled: Boolean) {
        StudentIndexRepository(context).requireExact(studentId)
        val settings = JSONObject().put("version", 2).put("enabled", enabled)
            .put("modules", JSONArray(if (enabled) ResearchUpdatePolicy.modules.toList() else emptyList<String>()))
            .put("consentedAt", if (enabled) Timestamp.now() else "")
            .put("updatedAt", Timestamp.now())
        db.runInTransaction { db.tasks().metadata(BusinessMetadataEntity(key(studentId), settings.toString())) }
        if (enabled) {
            StudioAutomation.schedule(context)
            StudioAutomation.enqueueCheck(context, studentId)
        }
    }

    @Deprecated("Use the single student-level network permission")
    fun setEnabled(studentId: String, @Suppress("UNUSED_PARAMETER") module: String, enabled: Boolean) =
        setNetworkEnabled(studentId, enabled)

    fun check(studentId: String): String = synchronized(StudentWorkLocks.forStudent(studentId)) {
        StudentIndexRepository(context).requireExact(studentId)
        if (!networkEnabled(studentId)) return@synchronized "联网参考建议未开启"
        require(LicenseManager(context).status().active) { "产品未激活，已有建议继续保留" }
        val independent = ResearchServiceSelection.independent(context)
        val config = (if (independent) AgentConfigurationStore(context).load() else ResearchServiceSelection.load(context))
            ?: error("当前 AI 处理服务未配置或不支持联网搜索，请检查设置")
        val searchConfig = if (independent) AgentConfigurationStore(context, "local_websearch").load()
            ?: error("请先配置独立搜索服务") else null
        if (independent) {
            require(ResearchServiceSelection.independentVerified(context)) { "请先测试独立搜索来源" }
        } else if (!ModelEndpointPolicy.isBailian(config.endpoint)) {
            val key = "research-probe:${ScopedContentPolicy.hash("${config.endpoint}:${config.model}".toByteArray())}"
            require(db.tasks().metadata(key) == "verified_sources") { "请先测试联网来源；测试通过后才能生成规划" }
        }
        val repository = ScopedContentRepository(context)
        val updated = mutableListOf<String>()
        var waiting = 0
        val failures = mutableListOf<String>()

        for (module in ResearchUpdatePolicy.modules) {
            val topic = "基于当前脱敏档案提供参考建议；信息不足时明确说明，不认定能力，不自动申请、报名或修改档案"
            val input = StudioInputFactory(context, repository).prepare(studentId, module, emptyList(), topic, 3, false).input
            val fingerprint = ScopedContentPolicy.fingerprint(input)
            val receiptKey = "research-update:$studentId:$module"
            var previous = db.tasks().metadata(receiptKey)?.let(::JSONObject)

            // A completed model response rejected by the old source-ID validator is not an
            // unknown outcome. Preserve its receipt and allow the revised input to be tried.
            // Never apply this to interrupted/running calls or unrelated validation failures.
            if (independent && previous?.optString("state") == "waiting_receipt" &&
                (previous.optString("message") == "来源未在输入或检索回执中出现" ||
                    previous.optString("message").startsWith("关键字段缺少检索回执中的来源：")) &&
                previous.optString("fingerprint") != fingerprint &&
                !db.ledger().hasUnresolvedCall(studentId, listOf("studio:${previous.optString("fingerprint")}"))) {
                val oldFingerprint = previous.optString("fingerprint")
                db.tasks().metadata(BusinessMetadataEntity("research-update-retired:$studentId:$module:$oldFingerprint", previous.toString()))
                previous = null
            }
            if (previous?.optString("state") == "waiting_receipt") {
                val recovered = repository.versionByKey(studentId, previous.optString("fingerprint"))
                if (recovered != null) {
                    previous = JSONObject(previous.toString()).put("state", "succeeded")
                        .put("versionId", recovered.id).put("completedAt", Timestamp.now())
                    db.tasks().metadata(BusinessMetadataEntity(receiptKey, previous.toString()))
                } else {
                    waiting++
                    continue
                }
            }
            if (!ResearchUpdatePolicy.due(previous, fingerprint)) continue


            val started = JSONObject().put("state", "waiting_receipt").put("fingerprint", fingerprint)
                .put("startedAt", Timestamp.now())
            db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.toString()))
            try {
                val baseProvider = ModelRuntime.provider(context, config)
                val provider = if (searchConfig != null) IndependentResearchProvider(baseProvider,
                    TavilySearch(searchConfig.apiKey)) { networkEnabled(studentId) } else baseProvider
                val service = LearningStudioService(context, provider, config.model, repository)
                val version = service.generate(studentId, module, emptyList(), topic, 3, false, ModelCancellation(), fingerprint)
                db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.put("state", "succeeded")
                    .put("versionId", version.id).put("completedAt", Timestamp.now()).toString()))
                updated += LearningStudioService.moduleLabels.getValue(module)
            } catch (error: Exception) {
                val possibleResult = db.ledger().hasPossibleResult(studentId, "studio:$fingerprint")
                val state = if (possibleResult) "waiting_receipt" else "queued"
                db.tasks().metadata(BusinessMetadataEntity(receiptKey, started.put("state", state)
                    .put("message", error.message ?: "生成未完成").put("updatedAt", Timestamp.now()).toString()))
                if (possibleResult) waiting++
                failures += "${LearningStudioService.moduleLabels.getValue(module)}：${error.message ?: "生成未完成"}"
            }
        }

        when {
            updated.isNotEmpty() -> "已更新：${updated.joinToString("、")}；其余建议将在后续检查时更新"
            failures.isNotEmpty() -> failures.joinToString("；")
            waiting > 0 -> "部分建议正在等待系统确认；上一有效版本继续可用"
            else -> "当前依据未变化；系统会在资料变化或月度检查时更新"
        }
    }
}

/** Existing separate configurations keep their route until explicitly changed. */
object ResearchServiceSelection {
    private const val PREFS = "research-service-selection"
    fun independent(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("independent_sources", false)
    fun independentVerified(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("independent_verified", false)
    fun setIndependentVerified(context: Context, verified: Boolean) {
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("independent_verified", verified).commit())
    }
    fun selectIndependent(context: Context) {
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("independent_sources", true)
            .putBoolean("independent_verified", false).commit())
    }
    fun separate(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return if (prefs.contains("separate")) prefs.getBoolean("separate", false)
        else AgentConfigurationStore(context, "local_research").publicProfile() != null
    }
    fun select(context: Context, separate: Boolean) {
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("separate", separate)
            .putBoolean("independent_sources", false).commit())
    }
    fun load(context: Context): AgentConfiguration? {
        val config = AgentConfigurationStore(context, if (separate(context)) "local_research" else "local_agent").load()
        return config?.takeIf { ModelEndpointPolicy.supportsResearchProbe(it.endpoint) }
    }
}
