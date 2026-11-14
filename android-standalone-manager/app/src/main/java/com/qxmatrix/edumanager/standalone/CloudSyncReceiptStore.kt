package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException
import java.util.UUID

internal object CloudSyncReceiptPolicy {
    fun accepts(status: String) = status in setOf("configured", "queued", "network_recovered", "delivered", "withdrawn", "failed")
}

/** Append-only, student-scoped user-facing sync receipts. Protocol traces stay out of the ordinary UI. */
class CloudSyncReceiptStore(context: Context) {
    private val state = PrivateStateStore(context)

    fun append(studentId: String, status: String, sourceId: String, detail: String = ""): JSONObject = synchronized(LOCK) {
        require(CloudSyncReceiptPolicy.accepts(status)) { "不支持的云同步回执状态：$status" }
        StudentIndexRepository(appContext).requireExact(studentId)
        val now = Timestamp.now()
        val row = JSONObject().put("studentId", studentId).put("sourceId", sourceId.ifBlank { "sync:${UUID.randomUUID()}" })
            .put("time", now).put("status", status).put("detail", detail.take(300))
        row.put("contentFingerprint", ScopedContentPolicy.fingerprint(row))
        val root = read(studentId); root.getJSONArray("receipts").put(row); root.put("updatedAt", now)
        state.writeBytes(path(studentId), (root.toString(2) + "\n").toByteArray())
        HighGrowthRoomStore(appContext).mirrorAsync(studentId, HighGrowthRoomStore.SYNC_RECEIPT, listOf(row))
        row
    }

    fun list(studentId: String): List<JSONObject> {
        StudentIndexRepository(appContext).requireExact(studentId)
        val rows = read(studentId).getJSONArray("receipts")
        val legacy = (0 until rows.length()).map { rows.getJSONObject(it) }
        return HighGrowthRoomStore(appContext).migrateAndPage(studentId, HighGrowthRoomStore.SYNC_RECEIPT, legacy, 100, 0)
    }

    private fun read(studentId: String) = try { JSONObject(state.readBytes(path(studentId)).toString(Charsets.UTF_8)) }
        catch (_: FileNotFoundException) { JSONObject().put("version", 1).put("studentId", studentId).put("updatedAt", "").put("receipts", JSONArray()) }
    private fun path(studentId: String) = "cloud-sync/receipts-$studentId.json"
    private val appContext: Context = context.applicationContext

    companion object { private val LOCK = Any() }
}
