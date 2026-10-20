package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.UUID

class GatewaySettings(private val context: Context) {
    private val prefs = context.getSharedPreferences("model_gateway", Context.MODE_PRIVATE)
    fun endpoint(): String = prefs.getString("endpoint", "").orEmpty()
    fun enabled(): Boolean = prefs.getBoolean("enabled", false)
    fun save(endpoint: String, enabled: Boolean) {
        val normalized = ModelEndpointPolicy.normalize(endpoint)
        check(prefs.edit().putString("endpoint", normalized).putBoolean("enabled", enabled).commit())
    }
    fun disable() { check(prefs.edit().putBoolean("enabled", false).commit()) }
}

/** Non-exportable device signing key; server requires administrator-pinned public key + student binding. */
class GatewayDeviceProof(private val context: Context) {
    private val alias = "edu-manager-gateway-device-v1"
    private fun store(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.also {
        if (!it.containsAlias(alias)) KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setDigests(KeyProperties.DIGEST_SHA256).setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1")).build())
            generateKeyPair()
        }
    }
    fun registration(studentId: String): JSONObject {
        StudentIndexRepository(context).requireExact(studentId)
        val license = LicenseManager(context); val status = license.requireActive()
        return JSONObject().put("deviceId", license.deviceId()).put("studentId", studentId).put("licenseId", status.licenseId)
            .put("publicKeyDer", Base64.encodeToString(store().getCertificate(alias).publicKey.encoded, Base64.NO_WRAP))
    }
    fun proof(studentId: String): JSONObject {
        StudentIndexRepository(context).requireExact(studentId)
        val license = LicenseManager(context); val token = license.gatewayLicenseToken()
        val issuedAt = System.currentTimeMillis(); val nonce = UUID.randomUUID().toString()
        val message = "${license.deviceId()}\n$studentId\n$issuedAt\n$nonce\n${ScopedContentPolicy.hash(token.toByteArray())}"
        val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(store().getKey(alias, null) as java.security.PrivateKey); update(message.toByteArray()) }.sign()
        return JSONObject().put("licenseToken", token).put("issuedAt", issuedAt).put("nonce", nonce)
            .put("signature", Base64.encodeToString(signature, Base64.NO_WRAP))
    }
}

class ModelBudget(private val context: Context) {
    fun reserve(studentId: String, category: String, operationId: String) {
        if (studentId.isNotBlank()) StudentIndexRepository(context).requireExact(studentId)
        val db = BusinessDatabase.get(context); BusinessRestoreRecovery.recover(context, db)
        db.runInTransaction {
            val key = "model-budget:${Timestamp.now().take(7)}:$category"
            val stored = db.tasks().metadata(key)
            val used = if (stored == null) 0 else requireNotNull(stored.toIntOrNull()) { "调用额度记录损坏，停止新调用" }
            val cap = when (category) { "research" -> 60; "vision" -> 300; "asr" -> 120; else -> 600 }
            require(used in 0 until cap) { "本机本月${category}安全调用上限已到；已保存资料仍可读取和导出" }
            val entitlement = LicenseManager(context).status()
            require(entitlement.active) { "授权未生效或已到期；本机历史资料仍可读取导出" }
            db.tasks().metadata(BusinessMetadataEntity(key, (used + 1).toString()))
            db.tasks().metadata(BusinessMetadataEntity("model-reservation:$operationId", JSONObject().put("category", category).put("studentId", studentId).put("reservedAt", Timestamp.now()).toString()))
        }
    }
}

/** One selection point for all business model calls. Gateway rejection never falls back to BYOK. */
object ModelRuntime {
    fun provider(context: Context, config: AgentConfiguration): ModelProvider = object : ModelProvider {
        override fun generate(request: ModelRequest): ModelResponse {
            request.cancellation.check()
            val category = if (request.webResearch) "research" else if (request.messages.toString().contains("\"image_url\"")) "vision" else "text"
            val gateway = GatewaySettings(context)
            val provider = if (gateway.enabled()) {
                require(request.studentId.isNotBlank()) { "受控网关需要确切学生作用域；不能替项目猜测学生" }
                val device = LicenseManager(context).deviceId()
                val session = ModelGatewaySessionClient().issue(gateway.endpoint(), request.studentId, device,
                    GatewayDeviceProof(context).proof(request.studentId), request.cancellation)
                ModelGatewayProvider(session, receipts = RoomModelReceiptSink(context))
            } else CompatibleModelProvider(config.endpoint, config.apiKey, receipts = RoomModelReceiptSink(context))
            ModelBudget(context).reserve(request.studentId, category, UUID.randomUUID().toString())
            return provider.generate(request)
        }
    }
}
