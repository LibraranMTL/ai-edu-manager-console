package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.UUID

object AudioSourcePolicy {
    const val MAX_BYTES = 20_000_000
    fun validate(name: String, bytes: ByteArray): String {
        require(bytes.size in 12..MAX_BYTES)
        fun ascii(start: Int, count: Int) = bytes.copyOfRange(start, start + count).toString(Charsets.US_ASCII)
        val ext = name.substringAfterLast('.', "").lowercase()
        val valid = when (ext) {
            "wav" -> ascii(0, 4) == "RIFF" && ascii(8, 4) == "WAVE"
            "m4a", "mp4" -> ascii(4, 4) == "ftyp"
            "mp3" -> ascii(0, 3) == "ID3" || (bytes[0].toInt() and 255 == 255 && bytes[1].toInt() and 224 == 224)
            "ogg" -> ascii(0, 4) == "OggS"
            "webm" -> bytes.take(4).map { it.toInt() and 255 } == listOf(26, 69, 223, 163)
            else -> false
        }
        require(valid) { "不是支持的 WAV/M4A/MP3/OGG/WebM 音频文件" }
        return ext
    }
}

/** Independent Windows-compatible ASR contract. Chat/vision credentials are never reused. */
class AudioTranscriptionService(private val context: Context) {
    fun transcribe(studentId: String, materialId: String, cloudConsent: Boolean, cancellation: ModelCancellation): JSONObject = synchronized(StudentWorkLocks.forStudent(studentId)) {
        val student = StudentIndexRepository(context).requireExact(studentId)
        val files = FileAssetService(context)
        val material = files.materials(studentId).single { it.getString("id") == materialId }
        val bytes = files.readMaterialBytes(studentId, materialId, AudioSourcePolicy.MAX_BYTES)
        val extension = AudioSourcePolicy.validate(material.getString("fileName"), bytes)
        val hash = ScopedContentPolicy.hash(bytes)
        val config = requireNotNull(AgentConfigurationStore(context, "local_asr").load()) { "请单独配置兼容 ASR 服务；聊天模型不代表能够转写" }
        require(Regex("^[A-Za-z0-9._/-]{1,120}$").matches(config.model)) { "ASR 模型名格式无效" }
        val base = ModelEndpointPolicy.normalize(config.endpoint)
        val local = URI(base).host in setOf("127.0.0.1", "localhost")
        require(local || cloudConsent) { "云端转写必须明确授权本次发送所选音频" }
        val key = ScopedContentPolicy.hash("$hash:$base:${config.model}:asr-v1".toByteArray())
        val taskId = "asr:$key"
        val repo = ScopedContentRepository(context)
        val cached = repo.checkpoint(studentId, "asr_result", key)
        val result = if (cached != null) cached else {
            require(!BusinessDatabase.get(context).ledger().hasPossibleResult(studentId, taskId)) { "上次转写可能已有结果或计费，请先核对；不重复上传" }
            ModelBudget(context).reserve(studentId, "asr", UUID.randomUUID().toString())
            val call = ModelCallReceipt(UUID.randomUUID().toString(), studentId, taskId, "asr-compatible", config.model, URI(base).host,
                "asr-v1", "asr-result-v1", System.currentTimeMillis(), thinkingMode = "not_applicable")
            val receipts = RoomModelReceiptSink(context); receipts.record(call)
            var sent = false
            try {
                cancellation.check()
                val boundary = "edu-${UUID.randomUUID()}"
                val connection = URL("$base/audio/transcriptions").openConnection() as HttpURLConnection
                try {
                    connection.instanceFollowRedirects = false; connection.requestMethod = "POST"; connection.connectTimeout = 15_000; connection.readTimeout = 90_000
                    connection.doOutput = true
                    connection.setRequestProperty("Authorization", "Bearer ${config.apiKey}")
                    connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                    cancellation.attach { connection.disconnect() }
                    connection.outputStream.use { out ->
                        sent = true
                        fun text(value: String) { out.write(value.toByteArray(Charsets.UTF_8)) }
                        text("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.$extension\"\r\nContent-Type: application/octet-stream\r\n\r\n")
                        out.write(bytes); text("\r\n--$boundary\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n${config.model}\r\n")
                        text("--$boundary\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n--$boundary--\r\n")
                    }
                    require(connection.responseCode in 200..299) { "ASR HTTP ${connection.responseCode}；没有重定向或自动重试" }
                    val body = connection.inputStream.use { it.readBytesBounded(1_000_000) }.toString(Charsets.UTF_8)
                    val text = JSONObject(body).getString("text").trim(); require(text.isNotEmpty() && text.length <= 100_000)
                    cancellation.check()
                    val value = JSONObject().put("text", text).put("sourceSha256", hash).put("engine", config.model)
                        .put("evidenceStatus", "machine_observed").put("reviewStatus", "pending_review").put("createdAt", Timestamp.now())
                    repo.saveCheckpoint(studentId, "asr_result", key, value)
                    receipts.record(call.copy(state = "succeeded", elapsedMs = System.currentTimeMillis() - call.startedAt))
                    value
                } finally { cancellation.detach(); connection.disconnect() }
            } catch (error: Throwable) {
                receipts.record(call.copy(state = if (sent) "unknown" else "failed", errorCode = if (sent) "asr_result_unknown" else "asr_not_sent", elapsedMs = System.currentTimeMillis() - call.startedAt))
                throw IllegalStateException(if (sent) "转写结果需人工核对，可能已计费；不自动重试" else "转写尚未发送：${error.message}", error)
            }
        }
        require(ScopedContentPolicy.hash(files.readMaterialBytes(studentId, materialId, AudioSourcePolicy.MAX_BYTES)) == hash) { "音频已变化，原版本保留" }
        val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
        val path = "${student.paths.summaryPath}/摘要库/音频转写-$key.json"
        val markdown = "${student.paths.summaryPath}/摘要库/音频转写-$key.md"
        val output = JSONObject(result.toString()).put("studentId", studentId).put("materialId", materialId).put("sourcePath", material.getString("absolutePath"))
        store.writeBytesSafely(path, output.toString(2).toByteArray(), "application/json")
        store.writeBytesSafely(markdown, "# 音频转写候选\n\n机器观察／待审核；不是学习掌握结论。\n来源 $materialId · SHA256 $hash\n\n${result.getString("text")}\n".toByteArray(), "text/markdown")
        files.patchMaterial(studentId, materialId, JSONObject().put("ocrStatus", "completed").put("ocrPath", path)
            .put("ocrMarkdownPath", markdown).put("digestReady", true).put("digestInputKind", "asr")
            .put("asrStatus", "pending_review"))
        runCatching { AutomationEventEmitter.ocrResult(context, studentId, material, output) }
        output
    }
}
