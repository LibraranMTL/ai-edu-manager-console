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
    val lastSyncAt: Long, val lastError: String, val pendingServerState: String)

/** Optional report-only cloud channel. It never reads raw materials or downloaded cloud caches. */
class CloudReportSync(private val context: Context) {
    private val prefs = context.getSharedPreferences("cloud_report_v1", Context.MODE_PRIVATE)
    private val privateState = PrivateStateStore(context)
    private val defaultProfileFields = listOf("displayName", "grade", "school", "learningGoal", "currentRegion", "phone", "email", "birthday", "address", "guardian")
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
        enabled = prefs.getBoolean("enabled:$studentId", false),
        cloudStudentId = prefs.getString("cloud:$studentId", "").orEmpty(),
        lastSyncAt = prefs.getLong("lastSync:$studentId", 0),
        lastError = prefs.getString("lastError:$studentId", "").orEmpty(),
        pendingServerState = prefs.getString("pending:$studentId", "").orEmpty(),
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
            .putString("cloud:$studentId", cloudStudentId).putBoolean("enabled:$studentId", true)
            .putInt("contractVersion:$studentId", 2)
            .putString("pending:$studentId", "").putString("lastError:$studentId", "")
            .apply { GrowthModelService.REPORTS.forEach { remove("hash:$studentId:${it.id}") } }.apply()
        schedule(studentId)
        return status(studentId)
    }

    fun enrollOfficial(studentId: String, code: String): CloudReportStatus =
        enroll(studentId, CloudServiceEndpoint.OFFICIAL_BASE_URL, code)

    fun setUpload(studentId: String, enabled: Boolean): CloudReportStatus {
        require(status(studentId).configured) { "请先为当前学生开通云端报告" }
        prefs.edit().putBoolean("enabled:$studentId", enabled)
            .putString("pending:$studentId", if (enabled) "enable" else "disable").apply()
        if (!enabled) WorkManager.getInstance(context).cancelUniqueWork(workName(studentId))
        schedule(studentId)
        return status(studentId)
    }

    fun approvePairing(studentId: String, pairingCode: String): JSONObject {
        val state = status(studentId)
        require(state.configured && state.enabled) { "当前学生尚未开启云端报告上传" }
        require(Regex("^\\d{8}$").matches(pairingCode.trim())) { "Windows 配对码应为 8 位数字" }
        return post(server(), "/v1/pairings/approve", token(), JSONObject()
            .put("pairingCode", pairingCode.trim())
            .put("cloudStudentIds", JSONArray().put(state.cloudStudentId)))
    }

    fun synchronize(studentId: String) {
        val state = status(studentId)
        if (!state.configured) return
        if (state.pendingServerState.isNotBlank()) {
            val desired = state.pendingServerState == "enable"
            post(server(), "/v1/grants/write-state", token(), JSONObject()
                .put("cloudStudentId", state.cloudStudentId).put("enabled", desired))
            prefs.edit().putString("pending:$studentId", "").apply()
        }
        if (!status(studentId).enabled) return
        if (prefs.getInt("contractVersion:$studentId", 1) >= 2) synchronizeProfile(studentId, state.cloudStudentId)
        val contents = snapshotForUpload(studentId)
        for ((index, definition) in GrowthModelService.REPORTS.withIndex()) {
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
            if (prefs.getInt("contractVersion:$studentId", 1) >= 2) uploadLearningReportMaterial(
                state.cloudStudentId, studentId, definition.id, definition.fileName, hash, content.toByteArray(Charsets.UTF_8)
            )
            prefs.edit().putString("hash:$studentId:${definition.id}", hash).apply()
        }
        prefs.edit().putLong("lastSync:$studentId", System.currentTimeMillis())
            .putString("lastError:$studentId", "").apply()
    }

    fun recordFailure(studentId: String, message: String) {
        prefs.edit().putString("lastError:$studentId", message.take(300)).apply()
    }

    private fun synchronizeProfile(studentId: String, cloudStudentId: String) {
        val student = StudentIndexRepository(context).requireExact(studentId)
        val source = student.toJson()
        val profile = JSONObject().put("displayName", student.name)
        fun include(target: String, sourceKey: String, fallback: String = "") {
            val value = source.optString(sourceKey).ifBlank { fallback }.trim()
            if (value.isNotBlank()) profile.put(target, value)
        }
        include("grade", "grade", student.grade); include("school", "school", student.school)
        include("learningGoal", "goal", student.goal); include("currentRegion", "currentRegion", student.planningProfile.currentRegion)
        include("phone", "phone"); include("email", "email"); include("birthday", "birthDate", student.planningProfile.birthDate)
        include("address", "address"); include("guardian", "guardian")
        val fields = defaultProfileFields.filter { profile.has(it) }
        val stable = defaultProfileFields.filter { profile.has(it) }.joinToString("|") { "$it=${profile.optString(it)}" }
        val hash = EducationPublicationPolicy.sha256(stable)
        if (prefs.getString("profileHash:$studentId", "") == hash) return
        post(server(), "/v2/students/$cloudStudentId/profile", token(), JSONObject().put("fields", JSONArray(fields)).put("profile", profile))
        prefs.edit().putString("profileHash:$studentId", hash).apply()
    }

    private fun uploadLearningReportMaterial(cloudStudentId: String, localStudentId: String, reportId: String,
        filename: String, hash: String, bytes: ByteArray) {
        val route = "/v2/students/$cloudStudentId/materials"
        val connection = (URL(server() + route).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15000; readTimeout = 15000; instanceFollowRedirects = false
            doOutput = true; setFixedLengthStreamingMode(bytes.size); setRequestProperty("Content-Type", "text/markdown")
            setRequestProperty("X-Document-Name", java.net.URLEncoder.encode(filename, "UTF-8").replace("+", "%20"))
            setRequestProperty("X-Material-Category", "learning_report"); setRequestProperty("X-Material-Id", "report:$reportId")
            setRequestProperty("X-Idempotency-Key", "android:$localStudentId:$reportId:${hash.take(24)}")
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

    private fun sourcePublicKey(): String {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias("cloud-report-sign-v1")) KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(KeyGenParameterSpec.Builder("cloud-report-sign-v1", KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
        }.generateKeyPair()
        return "-----BEGIN PUBLIC KEY-----\n" + Base64.encodeToString(store.getCertificate("cloud-report-sign-v1").publicKey.encoded, Base64.NO_WRAP) + "\n-----END PUBLIC KEY-----\n"
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
        val work = OneTimeWorkRequestBuilder<CloudReportWorker>()
            .setInputData(workDataOf("studentId" to studentId))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork(workName(studentId), policy, work)
    }

    fun resumePendingWork() {
        CloudReportSetPolicy.recoveryCandidates(prefs.all).forEach { studentId ->
            schedule(studentId, ExistingWorkPolicy.KEEP)
        }
    }

    companion object {
        private val publicationLock = Any()
        fun <T> withPublicationLock(action: () -> T): T = synchronized(publicationLock, action)
        fun enqueueAfterCompletePublication(context: Context, studentId: String) {
            val sync = CloudReportSync(context)
            if (sync.status(studentId).enabled) sync.schedule(studentId)
        }
        private fun workName(studentId: String) = "cloud-report-$studentId"
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
