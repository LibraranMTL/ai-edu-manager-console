package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.runBlocking
import java.util.UUID

data class CollaborationSnapshot(
    val node: CollaborationNodeIdentity,
    val devices: List<CollaborationDeviceEntity>,
    val studentMaps: List<CollaborationStudentMapEntity>,
    val exceptions: List<CollaborationExceptionRow>,
    val pendingQueueCount: Int,
)

class CollaborationRepository(context: Context) {
    private val appContext = context.applicationContext
    private val dao = CollaborationDatabase.get(appContext).collaborationDao()
    private val nodeStore = CollaborationNodeIdentityStore(appContext)
    private val secretCipher = CollaborationSecretCipher()
    private val students = StudentIndexRepository(appContext)

    fun initialize() {
        refreshSafMappings()
        enqueueActiveSyncJobs()
        CollaborationWorkScheduler.scheduleRecovery(appContext)
        CollaborationWorkScheduler.schedulePeriodic(appContext)
    }

    fun snapshot(): CollaborationSnapshot = runBlocking {
        CollaborationSnapshot(nodeStore.get(), dao.devices(), dao.studentMaps(), dao.exceptions(), dao.pendingQueueCount())
    }

    fun joinDevice(raw: String): CollaborationDeviceEntity {
        val connection = CollaborationPairingProtocol.parseConnectionInput(raw)
        val node = nodeStore.get()
        val verified = CollaborationNetworkClient().join(connection, node)
        val entity = CollaborationDeviceEntity(
            deviceBindingId = verified.deviceBindingId,
            transportBindingId = verified.transportBindingId,
            localNodeId = verified.localNodeId,
            peerNodeId = verified.peerNodeId,
            peerDisplayName = verified.peerDisplayName,
            endpointsJson = JSONArray(verified.endpoints).toString(),
            capabilitiesJson = JSONArray(verified.capabilities).toString(),
            encryptedSecret = secretCipher.encrypt(verified.sharedSecret, verified.deviceBindingId),
            status = "active",
            createdAt = verified.createdAt.ifBlank { verified.confirmedAt },
            updatedAt = verified.confirmedAt,
            lastSeenAt = verified.confirmedAt,
        )
        runBlocking {
            val duplicate = dao.activeDeviceForPeer(entity.peerNodeId)
            require(duplicate == null || duplicate.deviceBindingId == entity.deviceBindingId) { "本机已与该协作主机建立设备信任" }
            dao.upsertDevice(entity)
        }
        CollaborationWorkScheduler.scheduleRecovery(appContext)
        return entity
    }

    fun acceptStudentMapping(raw: String, localStudentId: String): AcceptedStudentMapping {
        val student = students.requireExact(localStudentId)
        val mapping = ensureSafMapping(student)
        require(mapping.hasReadWriteGrant) { "所选学生的知识库目录没有有效的 SAF 读写授权，请先在教育档案中重新接管目录" }
        val deviceBindingId = CollaborationPairingProtocol.offerDeviceBindingId(raw)
        val device = runBlocking { dao.device(deviceBindingId) }
            ?: error("学生共享邀请不属于本机已信任的协作设备")
        require(device.status == "active") { "对应协作设备当前不是启用状态" }
        val offer = JSONObject(raw.trim())
        require(offer.optString("inviterNodeId") == device.peerNodeId && offer.optString("transportBindingId") == device.transportBindingId) {
            "学生共享邀请与已信任设备的身份或传输关系不一致"
        }
        val accepted = CollaborationPairingProtocol.acceptStudentMappingOffer(
            raw = raw,
            localNodeId = nodeStore.get().nodeId,
            localStudentId = student.id,
            secret = secretCipher.decrypt(device.encryptedSecret, device.deviceBindingId),
        )
        require(accepted.deviceBindingId == device.deviceBindingId) { "学生共享邀请的设备范围不匹配" }
        CollaborationNetworkClient().confirmStudentMapping(
            endpoints = JSONArray(device.endpointsJson).collaborationStrings(),
            acceptanceJson = accepted.acceptanceJson,
        )
        val entity = CollaborationStudentMapEntity(
            studentMapId = accepted.studentMapId,
            deviceBindingId = accepted.deviceBindingId,
            transportBindingId = accepted.transportBindingId,
            localStudentId = student.id,
            peerStudentId = accepted.peerStudentId,
            peerStudentName = accepted.peerStudentName,
            syncKindsJson = JSONArray(accepted.syncKinds).toString(),
            status = "active",
            createdAt = accepted.createdAt,
            updatedAt = utcNow(),
        )
        runBlocking {
            dao.upsertStudentMap(entity)
            dao.upsertQueue(validationJob(entity))
            dao.upsertQueue(syncJob(entity))
        }
        CollaborationWorkScheduler.scheduleRecovery(appContext)
        return accepted
    }

    fun updateDeviceStatus(deviceBindingId: String, status: String) {
        require(status in setOf("active", "paused", "revoked")) { "不支持的协作设备状态" }
        runBlocking {
            val current = dao.device(deviceBindingId) ?: error("没有找到协作设备")
            require(current.status != "revoked" || status == "revoked") { "已撤销的设备必须重新配对" }
            val credential = if (status == "revoked") "" else current.encryptedSecret
            val now = utcNow()
            check(dao.updateDeviceStatus(deviceBindingId, status, credential, now) == 1)
            dao.updateStudentMapsForDevice(deviceBindingId, status, now)
            if (status == "revoked") dao.cancelQueueForDevice(deviceBindingId, now)
        }
    }

    fun refreshSafMappings() {
        students.list().forEach(::ensureSafMapping)
    }

    fun enqueueActiveSyncJobs(force: Boolean = false) = runBlocking {
        val now = System.currentTimeMillis()
        dao.activeStudentMaps().forEach { map ->
            val id = "student-sync-${map.studentMapId}"
            val existing = dao.queueJob(id)
            val lastUpdated = parseUtcMillis(existing?.updatedAt.orEmpty())
            val pending = existing?.status in setOf("queued", "retry", "running")
            if (!pending && (force || existing == null || now - lastUpdated >= SYNC_INTERVAL_MS)) dao.upsertQueue(syncJob(map, id))
        }
    }

    fun syncNow(studentMapId: String) {
        val map = runBlocking { dao.studentMap(studentMapId) } ?: error("没有找到学生协作映射")
        require(map.status == "active") { "学生协作映射当前未启用" }
        runBlocking { dao.upsertQueue(syncJob(map, "student-sync-${map.studentMapId}")) }
        CollaborationWorkScheduler.scheduleRecovery(appContext, foreground = true)
    }

    fun validateStudentScope(studentId: String) {
        val student = students.requireExact(studentId)
        val mapping = runBlocking { dao.safMapping(studentId) } ?: error("学生知识库尚未建立本机目录映射")
        require(mapping.treeUri == student.storageRootUri) { "学生知识库目录已变化，请刷新协作目录映射" }
        require(mapping.hasReadWriteGrant && hasPersistedReadWriteGrant(Uri.parse(mapping.treeUri))) { "学生知识库目录授权已失效" }
        require(mapping.localStudentId == student.id) { "学生协作目录范围不匹配" }
    }

    private fun ensureSafMapping(student: StudentRecord): CollaborationSafMappingEntity {
        val entity = CollaborationSafMappingEntity(
            localStudentId = student.id,
            treeUri = student.storageRootUri,
            rootPath = student.paths.rootPath,
            rawPath = student.paths.rawPath,
            summaryPath = student.paths.summaryPath,
            outputPath = student.paths.outputPath,
            hasReadWriteGrant = runCatching { hasPersistedReadWriteGrant(Uri.parse(student.storageRootUri)) }.getOrDefault(false),
            updatedAt = utcNow(),
        )
        runBlocking { dao.upsertSafMapping(entity) }
        return entity
    }

    private fun hasPersistedReadWriteGrant(uri: Uri): Boolean = appContext.contentResolver.persistedUriPermissions.any {
        it.uri == uri && it.isReadPermission && it.isWritePermission
    }

    private fun validationJob(map: CollaborationStudentMapEntity) = CollaborationQueueEntity(
        jobId = "scope-validation-${UUID.randomUUID()}",
        operation = CollaborationQueuePolicy.VALIDATE_STUDENT_SCOPE,
        deviceBindingId = map.deviceBindingId,
        studentMapId = map.studentMapId,
        localStudentId = map.localStudentId,
        payloadJson = JSONObject().put("localStudentId", map.localStudentId).toString(),
        status = "queued",
        attemptCount = 0,
        nextAttemptAt = System.currentTimeMillis(),
        createdAt = utcNow(),
        updatedAt = utcNow(),
        lastError = "",
    )

    private fun syncJob(map: CollaborationStudentMapEntity, jobId: String = "student-sync-${map.studentMapId}") = CollaborationQueueEntity(
        jobId = jobId,
        operation = CollaborationQueuePolicy.SYNC_STUDENT_ARCHIVE,
        deviceBindingId = map.deviceBindingId,
        studentMapId = map.studentMapId,
        localStudentId = map.localStudentId,
        payloadJson = JSONObject().put("studentMapId", map.studentMapId).toString(),
        status = "queued",
        attemptCount = 0,
        nextAttemptAt = System.currentTimeMillis(),
        createdAt = utcNow(),
        updatedAt = utcNow(),
        lastError = "",
    )

    companion object { private const val SYNC_INTERVAL_MS = 15 * 60 * 1000L }
}

internal object CollaborationQueuePolicy {
    const val VALIDATE_STUDENT_SCOPE = "validate_student_scope"
    const val SYNC_STUDENT_ARCHIVE = "sync_student_archive"
    const val MAX_ATTEMPTS = 8

    fun nextFailure(attemptCount: Int, now: Long): Triple<String, Int, Long> {
        val nextCount = attemptCount + 1
        if (nextCount >= MAX_ATTEMPTS) return Triple("failed", nextCount, 0L)
        val delay = (15_000L * (1L shl (nextCount - 1).coerceAtMost(6))).coerceAtMost(15 * 60 * 1000L)
        return Triple("retry", nextCount, now + delay)
    }

    fun followUpDelay(nextAttemptAt: Long, now: Long): Long = (nextAttemptAt - now).coerceAtLeast(0L)
}
