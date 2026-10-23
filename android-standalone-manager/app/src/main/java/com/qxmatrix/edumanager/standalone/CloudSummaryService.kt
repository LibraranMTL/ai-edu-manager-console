package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject

object CloudSummaryPolicy {
    fun summary(payload: JSONObject, studentName: String): String {
        val module = payload.getString("module")
        require(module in LearningStudioPolicy.fields && module != "cards") { "仅支持选题/规划摘要" }
        val result = buildString {
            appendLine("# ${LearningStudioService.moduleLabels[module]}参考摘要")
            appendLine("以下内容仅供参考，不代表已报名、录取、获奖或能力结论。")
            val items = payload.getJSONObject("result").getJSONArray("items")
            require(items.length() in 1..10)
            for (index in 0 until items.length()) {
                appendLine("\n## ${index + 1}")
                val item = items.getJSONObject(index)
                LearningStudioPolicy.fields.getValue(module).forEach { field -> appendLine("$field：${item.getString(field)}") }
                item.optJSONObject("fieldSources")?.let { sources ->
                    LearningStudioPolicy.fields.getValue(module).forEach { field ->
                        val url = sources.optString(field)
                        if (url.isNotBlank()) {
                            val uri = java.net.URI(url)
                            require(uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.rawUserInfo == null)
                            appendLine("$field 来源：$url")
                        }
                    }
                }
            }
        }
        val clean = LearningStudioPolicy.redact(result, studentName)
        require(!Regex("(?i)(?:(?<![a-z0-9])[a-z]:[\\\\/]|file://|content://|(?<![a-z0-9:/])/(?:Users|home|storage)/)").containsMatchIn(clean)) { "摘要含本机路径，不能上传" }
        require(clean.toByteArray().size <= 32_768) { "摘要超过32KB，请减少建议数量" }
        return clean
    }
    fun matches(document: JSONObject, name: String, hash: String, device: String): Boolean =
        document.optString("displayName") == name && document.optString("contentSha256").equals(hash, true) && document.optString("originDeviceId") == device
}

data class CloudSummaryPreview(val studentId: String, val versionId: String, val versionHash: String, val text: String,
    val contentHash: String, val cloudStudentId: String, val server: String, val filename: String)

class CloudSummaryService(private val context: Context) {
    fun prepare(studentId: String, versionId: String): CloudSummaryPreview {
        val student = StudentIndexRepository(context).requireExact(studentId)
        val row = ScopedContentRepository(context).exact(studentId, versionId); require(row.kind == "artifact")
        val payload = JSONObject(row.payload); require(row.sourceSha256 == ScopedContentPolicy.fingerprint(payload))
        val text = CloudSummaryPolicy.summary(payload, student.name); val hash = ScopedContentPolicy.hash(text.toByteArray())
        val cloud = CloudReportSync(context); val state = cloud.status(studentId)
        require(state.configured && state.enabled && state.pendingServerState.isBlank()) { "请先开通当前学生的云服务并完成上传许可同步" }
        require(Regex("^[a-zA-Z0-9_-]{8,96}$").matches(state.cloudStudentId))
        return CloudSummaryPreview(studentId, versionId, row.sourceSha256, text, hash, state.cloudStudentId, cloud.serviceAddress(), "planning-${hash.take(24)}.md")
    }
    fun publish(preview: CloudSummaryPreview): String = synchronized(StudentWorkLocks.forStudent(preview.studentId)) {
        require(prepare(preview.studentId, preview.versionId) == preview) { "摘要、学生绑定或云地址已变化，请重新预览" }
        val cloud = CloudReportSync(context); val db = BusinessDatabase.get(context)
        val key = "cloud-summary:${preview.studentId}:${preview.cloudStudentId}:${ScopedContentPolicy.hash(preview.server.toByteArray()).take(16)}:${preview.contentHash}"
        val previous = db.tasks().metadata(key)?.let(::JSONObject)
        fun findRemote(trash: Boolean): JSONObject? {
            var cursor = ""
            repeat(20) {
                val query = "?trash=${if (trash) 1 else 0}" + if (cursor.isBlank()) "" else "&cursor=${java.net.URLEncoder.encode(cursor, "UTF-8") }"
                val response = cloud.documentRequest("GET", "/v1/students/${preview.cloudStudentId}/documents$query", expectedServer = preview.server)
                val rows = response.getJSONArray("documents")
                for (index in 0 until rows.length()) if (CloudSummaryPolicy.matches(rows.getJSONObject(index), preview.filename, preview.contentHash, cloud.documentDeviceId())) return rows.getJSONObject(index)
                cursor = response.optString("nextCursor"); if (cursor.isBlank()) return null
            }
            error("远端清单超过核对上限，未发送；请先整理云文档")
        }
        val active = findRemote(false)
        val revoked = if (active == null) findRemote(true) else null
        if (active != null || revoked != null) {
            val row = active ?: requireNotNull(revoked)
            db.tasks().metadata(BusinessMetadataEntity(key, JSONObject().put("state", if (revoked != null) "withdrawn" else "succeeded").put("documentId", row.getString("documentId")).toString()))
            return@synchronized if (revoked != null) "该摘要已在云端撤回；不会重新上传或复活" else "已确认云端已有同一摘要，未重复上传"
        }
        require(UnknownOutcomePolicy.retryAllowed(previous)) { "上次摘要上传结果需核对，远端未找到；请到任务中心核对并单次授权，不会盲目重试" }
        require(prepare(preview.studentId, preview.versionId) == preview) { "核对期间资料或云绑定已变化，未上传" }
        db.tasks().metadata(BusinessMetadataEntity(key, JSONObject().put("state", "unknown").put("startedAt", Timestamp.now()).toString()))
        val receipt = cloud.documentRequest("POST", "/v1/students/${preview.cloudStudentId}/documents", preview.text.toByteArray(Charsets.UTF_8), preview.filename, preview.server)
        require(receipt.getString("contentSha256").equals(preview.contentHash, true)) { "云端摘要回执哈希不匹配，保持未知状态" }
        if (receipt.optBoolean("withdrawn", false)) {
            db.tasks().metadata(BusinessMetadataEntity(key, receipt.put("state", "withdrawn").toString()))
            return@synchronized "服务端确认该摘要已撤回；不会复活"
        }
        db.tasks().metadata(BusinessMetadataEntity(key, receipt.put("state", "succeeded").toString()))
        "摘要已上传并收到哈希回执；原件、档案与作答未上传"
    }
}
