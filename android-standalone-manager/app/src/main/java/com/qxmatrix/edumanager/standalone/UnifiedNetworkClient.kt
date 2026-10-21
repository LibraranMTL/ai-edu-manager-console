package com.qxmatrix.edumanager.standalone

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.CancellationException

enum class NetworkFailureKind { OFFLINE, TIMEOUT, HTTP_CLIENT, HTTP_SERVER, RESPONSE_TOO_LARGE, CANCELLED, INVALID_RESPONSE, TRANSPORT }
data class NetworkFailure(val kind: NetworkFailureKind, val retryable: Boolean, val resultUnknown: Boolean, val safeMessage: String)
data class NetworkResponse(val status: Int, val body: ByteArray, val headers: Map<String, List<String>>, val finalUrl: String)

data class NetworkRequest(
    val url: String,
    val method: String = "GET",
    val headers: Map<String, String> = emptyMap(),
    val body: ByteArray? = null,
    val connectTimeoutMs: Int = 15_000,
    val readTimeoutMs: Int = 60_000,
    val maxResponseBytes: Long = 4L * 1024 * 1024,
    val followRedirects: Boolean = false,
)

/** Shared bounded transport. It never logs bodies, credentials, full query strings or student data. */
object UnifiedNetworkClient {
    fun execute(request: NetworkRequest, cancellation: ModelCancellation? = null): NetworkResponse {
        val connection = openConnection(request)
        cancellation?.attach(connection::disconnect)
        try {
            cancellation?.check()
            request.body?.let { bytes -> connection.outputStream.use { it.write(bytes) } }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    cancellation?.check()
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size().toLong() + count > request.maxResponseBytes) throw ResponseTooLargeException()
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            cancellation?.check()
            val headers = connection.headerFields.entries.mapNotNull { (name, values) ->
                name?.let { it to values.orEmpty() }
            }.toMap()
            return NetworkResponse(status, body, headers, connection.url.toString())
        } finally {
            cancellation?.detach()
            connection.disconnect()
        }
    }

    fun openConnection(request: NetworkRequest): HttpURLConnection = (URL(request.url).openConnection() as HttpURLConnection).apply {
        requestMethod = request.method
        connectTimeout = request.connectTimeoutMs.coerceIn(1_000, 60_000)
        readTimeout = request.readTimeoutMs.coerceIn(1_000, 180_000)
        instanceFollowRedirects = request.followRedirects
        doOutput = request.body != null
        request.headers.forEach { (name, value) ->
            require(name.matches(Regex("^[A-Za-z0-9-]{1,80}$")) && '\r' !in value && '\n' !in value)
            setRequestProperty(name, value)
        }
    }

    fun classify(error: Throwable, requestMayHaveBeenSent: Boolean): NetworkFailure = when (error) {
        is CancellationException -> NetworkFailure(NetworkFailureKind.CANCELLED, false, requestMayHaveBeenSent, "操作已取消")
        is SocketTimeoutException -> NetworkFailure(NetworkFailureKind.TIMEOUT, true, requestMayHaveBeenSent, "网络响应超时")
        is ResponseTooLargeException -> NetworkFailure(NetworkFailureKind.RESPONSE_TOO_LARGE, false, false, "服务器返回内容超过安全限制")
        is IOException -> NetworkFailure(NetworkFailureKind.TRANSPORT, true, requestMayHaveBeenSent, "网络连接失败")
        else -> NetworkFailure(NetworkFailureKind.INVALID_RESPONSE, false, requestMayHaveBeenSent, "服务器响应无法验证")
    }
}

class ResponseTooLargeException : IOException("response_too_large")
