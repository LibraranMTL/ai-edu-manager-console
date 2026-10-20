package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.database.Cursor
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.Callable

/** Preserve collaboration history without cloning another device's keys, grants or active jobs.
 * The archive is restored as inert private data; actual sharing requires new pairing. */
object CollaborationArchiveSnapshot {
    const val PATH = "collaboration/archive-v1.json"
    private val tables = listOf("collaboration_devices", "collaboration_student_maps", "collaboration_saf_mappings", "collaboration_revisions",
        "collaboration_queue", "collaboration_conflicts", "collaboration_package_checkpoints", "collaboration_file_inventory")
    private val sensitive = setOf("encryptedsecret", "token", "apikey", "credential", "password", "authorization", "secret", "signature", "enrollmentcode")
    internal fun sanitize(value: Any?): Any? = when (value) {
        is JSONObject -> JSONObject().apply { value.keys().forEach { key -> put(key, if (key.lowercase() in sensitive) "" else sanitize(value.opt(key))) } }
        is JSONArray -> JSONArray().apply { for (i in 0 until value.length()) put(sanitize(value.opt(i))) }
        else -> value
    }
    fun exportBytes(context: Context): ByteArray {
        val db = CollaborationDatabase.get(context)
        return db.runInTransaction(Callable {
            val output = JSONObject()
            tables.forEach { table ->
                val rows = JSONArray()
                db.openHelper.writableDatabase.query("SELECT * FROM $table").use { cursor ->
                    while (cursor.moveToNext()) {
                        val row = JSONObject()
                        cursor.columnNames.forEachIndexed { index, column ->
                            val value: Any? = when (cursor.getType(index)) { Cursor.FIELD_TYPE_NULL -> JSONObject.NULL; Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(index); Cursor.FIELD_TYPE_STRING -> cursor.getString(index); else -> error("协作归档字段类型不支持") }
                            if (column == "payloadJson") row.put(column, sanitize(JSONTokener(value.toString()).nextValue()).toString())
                            else row.put(column, if (column.lowercase() in sensitive) "" else value)
                        }
                        require(table != "collaboration_queue" || row.optString("status") != "running") { "协作任务仍运行，请结束后备份" }
                        rows.put(row)
                    }
                }; output.put(table, rows)
            }
            JSONObject().put("schema", "edu-manager.collaboration-history-archive.v1").put("mode", "inert-history-repair-pairing-required")
                .put("createdAt", Timestamp.now()).put("tables", output).toString().toByteArray()
        })
    }
}
