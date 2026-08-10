package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.net.URI

data class CollaborationConnectionInfo(
    val invitationId: String,
    val expectedNodeId: String,
    val displayName: String,
    val pairingCode: String,
    val endpoints: List<String>,
    val expiresAt: String,
)

data class VerifiedDevicePairing(
    val deviceBindingId: String,
    val transportBindingId: String,
    val localNodeId: String,
    val peerNodeId: String,
    val peerDisplayName: String,
    val endpoints: List<String>,
    val capabilities: List<String>,
    val sharedSecret: String,
    val createdAt: String,
    val confirmedAt: String,
)

data class AcceptedStudentMapping(
    val studentMapId: String,
    val deviceBindingId: String,
    val transportBindingId: String,
    val localStudentId: String,
    val peerStudentId: String,
    val peerStudentName: String,
    val syncKinds: List<String>,
    val createdAt: String,
    val acceptanceJson: String,
)

internal object CollaborationPairingProtocol {
    const val PROTOCOL_VERSION = "1.0"
    const val NODE_SCHEMA = "edu-manager.collaboration-node.v1"
    const val DEVICE_CONNECTION_SCHEMA = "edu-manager.collaboration-device-connection.v1"
    const val DEVICE_CONFIRMATION_SCHEMA = "edu-manager.collaboration-device-confirmation.v1"
    const val DEVICE_BINDING_SCHEMA = "edu-manager.collaboration-device-binding.v1"
    const val STUDENT_MAPPING_OFFER_SCHEMA = "edu-manager.collaboration-student-map-offer.v1"
    const val STUDENT_MAPPING_ACCEPTANCE_SCHEMA = "edu-manager.collaboration-student-map-acceptance.v1"
    const val STUDENT_MAP_SCHEMA = "edu-manager.student-collaboration-map.v1"
    const val PEER_BINDING_SCHEMA = "edu-manager.peer-binding.v1"

    private val defaultSyncKinds = listOf("confirmed_knowledge", "growth_model", "learning_report", "education_archive")

    fun normalizeQrPayload(raw: String?): String? = runCatching {
        val value = raw.orEmpty().trim()
        if (value.matches(Regex("^\\d{6}$"))) return@runCatching value
        val parsed = JSONObject(value)
        require(parsed.optString("schema") == DEVICE_CONNECTION_SCHEMA)
        parseConnectionInput(value)
        value
    }.getOrNull()

    fun parseConnectionInput(raw: String, nowMillis: Long = System.currentTimeMillis()): CollaborationConnectionInfo {
        val value = raw.trim()
        val digits = value.replace(Regex("\\D"), "")
        if (!value.startsWith("{")) {
            require(digits.matches(Regex("^\\d{6}$"))) { "设备配对码必须是六位数字" }
            return CollaborationConnectionInfo("", "", "", digits, emptyList(), "")
        }
        val json = JSONObject(value)
        require(json.optString("schema") == DEVICE_CONNECTION_SCHEMA) { "粘贴内容不是设备连接信息" }
        require(json.optString("protocolVersion") == PROTOCOL_VERSION) { "设备配对协议版本不兼容" }
        val expiresAt = json.optString("expiresAt")
        require(parseUtcMillis(expiresAt) > nowMillis) { "设备连接信息已过期，请让对方重新生成" }
        val pairingCode = json.optString("pairingCode").replace(Regex("\\D"), "")
        require(pairingCode.matches(Regex("^\\d{6}$"))) { "设备配对码必须是六位数字" }
        val endpoints = json.optJSONArray("endpoints").collaborationStrings().mapNotNull(::normalizeEndpoint).distinct().take(8)
        require(endpoints.isNotEmpty()) { "连接信息没有可用的安全候选地址" }
        return CollaborationConnectionInfo(
            invitationId = json.optString("invitationId"),
            expectedNodeId = json.optString("nodeId"),
            displayName = json.optString("displayName"),
            pairingCode = pairingCode,
            endpoints = endpoints,
            expiresAt = expiresAt,
        )
    }

    fun normalizeEndpoint(value: String): String? = runCatching {
        val uri = URI(value.trim())
        require(uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank())
        require(uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null)
        require(uri.path.isNullOrBlank() || uri.path == "/")
        if (uri.scheme == "http") require(isPrivateOrManagedHost(uri.host))
        val port = if (uri.port > 0) ":${uri.port}" else ""
        "${uri.scheme}://${uri.host}$port"
    }.getOrNull()

    private fun isPrivateOrManagedHost(host: String): Boolean {
        val normalized = host.trim().lowercase()
        if (normalized == "localhost" || normalized.endsWith(".local") || normalized.endsWith(".ts.net")) return true
        val address = runCatching { InetAddress.getByName(normalized) }.getOrNull() ?: return false
        if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress) return true
        val bytes = address.address
        if (bytes.size != 4) return false
        val first = bytes[0].toInt() and 0xff
        val second = bytes[1].toInt() and 0xff
        return first == 100 && second in 64..127
    }

    fun verifyDeviceConfirmation(value: JSONObject, localNodeId: String): VerifiedDevicePairing {
        require(value.optString("schema") == DEVICE_CONFIRMATION_SCHEMA) { "设备配对确认格式无效" }
        require(value.optString("protocolVersion") == PROTOCOL_VERSION) { "设备配对协议版本不兼容" }
        val binding = requireNotNull(value.optJSONObject("binding")) { "设备配对缺少传输关系" }
        val deviceBinding = requireNotNull(value.optJSONObject("deviceBinding")) { "设备配对缺少设备关系" }
        val secret = value.optString("sharedSecret")
        require(secret.isNotBlank() && CollaborationCrypto.sha256(secret) == binding.optString("sharedSecretRef")) { "设备配对共享密钥校验失败" }
        val participants = binding.optJSONArray("participantNodeIds").collaborationStrings()
        require(participants.size == 2 && participants.distinct().size == 2 && localNodeId in participants) { "设备配对确认不属于本机" }
        val deviceParticipants = deviceBinding.optJSONArray("participantNodeIds").collaborationStrings().sorted()
        require(deviceParticipants == participants.sorted()) { "设备配对中的设备关系与传输关系不一致" }
        val inviter = requireNotNull(value.optJSONObject("inviterNode")) { "设备配对缺少邀请方身份" }
        val accepting = requireNotNull(value.optJSONObject("acceptingNode")) { "设备配对缺少接收方身份" }
        require(accepting.optString("nodeId") == localNodeId) { "设备配对接收身份不属于本机" }
        val expectedProof = CollaborationCrypto.hmac(secret, listOf(
            value.optString("invitationId"),
            value.optString("transportBindingId"),
            inviter.optString("nodeId"),
            accepting.optString("nodeId"),
            value.optString("confirmedAt"),
            CollaborationCrypto.sha256(stringifyPeerBinding(binding)),
            CollaborationCrypto.sha256(stringifyDeviceBinding(deviceBinding)),
        ))
        require(CollaborationCrypto.constantTimeEquals(value.optString("proof"), expectedProof)) { "设备配对确认签名无效" }
        val peerNodeId = inviter.optString("nodeId")
        require(peerNodeId.isNotBlank() && peerNodeId != localNodeId) { "协作主机身份无效" }
        val endpoints = binding.optJSONArray("transportOffers").collaborationObjects()
            .filter { it.optString("nodeId") == peerNodeId }
            .flatMap { it.optJSONArray("endpoints").collaborationStrings() }
            .mapNotNull(::normalizeEndpoint).distinct().take(8)
        return VerifiedDevicePairing(
            deviceBindingId = deviceBinding.optString("deviceBindingId"),
            transportBindingId = binding.optString("bindingId"),
            localNodeId = localNodeId,
            peerNodeId = peerNodeId,
            peerDisplayName = inviter.optString("displayName").ifBlank { "协作主机" },
            endpoints = endpoints,
            capabilities = deviceBinding.optJSONArray("capabilities").collaborationStrings(),
            sharedSecret = secret,
            createdAt = deviceBinding.optString("createdAt"),
            confirmedAt = value.optString("confirmedAt"),
        ).also {
            require(it.deviceBindingId.isNotBlank() && it.transportBindingId.isNotBlank()) { "设备配对确认缺少关系编号" }
        }
    }

    fun acceptStudentMappingOffer(
        raw: String,
        localNodeId: String,
        localStudentId: String,
        secret: String,
        nowMillis: Long = System.currentTimeMillis(),
    ): AcceptedStudentMapping {
        require(localStudentId.isNotBlank()) { "必须选择本机的确切学生档案" }
        val offer = JSONObject(raw.trim())
        require(offer.optString("schema") == STUDENT_MAPPING_OFFER_SCHEMA) { "粘贴内容不是学生共享邀请" }
        require(offer.optString("protocolVersion") == PROTOCOL_VERSION) { "学生共享协议版本不兼容" }
        require(parseUtcMillis(offer.optString("expiresAt")) > nowMillis) { "学生共享邀请已过期" }
        val expectedOfferProof = CollaborationCrypto.hmac(secret, listOf(
            offer.optString("offerId"), offer.optString("deviceBindingId"), offer.optString("transportBindingId"),
            offer.optString("mappingBindingId"), offer.optString("inviterNodeId"), offer.optString("inviterStudentId"), offer.optString("expiresAt"),
        ))
        require(CollaborationCrypto.constantTimeEquals(offer.optString("proof"), expectedOfferProof)) { "学生共享邀请未通过设备信任校验" }
        val inviterNodeId = offer.optString("inviterNodeId")
        val inviterStudentId = offer.optString("inviterStudentId")
        require(inviterNodeId.isNotBlank() && inviterNodeId != localNodeId && inviterStudentId.isNotBlank()) { "学生共享邀请范围无效" }
        val deviceBindingId = offer.optString("deviceBindingId")
        val createdAt = offer.optString("createdAt")
        val endpoints = listOf(inviterNodeId to inviterStudentId, localNodeId to localStudentId)
            .sortedBy { "${it.first}:${it.second}" }
        val studentMapId = stableId("student-map", listOf(deviceBindingId) + endpoints.map { "${it.first}:${it.second}" })
        val studentMap = JSONObject().apply {
            put("schema", STUDENT_MAP_SCHEMA); put("studentMapId", studentMapId); put("deviceBindingId", deviceBindingId)
            put("participantStudents", JSONArray().apply { endpoints.forEach { put(JSONObject().put("nodeId", it.first).put("studentId", it.second)) } })
            put("status", "active"); put("syncKinds", JSONArray(defaultSyncKinds)); put("transportBindingIds", JSONArray(listOf(offer.optString("mappingBindingId"))))
            put("origin", "native"); put("createdAt", createdAt); put("updatedAt", createdAt); put("revokedAt", "")
        }
        val acceptedAt = utcAt(nowMillis)
        val mappingBinding = JSONObject().apply {
            put("schema", PEER_BINDING_SCHEMA); put("protocolVersion", PROTOCOL_VERSION); put("bindingId", offer.optString("mappingBindingId"))
            put("participantNodeIds", JSONArray(listOf(inviterNodeId, localNodeId)))
            put("roleAssignments", JSONArray().apply {
                put(roleAssignment(inviterNodeId, inviterStudentId, "educator", acceptedAt)); put(roleAssignment(inviterNodeId, inviterStudentId, "learner_authority", acceptedAt))
                put(roleAssignment(localNodeId, localStudentId, "educator", acceptedAt)); put(roleAssignment(localNodeId, localStudentId, "learner_authority", acceptedAt))
            })
            put("sharedSecretRef", CollaborationCrypto.sha256(secret)); put("status", "active"); put("capabilities", JSONArray())
            put("transportOffers", JSONArray()); put("createdAt", createdAt); put("lastSeenAt", ""); put("revokedAt", "")
        }
        val acceptanceId = "student-map-acceptance-${java.util.UUID.randomUUID()}"
        val proof = CollaborationCrypto.hmac(secret, listOf(
            offer.optString("offerId"), studentMapId, mappingBinding.optString("bindingId"),
            CollaborationCrypto.sha256(stringifyStudentMap(studentMap)), CollaborationCrypto.sha256(stringifyPeerBinding(mappingBinding)),
        ))
        val acceptanceJson = orderedObject(listOf(
            "schema" to quote(STUDENT_MAPPING_ACCEPTANCE_SCHEMA),
            "protocolVersion" to quote(PROTOCOL_VERSION),
            "acceptanceId" to quote(acceptanceId),
            "offerId" to quote(offer.optString("offerId")),
            "deviceBindingId" to quote(deviceBindingId),
            "studentMap" to stringifyStudentMap(studentMap),
            "mappingBinding" to stringifyPeerBinding(mappingBinding),
            "acceptedAt" to quote(acceptedAt),
            "proof" to quote(proof),
        ))
        return AcceptedStudentMapping(
            studentMapId, deviceBindingId, offer.optString("mappingBindingId"), localStudentId, inviterStudentId,
            offer.optString("inviterStudentName"), defaultSyncKinds, createdAt, acceptanceJson,
        )
    }

    fun offerDeviceBindingId(raw: String): String = JSONObject(raw.trim()).also {
        require(it.optString("schema") == STUDENT_MAPPING_OFFER_SCHEMA) { "粘贴内容不是学生共享邀请" }
    }.optString("deviceBindingId")

    private fun roleAssignment(nodeId: String, studentId: String, role: String, createdAt: String) = JSONObject().apply {
        put("nodeId", nodeId); put("actorId", ""); put("role", role); put("studentId", studentId)
        put("scope", JSONArray()); put("createdAt", createdAt); put("revokedAt", "")
    }

    private fun stableId(prefix: String, values: List<String>): String = "$prefix-${CollaborationCrypto.sha256(values.filter { it.isNotBlank() }.distinct().sorted().joinToString("\u001f")).take(32)}"

    private fun stringifyPeerBinding(value: JSONObject): String = orderedObject(listOf(
        "schema" to quote(value.optString("schema")), "protocolVersion" to quote(value.optString("protocolVersion")),
        "bindingId" to quote(value.optString("bindingId")), "participantNodeIds" to stringifyStrings(value.optJSONArray("participantNodeIds")),
        "roleAssignments" to stringifyRoles(value.optJSONArray("roleAssignments")), "sharedSecretRef" to quote(value.optString("sharedSecretRef")),
        "status" to quote(value.optString("status")), "capabilities" to stringifyStrings(value.optJSONArray("capabilities")),
        "transportOffers" to stringifyOffers(value.optJSONArray("transportOffers")), "createdAt" to quote(value.optString("createdAt")),
        "lastSeenAt" to quote(value.optString("lastSeenAt")), "revokedAt" to quote(value.optString("revokedAt")),
    ))

    private fun stringifyDeviceBinding(value: JSONObject): String = orderedObject(listOf(
        "schema" to quote(value.optString("schema")), "deviceBindingId" to quote(value.optString("deviceBindingId")),
        "participantNodeIds" to stringifyStrings(value.optJSONArray("participantNodeIds")), "status" to quote(value.optString("status")),
        "capabilities" to stringifyStrings(value.optJSONArray("capabilities")), "transportOffers" to stringifyOffers(value.optJSONArray("transportOffers")),
        "transportBindingIds" to stringifyStrings(value.optJSONArray("transportBindingIds")), "origin" to quote(value.optString("origin")),
        "createdAt" to quote(value.optString("createdAt")), "updatedAt" to quote(value.optString("updatedAt")),
        "revokedAt" to quote(value.optString("revokedAt")),
    ))

    private fun stringifyStudentMap(value: JSONObject): String = orderedObject(listOf(
        "schema" to quote(value.optString("schema")), "studentMapId" to quote(value.optString("studentMapId")),
        "deviceBindingId" to quote(value.optString("deviceBindingId")), "participantStudents" to value.optJSONArray("participantStudents").collaborationObjects().joinToString(",", "[", "]") {
            orderedObject(listOf("nodeId" to quote(it.optString("nodeId")), "studentId" to quote(it.optString("studentId"))))
        },
        "status" to quote(value.optString("status")), "syncKinds" to stringifyStrings(value.optJSONArray("syncKinds")),
        "transportBindingIds" to stringifyStrings(value.optJSONArray("transportBindingIds")), "origin" to quote(value.optString("origin")),
        "createdAt" to quote(value.optString("createdAt")), "updatedAt" to quote(value.optString("updatedAt")), "revokedAt" to quote(value.optString("revokedAt")),
    ))

    private fun stringifyOffers(array: JSONArray?): String = array.collaborationObjects().joinToString(",", "[", "]") { offer ->
        orderedObject(listOf(
            "transportId" to quote(offer.optString("transportId")), "protocolVersion" to quote(offer.optString("protocolVersion")),
            "endpoints" to stringifyStrings(offer.optJSONArray("endpoints")), "preferred" to offer.optBoolean("preferred").toString(),
            "nodeId" to quote(offer.optString("nodeId")),
        ))
    }

    private fun stringifyRoles(array: JSONArray?): String = array.collaborationObjects().joinToString(",", "[", "]") { role ->
        orderedObject(listOf(
            "nodeId" to quote(role.optString("nodeId")), "actorId" to quote(role.optString("actorId")), "role" to quote(role.optString("role")),
            "studentId" to quote(role.optString("studentId")), "scope" to stringifyStrings(role.optJSONArray("scope")),
            "createdAt" to quote(role.optString("createdAt")), "revokedAt" to quote(role.optString("revokedAt")),
        ))
    }

    private fun stringifyStrings(array: JSONArray?): String = array.collaborationStrings().joinToString(",", "[", "]", transform = ::quote)
    private fun orderedObject(fields: List<Pair<String, String>>) = fields.joinToString(",", "{", "}") { quote(it.first) + ":" + it.second }
    private fun quote(value: String) = CourseCatalogCanonicalJson.quote(value)
}

internal fun JSONArray?.collaborationStrings(): List<String> = buildList {
    if (this@collaborationStrings != null) for (index in 0 until length()) optString(index).trim().takeIf { it.isNotBlank() }?.let(::add)
}

internal fun JSONArray?.collaborationObjects(): List<JSONObject> = buildList {
    if (this@collaborationObjects != null) for (index in 0 until length()) optJSONObject(index)?.let(::add)
}
