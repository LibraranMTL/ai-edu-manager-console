package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.database.Cursor
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Callable

/** Logical, transaction-consistent snapshot. Never copies a live SQLite database or WAL. */
class BusinessDatabaseBackup(private val context: Context, private val db: BusinessDatabase = BusinessDatabase.get(context)) {
    fun exportBytes(): ByteArray {
        TaskRepository(RoomTaskLedgerStore(context, db)).list() // Validate/import before exporting the authoritative DB.
        return db.runInTransaction(Callable {
            require(db.tasks().all().none { it.status in ACTIVE }) { "资料任务仍在运行，请结束后备份" }
            val tables = JSONObject()
            val sql = db.openHelper.writableDatabase
            TABLES.forEach { table ->
                val rows = JSONArray()
                sql.query("SELECT * FROM $table").use { cursor ->
                    while (cursor.moveToNext()) rows.put(JSONObject().apply {
                        cursor.columnNames.forEachIndexed { index, column -> put(column, when (cursor.getType(index)) {
                            Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
                            Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(index)
                            Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(index)
                            Cursor.FIELD_TYPE_STRING -> cursor.getString(index)
                            else -> error("业务快照不支持二进制字段")
                        }) }
                    })
                }
                if (table == "model_calls") require((0 until rows.length()).none { rows.getJSONObject(it).getString("state") == "running" }) { "模型调用仍在运行，请结束后备份" }
                tables.put(table, rows)
            }
            (JSONObject().put("schema", SCHEMA).put("databaseVersion", 3).put("createdAt", Timestamp.now()).put("tables", tables).toString(2) + "\n").toByteArray()
        })
    }

    /** Restore into a new/empty business store only; importing must never replace another family's DB. */
    fun <T> restoreStaged(stateRoot: File, applyPrivateState: () -> T): T {
        val file = File(stateRoot, SNAPSHOT_PATH)
        if (!file.isFile) {
            // Old packages have no Room snapshot. Validate legacy bytes now, import only after private state is applied.
            LegacyTaskCodec.decode(File(stateRoot, RoomTaskLedgerStore.TASKS).takeIf(File::isFile)?.readBytes(),
                File(stateRoot, RoomTaskLedgerStore.EVENTS).takeIf(File::isFile)?.readBytes())
        }
        val snapshot = if (file.isFile) JSONObject(file.readText()).also {
            require((it.getString("schema") == SCHEMA && it.getInt("databaseVersion") == 3) ||
                (it.getString("schema") == "edu-manager.business-database-snapshot.v2" && it.getInt("databaseVersion") == 2)) { "业务数据库快照版本不受支持" }
            val expected = if (it.getInt("databaseVersion") == 2) TABLES.filter { name -> name != "scoped_content" } else TABLES
            require(it.getJSONObject("tables").keys().asSequence().toSet() == expected.toSet()) { "业务数据库快照表不完整" }
        } else null
        val studentFile = File(stateRoot, "students.json")
        val studentIds = if (studentFile.isFile) JSONArray(studentFile.readText()).toObjects().map { it.getString("id") }.toSet() else emptySet()
        val projectFile = File(stateRoot, "projects.json")
        val projectIds = if (projectFile.isFile) JSONObject(projectFile.readText()).getJSONArray("projects").toObjects().map { it.getString("id") }.toSet() else emptySet()
        return BusinessRestoreRecovery.apply(context, stateRoot, db) {
        db.runInTransaction(Callable {
            val sql = db.openHelper.writableDatabase
            TABLES.filter { it != "business_metadata" }.forEach { table ->
                sql.query("SELECT COUNT(*) FROM $table").use { cursor -> cursor.moveToFirst(); require(cursor.getLong(0) == 0L) { "本机已有业务记录，不能覆盖恢复；请使用新的空白设备或先保留本机备份" } }
            }
            sql.execSQL("DELETE FROM business_metadata")
            val result = applyPrivateState()
            if (snapshot != null) {
                val tables = snapshot.getJSONObject("tables")
                TABLES.forEach { table ->
                    if (!tables.has(table)) return@forEach // Validated V2 package, additive V3 content table stays empty.
                    val columns = sql.query("SELECT * FROM $table LIMIT 0").use { it.columnNames.toList() }
                    val rows = tables.getJSONArray(table)
                    for (i in 0 until rows.length()) {
                        val row = rows.getJSONObject(i)
                        require(row.keys().asSequence().toSet() == columns.toSet()) { "业务快照字段不匹配：$table" }
                        if (table == "business_tasks") {
                            val task = JSONObject(row.getString("payload")); LegacyTaskCodec.validateTask(task)
                            val student = LegacyTaskCodec.studentId(task); val project = LegacyTaskCodec.projectId(task)
                            require(student.isBlank() || student in studentIds) { "快照任务指向不存在的学生" }
                            require(project.isBlank() || project in projectIds) { "快照任务指向不存在的项目" }
                            require(row.getString("id") == task.getString("id") && row.getString("studentId") == student && row.getString("projectId") == project && row.getString("status") == task.getString("status")) { "快照任务索引与内容冲突" }
                            row.put("processSession", "restored-device")
                        }
                        if (table == "model_calls") {
                            require(row.getString("studentId").isBlank() || row.getString("studentId") in studentIds) { "模型回执指向不存在的学生" }
                            row.put("processSession", "restored-device")
                            if (row.getString("state") == "running") row.put("state", "unknown").put("errorCode", "restore_interrupted")
                        }
                        if (table == "scoped_content") {
                            require(row.getString("studentId") in studentIds) { "内容记录指向不存在的学生" }
                            require(row.getString("projectId").isBlank() || row.getString("projectId") in projectIds) { "内容记录指向不存在的项目" }
                            val payload = JSONObject(row.getString("payload"))
                            if (row.getString("kind") in setOf("artifact", "favorite", "review", "action", "action_event", "intake_event", "ocr_page", "vision_page", "asr_result", "digest_result")) require(row.getString("sourceSha256") == ScopedContentPolicy.fingerprint(payload)) { "版本/处理快照哈希不匹配" }
                            if (row.getString("kind") in setOf("material", "conversation", "intake_event")) require(payload.getString("studentId") == row.getString("studentId")) { "来源登记作用域与索引不匹配" }
                            if (row.getString("kind") == "search") row.put("state", "stale") // Rebuild against this device's SAF grants, never trust old URIs.
                        }
                        if (table == "business_metadata" && row.getString("name").startsWith("studio-auto:")) {
                            val consent = JSONObject(row.getString("payload")).put("enabled", false).put("restoreRequiresConsent", true)
                            row.put("payload", consent.toString()) // Cloud automation requires fresh authorization on the new device.
                        }
                        if (table == "business_metadata" && row.getString("name").let { it.startsWith("digest-request:") || it.startsWith("cloud-summary:") }) {
                            val marker = JSONObject(row.getString("payload"))
                            if (marker.optString("state") == "authorized_retry") row.put("payload", marker.put("state", "unknown").put("restoreRequiresConsent", true).toString())
                        }
                        val values = columns.map { column -> row.opt(column).takeUnless { it == JSONObject.NULL } }.toTypedArray()
                        sql.execSQL("INSERT INTO $table (${columns.joinToString(",")}) VALUES (${columns.joinToString(",") { "?" }})", values)
                    }
                }
                require(db.tasks().metadata(RoomTaskLedgerStore.MIGRATION_KEY) != null) { "业务快照缺少任务迁移标记" }
            } else TaskRepository(RoomTaskLedgerStore(context, db)).list()
            result
        })
        }
    }

    companion object {
        const val SNAPSHOT_PATH = "business-db/snapshot-v2.json"
        const val SCHEMA = "edu-manager.business-database-snapshot.v3"
        val TABLES = listOf("model_calls", "file_operation_intents", "business_tasks", "task_events", "business_metadata", "scoped_content")
        private val ACTIVE = setOf("running", "waiting_result", "reviewing")
        /** Payloads are JSON strings, so recurse into them as well as structured columns. */
        fun remapSnapshot(file: File, remap: (Any?) -> Any?) {
            if (!file.isFile) return
            val snapshot = JSONObject(file.readText())
            val tables = snapshot.getJSONObject("tables")
            TABLES.forEach { table ->
                if (!tables.has(table)) return@forEach
                val rows = tables.getJSONArray(table)
                for (i in 0 until rows.length()) {
                    val row = rows.getJSONObject(i)
                    // Artifact/favorite evidence is an immutable historical snapshot, not a live path mapping.
                    // Rewriting its JSON would invalidate its recorded content fingerprint.
                    val remappableContent = table == "scoped_content" && row.getString("kind") !in setOf("artifact", "favorite", "review", "action", "action_event", "intake_event", "ocr_page", "vision_page", "asr_result", "digest_result")
                    if (table in setOf("business_tasks", "task_events") || remappableContent || (table == "business_metadata" && row.optString("name") in setOf(RoomTaskLedgerStore.MIGRATION_KEY, "conversation-room-header"))) {
                        val payload = JSONObject(row.getString("payload"))
                        remap(payload); row.put("payload", payload.toString())
                    }
                    if (table == "scoped_content") {
                        row.put("logicalPath", remap(row.opt("logicalPath")))
                        row.put("rootUri", remap(row.opt("rootUri")))
                    }
                    if (table == "file_operation_intents") {
                        row.put("sourceRef", remap(row.opt("sourceRef"))); row.put("targetRef", remap(row.opt("targetRef")))
                    }
                }
            }
            file.writeText(snapshot.toString(2))
        }
    }
}
