package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import androidx.work.workDataOf
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.Signature
import java.security.PrivateKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class CloudReportStatus(val configured: Boolean, val enabled: Boolean, val cloudStudentId: String,
    val lastSyncAt: Long, val lastError: String, val pendingServerState: String, val materialCategories: Set<String>,
    val profileFields: Set<String>, val authorizationPurpose: String, val authorizationExpiresAt: Long)

/** Optional, independently scoped cloud channel. Raw materials are uploaded only after per-item selection. */
class CloudReportSync(private val context: Context) {
    private val prefs = context.getSharedPreferences("cloud_report_v1", Context.MODE_PRIVATE)
    private val privateState = PrivateStateStore(context)
    private val defaultProfileFields = listOf("displayName", "grade", "learningGoal")
    // Keep the legacy report channel enabled. The four new document categories
    // require an explicit user selection before their scopes are granted.
    private val defaultMaterialCategories = listOf("learning_report")

    fun beginPublication(studentId: String): String {
        val id = UUID.randomUUID().toString()
        privateState.writeBytes("cloud-report/$studentId.pending", id.toByteArray(Charsets.UTF_8))
        return id
    }

    fun commitPublication(studentId: String, publicationId: String, contents: List<String>) {
        require(privateTextOrNull("cloud-report/$studentId.pending") == publicationId) { "整组报告发布编号不一致" }
        storeManifest(studentId, publicationId, contents)
        // A crash between manifest commit and marker clear is safe: both IDs still match.
        privateState.writeBytes("cloud-report/$studentId.pending", ByteArray(0))
    }

    /** Repairs only the already active publication; it never creates a second publication id. */
    fun reconcilePublication(studentId: String, publicationId: String, contents: List<String>): Boolean {
        val pending = privateTextOrNull("cloud-report/$studentId.pending").orEmpty()
        if (pending.isBlank()) return false
        require(pending == publicationId) { "待提交报告与当前活动版本不一致，停止自动对账" }
        commitPublication(studentId, publicationId, contents)
        return true
    }

    private fun storeManifest(studentId: String, publicationId: String, contents: List<String>) {
        val reports = validateSet(studentId, contents)
        val manifest = JSONObject().put("version", 1).put("studentId", studentId).put("publicationId", publicationId)
            .put("hashes", JSONArray(reports.map { EducationPublicationPolicy.sha256(it) }))
        privateState.writeBytes("cloud-report/$studentId.json", manifest.toString().toByteArray(Charsets.UTF_8))
    }

    private fun validateSet(studentId: String, contents: List<String>): List<String> {
        require(contents.size == GrowthModelService.REPORTS.size) { "四份报告未全部准备完成" }
        GrowthModelService.REPORTS.forEachIndexed { index, definition ->
            val content = contents[index]
            EducationPublicationPolicy.validatePublishedReport(studentId, definition.title, content)
            val header = Regex("^---\\s*\\r?\\n([\\s\\S]*?)\\r?\\n---").find(content)?.groupValues?.get(1) ?: error("报告缺少元信息")
            val type = Regex("^type:\\s*(\\S+)", RegexOption.MULTILINE).find(header)?.groupValues?.get(1)
            require(type == definition.type) { "${definition.title}类型与整组清单不一致" }
        }
        return contents
    }

    private fun snapshotForUpload(studentId: String): List<String> = withPublicationLock {
        val pending = privateTextOrNull("cloud-report/$studentId.pending").orEmpty().ifBlank { null }
        val manifest = privateTextOrNull("cloud-report/$studentId.json")?.let(::JSONObject)
        if (manifest == null) require(pending == null) { "本次四份报告尚未整组提交，暂不上传" }
        val service = GrowthModelService(context)
        val contents = validateSet(studentId, GrowthModelService.REPORTS.map { service.readPublishedReport(studentId, it.id) })
        val hashes = JSONArray(contents.map { EducationPublicationPolicy.sha256(it) })
        if (manifest == null) {
            // Upgrade path for four already-published reports: seal the complete current set once.
            storeManifest(studentId, "legacy-${UUID.randomUUID()}", contents)
        } else {
            require(manifest.optInt("version") == 1 && manifest.optString("studentId") == studentId) { "整组报告清单无效" }
            val committed = manifest.optJSONArray("hashes") ?: error("整组报告清单缺少哈希")
            require(CloudReportSetPolicy.uploadable(
                pending, manifest.optString("publicationId"),
                (0 until committed.length()).map { committed.optString(it) },
                (0 until hashes.length()).map { hashes.optString(it) },
            )) {
                "四份报告与已提交快照不一致，暂不上传"
            }
        }
        contents
    }

    private fun privateTextOrNull(path: String): String? = try {
        privateState.readBytes(path).toString(Charsets.UTF_8)
    } catch (_: FileNotFoundException) {
        null
    }

    fun status(studentId: String): CloudReportStatus = CloudReportStatus(
        configured = prefs.getString("cloud:$studentId", "").orEmpty().isNotBlank() &&
            prefs.getString("bindingDevice:$studentId", "").orEmpty().let { it.isNotBlank() && it == prefs.getString("deviceId", "") },
        enabled = prefs.getBoolean("enabled:$studentId", false) &&
            prefs.getLong("authorizationExpiresAt:$studentId", 0L) > System.currentTimeMillis(),
        cloudStudentId = prefs.getString("cloud:$studentId", "").orEmpty(),
        lastSyncAt = prefs.getLong("lastSync:$studentId", 0),
        lastError = prefs.getString("lastError:$studentId", "").orEmpty(),
        pendingServerState = prefs.getString("pending:$studentId", "").orEmpty(),
        materialCategories = prefs.getStringSet("categories:$studentId", setOf("learning_report")).orEmpty().toSet(),
        profileFields = prefs.getStringSet("profileFields:$studentId", defaultProfileFields.toSet()).orEmpty().toSet(),
        authorizationPurpose = prefs.getString("authorizationPurpose:$studentId", "document_sync").orEmpty(),
        authorizationExpiresAt = prefs.getLong("authorizationExpiresAt:$studentId", 0L),
    )

    fun enroll(studentId: String, serverUrl: String, code: String): CloudReportStatus {
        StudentIndexRepository(context).requireExact(studentId)
        val base = checkedBase(serverUrl)
        val currentBase = prefs.getString("server", "").orEmpty()
        require(currentBase.isBlank() || currentBase == base) { "本机已绑定另一云端服务地址" }
        val body = JSONObject().put("enrollmentCode", code.trim().uppercase()).put("publicKey", sourcePublicKey())
            .put("contractVersion", 2).put("profileFields", JSONArray(defaultProfileFields))
            .put("materialCategories", JSONArray(defaultMaterialCategories))
        val result = try { post(base, "/v1/source-enrollments/redeem", token().takeIf { it.isNotBlank() && prefs.getString("deviceId", "").orEmpty().isNotBlank() }, body) }
            catch (error: CloudHttpException) {
                if (error.status != 401) throw error
                post(base, "/v1/source-enrollments/redeem", null, body)
            }
        val cloudStudentId = result.getString("cloudStudentId")
        val deviceToken = result.getString("deviceToken")
        require(Regex("^cs_[a-f0-9]{32}$").matches(cloudStudentId)) { "云端学生标识无效" }
        prefs.edit().putString("server", base).putString("token", encrypt(deviceToken))
            .putString("deviceId", result.getString("deviceId")).putString("bindingDevice:$studentId", result.getString("deviceId"))
            .putString("cloud:$studentId", cloudStudentId).putBoolean("enabled:$studentId", false)
            .putInt("contractVersion:$studentId", 2)
            .putStringSet("categories:$studentId", defaultMaterialCategories.toSet())
            .putStringSet("profileFields:$studentId", defaultProfileFields.toSet())
            .putString("authorizationPurpose:$studentId", "document_sync").putLong("authorizationExpiresAt:$studentId", 0L)
            .putString("pending:$studentId", "disable").putString("lastError:$studentId", "")
            .apply { GrowthModelService.REPORTS.forEach { remove("hash:$studentId:${it.id}") } }.apply()
        schedule(studentId)
        return status(studentId)
    }

    fun enrollOfficial(studentId: String, code: String): CloudReportStatus =
        enroll(studentId, CloudServiceEndpoint.OFFICIAL_BASE_URL, code)

    /** Establishes cloud identity from an active Android product license. Upload remains disabled
     * until the user separately confirms fields, categories, purpose and expiry. */
    fun autoEnrollOfficial(studentId: String): CloudReportStatus {
        val student = StudentIndexRepository(context).requireExact(studentId)
        val license = LicenseManager(context)
        license.requireActive()
        // A previous response may already have been committed before receipt writing failed.
        // Never replace an existing student's explicit upload scope on a repeated enrollment.
        val current = status(studentId)
        if (current.configured) return current
        val base = checkedBase(CloudServiceEndpoint.OFFICIAL_BASE_URL)
        val currentBase = prefs.getString("server", "").orEmpty()
        require(currentBase.isBlank() || currentBase == base) { "本机已绑定另一云端服务地址" }
        val bindingPreference = "bindingKey:$studentId"
        val existingBinding = prefs.getString(bindingPreference, "").orEmpty()
        val bindingKey = if (existingBinding.isBlank()) {
            Base64.encodeToString(ByteArray(32).also(SecureRandom()::nextBytes), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                .also { prefs.edit().putString(bindingPreference, encrypt(it)).commit() }
        } else decrypt(existingBinding)
        val existingToken = token().takeIf { it.isNotBlank() && prefs.getString("deviceId", "").orEmpty().isNotBlank() }
        val body = JSONObject().put("licenseToken", license.gatewayLicenseToken()).put("deviceId", license.deviceId())
            .put("bindingKey", bindingKey).put("displayName", student.name).put("publicKey", sourcePublicKey())
            .put("contractVersion", 2).put("profileFields", JSONArray(listOf("displayName")))
            .put("materialCategories", JSONArray())
        val result = try { post(base, "/v2/source-auto-enroll", existingToken, body) }
            catch (error: CloudHttpException) {
                if (error.status != 401 || existingToken == null) throw error
                post(base, "/v2/source-auto-enroll", null, body)
            }
        persistEnrollment(studentId, base, result, setOf("displayName"), emptySet())
        CloudSyncReceiptStore(context).append(studentId, "configured", "auto-enroll:$studentId",
            "已用本机产品授权建立云端身份；尚未授权上传任何资料")
        return status(studentId)
    }

    private fun persistEnrollment(studentId: String, base: String, result: JSONObject,
        profileFields: Set<String>, categories: Set<String>) {
        val cloudStudentId = result.getString("cloudStudentId")
        val deviceToken = result.getString("deviceToken")
        require(Regex("^cs_[a-f0-9]{32}$").matches(cloudStudentId)) { "云端学生标识无效" }
        prefs.edit().putString("server", base).putString("token", encrypt(deviceToken))
            .putString("deviceId", result.getString("deviceId")).putString("bindingDevice:$studentId", result.getString("deviceId"))
            .putString("cloud:$studentId", cloudStudentId).putBoolean("enabled:$studentId", false)
            .putInt("contractVersion:$studentId", 2).putStringSet("categories:$studentId", categories)
            .putStringSet("profileFields:$studentId", profileFields).putString("authorizationPurpose:$studentId", "document_sync")
            .putLong("authorizationExpiresAt:$studentId", 0L).putString("pending:$studentId", "")
            .putString("lastError:$studentId", "").apply { GrowthModelService.REPORTS.forEach { remove("hash:$studentId:${it.id}") } }.apply()
    }

    fun setUpload(studentId: String, enabled: Boolean): CloudReportStatus {
        require(status(studentId).configured) { "请先为当前学生开通云端报告" }
        if (enabled) require(status(studentId).authorizationExpiresAt > System.currentTimeMillis()) { "请先重新确认上传范围和有效期" }
        prefs.edit().putBoolean("enabled:$studentId", enabled)
            .putString("pending:$studentId", if (enabled) "enable" else "disable").apply()
        if (!enabled) WorkManager.getInstance(context).cancelUniqueWork(workName(studentId))
        CloudSyncReceiptStore(context).append(studentId, if (enabled) "queued" else "withdrawn", "upload-switch:$studentId",
            if (enabled) "已等待发送" else "已关闭后续上传；云端既有资料未删除")
        schedule(studentId)
        return status(studentId)
    }

    fun setUploadScope(studentId: String, profileFields: Set<String>, categories: Set<String>,
        authorizationPurpose: String, authorizationExpiresAt: Long): CloudReportStatus {
        val current = status(studentId)
        require(current.configured) { "请先为当前学生开通云同步" }
        CloudUploadAuthorizationPolicy.validate(profileFields, categories, authorizationPurpose, authorizationExpiresAt)
        val result = post(server(), "/v2/source-upload-scope", token(), JSONObject()
            .put("cloudStudentId", current.cloudStudentId).put("profileFields", JSONArray(profileFields.sorted()))
            .put("materialCategories", JSONArray(categories.sorted())).put("authorizationPurpose", authorizationPurpose)
            .put("authorizationExpiresAt", authorizationExpiresAt))
        val accepted = result.optJSONArray("materialCategories")?.let { values -> (0 until values.length()).map { values.getString(it) }.toSet() }
            ?: error("云端未返回授权范围")
        val acceptedFields = result.optJSONArray("profileFields")?.let { values -> (0 until values.length()).map { values.getString(it) }.toSet() }
            ?: error("云端未返回基础信息范围")
        require(accepted == categories && acceptedFields == profileFields && result.optString("authorizationPurpose") == authorizationPurpose &&
            result.optLong("authorizationExpiresAt") == authorizationExpiresAt) { "云端授权范围与选择不一致" }
        prefs.edit().putStringSet("categories:$studentId", accepted).putStringSet("profileFields:$studentId", acceptedFields)
            .putString("authorizationPurpose:$studentId", authorizationPurpose).putLong("authorizationExpiresAt:$studentId", authorizationExpiresAt)
            .putBoolean("enabled:$studentId", true).putString("pending:$studentId", "").apply()
        CloudSyncReceiptStore(context).append(studentId, "queued", "scope:$studentId:$authorizationExpiresAt",
            "已授权 ${acceptedFields.size} 个基础字段、${accepted.size} 类资料；用途 ${if (authorizationPurpose == "expert_interpretation") "专家解读咨询" else "文档同步"}")
        schedule(studentId)
        return status(studentId)
    }

    fun selectRawMaterial(studentId: String, materialId: String, selected: Boolean) {
        StudentIndexRepository(context).requireExact(studentId)
        require(FileAssetService(context).materials(studentId).any { it.optString("id") == materialId }) { "未找到指定学习资料" }
        val key = "selectedMaterials:$studentId"
        val next = prefs.getStringSet(key, emptySet()).orEmpty().toMutableSet()
        if ((materialId in next) == selected) return
        if (selected) next += materialId else next -= materialId
        prefs.edit().putStringSet(key, next).apply()
        CloudSyncReceiptStore(context).append(studentId, if (selected) "queued" else "withdrawn", "material:$materialId",
            if (selected) "已选择该原件等待发送" else "已取消该原件的后续发送")
        if (selected && status(studentId).enabled) schedule(studentId)
    }

    fun selectedRawMaterials(studentId: String): Set<String> = prefs.getStringSet("selectedMaterials:$studentId", emptySet()).orEmpty().toSet()

    fun approvePairing(studentId: String, pairingCode: String): JSONObject {
        val state = status(studentId)
        require(state.configured && state.enabled) { "当前学生尚未开启云端报告上传" }
        require(Regex("^\\d{8}$").matches(pairingCode.trim())) { "Windows 配对码应为 8 位数字" }
        return post(server(), "/v1/pairings/approve", token(), JSONObject()
            .put("pairingCode", pairingCode.trim())
            .put("cloudStudentIds", JSONArray().put(state.cloudStudentId))
            .put("contractVersion", 2).put("profileFields", JSONArray(state.profileFields.sorted()))
            .put("materialCategories", JSONArray(state.materialCategories.sorted())))
    }

    /** Explicitly creates a separate viewer identity; source/upload permission alone never grants inbox reads. */
    fun enableCloudInbox(studentId: String): JSONObject {
        val upload = status(studentId); require(upload.configured && upload.enabled) { "请先开启当前学生云同步" }
        val pairing = post(server(), "/v1/pairings", null, JSONObject().put("publicKey", publicKey(INBOX_SIGNING_ALIAS)))
        val approval = post(server(), "/v1/pairings/approve", token(), JSONObject()
            .put("pairingCode", pairing.getString("pairingCode")).put("cloudStudentIds", JSONArray().put(upload.cloudStudentId))
            .put("contractVersion", 2).put("profileFields", JSONArray(upload.profileFields.sorted()))
            .put("materialCategories", JSONArray(upload.materialCategories.sorted())))
        require(approval.getString("deviceId") == pairing.getString("deviceId")) { "成果收件箱设备确认不一致" }
        prefs.edit().putString("inboxToken:$studentId", encrypt(pairing.getString("deviceToken")))
            .putString("inboxDevice:$studentId", pairing.getString("deviceId")).apply()
        return JSONObject().put("enabled", true).put("deviceId", pairing.getString("deviceId"))
    }

    fun cloudInboxEnabled(studentId: String): Boolean = prefs.getString("inboxToken:$studentId", "").orEmpty().isNotBlank() &&
        prefs.getString("inboxDevice:$studentId", "").orEmpty().isNotBlank()

    fun listCloudInbox(studentId: String): List<JSONObject> {
        val cloud = status(studentId); require(cloud.configured && cloudInboxEnabled(studentId)) { "成果收件箱尚未开通" }
        val result = viewerRequest(studentId, "GET", "/v2/inbox")
        val rows = result.optJSONArray("submissions") ?: JSONArray()
        return (0 until rows.length()).map { rows.getJSONObject(it) }.filter { item ->
            val ids = item.optJSONArray("cloudStudentIds") ?: JSONArray().put(item.optString("cloudStudentId"))
            (0 until ids.length()).any { ids.optString(it) == cloud.cloudStudentId }
        }
    }

    fun leaseCloudInbox(studentId: String, submissionId: String): JSONObject {
        require(Regex("^submission_[a-f0-9]{32}$").matches(submissionId)) { "成果标识无效" }
        val result = viewerRequest(studentId, "POST", "/v2/inbox/$submissionId/lease", JSONObject())
        require(result.optString("cloudStudentId") == status(studentId).cloudStudentId) { "成果不属于当前学生" }
        return result
    }

    fun settleCloudInbox(studentId: String, submissionId: String, leaseId: String, accepted: Boolean, reason: String = ""): JSONObject =
        viewerRequest(studentId, "POST", "/v2/inbox/$submissionId/settle", JSONObject().put("leaseId", leaseId)
            .put("status", if (accepted) "committed" else "quarantined").put("reason", reason.take(500)))

    fun synchronize(studentId: String) {
        val expiry = prefs.getLong("authorizationExpiresAt:$studentId", 0L)
        if ((expiry <= 0L || CloudUploadAuthorizationPolicy.isExpired(expiry)) && prefs.getBoolean("enabled:$studentId", false)) {
            prefs.edit().putBoolean("enabled:$studentId", false).putString("pending:$studentId", "disable").apply()
            CloudSyncReceiptStore(context).append(studentId, "withdrawn", "scope-expired:$studentId:$expiry", "授权已到期，已停止后续上传")
        }
        val state = status(studentId)
        if (!state.configured) return
        if (state.pendingServerState.isNotBlank()) {
            val desired = state.pendingServerState == "enable"
            post(server(), "/v1/grants/write-state", token(), JSONObject()
                .put("cloudStudentId", state.cloudStudentId).put("enabled", desired))
            prefs.edit().putString("pending:$studentId", "").apply()
        }
        if (!status(studentId).enabled) return
        val hadError = state.lastError.isNotBlank()
        if (prefs.getInt("contractVersion:$studentId", 1) >= 2 && status(studentId).profileFields.isNotEmpty()) {
            synchronizeProfile(studentId, state.cloudStudentId)
        }
        val categories = status(studentId).materialCategories
        var reportFailure: Throwable? = null
        try {
        val contents = if ("learning_report" in categories) snapshotForUpload(studentId) else emptyList()
        for ((index, definition) in GrowthModelService.REPORTS.withIndex()) {
            if ("learning_report" !in categories) break
            if (!status(studentId).enabled) return
            val content = contents[index]
            val checked = EducationPublicationPolicy.validatePublishedReport(studentId, definition.title, content)
            val header = Regex("^---\\s*\\r?\\n([\\s\\S]*?)\\r?\\n---", RegexOption.MULTILINE).find(content)?.groupValues?.get(1) ?: continue
            val type = Regex("^type:\\s*(\\S+)", RegexOption.MULTILINE).find(header)?.groupValues?.get(1) ?: continue
            val sourceStatus = Regex("^status:\\s*(\\S+)", RegexOption.MULTILINE).find(header)?.groupValues?.get(1)?.lowercase() ?: continue
            val publishedAt = Regex("^updated:\\s*(\\d{4}-\\d{2}-\\d{2})", RegexOption.MULTILINE).find(header)?.groupValues?.get(1) ?: continue
            if (type != definition.type || sourceStatus !in setOf("active", "published", "current", "updated")) continue
            if (Regex("(?:[A-Za-z]:\\\\|file://|(?:^|\\s)/(?:Users|home)/)").containsMatchIn(content)) {
                error("${definition.title}含本机绝对路径，已停止上传并等待去敏")
            }
            val hash = EducationPublicationPolicy.sha256(content)
            if (prefs.getString("hash:$studentId:${definition.id}", "") == hash) continue
            val body = JSONObject().put("cloudStudentId", state.cloudStudentId).put("localStudentId", studentId).put("originPlatform", "android")
                .put("reportType", type).put("sourceStatus", sourceStatus)
                .put("publishedAt", publishedAt).put("sourceSha256", checked.sourceHash)
                .put("contentSha256", hash).put("filename", definition.fileName).put("content", content)
            try { post(server(), "/v1/reports", token(), body) }
            catch (error: CloudHttpException) { if (error.status != 410) throw error }
            if (prefs.getInt("contractVersion:$studentId", 1) >= 2) uploadMaterial(
                state.cloudStudentId, studentId, definition.id, definition.fileName, hash, content.toByteArray(Charsets.UTF_8),
                "learning_report", "text/markdown"
            )
            prefs.edit().putString("hash:$studentId:${definition.id}", hash).apply()
        }
        } catch (error: Exception) {
            reportFailure = error
        }
        // A missing or invalid report must not block explicitly selected, independently
        // authorized materials. Report the partial failure after sending the other categories.
        synchronizeSelectedCategories(studentId, state.cloudStudentId)
        reportFailure?.let { throw it }
        prefs.edit().putLong("lastSync:$studentId", System.currentTimeMillis())
            .putString("lastError:$studentId", "").apply()
        val receipts = CloudSyncReceiptStore(context)
        if (hadError) receipts.append(studentId, "network_recovered", "sync:$studentId", "网络恢复后已继续核对待发送内容")
        receipts.append(studentId, "delivered", "sync:$studentId:${System.currentTimeMillis()}", "已送达当前许可范围内的更新")
    }

    fun recordFailure(studentId: String, message: String) {
        prefs.edit().putString("lastError:$studentId", message.take(300)).apply()
        runCatching { CloudSyncReceiptStore(context).append(studentId, "failed", "sync:$studentId:${System.currentTimeMillis()}", message) }
    }

    private fun synchronizeProfile(studentId: String, cloudStudentId: String) {
        val student = StudentIndexRepository(context).requireExact(studentId)
        val source = student.toJson()
        val allowed = status(studentId).profileFields
        val profile = JSONObject()
        if ("displayName" in allowed) profile.put("displayName", student.name)
        fun include(target: String, sourceKey: String, fallback: String = "") {
            if (target !in allowed) return
            val value = source.optString(sourceKey).ifBlank { fallback }.trim()
            if (value.isNotBlank()) profile.put(target, value)
        }
        include("grade", "grade", student.grade); include("school", "school", student.school)
        include("learningGoal", "goal", student.goal); include("currentRegion", "currentRegion", student.planningProfile.currentRegion)
        include("phone", "phone"); include("email", "email"); include("birthday", "birthDate", student.planningProfile.birthDate)
        include("address", "address"); include("guardian", "guardian")
        val fields = allowed.filter { profile.has(it) }
        val stable = allowed.sorted().filter { profile.has(it) }.joinToString("|") { "$it=${profile.optString(it)}" }
        val hash = EducationPublicationPolicy.sha256(stable)
        if (prefs.getString("profileHash:$studentId", "") == hash) return
        post(server(), "/v2/students/$cloudStudentId/profile", token(), JSONObject().put("fields", JSONArray(fields)).put("profile", profile))
        prefs.edit().putString("profileHash:$studentId", hash).apply()
    }

    private fun synchronizeSelectedCategories(studentId: String, cloudStudentId: String) {
        val categories = status(studentId).materialCategories
        val rows = ScopedContentRepository(context).list(studentId, listOf("artifact"), 100, 0)
        rows.forEach { row ->
            val payload = runCatching { JSONObject(row.payload) }.getOrNull() ?: return@forEach
            val module = payload.optString("module")
            val category = when (module) { "cards" -> "learning_card"; "topics" -> "topic_suggestion"; "competitions" -> "competition_recommendation"; else -> "" }
            if (category.isBlank() || category !in categories) return@forEach
            val body = if (module == "cards") LearningStudioPolicy.questionsOnly(payload) else payload.toString(2)
            val bytes = body.toByteArray(Charsets.UTF_8); val hash = ScopedContentPolicy.hash(bytes)
            val key = "materialHash:$studentId:$category:${row.id}"
            if (prefs.getString(key, "") == hash) return@forEach
            uploadMaterial(cloudStudentId, studentId, row.id, "${row.title}-${row.createdAt.take(10)}.${if (module == "cards") "md" else "json"}", hash, bytes,
                category, if (module == "cards") "text/markdown" else "application/json", row.projectId)
            prefs.edit().putString(key, hash).apply()
        }
        if ("learning_material" !in categories) return
        val selected = selectedRawMaterials(studentId)
        FileAssetService(context).materials(studentId).filter { it.optString("id") in selected }.forEach { material ->
            val materialId = material.getString("id"); val expected = material.optString("sourceSha256")
            val bytes = FileAssetService(context).readMaterialBytes(studentId, materialId, 20 * 1024 * 1024)
            val hash = ScopedContentPolicy.hash(bytes); require(expected.isBlank() || expected == hash) { "${material.optString("fileName")} 原件已变化，停止上传" }
            val key = "materialHash:$studentId:learning_material:$materialId"
            if (prefs.getString(key, "") == hash) return@forEach
            val filename = material.optString("fileName", "$materialId.bin")
            val contentType = when (filename.substringAfterLast('.', "").lowercase()) {
                "txt" -> "text/plain"
                "md" -> "text/markdown"
                "pdf" -> "application/pdf"
                "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                else -> error("暂不支持上传此原件格式：$filename；原件仍保留在本机")
            }
            uploadMaterial(cloudStudentId, studentId, materialId, filename, hash, bytes,
                "learning_material", contentType, material.optString("projectId"))
            prefs.edit().putString(key, hash).apply()
        }
    }

    private fun uploadMaterial(cloudStudentId: String, localStudentId: String, reportId: String,
        filename: String, hash: String, bytes: ByteArray, category: String, contentType: String, projectId: String = "") {
        val route = "/v2/students/$cloudStudentId/materials"
        val connection = (URL(server() + route).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15000; readTimeout = 15000; instanceFollowRedirects = false
            doOutput = true; setFixedLengthStreamingMode(bytes.size); setRequestProperty("Content-Type", contentType)
            setRequestProperty("X-Document-Name", java.net.URLEncoder.encode(filename, "UTF-8").replace("+", "%20"))
            setRequestProperty("X-Material-Category", category); setRequestProperty("X-Material-Id", "$category:$reportId")
            setRequestProperty("X-Idempotency-Key", "android:$localStudentId:$category:$reportId:${hash.take(24)}")
            if (projectId.isNotBlank()) {
                setRequestProperty("X-Project-Id", projectId)
                setRequestProperty("X-Scope-Fingerprint", projectScopeFingerprint(localStudentId, projectId))
            }
            addSignedHeaders(this, "POST", route, bytes)
        }
        try {
            connection.outputStream.use { it.write(bytes) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val result = JSONObject(stream?.use { it.readBytesBounded(1_048_576).toString(Charsets.UTF_8) } ?: "{}")
            if (connection.responseCode !in 200..299) throw CloudHttpException(connection.responseCode, result.optString("error", "新版资料同步未完成"))
        } finally { connection.disconnect() }
    }

    private fun addSignedHeaders(connection: HttpURLConnection, method: String, route: String, bytes: ByteArray) {
        val timestamp = System.currentTimeMillis().toString(); val nonce = UUID.randomUUID().toString().replace("-", "")
        val hash = ScopedContentPolicy.hash(bytes)
        val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey("cloud-report-sign-v1", null) as? PrivateKey
            ?: error("来源许可缺少设备私钥，请重新开通")
        val signature = Signature.getInstance("SHA256withECDSA").run {
            initSign(key); update("$method\n$route\n$timestamp\n$nonce\n$hash".toByteArray(Charsets.UTF_8)); sign()
        }
        connection.setRequestProperty("Authorization", "Bearer ${token()}")
        connection.setRequestProperty("X-Cloud-Device-Id", prefs.getString("deviceId", ""))
        connection.setRequestProperty("X-Cloud-Timestamp", timestamp); connection.setRequestProperty("X-Cloud-Nonce", nonce)
        connection.setRequestProperty("X-Cloud-Body-Sha256", hash)
        connection.setRequestProperty("X-Cloud-Signature", Base64.encodeToString(signature, Base64.NO_WRAP or Base64.NO_PADDING or Base64.URL_SAFE))
    }

    fun pauseAfterSnapshotFailure(studentId: String, cause: Throwable) {
        if (!status(studentId).configured) return
        prefs.edit().putBoolean("enabled:$studentId", false).putString("pending:$studentId", "disable")
            .putString("lastError:$studentId", "整组快照未提交，云上传已暂停：${cause.message ?: "存储失败"}".take(300)).commit()
        WorkManager.getInstance(context).cancelUniqueWork(workName(studentId))
        schedule(studentId)
    }

    private fun server(): String = prefs.getString("server", "").orEmpty().takeIf(String::isNotBlank)
        ?: error("尚未绑定云端服务")

    private fun token(): String {
        val value = prefs.getString("token", "").orEmpty()
        return if (value.isBlank()) "" else decrypt(value)
    }

    fun serviceAddress(): String = prefs.getString("server", "").orEmpty().ifBlank { CloudServiceEndpoint.OFFICIAL_BASE_URL }
    internal fun documentDeviceId(): String = prefs.getString("deviceId", "").orEmpty()
    /** Explicit document channel only; callers supply a previewed summary, never raw materials. */
    internal fun documentRequest(method: String, route: String, bytes: ByteArray = ByteArray(0), filename: String = "", expectedServer: String = serviceAddress()): JSONObject {
        require(method in setOf("GET", "POST") && route.startsWith("/v1/students/") && route.contains("/documents"))
        val snapshot = prefs.all
        require(snapshot["server"] == expectedServer && expectedServer.isNotBlank()) { "云地址已变化，请重新预览" }
        val credential = decrypt(snapshot["token"] as? String ?: error("云凭据缺失"))
        val deviceId = snapshot["deviceId"] as? String ?: error("设备绑定缺失")
        val connection = (URL(expectedServer + route).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 15000; readTimeout = 15000; instanceFollowRedirects = false
            val timestamp = System.currentTimeMillis().toString(); val nonce = UUID.randomUUID().toString().replace("-", "")
            val hash = ScopedContentPolicy.hash(bytes)
            val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey("cloud-report-sign-v1", null) as? PrivateKey
                ?: error("缺少来源设备私钥，请重新开通")
            val signature = Signature.getInstance("SHA256withECDSA").run {
                initSign(key); update("$method\n$route\n$timestamp\n$nonce\n$hash".toByteArray(Charsets.UTF_8)); sign()
            }
            setRequestProperty("Authorization", "Bearer $credential")
            setRequestProperty("X-Cloud-Device-Id", deviceId); setRequestProperty("X-Cloud-Timestamp", timestamp)
            setRequestProperty("X-Cloud-Nonce", nonce); setRequestProperty("X-Cloud-Body-Sha256", hash)
            setRequestProperty("X-Cloud-Signature", Base64.encodeToString(signature, Base64.NO_WRAP or Base64.NO_PADDING or Base64.URL_SAFE))
            if (method == "POST") {
                doOutput = true; setFixedLengthStreamingMode(bytes.size)
                setRequestProperty("Content-Type", "text/markdown")
                setRequestProperty("X-Document-Name", java.net.URLEncoder.encode(filename, "UTF-8").replace("+", "%20"))
            }
        }
        return try {
            if (method == "POST") connection.outputStream.use { it.write(bytes) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val result = JSONObject(stream?.use { it.readBytesBounded(1_048_576).toString(Charsets.UTF_8) } ?: "{}")
            if (code !in 200..299) throw CloudHttpException(code, result.optString("error", "文档请求未完成"))
            result
        } finally { connection.disconnect() }
    }

    fun officialServiceAddress(): String = CloudServiceEndpoint.OFFICIAL_BASE_URL

    fun usesOfficialService(): Boolean = CloudServiceEndpoint.isOfficial(serviceAddress())

    /**
     * Explicitly forgets legacy trial bindings before switching to the official Alibaba Cloud endpoint.
     * Local reports and signing keys are preserved; every student must redeem a new official enrollment code.
     */
    fun switchToOfficialService(): Int {
        val studentIds = prefs.all.keys.filter { it.startsWith("cloud:") }.map { it.removePrefix("cloud:") }.toSet()
        studentIds.forEach { WorkManager.getInstance(context).cancelUniqueWork(workName(it)) }
        prefs.edit().clear().putString("server", CloudServiceEndpoint.OFFICIAL_BASE_URL).commit()
        return studentIds.size
    }

    fun checkConnection(): String {
        return checkConnectionAt(serviceAddress())
    }

    fun checkOfficialConnection(): String = checkConnectionAt(CloudServiceEndpoint.OFFICIAL_BASE_URL)

    private fun checkConnectionAt(baseUrl: String): String {
        val connection = (URL(checkedBase(baseUrl) + "/health").openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000; readTimeout = 15000; instanceFollowRedirects = false
        }
        return try {
            require(connection.responseCode == 200) { "服务连接失败（HTTP ${connection.responseCode}）" }
            val health = JSONObject(connection.inputStream.bufferedReader().use { it.readText().take(4096) })
            require(health.optBoolean("ok") && health.optString("service") == CloudServiceEndpoint.HEALTH_SERVICE_ID) {
                "地址不是教育管家云端文档服务"
            }
            "阿里云 HTTPS 与服务身份检查通过；学生许可和同步需另行开通验证。"
        } finally { connection.disconnect() }
    }

    private fun checkedBase(value: String): String = CloudServiceEndpoint.normalize(value)

    private fun post(base: String, route: String, token: String?, body: JSONObject): JSONObject {
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        val connection = (URL(base + route).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15000; readTimeout = 15000; instanceFollowRedirects = false
            doOutput = true; setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (!token.isNullOrBlank()) {
                setRequestProperty("Authorization", "Bearer $token")
                val timestamp = System.currentTimeMillis().toString()
                val nonce = UUID.randomUUID().toString().replace("-", "")
                val bodyHash = EducationPublicationPolicy.sha256(body.toString())
                val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey("cloud-report-sign-v1", null) as? PrivateKey
                    ?: error("来源许可缺少设备私钥，请重新开通")
                val signature = Signature.getInstance("SHA256withECDSA").run {
                    initSign(key); update("POST\n$route\n$timestamp\n$nonce\n$bodyHash".toByteArray(Charsets.UTF_8)); sign()
                }
                setRequestProperty("X-Cloud-Device-Id", prefs.getString("deviceId", ""))
                setRequestProperty("X-Cloud-Timestamp", timestamp); setRequestProperty("X-Cloud-Nonce", nonce)
                setRequestProperty("X-Cloud-Body-Sha256", bodyHash)
                setRequestProperty("X-Cloud-Signature", Base64.encodeToString(signature, Base64.NO_WRAP or Base64.NO_PADDING or Base64.URL_SAFE))
            }
        }
        return try {
            connection.outputStream.use { it.write(bytes) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val result = JSONObject(stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}")
            if (connection.responseCode !in 200..299) throw CloudHttpException(connection.responseCode, result.optString("error", "云端请求失败（HTTP ${connection.responseCode}）"))
            result
        } finally { connection.disconnect() }
    }

    private fun sourcePublicKey(): String = publicKey("cloud-report-sign-v1")

    private fun publicKey(alias: String): String {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(alias)) KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
        }.generateKeyPair()
        return "-----BEGIN PUBLIC KEY-----\n" + Base64.encodeToString(store.getCertificate(alias).publicKey.encoded, Base64.NO_WRAP) + "\n-----END PUBLIC KEY-----\n"
    }

    fun issueRemoteAgentSession(studentId: String, provider: String, taskType: String, categories: Set<String>, projectId: String = ""): JSONObject {
        val cloud = status(studentId); require(cloud.configured && cloudInboxEnabled(studentId)) { "请先开通成果收件箱只读许可" }
        require(provider in setOf("codex", "workbuddy")); require(taskType.matches(Regex("^[A-Za-z0-9._:-]{3,100}$")))
        require(categories.isNotEmpty() && categories.all { it in cloud.materialCategories }) { "任务资料范围超出当前读取许可" }
        if (projectId.isNotBlank()) require(ProjectRepository(context).list().any { it.id == projectId && studentId in it.studentIds }) { "项目不属于当前学生" }
        val operation = UUID.randomUUID().toString().replace("-", "")
        val body = JSONObject().put("provider", provider).put("cloudStudentId", cloud.cloudStudentId)
            .put("projectId", projectId).put("scopeFingerprint", if (projectId.isBlank()) "" else projectScopeFingerprint(studentId, projectId))
            .put("taskId", "android_task_$operation").put("executionId", "android_exec_$operation")
            .put("taskType", taskType).put("idempotencyKey", "android_agent_$operation")
            .put("materialCategories", JSONArray(categories.sorted())).put("lifetimeMs", 15 * 60 * 1000)
        val result = viewerRequest(studentId, "POST", "/v2/agent-sessions", body)
        val ids = prefs.getStringSet("agentSessions:$studentId", emptySet()).orEmpty().toMutableSet().apply { add(result.getString("sessionId")) }
        prefs.edit().putStringSet("agentSessions:$studentId", ids).apply()
        return result
    }

    fun remoteAgentStatuses(studentId: String): List<JSONObject> = prefs.getStringSet("agentSessions:$studentId", emptySet()).orEmpty().mapNotNull { id ->
        runCatching { viewerRequest(studentId, "GET", "/v2/agent-sessions/$id") }.getOrNull()
    }.sortedByDescending { it.optLong("updatedAt") }

    fun revokeRemoteAgentSession(studentId: String, sessionId: String): JSONObject {
        require(Regex("^agent_session_[a-f0-9]{32}$").matches(sessionId))
        return viewerRequest(studentId, "POST", "/v2/agent-sessions/revoke", JSONObject().put("sessionId", sessionId))
    }

    private fun projectScopeFingerprint(studentId: String, projectId: String) = ScopedContentPolicy.hash("android-project-v1|$studentId|$projectId".toByteArray())

    private fun viewerRequest(studentId: String, method: String, route: String, body: JSONObject? = null): JSONObject {
        require(method in setOf("GET", "POST") && (route.startsWith("/v2/inbox") || route.startsWith("/v2/agent-sessions")))
        val bytes = body?.toString()?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
        val credential = decrypt(prefs.getString("inboxToken:$studentId", "").orEmpty().ifBlank { error("成果收件箱凭据缺失") })
        val deviceId = prefs.getString("inboxDevice:$studentId", "").orEmpty().ifBlank { error("成果收件箱设备缺失") }
        val connection = (URL(server() + route).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 15000; readTimeout = 15000; instanceFollowRedirects = false
            if (method == "POST") { doOutput = true; setFixedLengthStreamingMode(bytes.size); setRequestProperty("Content-Type", "application/json; charset=utf-8") }
            val timestamp = System.currentTimeMillis().toString(); val nonce = UUID.randomUUID().toString().replace("-", "")
            val hash = ScopedContentPolicy.hash(bytes)
            val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey(INBOX_SIGNING_ALIAS, null) as? PrivateKey
                ?: error("成果收件箱缺少设备私钥")
            val signature = Signature.getInstance("SHA256withECDSA").run {
                initSign(key); update("$method\n$route\n$timestamp\n$nonce\n$hash".toByteArray(Charsets.UTF_8)); sign()
            }
            setRequestProperty("Authorization", "Bearer $credential"); setRequestProperty("X-Cloud-Device-Id", deviceId)
            setRequestProperty("X-Cloud-Timestamp", timestamp); setRequestProperty("X-Cloud-Nonce", nonce)
            setRequestProperty("X-Cloud-Body-Sha256", hash)
            setRequestProperty("X-Cloud-Signature", Base64.encodeToString(signature, Base64.NO_WRAP or Base64.NO_PADDING or Base64.URL_SAFE))
        }
        return try {
            if (method == "POST") connection.outputStream.use { it.write(bytes) }
            val code = connection.responseCode; val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val result = JSONObject(stream?.use { it.readBytesBounded(1_048_576).toString(Charsets.UTF_8) } ?: "{}")
            if (code !in 200..299) throw CloudHttpException(code, result.optString("error", "成果收件箱请求未完成"))
            result
        } finally { connection.disconnect() }
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("cloud-report-v1", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("cloud-report-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val data = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
        }
        return cipher.doFinal(data.copyOfRange(12, data.size)).toString(Charsets.UTF_8)
    }

    private fun schedule(studentId: String) {
        schedule(studentId, ExistingWorkPolicy.REPLACE)
    }

    private fun schedule(studentId: String, policy: ExistingWorkPolicy) {
        runCatching { CloudSyncReceiptStore(context).append(studentId, "queued", "work:$studentId:${System.currentTimeMillis()}", "等待联网后发送") }
        val work = OneTimeWorkRequestBuilder<CloudReportWorker>()
            .setInputData(workDataOf("studentId" to studentId))
            .setConstraints(BackgroundWorkPolicy.remoteConstraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork(BackgroundWorkPolicy.uniqueName("cloud-report", studentId), policy, work)
    }

    fun resumePendingWork() {
        CloudReportSetPolicy.recoveryCandidates(prefs.all).forEach { studentId ->
            schedule(studentId, ExistingWorkPolicy.KEEP)
        }
    }

    companion object {
        private const val INBOX_SIGNING_ALIAS = "cloud-inbox-sign-v1"
        val MATERIAL_CATEGORIES = CloudUploadAuthorizationPolicy.MATERIAL_CATEGORIES.toSet()
        private val publicationLock = Any()
        fun <T> withPublicationLock(action: () -> T): T = synchronized(publicationLock, action)
        fun enqueueAfterCompletePublication(context: Context, studentId: String) {
            val sync = CloudReportSync(context)
            if (sync.status(studentId).enabled) sync.schedule(studentId)
        }
        private fun workName(studentId: String) = BackgroundWorkPolicy.uniqueName("cloud-report", studentId)
    }
}

class CloudHttpException(val status: Int, message: String) : IllegalStateException(message)

class CloudReportWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val studentId = inputData.getString("studentId") ?: return Result.failure()
        val sync = CloudReportSync(applicationContext)
        return runCatching { BusinessRestoreRecovery.recover(applicationContext); sync.synchronize(studentId) }
            .fold(onSuccess = { Result.success() }, onFailure = {
                sync.recordFailure(studentId, it.message ?: "云同步失败")
                if (runAttemptCount >= 8 || (it is CloudHttpException && it.status in 400..499 && it.status != 429)) Result.failure() else Result.retry()
            })
    }
}
