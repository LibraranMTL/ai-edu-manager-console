package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.Callable

/** Malformed legacy bytes must not turn into an empty, writable task list. */
object LegacyTaskCodec {
    data class Snapshot(val tasks: List<JSONObject>, val events: List<JSONObject>, val history: JSONArray)
    fun decode(tasksBytes: ByteArray?, eventsBytes: ByteArray?): Snapshot {
        val root = tasksBytes?.let { JSONObject(it.toString(Charsets.UTF_8)) }
        if (root != null) require(root.getString("protocolVersion") == TaskProtocol.VERSION) { "旧任务协议不受支持" }
        val array = root?.getJSONArray("tasks") ?: JSONArray()
        val tasks = (0 until array.length()).map { array.getJSONObject(it).also(::validateTask) }
        require(tasks.map { it.getString("id") }.distinct().size == tasks.size) { "旧任务 ID 重复，禁止迁移" }
        val events = eventsBytes?.toString(Charsets.UTF_8)?.lineSequence()?.filter(String::isNotBlank)?.map { line ->
            JSONObject(line).also { require(it.getString("id").isNotBlank() && it.getString("taskId").isNotBlank()); it.getString("at") }
        }?.toList().orEmpty()
        require(events.map { it.getString("id") }.distinct().size == events.size) { "旧事件 ID 重复，禁止迁移" }
        return Snapshot(tasks, events, root?.optJSONArray("history") ?: JSONArray())
    }
    fun validateTask(task: JSONObject) {
        require(task.getString("id").isNotBlank()) { "任务 ID 为空" }
        require(task.getString("status") in TaskProtocol.transitions) { "任务状态无效" }
        require(task.getString("protocolVersion") == TaskProtocol.VERSION) { "任务协议不受支持" }
        TaskProtocol.validatePermissions(task, TaskRepository.OPERATION_ALLOWLIST)
        val inputStudent = task.optJSONObject("input")?.optString("studentId").orEmpty()
        if (task.optString("sourceType") == "student" && inputStudent.isNotBlank()) require(task.getString("sourceId") == inputStudent) { "任务学生作用域冲突" }
    }
    fun studentId(task: JSONObject): String = task.optJSONObject("input")?.optString("studentId").orEmpty()
        .ifBlank { if (task.optString("sourceType") == "student") task.optString("sourceId") else "" }
    fun projectId(task: JSONObject): String = task.optJSONObject("input")?.optString("projectId").orEmpty()
        .ifBlank { if (task.optString("sourceType") == "project") task.optString("sourceId") else "" }
}

internal interface TaskLedgerStore {
    fun <T> transaction(block: () -> T): T
    fun all(): List<JSONObject>
    fun scoped(studentId: String, projectIds: List<String>, limit: Int): List<JSONObject>
    fun hasActive(studentId: String, projectIds: List<String>): Boolean
    fun exact(id: String): JSONObject?
    fun insert(task: JSONObject)
    fun replace(current: JSONObject, next: JSONObject)
    fun event(event: JSONObject)
    fun events(taskId: String, limit: Int): List<JSONObject>
}

/** Callers must load and mutate asynchronously, never on the Android main thread. */
internal class RoomTaskLedgerStore(context: Context, private val db: BusinessDatabase = BusinessDatabase.get(context)) : TaskLedgerStore {
    private val context = context.applicationContext
    private val dao = db.tasks()
    private val state = PrivateStateStore(context)
    override fun <T> transaction(block: () -> T): T {
        check(Looper.myLooper() != Looper.getMainLooper()) { "任务数据库必须在后台线程访问" }
        if (!db.inTransaction()) BusinessRestoreRecovery.recover(context, db)
        return db.runInTransaction(Callable { ensureMigrated(); recoverInterrupted(); block() })
    }
    private fun ensureMigrated() {
        if (dao.metadata(MIGRATION_KEY) != null) return
        require(dao.all().isEmpty() && dao.events().isEmpty()) { "任务迁移标记缺失，已有数据库不可覆盖" }
        val tasksBytes = state.readIfPresent(TASKS); val eventsBytes = state.readIfPresent(EVENTS)
        require((tasksBytes?.size ?: 0) <= MAX_IMPORT_BYTES && (eventsBytes?.size ?: 0) <= MAX_IMPORT_BYTES) { "旧任务文件过大，需要人工检查" }
        val snapshot = LegacyTaskCodec.decode(tasksBytes, eventsBytes)
        val fingerprint = MessageDigest.getInstance("SHA-256").apply {
            update(tasksBytes ?: ByteArray(0)); update(0.toByte()); update(eventsBytes ?: ByteArray(0))
        }.digest().joinToString("") { "%02x".format(it) }
        tasksBytes?.let { state.writeBytes("task-center/legacy-room-v2/$fingerprint/tasks.json", it) }
        eventsBytes?.let { state.writeBytes("task-center/legacy-room-v2/$fingerprint/events.jsonl", it) }
        snapshot.tasks.forEach { dao.insert(entity(it).copy(processSession = "legacy-import")) }; snapshot.events.forEach(::event)
        dao.metadata(BusinessMetadataEntity(MIGRATION_KEY, JSONObject().put("sha256", fingerprint)
            .put("taskCount", snapshot.tasks.size).put("eventCount", snapshot.events.size)
            .put("history", snapshot.history).put("migratedAt", Timestamp.now()).toString()))
    }
    private fun recoverInterrupted() {
        dao.interrupted(BusinessDatabase.processSession).forEach { row ->
            val current = JSONObject(row.payload)
            // Unknown model/write results are never automatically retried after process loss.
            val next = TaskProtocol.envelope(JSONObject(current.toString()).put("status", "failed")
                .put("error", JSONObject().put("code", "process_interrupted").put("message", "上次进程中断，结果未知；请核对已有产物后从原入口恢复"))
                .put("autoRetry", false).put("completedAt", Timestamp.now()), current)
            replace(current, next)
            event(JSONObject().put("id", "event-${java.util.UUID.randomUUID()}").put("taskId", row.id)
                .put("at", Timestamp.now()).put("type", "process_interrupted").put("detail", JSONObject().put("previousStatus", row.status)))
        }
    }
    private fun entity(task: JSONObject) = BusinessTaskEntity(task.getString("id"), LegacyTaskCodec.studentId(task),
        LegacyTaskCodec.projectId(task), task.getString("status"), task.optString("updatedAt"), 0,
        BusinessDatabase.processSession, task.toString())
    override fun all() = dao.all().map { JSONObject(it.payload) }
    override fun scoped(studentId: String, projectIds: List<String>, limit: Int) = dao.scoped(studentId, projectIds, limit.coerceIn(1, 200)).map { JSONObject(it.payload) }
    override fun hasActive(studentId: String, projectIds: List<String>) = dao.hasActive(studentId, projectIds)
    override fun exact(id: String) = dao.exact(id)?.let { JSONObject(it.payload) }
    override fun insert(task: JSONObject) { dao.insert(entity(task)) }
    override fun replace(current: JSONObject, next: JSONObject) {
        val row = requireNotNull(dao.exact(current.getString("id"))) { "未找到任务" }
        require(row.payload == current.toString()) { "任务已变更，请重新读取" }
        check(dao.update(row.id, row.revision, next.getString("status"), next.getString("updatedAt"), BusinessDatabase.processSession, next.toString()) == 1) { "任务并发更新冲突" }
    }
    override fun event(event: JSONObject) { dao.event(TaskEventEntity(event.getString("id"), event.getString("taskId"), event.getString("at"), event.toString())) }
    override fun events(taskId: String, limit: Int) = dao.eventsFor(taskId, limit.coerceIn(1, 100)).map { JSONObject(it.payload) }
    companion object {
        const val TASKS = "task-center/tasks.json"
        const val EVENTS = "task-center/events.jsonl"
        const val MIGRATION_KEY = "legacy-tasks-room-v2"
        private const val MAX_IMPORT_BYTES = 32 * 1024 * 1024
    }
}
