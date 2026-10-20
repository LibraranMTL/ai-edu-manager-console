package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Real local HTTP transport; synthetic payloads, no external API, credential or student data. */
class ModelTransportTest {
    private class LocalServer(private val handler: (String, Map<String, String>, String, Int) -> Pair<Int, String>) : AutoCloseable {
        private val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val port: Int get() = socket.localPort
        val failure = AtomicReference<Throwable?>()
        private val thread = Thread {
            try {
                while (!socket.isClosed) socket.accept().use { connection ->
                    connection.soTimeout = 5000
                    val reader = connection.getInputStream().bufferedReader()
                    val start = reader.readLine().orEmpty()
                    val headers = linkedMapOf<String, String>()
                    while (true) {
                        val line = reader.readLine().orEmpty(); if (line.isBlank()) break
                        headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim()
                    }
                    val chars = CharArray(headers["content-length"]?.toIntOrNull() ?: 0)
                    var offset = 0
                    while (offset < chars.size) { val read = reader.read(chars, offset, chars.size - offset); if (read < 0) break; offset += read }
                    val (status, response) = handler(start, headers, String(chars), port)
                    val bytes = response.toByteArray(Charsets.UTF_8)
                    val location = if (status == 307) "Location: http://127.0.0.1:$port/redirect-target\r\n" else ""
                    val head = "HTTP/1.1 $status Test\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nx-request-id: local-request-1\r\n${location}Connection: close\r\n\r\n"
                    connection.getOutputStream().write(head.toByteArray(Charsets.UTF_8))
                    connection.getOutputStream().write(bytes); connection.getOutputStream().flush()
                }
            } catch (error: Throwable) { if (!socket.isClosed) failure.set(error) }
        }.apply { isDaemon = true; start() }
        override fun close() { socket.close(); thread.join(1000) }
    }

    @Test fun sendsJsonAndCapturesProviderRequestId() {
        val requests = AtomicInteger()
        val server = LocalServer { start, headers, requestBody, _ ->
            requests.incrementAndGet()
            assertEquals("POST /v1/chat/completions HTTP/1.1", start)
            assertEquals("Bearer synthetic-test-only", headers["authorization"])
            val request = JSONObject(requestBody)
            assertEquals("synthetic-model", request.getString("model"))
            200 to """{"choices":[{"finish_reason":"stop","message":{"content":"OK"}}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}"""
        }
        try {
            val provider = CompatibleModelProvider("http://127.0.0.1:${server.port}/v1", "synthetic-test-only")
            val result = provider.generate(ModelRequest("synthetic-model", JSONArray().put(JSONObject().put("role", "user").put("content", "OK"))))
            assertEquals("OK", result.text); assertEquals("local-request-1", result.requestId)
            assertEquals(4L, result.usage.totalTokens); assertEquals(1, requests.get())
        } finally { server.close() }
        assertNull(server.failure.get())
    }

    @Test fun redirectIsRejectedWithoutForwardingAuthorization() {
        val forwarded = AtomicInteger()
        val server = LocalServer { start, _, _, _ ->
            if (start.contains("/redirect-target")) { forwarded.incrementAndGet(); 200 to "{}" }
            else 307 to ""
        }
        try {
            val provider = CompatibleModelProvider("http://127.0.0.1:${server.port}/v1", "synthetic-test-only")
            try { provider.generate(ModelRequest("synthetic-model", JSONArray())); fail("redirect accepted") }
            catch (error: IllegalArgumentException) { assertTrue(error.message.orEmpty().contains("HTTP 307")) }
            assertEquals(0, forwarded.get())
        } finally { server.close() }
        assertNull(server.failure.get())
    }
}
