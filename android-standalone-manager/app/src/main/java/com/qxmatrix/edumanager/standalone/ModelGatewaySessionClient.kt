package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

/** Explicit bootstrap only. Proof comes from an authorized license/device integration, never
 * inferred from a local active flag. Credentials and proof remain memory-only; no retries. */
class ModelGatewaySessionClient(private val transport: ModelTransport = UrlConnectionModelTransport()) {
    fun issue(baseUrl: String, studentId: String, deviceId: String, proof: JSONObject, cancellation: ModelCancellation): ModelGatewaySession {
        val endpoint = ModelEndpointPolicy.normalize(baseUrl)
        require(Regex("^[A-Za-z0-9_-]{1,128}$").matches(studentId) && Regex("^[A-Za-z0-9_-]{1,128}$").matches(deviceId))
        require(proof.length() > 0 && proof.toString().toByteArray().size <= 16_000) { "许可证/设备证明缺失或超限" }
        cancellation.check()
        val response = transport.post("$endpoint/model-gateway/session", "", JSONObject().put("studentId", studentId).put("deviceId", deviceId)
            .put("proof", JSONObject(proof.toString())), cancellation)
        require(response.status in 200..299) { "网关会话未签发（HTTP ${response.status}）；不会回退为共享或个人密钥" }
        cancellation.check()
        return ModelGatewaySession.fromJson(endpoint, JSONObject(response.body), studentId, deviceId)
    }
}
