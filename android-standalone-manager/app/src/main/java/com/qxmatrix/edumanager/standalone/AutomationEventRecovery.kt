package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest

data class RecoverableDigestEvent(val fingerprint: String, val sourceIds: List<String>)

/** Only a complete, internally consistent processed batch can be replayed. */
object AutomationEventRecoveryPolicy {
    fun digestEvents(materials: List<JSONObject>): List<RecoverableDigestEvent> {
        val byId = materials.associateBy { it.optString("id") }
        return materials.mapNotNull { material ->
            val fingerprint = material.optString("automationDigestFingerprint")
            val array = material.optJSONArray("automationDigestSourceIds") ?: return@mapNotNull null
            val ids = (0 until array.length()).map { array.optString(it) }
            if (fingerprint.isBlank() || ids.isEmpty() || ids.any { it.isBlank() } || ids.size != ids.distinct().size) return@mapNotNull null
            if (ids.any { id ->
                    val row = byId[id] ?: return@any true
                    MaterialStatus.normalize(row.optString("status")) != MaterialStatus.PROCESSED ||
                        row.optString("automationDigestFingerprint") != fingerprint ||
                        row.optJSONArray("automationDigestSourceIds")?.toString() != array.toString()
                }) return@mapNotNull null
            RecoverableDigestEvent(fingerprint, ids)
        }.distinct()
    }
}

/** Reconstruct missed triggers from persisted student material state. */
class AutomationEventRecovery(private val context: Context) {
    fun recover(): JSONObject {
        val mode = AutomationMode.from(AutoDigestSettingsStore(context).load().automationMode)
        if (mode == AutomationMode.OFF)
            return JSONObject().put("skipped", true).put("errors", 0)
        var imported = 0; var missingFingerprint = 0; var digests = 0; var errors = 0
        var legacyObserved = 0; var legacyCompleted = 0; var repairedBatches = 0; var batchesNeedAttention = 0; var projects = 0
        val files = FileAssetService(context)
        StudentIndexRepository(context).list().forEach { student ->
            runCatching { synchronized(StudentWorkLocks.forStudent(student.id)) {
                val batchSummary = DigestBatchRecovery(context).recover(student.id)
                runCatching { GrowthModelService(context).generateObservationDraftIfNeeded(student.id) }.onFailure { errors++ }
                repairedBatches += batchSummary.optInt("completedBatches")
                batchesNeedAttention += batchSummary.optInt("needsAttention")
                val materials = files.materials(student.id)
                materials.filter { it.optString("sourceSha256").isBlank() && it.optString("sha1").isNotBlank() &&
                    it.optString("sourceEvidence").isBlank() && MaterialStatus.normalize(it.optString("status")) in
                    setOf(MaterialStatus.PENDING_DIGEST, MaterialStatus.PROCESSED) }.forEach { material ->
                    runCatching {
                        require(!MaterialProcessingPolicy.attributionConflict(material)) { "资料归属未确认" }
                        val bytes = files.readMaterialBytes(student.id, material.getString("id"))
                        if (material.has("size") && material.optLong("size", -1) >= 0)
                            require(material.optLong("size") == bytes.size.toLong()) { "原件大小与旧记录不一致" }
                        val observedSha1 = MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }
                        require(observedSha1.equals(material.optString("sha1"), ignoreCase = true)) { "原件与旧 SHA-1 不一致" }
                        files.patchMaterial(student.id, material.getString("id"), JSONObject()
                            .put("sourceEvidence", "legacy_sha1_matches_current_bytes")
                            .put("observedSourceSha256", ScopedContentPolicy.hash(bytes))
                            .put("sourceEvidenceObservedAt", Timestamp.now())
                            .put("automationAttentionReason", if (material.optString("automationAttentionReason") == "legacy_source_unverifiable") "" else material.optString("automationAttentionReason")))
                        if (material.optString("automationAttentionReason") == "legacy_source_unverifiable") material.put("automationAttentionReason", "")
                        legacyObserved++
                    }.onFailure {
                        missingFingerprint++
                        material.put("automationAttentionReason", "legacy_source_unverifiable")
                        runCatching { files.patchMaterial(student.id, material.getString("id"), JSONObject()
                            .put("automationAttentionReason", "legacy_source_unverifiable")
                            .put("automationAttentionMessage", "旧资料原件不可读取或与登记不一致，无法确认来源")) }
                    }
                }
                materials.filter { MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PENDING_DIGEST }
                    .forEach materialLoop@ { material ->
                        if (material.optString("automationAttentionReason") == "legacy_source_unverifiable" && material.optString("sha1").isNotBlank()) return@materialLoop
                        if (material.optString("sourceSha256").isBlank() && material.optString("sha1").isBlank()) {
                            val observed = runCatching {
                                val bytes = files.readMaterialBytes(student.id, material.getString("id"))
                                if (material.has("size") && material.optLong("size", -1) >= 0)
                                    require(material.optLong("size") == bytes.size.toLong()) { "原件大小与旧记录不一致" }
                                val hash = ScopedContentPolicy.hash(bytes)
                                files.patchMaterial(student.id, material.getString("id"), JSONObject()
                                    .put("sourceSha256", hash).put("sourceEvidence", "current_bytes_observed_history_unverified")
                                    .put("sourceEvidenceObservedAt", Timestamp.now()).put("automationAttentionReason", ""))
                                material.put("sourceSha256", hash)
                                legacyObserved++
                            }
                            if (observed.isFailure) {
                                missingFingerprint++
                                runCatching { files.patchMaterial(student.id, material.getString("id"), JSONObject()
                                    .put("automationAttentionReason", "legacy_source_unverifiable")
                                    .put("automationAttentionMessage", "旧资料原件不可读取或与登记不一致，无法确认来源")) }
                                return@materialLoop
                            }
                        }
                        runCatching { AutomationEventEmitter.imported(context, student.id, material); imported++ }
                            .onFailure { errors++ }
                    }
                AutomationEventRecoveryPolicy.digestEvents(materials).forEach { event ->
                    runCatching {
                        AutomationOrchestrator(context).emit(AutomationEventType.DIGEST_COMPLETED, student.id,
                            event.fingerprint, event.sourceIds)
                        digests++
                    }.onFailure { errors++ }
                }
                legacyCompleted += materials.count { MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PROCESSED &&
                    it.optString("automationDigestFingerprint").isBlank() }
            } }.onFailure { errors++ }
        }
        if (mode == AutomationMode.FULL) {
            val projectMaterials = LocalProjectMaterialService(context)
            ProjectRepository(context).list().filter { it.studentIds.isNotEmpty() && it.status !in setOf("sealed", "archived") }.forEach { project ->
                runCatching {
                    ProjectDigestQueue(context).enqueueAutomatic(project.id)
                    val fingerprint = projectMaterials.persistedSnapshotFingerprint(project.id) ?: return@runCatching
                    AutomationOrchestrator(context).emit(AutomationEventType.PROJECT_SNAPSHOT_CHANGED, "", fingerprint, projectId = project.id)
                    projects++
                }.onFailure { errors++ }
            }
        }
        return JSONObject().put("importsExamined", imported).put("importsMissingFingerprint", missingFingerprint)
            .put("legacySourcesObserved", legacyObserved).put("legacyProcessedWithoutReceipt", legacyCompleted)
            .put("digestBatchesRecovered", repairedBatches).put("digestBatchesNeedAttention", batchesNeedAttention)
            .put("digestBatchesExamined", digests).put("projectSnapshotsExamined", projects).put("errors", errors)
    }
}
