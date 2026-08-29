package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.net.URL
import java.util.UUID

data class DiscoveredCollaborationHost(
    val nodeId: String,
    val displayName: String,
    val endpoints: List<String>,
)

internal object CollaborationLanDiscovery {
    private const val DISCOVERY_PORT = 18778

    fun discover(timeoutMillis: Int = 1_600): List<DiscoveredCollaborationHost> {
        val request = JSONObject().apply {
            put("type", "AI_EDU_MANAGER_DISCOVER")
            put("protocolVersion", 2)
            put("requestId", "android-collaboration-discover-${UUID.randomUUID()}")
            put("searchRole", "all")
        }.toString().toByteArray(Charsets.UTF_8)
        val results = linkedMapOf<String, DiscoveredCollaborationHost>()
        DatagramSocket().use { socket ->
            socket.broadcast = true
            socket.soTimeout = 250
            broadcastTargets().forEach { address ->
                runCatching { socket.send(DatagramPacket(request, request.size, address, DISCOVERY_PORT)) }
            }
            val deadline = System.currentTimeMillis() + timeoutMillis
            val buffer = ByteArray(64 * 1024)
            while (System.currentTimeMillis() < deadline) {
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue
                }
                val payload = runCatching { JSONObject(String(packet.data, packet.offset, packet.length, Charsets.UTF_8)) }.getOrNull() ?: continue
                if (payload.optString("type") != "AI_EDU_MANAGER_DISCOVERY" || payload.optString("role") !in setOf("host", "standalone")) continue
                val nodeId = payload.optString("deviceId").trim()
                if (nodeId.isBlank()) continue
                val port = payload.optInt("port", 18777).coerceIn(1, 65535)
                val endpoints = buildList {
                    addAll(payload.optJSONArray("lanUrls").collaborationStrings())
                    addAll(payload.optJSONArray("tailscaleUrls").collaborationStrings())
                    add("http://${packet.address.hostAddress}:$port")
                }.mapNotNull(CollaborationPairingProtocol::normalizeEndpoint).distinct().take(8)
                if (endpoints.isEmpty()) continue
                results[nodeId] = DiscoveredCollaborationHost(
                    nodeId = nodeId,
                    displayName = payload.optString("displayName").ifBlank { payload.optString("hostName") }.ifBlank { "附近协作设备" },
                    endpoints = endpoints,
                )
            }
        }
        return results.values.toList()
    }

    private fun broadcastTargets(): Set<InetAddress> = buildSet {
        add(InetAddress.getByName("255.255.255.255"))
        val interfaces = runCatching { java.util.Collections.list(NetworkInterface.getNetworkInterfaces()) }.getOrDefault(emptyList())
        interfaces.filter { runCatching { it.isUp && !it.isLoopback }.getOrDefault(false) }.forEach { network ->
            network.interfaceAddresses.mapNotNull { it.broadcast }.filterIsInstance<Inet4Address>().forEach(::add)
        }
    }
}

internal class CollaborationNetworkClient {
    fun join(
        connection: CollaborationConnectionInfo,
        localNode: CollaborationNodeIdentity,
        localEndpoints: List<String> = emptyList(),
    ): VerifiedDevicePairing {
        val discovered = if (connection.endpoints.isEmpty()) CollaborationLanDiscovery.discover() else emptyList()
        val candidates = if (connection.endpoints.isNotEmpty()) connection.endpoints else discovered.flatMap { it.endpoints }
        require(candidates.isNotEmpty()) { "尚未发现协作设备；请确认两台设备在同一局域网或热点，或粘贴完整连接信息" }
        var lastError = "没有协作设备接受该临时码"
        for (endpoint in candidates.distinct().take(8)) {
            try {
                val payload = postJoin(endpoint, connection, localNode, localEndpoints)
                val confirmation = requireNotNull(payload.optJSONObject("confirmation")) {
                    payload.optString("message").ifBlank { "对方没有返回设备配对确认" }
                }
                val verified = CollaborationPairingProtocol.verifyDeviceConfirmation(confirmation, localNode.nodeId)
                if (connection.expectedNodeId.isNotBlank()) require(verified.peerNodeId == connection.expectedNodeId) { "返回的主机身份与连接信息不一致" }
                return verified.copy(endpoints = (verified.endpoints + endpoint).distinct().take(8))
            } catch (error: Exception) {
                lastError = error.message ?: "连接 $endpoint 失败"
            }
        }
        error(lastError)
    }

    fun confirmStudentMapping(endpoints: List<String>, acceptanceJson: String) {
        require(endpoints.isNotEmpty()) { "协作设备没有可用的确认地址" }
        var lastError = "无法把学生映射确认发回协作设备"
        for (endpoint in endpoints.mapNotNull(CollaborationPairingProtocol::normalizeEndpoint).distinct().take(8)) {
            val http = try {
                (URL("$endpoint/api/collaboration/student-map/accept").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 4_000
                    readTimeout = 6_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            } catch (error: Exception) {
                lastError = error.message ?: "连接 $endpoint 失败"
                continue
            }
            try {
                http.outputStream.use { it.write(acceptanceJson.toByteArray(Charsets.UTF_8)) }
                val status = http.responseCode
                val response = (if (status in 200..299) http.inputStream else http.errorStream)
                    ?.bufferedReader()?.use { it.readText() }.orEmpty()
                val parsed = runCatching { JSONObject(response) }
                    .getOrElse { JSONObject().put("message", "协作设备返回了无法识别的响应（HTTP $status）") }
                require(status in 200..299 && parsed.optBoolean("ok")) {
                    parsed.optString("message").ifBlank { "协作设备没有确认学生映射（HTTP $status）" }
                }
                return
            } catch (error: Exception) {
                lastError = error.message ?: "连接 $endpoint 失败"
            } finally {
                http.disconnect()
            }
        }
        error(lastError)
    }

    private fun postJoin(
        endpoint: String,
        connection: CollaborationConnectionInfo,
        localNode: CollaborationNodeIdentity,
        localEndpoints: List<String>,
    ): JSONObject {
        val http = URL("$endpoint/api/collaboration/device-pair/join").openConnection() as HttpURLConnection
        http.requestMethod = "POST"
        http.connectTimeout = 4_000
        http.readTimeout = 6_000
        http.doOutput = true
        http.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        val body = JSONObject().apply {
            put("invitationId", connection.invitationId)
            put("pairingCode", connection.pairingCode)
            put("acceptingNode", localNode.toJson())
            put("transportOffers", org.json.JSONArray().apply {
                val endpoints = localEndpoints.mapNotNull(CollaborationPairingProtocol::normalizeEndpoint).distinct().take(8)
                if (endpoints.isNotEmpty()) put(JSONObject().apply {
                    put("transportId", "lan_direct")
                    put("protocolVersion", "1.1")
                    put("endpoints", org.json.JSONArray(endpoints))
                    put("preferred", true)
                    put("nodeId", localNode.nodeId)
                })
            })
        }.toString().toByteArray(Charsets.UTF_8)
        http.outputStream.use { it.write(body) }
        val status = http.responseCode
        val response = (if (status in 200..299) http.inputStream else http.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
        val parsed = runCatching { JSONObject(response) }.getOrElse { JSONObject().put("message", "协作设备返回了无法识别的响应（HTTP $status）") }
        require(status in 200..299) { parsed.optString("message").ifBlank { "连接协作设备失败（HTTP $status）" } }
        http.disconnect()
        return parsed
    }
}
