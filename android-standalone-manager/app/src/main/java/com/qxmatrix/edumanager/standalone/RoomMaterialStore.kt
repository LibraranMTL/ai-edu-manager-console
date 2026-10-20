package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import java.util.concurrent.Callable

/** Room is authoritative after a single strict import; SAF JSON becomes a recoverable projection. */
class RoomMaterialStore(private val db: BusinessDatabase, private val studentId: String) {
    private val marker = "material-room-v1:$studentId"
    fun migrate(loadLegacy: () -> List<JSONObject>) = db.runInTransaction {
        if (db.tasks().metadata(marker) == null) {
            val records = loadLegacy()
            require(records.size <= 20_000 && records.map { it.getString("id") }.distinct().size == records.size)
            records.forEach { require(it.getString("studentId") == studentId); save(it) }
            db.tasks().metadata(BusinessMetadataEntity(marker, JSONObject().put("studentId", studentId).put("imported", records.size).toString()))
        }
    }
    fun list(): List<JSONObject> = db.content().materials(studentId).map { JSONObject(it.payload).also { value -> require(value.getString("studentId") == studentId) } }
    fun <T> change(action: (MutableList<JSONObject>) -> T): T = db.runInTransaction(Callable {
        val records = list().toMutableList(); val before = records.associate { it.getString("id") to it.toString() }; val result = action(records)
        require(records.size <= 20_000 && records.map { it.getString("id") }.distinct().size == records.size)
        records.filter { before[it.getString("id")] != it.toString() }.forEach(::save)
        db.tasks().metadata(BusinessMetadataEntity("material-projection:$studentId", "pending"))
        result
    })
    private fun save(value: JSONObject) {
        require(value.getString("studentId") == studentId && value.getString("id").isNotBlank())
        val id = value.getString("id"); val key = "material:$id"
        val now = Timestamp.now(); val payload = value.toString(); val dao = db.content()
        val old = dao.byKey(studentId, "material", key)
        if (old == null) dao.insert(ScopedContentEntity("registered:${ScopedContentPolicy.hash("$studentId:$id".toByteArray())}", studentId,
            "material", key, value.optString("fileName", id), payload, "", value.optString("absolutePath"), value.optString("sourceSha256"),
            value.optString("projectId"), value.optString("status"), value.optString("uploadedAt", now), now, payload))
        else if (old.payload != payload) require(dao.materialUpdate(studentId, old.id, old.payload, value.optString("fileName", id),
            value.optString("absolutePath"), value.optString("sourceSha256"), value.optString("status"), now, payload) == 1) { "资料状态已变化" }
    }
    fun projectionComplete() { db.tasks().metadata(BusinessMetadataEntity("material-projection:$studentId", "completed")) }
}

/** Compatibility adapter for legacy synchronous UI callers; Room itself never runs on main. */
object MaterialDatabaseAccess {
    private val worker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>()
    fun lock(studentId: String): Any = locks.getOrPut(studentId) { Any() }
    fun <T> run(action: () -> T): T {
        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) return action()
        return try { worker.submit(Callable(action)).get() }
        catch (error: java.util.concurrent.ExecutionException) { throw (error.cause ?: error) }
    }
}
