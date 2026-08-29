package com.qxmatrix.edumanager.standalone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class CollaborationNearbyService : Service() {
    private var server: CollaborationNearbyServer? = null
    private val state by lazy { CollaborationNearbyStateStore(this) }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            state.clearInvitation()
            state.recordEvent("附近协作接收已由用户停止")
            stopSelf()
            return START_NOT_STICKY
        }
        state.markStarting()
        startAsForeground()
        if (server == null) {
            runCatching {
                CollaborationNearbyServer(this).also { it.start(); server = it }
                state.setRunning(true)
                state.recordEvent("附近协作接收已启动")
            }.onFailure {
                state.setStartupError("附近协作接收启动失败：${it.message ?: "端口或网络不可用"}")
                stopSelf()
            }
        } else {
            state.setRunning(true)
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        server?.close()
        server = null
        state.setRunning(false)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startAsForeground() {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, CollaborationActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, CollaborationNearbyService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notificationBuilder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val notification = notificationBuilder
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("AI教育管家附近知识协作")
            .setContentText("仅在同一 Wi-Fi、热点或已配置的 Tailscale 网络中接收可信设备连接")
            .setContentIntent(pendingIntent)
            .addAction(Notification.Action.Builder(null, "停止", stopIntent).build())
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "附近知识协作", NotificationManager.IMPORTANCE_LOW))
    }

    companion object {
        const val ACTION_START = "com.qxmatrix.edumanager.standalone.action.START_NEARBY_COLLABORATION"
        const val ACTION_STOP = "com.qxmatrix.edumanager.standalone.action.STOP_NEARBY_COLLABORATION"
        private const val CHANNEL_ID = "knowledge-collaboration-nearby"
        private const val NOTIFICATION_ID = 8221
    }
}

internal class CollaborationNearbyServer(private val context: android.content.Context) : AutoCloseable {
    private val running = AtomicBoolean(false)
    private val executor = Executors.newFixedThreadPool(5)
    private val repository = CollaborationRepository(context)
    private val receiver = CollaborationNearbyDirectReceiver(context)
    private val state = CollaborationNearbyStateStore(context)
    private val node = CollaborationNodeIdentityStore(context).get()
    private var httpServer: ServerSocket? = null
    private var discoverySocket: DatagramSocket? = null

    fun start() {
        check(running.compareAndSet(false, true)) { "附近协作服务已经启动" }
        try {
            httpServer = ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress("0.0.0.0", CollaborationNearbyEndpointResolver.HTTP_PORT))
            }
            discoverySocket = DatagramSocket(null).apply {
                reuseAddress = true
                broadcast = true
                bind(InetSocketAddress("0.0.0.0", CollaborationNearbyEndpointResolver.DISCOVERY_PORT))
            }
            executor.execute(::acceptLoop)
            executor.execute(::discoveryLoop)
        } catch (error: Exception) {
            close()
            throw error
        }
    }

    private fun acceptLoop() {
        while (running.get()) {
            val socket = try { httpServer?.accept() } catch (_: SocketException) { null } catch (_: Exception) { null } ?: break
            executor.execute { handleClient(socket) }
        }
    }

    private fun discoveryLoop() {
        val buffer = ByteArray(64 * 1024)
        while (running.get()) {
            val packet = DatagramPacket(buffer, buffer.size)
            try {
                discoverySocket?.receive(packet) ?: break
                val request = runCatching { JSONObject(String(packet.data, packet.offset, packet.length, Charsets.UTF_8)) }.getOrNull() ?: continue
                if (request.optString("type") != "AI_EDU_MANAGER_DISCOVER" || request.optInt("protocolVersion") < 2) continue
                if (request.optString("searchRole", "all") !in setOf("host", "standalone", "all")) continue
                val payload = JSONObject().apply {
                    put("type", "AI_EDU_MANAGER_DISCOVERY"); put("protocolVersion", 2); put("role", "standalone")
                    put("deviceId", node.nodeId); put("machineCode", node.machineCode); put("displayName", node.displayName)
                    put("platform", "android")
                    put("appVersion", context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty())
                    put("port", CollaborationNearbyEndpointResolver.HTTP_PORT)
                    put("lanUrls", JSONArray(CollaborationNearbyEndpointResolver.lanEndpoints()))
                    put("tailscaleUrls", JSONArray(CollaborationNearbyEndpointResolver.tailscaleEndpoints()))
                    put("capabilities", JSONArray(listOf("device-trust-v1", "student-mapping-v1", "android-nearby-v1", "lan-direct-v1")))
                }.toString().toByteArray(Charsets.UTF_8)
                discoverySocket?.send(DatagramPacket(payload, payload.size, packet.address, packet.port))
            } catch (_: SocketException) {
                break
            } catch (_: Exception) {
                // Discovery is best effort; malformed packets do not stop the foreground service.
            }
        }
    }

    private fun handleClient(socket: Socket) {
        socket.use { client ->
            client.soTimeout = 35_000
            val output = BufferedOutputStream(client.getOutputStream())
            try {
                val request = readRequest(BufferedInputStream(client.getInputStream()), client.inetAddress?.hostAddress.orEmpty())
                val result = route(request)
                writeJson(output, result.first, result.second)
            } catch (error: RouteNotFoundException) {
                writeJson(output, 404, JSONObject().put("ok", false).put("message", "附近协作接口不存在"))
            } catch (error: Exception) {
                writeJson(output, 400, JSONObject().put("ok", false).put("message", error.message ?: "附近协作请求失败"))
            }
        }
    }

    private fun route(request: NearbyHttpRequest): Pair<Int, JSONObject> {
        val path = URI(request.target).path ?: "/"
        if (request.method == "POST" && path == "/api/collaboration/device-pair/join") {
            val completed = repository.completeIncomingDevicePairing(request.body.toString(Charsets.UTF_8), request.remoteAddress)
            return 200 to JSONObject().put("ok", true).put("confirmation", JSONObject(completed.confirmationJson))
        }
        if (request.method == "POST" && path == "/api/collaboration/student-map/accept") {
            val accepted = repository.acceptIncomingStudentMapping(request.body.toString(Charsets.UTF_8))
            return 200 to JSONObject().put("ok", true).put("studentMapId", accepted.studentMapId)
        }
        if (request.method == "GET" && path == "/api/collaboration/direct/capabilities") {
            return 200 to receiver.capabilities()
        }
        Regex("^/api/collaboration/android/pull/([A-Za-z0-9._-]+)$").matchEntire(path)?.let { match ->
            if (request.method == "GET") return 200 to receiver.noPullAvailable(match.groupValues[1], request.method, path, request.headers)
        }
        if (request.method == "POST" && path == "/api/collaboration/direct/packages") {
            return 200 to receiver.initialize(request.method, path, request.headers, request.body)
        }
        Regex("^/api/collaboration/direct/packages/([A-Za-z0-9._-]+)/files/(\\d+)/chunks/(\\d+)$").matchEntire(path)?.let { match ->
            if (request.method == "PUT") return 200 to receiver.appendChunk(
                match.groupValues[1], match.groupValues[2].toInt(), match.groupValues[3].toLong(),
                request.method, path, request.headers, request.body,
            )
        }
        Regex("^/api/collaboration/direct/packages/([A-Za-z0-9._-]+)/commit$").matchEntire(path)?.let { match ->
            if (request.method == "POST") return 200 to receiver.commit(match.groupValues[1], request.method, path, request.headers, request.body)
        }
        throw RouteNotFoundException()
    }

    private fun readRequest(input: BufferedInputStream, remoteAddress: String): NearbyHttpRequest {
        val requestLine = readAsciiLine(input, 8 * 1024)
        val parts = requestLine.split(' ')
        require(parts.size == 3 && parts[2].startsWith("HTTP/1.")) { "HTTP 请求行无效" }
        val method = parts[0].uppercase()
        require(method in setOf("GET", "POST", "PUT")) { "HTTP 方法不受支持" }
        val target = parts[1]
        require(target.startsWith('/') && target.length <= 4 * 1024) { "HTTP 请求路径无效" }
        val headers = linkedMapOf<String, String>()
        var headerBytes = 0
        while (true) {
            val line = readAsciiLine(input, 16 * 1024)
            headerBytes += line.length
            require(headerBytes <= 64 * 1024) { "HTTP 请求头过大" }
            if (line.isEmpty()) break
            val separator = line.indexOf(':')
            require(separator > 0) { "HTTP 请求头无效" }
            headers[line.substring(0, separator).trim().lowercase()] = line.substring(separator + 1).trim()
        }
        val contentLength = headers["content-length"]?.toLongOrNull() ?: 0L
        require(contentLength in 0..MAX_REQUEST_BYTES.toLong()) { "HTTP 请求正文过大" }
        val body = ByteArray(contentLength.toInt())
        var offset = 0
        while (offset < body.size) {
            val count = input.read(body, offset, body.size - offset)
            require(count > 0) { "HTTP 请求正文不完整" }
            offset += count
        }
        return NearbyHttpRequest(method, target, headers, body, remoteAddress)
    }

    private fun readAsciiLine(input: BufferedInputStream, maximum: Int): String {
        val bytes = ArrayList<Byte>()
        while (bytes.size <= maximum) {
            val value = input.read()
            require(value >= 0) { "HTTP 请求提前结束" }
            if (value == '\n'.code) break
            if (value != '\r'.code) bytes += value.toByte()
        }
        require(bytes.size <= maximum) { "HTTP 行过长" }
        return bytes.toByteArray().toString(Charsets.ISO_8859_1)
    }

    private fun writeJson(output: BufferedOutputStream, status: Int, payload: JSONObject) {
        val body = payload.toString().toByteArray(Charsets.UTF_8)
        val reason = when (status) { 200 -> "OK"; 404 -> "Not Found"; else -> "Bad Request" }
        val headers = "HTTP/1.1 $status $reason\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n"
        output.write(headers.toByteArray(Charsets.ISO_8859_1))
        output.write(body)
        output.flush()
    }

    override fun close() {
        if (!running.getAndSet(false)) return
        runCatching { httpServer?.close() }
        runCatching { discoverySocket?.close() }
        executor.shutdownNow()
        state.setRunning(false)
    }

    private data class NearbyHttpRequest(
        val method: String,
        val target: String,
        val headers: Map<String, String>,
        val body: ByteArray,
        val remoteAddress: String,
    )

    private class RouteNotFoundException : RuntimeException()

    companion object { private const val MAX_REQUEST_BYTES = 8 * 1024 * 1024 }
}
