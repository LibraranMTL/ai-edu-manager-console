package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject

/** Same scoped source-event contract for all channels; never moves an existing original. */
class IntakeRegistry(private val context: Context) {
    fun register(studentId: String, channel: String, eventId: String, hash: String, path: String, rootUri: String,
        receivedAt: String, projectId: String = "") = MaterialDatabaseAccess.run {
        StudentIndexRepository(context).requireExact(studentId)
        if (projectId.isNotBlank()) require(studentId in ProjectRepository(context).requireExact(projectId).studentIds) { "来源项目未绑定当前学生" }
        require(channel.isNotBlank() && eventId.isNotBlank() && Regex("^[a-fA-F0-9]{64}$").matches(hash))
        val db = BusinessDatabase.get(context); BusinessRestoreRecovery.recover(context, db)
        db.runInTransaction {
            val key = ScopedContentPolicy.hash("$studentId:$channel:$eventId".toByteArray())
            val payload = JSONObject().put("studentId", studentId).put("sourceChannel", channel).put("sourceId", eventId)
                .put("sourceSha256", hash).put("originalPath", path).put("receivedAt", receivedAt).put("projectId", projectId)
            val old = db.content().byKey(studentId, "intake_event", key)
            if (old != null) require(JSONObject(old.payload).getString("sourceSha256") == hash && old.logicalPath == path) { "相同来源事件发生内容冲突" }
            else db.content().insert(ScopedContentEntity("intake-event:$key", studentId, "intake_event", key, path.substringAfterLast('/'), "", rootUri,
                path, ScopedContentPolicy.fingerprint(payload), projectId, "saved", receivedAt, receivedAt, payload.toString()))
        }
    }
}
