package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.util.UUID

class ModelBudget(private val context: Context) {
    fun reserve(studentId: String, category: String, operationId: String) {
        if (studentId.isNotBlank()) StudentIndexRepository(context).requireExact(studentId)
        val db = BusinessDatabase.get(context); BusinessRestoreRecovery.recover(context, db)
        db.runInTransaction {
            val key = "model-budget:${Timestamp.now().take(7)}:$category"
            val stored = db.tasks().metadata(key)
            val used = if (stored == null) 0 else requireNotNull(stored.toIntOrNull()) { "调用额度记录损坏，停止新调用" }
            require(used >= 0 && used < Int.MAX_VALUE) { "调用记录异常" }
            val entitlement = LicenseManager(context).status()
            require(entitlement.active) { "授权未生效或已到期；本机历史资料仍可读取导出" }
            db.tasks().metadata(BusinessMetadataEntity(key, (used + 1).toString()))
            db.tasks().metadata(BusinessMetadataEntity("model-reservation:$operationId", JSONObject().put("category", category).put("studentId", studentId).put("reservedAt", Timestamp.now()).toString()))
        }
    }
}

/** One selection point for all business model calls. */
object ModelRuntime {
    fun provider(context: Context, config: AgentConfiguration, publicResponseStructure: ((String) -> Unit)? = null): ModelProvider = object : ModelProvider {
        override fun generate(request: ModelRequest): ModelResponse {
            request.cancellation.check()
            val category = if (request.webResearch) "research" else if (request.messages.toString().contains("\"image_url\"")) "vision" else "text"
            val provider = CompatibleModelProvider(config.endpoint, config.apiKey, receipts = RoomModelReceiptSink(context), publicResponseStructure = publicResponseStructure)
            val synthetic = BuildConfig.FAULT_HARNESS && context.packageName.endsWith(".faulttest") &&
                request.model == "synthetic-fault-model" && java.net.URI(config.endpoint).host in setOf("127.0.0.1", "localhost")
            if (!synthetic) ModelBudget(context).reserve(request.studentId, category, UUID.randomUUID().toString())
            return provider.generate(request)
        }
    }
}
