package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable

class RoomConversationStore(private val db: BusinessDatabase, private val validateStudents: (Set<String>) -> Unit) {
    private val marker = "conversation-room-v1"
    private val header = "conversation-room-header"
    fun read(loadLegacy: () -> JSONObject): JSONObject = db.runInTransaction(Callable {
        if (db.tasks().metadata(marker) == null) {
            write(loadLegacy())
            db.tasks().metadata(BusinessMetadataEntity(marker, "completed"))
        }
        val root = JSONObject(requireNotNull(db.tasks().metadata(header)))
        root.put("imports", JSONArray(db.content().conversations().map { JSONObject(it.payload) }))
    })
    fun write(root: JSONObject) = db.runInTransaction {
        val records = root.getJSONArray("imports").toObjects(); require(records.size <= 20_000)
        val identities = records.map { "${it.getString("studentId")}:${it.getString("recordId")}" }
        require(identities.distinct().size == identities.size) { "对话登记重复" }
        validateStudents(records.map { it.getString("studentId") }.toSet())
        val dao = db.content(); val old = dao.conversations()
        for (record in records) {
            val student = record.getString("studentId"); val key = record.getString("recordId"); val payload = record.toString()
            val state = record.optString("lifecycleStatus", "active"); val existing = dao.byKey(student, "conversation", key)
            val now = Timestamp.now()
            if (existing == null) dao.insert(ScopedContentEntity("conversation:${ScopedContentPolicy.hash("$student:$key".toByteArray())}", student,
                "conversation", key, record.optString("sourceAgent", "对话"), "", "", record.getString("contentPath"), record.getString("contentHash"),
                record.optString("projectId"), state, record.getString("importedAt"), now, payload))
            else if (existing.payload != payload || existing.state != state) require(dao.conversationUpdate(student, existing.id, existing.payload, payload, state, now) == 1)
        }
        old.filter { "${it.studentId}:${it.sourceKey}" !in identities }.forEach {
            require(dao.conversationUpdate(it.studentId, it.id, it.payload, it.payload, "removed", Timestamp.now()) == 1)
        }
        val snapshot = JSONObject(root.toString()).apply { remove("imports") }
        db.tasks().metadata(BusinessMetadataEntity(header, snapshot.toString()))
        db.tasks().metadata(BusinessMetadataEntity("conversation-projection", "pending"))
    }
    fun projectionComplete() { db.tasks().metadata(BusinessMetadataEntity("conversation-projection", "completed")) }
}
