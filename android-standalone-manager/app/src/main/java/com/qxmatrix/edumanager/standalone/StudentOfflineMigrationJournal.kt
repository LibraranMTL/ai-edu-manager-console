package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class StudentOfflineMigrationState(
    val migrationId: String,
    val sourceUri: String,
    val targetUri: String,
    val phase: String,
    val totalFiles: Int,
    val completedFiles: Int,
    val totalBytes: Long,
    val completedBytes: Long,
    val current: String,
    val message: String,
    val completedKeys: Set<String>,
    val updatedAt: String,
    val currentFileBytes: Long = 0L,
    val currentFileTotalBytes: Long = 0L,
    val startedAtEpochMs: Long = 0L,
) {
    private fun baseJson(): JSONObject = JSONObject().apply {
        put("schema", SCHEMA); put("migrationId", migrationId); put("sourceUri", sourceUri); put("targetUri", targetUri)
        put("phase", phase); put("totalFiles", totalFiles); put("completedFiles", completedFiles)
        put("totalBytes", totalBytes); put("completedBytes", completedBytes); put("current", current); put("message", message)
        put("updatedAt", updatedAt); put("currentFileBytes", currentFileBytes); put("currentFileTotalBytes", currentFileTotalBytes)
        put("startedAtEpochMs", startedAtEpochMs)
    }

    fun toJson(): JSONObject = baseJson().apply { put("completedKeys", JSONArray(completedKeys.toList().sorted())) }
    fun toProgressJson(): JSONObject = baseJson()

    companion object {
        const val SCHEMA = "edu-manager.student-offline-journal.v1"
        fun fromJson(value: JSONObject): StudentOfflineMigrationState {
            require(value.getString("schema") == SCHEMA)
            val keys = linkedSetOf<String>(); val array = value.optJSONArray("completedKeys") ?: JSONArray()
            for (index in 0 until array.length()) keys += array.getString(index)
            return StudentOfflineMigrationState(
                value.getString("migrationId"), value.getString("sourceUri"), value.getString("targetUri"), value.getString("phase"),
                value.optInt("totalFiles"), value.optInt("completedFiles"), value.optLong("totalBytes"), value.optLong("completedBytes"),
                value.optString("current"), value.optString("message"), keys, value.optString("updatedAt"),
                value.optLong("currentFileBytes"), value.optLong("currentFileTotalBytes"), value.optLong("startedAtEpochMs"),
            )
        }
    }
}

class StudentOfflineMigrationJournal(context: Context) {
    private val state = PrivateStateStore(context)

    fun read(migrationId: String): StudentOfflineMigrationState? = try {
        StudentOfflineMigrationState.fromJson(JSONObject(state.readBytes(path(migrationId)).toString(Charsets.UTF_8)))
    } catch (_: Exception) { null }

    fun latest(): StudentOfflineMigrationState? = try {
        val id = state.readBytes(LATEST).toString(Charsets.UTF_8).trim()
        read(id)
    } catch (_: Exception) { null }

    fun latestProgress(): StudentOfflineMigrationState? = try {
        StudentOfflineMigrationState.fromJson(JSONObject(state.readBytes(LIVE).toString(Charsets.UTF_8)))
    } catch (_: Exception) { latest() }

    fun write(value: StudentOfflineMigrationState) {
        state.writeBytes(path(value.migrationId), (value.toJson().toString(2) + "\n").toByteArray())
        state.writeBytes(LATEST, value.migrationId.toByteArray())
        writeProgress(value)
    }

    fun writeProgress(value: StudentOfflineMigrationState) {
        state.writeBytes(LIVE, (value.toProgressJson().toString(2) + "\n").toByteArray())
    }

    private fun path(id: String): String = "offline-migrations/${safe(id)}.json"
    private fun safe(value: String): String = value.replace(Regex("[^A-Za-z0-9._-]"), "-").take(100).also { require(it.isNotBlank()) }
    companion object {
        private const val LATEST = "offline-migrations/latest.txt"
        private const val LIVE = "offline-migrations/live.json"
    }
}
