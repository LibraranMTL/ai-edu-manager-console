package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface

data class CollaborationNearbyStatus(
    val running: Boolean,
    val starting: Boolean,
    val port: Int,
    val endpoints: List<String>,
    val invitationCode: String,
    val invitationExpiresAt: String,
    val lastError: String,
    val lastEvent: String,
)

data class PendingStudentMappingOffer(
    val offerJson: String,
    val localStudentId: String,
)

internal class CollaborationNearbyStateStore(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val cipher = CollaborationSecretCipher()

    fun saveInvitation(value: CollaborationDeviceInvitation) {
        val stored = JSONObject().apply {
            put("invitationId", value.invitationId)
            put("transportBindingId", value.transportBindingId)
            put("inviterNode", value.inviterNode.toJson())
            put("endpoints", JSONArray(value.endpoints))
            put("pairingCode", value.pairingCode)
            put("pairingCodeHash", value.pairingCodeHash)
            put("encryptedRequestToken", cipher.encrypt(value.requestToken, value.invitationId))
            put("createdAt", value.createdAt)
            put("expiresAt", value.expiresAt)
        }
        check(preferences.edit()
            .putString(KEY_INVITATION, stored.toString())
            .putString(KEY_PAIRING_INVITATION_ID, value.invitationId)
            .putInt(KEY_PAIRING_TOTAL_FAILURES, 0)
            .remove(KEY_PAIRING_SOURCES)
            .commit()) { "无法保存附近设备连接信息" }
    }

    fun activeInvitation(nowMillis: Long = System.currentTimeMillis()): CollaborationDeviceInvitation? {
        val stored = preferences.getString(KEY_INVITATION, "").orEmpty().takeIf(String::isNotBlank) ?: return null
        val value = runCatching { JSONObject(stored) }.getOrNull() ?: return clearInvitation().let { null }
        if (parseUtcMillis(value.optString("expiresAt")) <= nowMillis) return clearInvitation().let { null }
        val node = value.optJSONObject("inviterNode") ?: return clearInvitation().let { null }
        val invitationId = value.optString("invitationId")
        return runCatching {
            CollaborationDeviceInvitation(
                invitationId = invitationId,
                transportBindingId = value.getString("transportBindingId"),
                inviterNode = CollaborationNodeIdentity(
                    nodeId = node.getString("nodeId"),
                    displayName = node.optString("displayName").ifBlank { "Android 单机版" },
                    machineCode = node.optString("machineCode"),
                    createdAt = node.optString("createdAt"),
                ),
                endpoints = value.optJSONArray("endpoints").collaborationStrings(),
                pairingCode = value.getString("pairingCode"),
                pairingCodeHash = value.getString("pairingCodeHash"),
                requestToken = cipher.decrypt(value.getString("encryptedRequestToken"), invitationId),
                createdAt = value.getString("createdAt"),
                expiresAt = value.getString("expiresAt"),
            )
        }.getOrElse { clearInvitation(); null }
    }

    fun clearInvitation() {
        preferences.edit()
            .remove(KEY_INVITATION)
            .remove(KEY_PAIRING_INVITATION_ID)
            .remove(KEY_PAIRING_TOTAL_FAILURES)
            .remove(KEY_PAIRING_SOURCES)
            .apply()
    }

    @Synchronized
    fun requirePairingAllowed(invitationId: String, sourceAddress: String, nowMillis: Long = System.currentTimeMillis()) {
        resetPairingGuardIfNeeded(invitationId)
        if (preferences.getInt(KEY_PAIRING_TOTAL_FAILURES, 0) >= CollaborationNearbySecurityPolicy.MAX_PAIRING_FAILURES) {
            clearInvitation()
            error("设备配对码不正确或已经失效")
        }
        val source = pairingSourceState(sourceAddress)
        require(source.optLong("retryAt", 0L) <= nowMillis) { "设备配对码不正确或已经失效，请稍后重试" }
    }

    @Synchronized
    fun recordPairingFailure(invitationId: String, sourceAddress: String, nowMillis: Long = System.currentTimeMillis()): Boolean {
        resetPairingGuardIfNeeded(invitationId)
        val sourceKey = sourceKey(sourceAddress)
        val sources = pairingSources()
        val current = sources.optJSONObject(sourceKey) ?: JSONObject()
        val sourceFailures = current.optInt("failures", 0) + 1
        sources.put(sourceKey, JSONObject().apply {
            put("failures", sourceFailures)
            put("retryAt", nowMillis + CollaborationNearbySecurityPolicy.pairingCooldownMillis(sourceFailures))
        })
        val total = preferences.getInt(KEY_PAIRING_TOTAL_FAILURES, 0) + 1
        val invalidated = total >= CollaborationNearbySecurityPolicy.MAX_PAIRING_FAILURES
        if (invalidated) {
            clearInvitation()
        } else {
            check(preferences.edit().putInt(KEY_PAIRING_TOTAL_FAILURES, total).putString(KEY_PAIRING_SOURCES, sources.toString()).commit()) {
                "无法保存设备配对保护状态"
            }
        }
        return invalidated
    }

    @Synchronized
    fun clearPairingFailures(invitationId: String) {
        if (preferences.getString(KEY_PAIRING_INVITATION_ID, "") == invitationId) {
            preferences.edit().putInt(KEY_PAIRING_TOTAL_FAILURES, 0).remove(KEY_PAIRING_SOURCES).apply()
        }
    }

    @Synchronized
    fun consumeNonce(bindingId: String, nonce: String, expiresAt: Long, nowMillis: Long = System.currentTimeMillis()): Boolean {
        val stored = runCatching { JSONObject(preferences.getString(KEY_RECENT_NONCES, "{}").orEmpty()) }.getOrDefault(JSONObject())
        val keys = mutableListOf<String>()
        val iterator = stored.keys()
        while (iterator.hasNext()) keys += iterator.next()
        keys.filter { stored.optLong(it, 0L) <= nowMillis }.forEach(stored::remove)
        val nonceKey = CollaborationCrypto.sha256("$bindingId\u001f$nonce")
        if (stored.has(nonceKey)) return false
        stored.put(nonceKey, expiresAt)
        val retained = mutableListOf<Pair<String, Long>>()
        val retainedIterator = stored.keys()
        while (retainedIterator.hasNext()) {
            val key = retainedIterator.next()
            retained += key to stored.optLong(key, 0L)
        }
        retained.sortedBy { it.second }
            .take((retained.size - CollaborationNearbySecurityPolicy.MAX_RECENT_NONCES).coerceAtLeast(0))
            .forEach { stored.remove(it.first) }
        check(preferences.edit().putString(KEY_RECENT_NONCES, stored.toString()).commit()) { "无法保存直传防重放状态" }
        return true
    }

    fun savePendingOffer(offerJson: String, localStudentId: String) {
        val offer = JSONObject(offerJson)
        val offerId = offer.getString("offerId")
        val value = JSONObject().put("offerJson", offerJson).put("localStudentId", localStudentId)
        check(preferences.edit().putString(offerKey(offerId), value.toString()).commit()) { "无法保存学生共享邀请" }
    }

    fun pendingOffer(offerId: String, nowMillis: Long = System.currentTimeMillis()): PendingStudentMappingOffer? {
        val key = offerKey(offerId)
        val stored = preferences.getString(key, "").orEmpty().takeIf(String::isNotBlank) ?: return null
        val value = runCatching { JSONObject(stored) }.getOrNull() ?: return clearPendingOffer(offerId).let { null }
        val offerJson = value.optString("offerJson")
        val offer = runCatching { JSONObject(offerJson) }.getOrNull() ?: return clearPendingOffer(offerId).let { null }
        if (parseUtcMillis(offer.optString("expiresAt")) <= nowMillis) return clearPendingOffer(offerId).let { null }
        return PendingStudentMappingOffer(offerJson, value.optString("localStudentId"))
    }

    fun clearPendingOffer(offerId: String) {
        preferences.edit().remove(offerKey(offerId)).apply()
    }

    fun markStarting() {
        CollaborationNearbyRuntimeState.starting = true
        CollaborationNearbyRuntimeState.running = false
        preferences.edit().remove(KEY_LAST_ERROR).apply()
    }

    fun setRunning(running: Boolean, port: Int = CollaborationNearbyEndpointResolver.HTTP_PORT) {
        CollaborationNearbyRuntimeState.starting = false
        CollaborationNearbyRuntimeState.running = running
        preferences.edit().putBoolean(KEY_RUNNING, running).putInt(KEY_PORT, port).apply {
            if (running) remove(KEY_LAST_ERROR)
        }.apply()
    }

    fun setStartupError(message: String) {
        CollaborationNearbyRuntimeState.starting = false
        CollaborationNearbyRuntimeState.running = false
        preferences.edit().putBoolean(KEY_RUNNING, false).putString(KEY_LAST_ERROR, message.take(500)).apply()
    }

    fun recordError(message: String) {
        preferences.edit().putString(KEY_LAST_ERROR, message.take(500)).apply()
    }

    fun recordEvent(message: String) {
        preferences.edit().putString(KEY_LAST_EVENT, message.take(500)).apply()
    }

    fun clearError() {
        preferences.edit().remove(KEY_LAST_ERROR).apply()
    }

    fun status(): CollaborationNearbyStatus {
        val invitation = activeInvitation()
        val port = preferences.getInt(KEY_PORT, CollaborationNearbyEndpointResolver.HTTP_PORT)
        return CollaborationNearbyStatus(
            running = CollaborationNearbyRuntimeState.running,
            starting = CollaborationNearbyRuntimeState.starting,
            port = port,
            endpoints = CollaborationNearbyEndpointResolver.localEndpoints(port),
            invitationCode = invitation?.pairingCode.orEmpty(),
            invitationExpiresAt = invitation?.expiresAt.orEmpty(),
            lastError = preferences.getString(KEY_LAST_ERROR, "").orEmpty(),
            lastEvent = preferences.getString(KEY_LAST_EVENT, "").orEmpty(),
        )
    }

    private fun resetPairingGuardIfNeeded(invitationId: String) {
        if (preferences.getString(KEY_PAIRING_INVITATION_ID, "") != invitationId) {
            check(preferences.edit().putString(KEY_PAIRING_INVITATION_ID, invitationId).putInt(KEY_PAIRING_TOTAL_FAILURES, 0)
                .remove(KEY_PAIRING_SOURCES).commit()) { "无法重置设备配对保护状态" }
        }
    }

    private fun pairingSources(): JSONObject = runCatching {
        JSONObject(preferences.getString(KEY_PAIRING_SOURCES, "{}").orEmpty())
    }.getOrDefault(JSONObject())

    private fun pairingSourceState(sourceAddress: String): JSONObject = pairingSources().optJSONObject(sourceKey(sourceAddress)) ?: JSONObject()

    private fun sourceKey(sourceAddress: String): String = CollaborationCrypto.sha256(sourceAddress.trim().ifBlank { "unknown" })

    private fun offerKey(offerId: String): String {
        require(offerId.matches(Regex("^[A-Za-z0-9._-]{1,160}$"))) { "学生共享邀请编号无效" }
        return "pending_offer_$offerId"
    }

    companion object {
        private const val PREFERENCES = "collaboration_nearby"
        private const val KEY_INVITATION = "active_invitation"
        private const val KEY_RUNNING = "service_running"
        private const val KEY_PORT = "service_port"
        private const val KEY_LAST_ERROR = "service_last_error"
        private const val KEY_LAST_EVENT = "service_last_event"
        private const val KEY_PAIRING_INVITATION_ID = "pairing_invitation_id"
        private const val KEY_PAIRING_TOTAL_FAILURES = "pairing_total_failures"
        private const val KEY_PAIRING_SOURCES = "pairing_sources"
        private const val KEY_RECENT_NONCES = "recent_nonces"
    }
}

internal object CollaborationNearbyRuntimeState {
    @Volatile var running: Boolean = false
    @Volatile var starting: Boolean = false
}

internal object CollaborationNearbySecurityPolicy {
    const val MAX_PAIRING_FAILURES = 5
    const val MAX_RECENT_NONCES = 512
    const val INBOUND_RETENTION_MS = 7L * 24 * 60 * 60 * 1000
    const val MAX_STAGING_BYTES = 4L * 1024 * 1024 * 1024
    const val MIN_FREE_BYTES = 512L * 1024 * 1024

    fun pairingCooldownMillis(failures: Int): Long = when (failures.coerceAtLeast(1)) {
        1 -> 2_000L
        2 -> 5_000L
        3 -> 15_000L
        else -> 60_000L
    }

    fun expiredInbound(lastModified: Long, nowMillis: Long): Boolean = lastModified <= 0L || nowMillis - lastModified >= INBOUND_RETENTION_MS

    fun projectedAppendBytes(stagingBytes: Long, appendedBytes: Long): Long =
        Math.addExact(stagingBytes.coerceAtLeast(0L), appendedBytes.coerceAtLeast(0L))

    fun hasRequiredFreeSpace(usableSpace: Long, remainingBytes: Long): Boolean =
        usableSpace >= Math.addExact(remainingBytes.coerceAtLeast(0L), MIN_FREE_BYTES)
}

internal object CollaborationNearbyEndpointResolver {
    const val HTTP_PORT = 18779
    const val DISCOVERY_PORT = 18778

    fun localEndpoints(port: Int = HTTP_PORT): List<String> = localAddresses()
        .map { "http://${it.hostAddress}:$port" }
        .mapNotNull(CollaborationPairingProtocol::normalizeEndpoint)
        .distinct()
        .sortedWith(compareBy<String>({ isTailscale(it) }, { it }))
        .take(8)

    fun lanEndpoints(port: Int = HTTP_PORT): List<String> = localEndpoints(port).filterNot(::isTailscale)

    fun tailscaleEndpoints(port: Int = HTTP_PORT): List<String> = localEndpoints(port).filter(::isTailscale)

    private fun localAddresses(): List<Inet4Address> = runCatching {
        java.util.Collections.list(NetworkInterface.getNetworkInterfaces())
            .filter { it.isUp && !it.isLoopback }
            .flatMap { java.util.Collections.list(it.inetAddresses) }
            .filterIsInstance<Inet4Address>()
            .filterNot { it.isAnyLocalAddress || it.isLoopbackAddress || it.isLinkLocalAddress }
    }.getOrDefault(emptyList())

    private fun isTailscale(endpoint: String): Boolean = runCatching {
        val address = java.net.URI(endpoint).host.split('.').map(String::toInt)
        address.size == 4 && address[0] == 100 && address[1] in 64..127
    }.getOrDefault(false)
}
