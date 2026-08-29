package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.ContextCompat
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
    val nearby: CollaborationNearbyStatus,
)

class CollaborationRepository(context: Context) {
    private val appContext = context.applicationContext
    private val dao = CollaborationDatabase.get(appContext).collaborationDao()
    private val nodeStore = CollaborationNodeIdentityStore(appContext)
    private val secretCipher = CollaborationSecretCipher()
    private val students = StudentIndexRepository(appContext)
    private val nearbyState = CollaborationNearbyStateStore(appContext)

    fun initialize() {
        refreshSafMappings()
        enqueueActiveSyncJobs()
        CollaborationWorkScheduler.scheduleRecovery(appContext)
        CollaborationWorkScheduler.schedulePeriodic(appContext)
    }

    fun snapshot(): CollaborationSnapshot = runBlocking {
        CollaborationSnapshot(nodeStore.get(), dao.devices(), dao.studentMaps(), dao.exceptions(), dao.pendingQueueCount(), nearbyState.status())
    }

    fun joinDevice(raw: String): CollaborationDeviceEntity {
        val connection = CollaborationPairingProtocol.parseConnectionInput(raw)
        val node = nodeStore.get()
        startNearbyReceiver()
        val verified = CollaborationNetworkClient().join(
            connection,
            node,
            CollaborationNearbyEndpointResolver.localEndpoints(),
        )
        val entity = persistDevice(verified)
        CollaborationWorkScheduler.scheduleRecovery(appContext)
        return entity
    }

    fun createNearbyInvitation(): CollaborationDeviceInvitation {
        val endpoints = CollaborationNearbyEndpointResolver.localEndpoints()
        require(endpoints.isNotEmpty()) { "请先连接同一 Wi-Fi、开启热点或启用 Tailscale，再生成附近设备连接信息" }
        startNearbyReceiver()
        val invitation = CollaborationPairingProtocol.createDeviceInvitation(nodeStore.get(), endpoints)
        nearbyState.saveInvitation(invitation)
        return invitation
    }

    fun startNearbyReceiver(timeoutMillis: Long = 3_000L): CollaborationNearbyStatus {
        val existing = nearbyState.status()
        if (existing.running) return existing
        nearbyState.markStarting()
        ContextCompat.startForegroundService(
            appContext,
            Intent(appContext, CollaborationNearbyService::class.java).setAction(CollaborationNearbyService.ACTION_START),
        )
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            val status = nearbyState.status()
            if (status.running) return status
            if (status.lastError.isNotBlank()) error(status.lastError)
            Thread.sleep(100)
        }
        error("附近协作接收启动超时，请检查系统通知权限和网络状态")
    }

    fun stopNearbyReceiver() {
        appContext.startService(Intent(appContext, CollaborationNearbyService::class.java).setAction(CollaborationNearbyService.ACTION_STOP))
    }

    fun completeIncomingDevicePairing(raw: String, sourceAddress: String = "unknown"): IncomingDevicePairing {
        val invitation = nearbyState.activeInvitation() ?: error("本机没有有效的附近设备连接邀请，请重新生成")
        nearbyState.requirePairingAllowed(invitation.invitationId, sourceAddress)
        val completed = try {
            val body = JSONObject(raw)
            val requestedInvitation = body.optString("invitationId")
            require(requestedInvitation.isBlank() || requestedInvitation == invitation.invitationId) { "设备配对码不正确或已经失效" }
            val acceptingNode = requireNotNull(body.optJSONObject("acceptingNode")) { "连接请求缺少接收设备身份" }
            val acceptingEndpoints = body.optJSONArray("transportOffers").collaborationObjects()
                .flatMap { it.optJSONArray("endpoints").collaborationStrings() }
            CollaborationPairingProtocol.completeDevicePairing(
                invitation = invitation,
                acceptingNode = acceptingNode,
                pairingCode = body.optString("pairingCode"),
                acceptingEndpoints = acceptingEndpoints,
            )
        } catch (_: Exception) {
            val invalidated = nearbyState.recordPairingFailure(invitation.invitationId, sourceAddress)
            nearbyState.recordEvent(if (invalidated) "设备连接邀请因连续验证失败已自动作废" else "收到一次无效的设备连接请求")
            error("设备配对码不正确或已经失效${if (invalidated) "，请重新生成" else ""}")
        }
        nearbyState.clearPairingFailures(invitation.invitationId)
        persistDevice(completed.inviterPairing)
        nearbyState.clearInvitation()
        nearbyState.clearError()
        nearbyState.recordEvent("已与“${completed.inviterPairing.peerDisplayName}”建立设备信任")
        CollaborationWorkScheduler.scheduleRecovery(appContext)
        return completed
    }

    fun createStudentMappingOffer(deviceBindingId: String, localStudentId: String): String {
        val student = students.requireExact(localStudentId)
        val mapping = ensureSafMapping(student)
        require(mapping.hasReadWriteGrant) { "所选学生的知识库目录没有有效的 SAF 读写授权，请先在教育档案中重新接管目录" }
        val device = runBlocking { dao.device(deviceBindingId) } ?: error("没有找到协作设备")
        require(device.status == "active") { "对应协作设备当前不是启用状态" }
        val offer = CollaborationPairingProtocol.createStudentMappingOffer(
            device = device,
            localNodeId = nodeStore.get().nodeId,
            localStudentId = student.id,
            localStudentName = student.name,
            secret = secretCipher.decrypt(device.encryptedSecret, device.deviceBindingId),
        )
        nearbyState.savePendingOffer(offer, student.id)
        startNearbyReceiver()
        return offer
    }

    fun acceptIncomingStudentMapping(raw: String): AcceptedStudentMapping {
        val acceptance = JSONObject(raw)
        val offerId = acceptance.optString("offerId")
        val pending = nearbyState.pendingOffer(offerId) ?: error("没有找到对应的本机学生共享邀请，或邀请已经过期")
        val offer = JSONObject(pending.offerJson)
        val device = runBlocking { dao.device(offer.optString("deviceBindingId")) }
            ?: error("学生共享确认不属于本机已信任的协作设备")
        require(device.status == "active" && offer.optString("inviterNodeId") == nodeStore.get().nodeId) { "学生共享确认的设备范围无效" }
        val accepted = CollaborationPairingProtocol.verifyStudentMappingAcceptance(
            raw = raw,
            offerRaw = pending.offerJson,
            localNodeId = nodeStore.get().nodeId,
            localStudentId = pending.localStudentId,
            peerStudentName = device.peerDisplayName,
            secret = secretCipher.decrypt(device.encryptedSecret, device.deviceBindingId),
        )
        persistStudentMapping(accepted)
        nearbyState.clearPendingOffer(offerId)
        return accepted
    }

    private fun persistDevice(verified: VerifiedDevicePairing): CollaborationDeviceEntity {
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
            require(duplicate == null || duplicate.deviceBindingId == entity.deviceBindingId) { "本机已与该协作设备建立设备信任" }
            dao.upsertDevice(entity)
        }
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
        persistStudentMapping(accepted)
        CollaborationWorkScheduler.scheduleRecovery(appContext)
        return accepted
    }

    private fun persistStudentMapping(accepted: AcceptedStudentMapping) {
        val entity = CollaborationStudentMapEntity(
            studentMapId = accepted.studentMapId,
            deviceBindingId = accepted.deviceBindingId,
            transportBindingId = accepted.transportBindingId,
            localStudentId = accepted.localStudentId,
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
    }

    fun updateDeviceStatus(deviceBindingId: String, status: String) {
        require(status in setOf("active", "paused", "revoked")) { "不支持的协作设备状态" }
        runBlocking {
            val current = dao.device(deviceBindingId) ?: error("没有找到协作设备")
            require(current.status != "revoked" || status == "revoked") { "已撤销的设备必须重新配对" }
            val credential = if (status == "revoked") "" else current.encryptedSecret
            val now = utcNow()
            check(dao.updateDeviceStatus(deviceBindingId, status, credential, now) == 1)
            if (status == "revoked") {
                dao.updateStudentMapsForDevice(deviceBindingId, status, now)
                dao.cancelQueueForDevice(deviceBindingId, now)
            }
        }
        if (status == "revoked") {
            CollaborationNearbyDirectReceiver(appContext).clearForDevice(deviceBindingId)
            nearbyState.recordEvent("协作设备已撤销，其未完成接收暂存已清理")
        }
    }

    fun updateStudentMapStatus(studentMapId: String, status: String) {
        require(status in setOf("active", "paused", "revoked")) { "不支持的学生共享状态" }
        runBlocking {
            val current = dao.studentMap(studentMapId) ?: error("没有找到学生共享关系")
            require(current.status != "revoked" || status == "revoked") { "已解除的学生共享需要重新建立" }
            val device = dao.device(current.deviceBindingId) ?: error("没有找到协作设备")
            require(device.status != "revoked") { "协作设备已撤销，需要重新配对" }
            val now = utcNow()
            check(dao.updateStudentMapStatus(studentMapId, status, now) == 1)
            if (status != "active") dao.cancelQueueForStudentMap(studentMapId, now)
        }
        nearbyState.recordEvent(
            when (status) {
                "active" -> "学生共享已恢复"
                "paused" -> "学生共享已暂停"
                else -> "学生共享已解除"
            },
        )
        if (status == "active") CollaborationWorkScheduler.scheduleRecovery(appContext, foreground = true)
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
