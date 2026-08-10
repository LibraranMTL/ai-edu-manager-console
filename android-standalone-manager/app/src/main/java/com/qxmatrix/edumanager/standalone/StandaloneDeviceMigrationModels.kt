package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class StandaloneDeviceMigrationState(
    val migrationId: String,
    val operation: String,
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
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("schema", SCHEMA); put("migrationId", migrationId); put("operation", operation)
        put("sourceUri", sourceUri); put("targetUri", targetUri); put("phase", phase)
        put("totalFiles", totalFiles); put("completedFiles", completedFiles)
        put("totalBytes", totalBytes); put("completedBytes", completedBytes)
        put("current", current); put("message", message)
        put("completedKeys", JSONArray(completedKeys.toList().sorted())); put("updatedAt", updatedAt)
    }

    companion object {
        const val SCHEMA = "edu-manager.standalone-device-journal.v1"
        fun fromJson(value: JSONObject): StandaloneDeviceMigrationState {
            require(value.getString("schema") == SCHEMA)
            val keys = linkedSetOf<String>(); val array = value.optJSONArray("completedKeys") ?: JSONArray()
            for (index in 0 until array.length()) keys += array.getString(index)
            return StandaloneDeviceMigrationState(
                value.getString("migrationId"), value.getString("operation"), value.optString("sourceUri"),
                value.optString("targetUri"), value.getString("phase"), value.optInt("totalFiles"),
                value.optInt("completedFiles"), value.optLong("totalBytes"), value.optLong("completedBytes"),
                value.optString("current"), value.optString("message"), keys, value.optString("updatedAt"),
            )
        }
    }
}

class StandaloneDeviceMigrationJournal(context: Context) {
    private val state = PrivateStateStore(context)
    fun latest(): StandaloneDeviceMigrationState? = runCatching {
        val id = state.readBytes(LATEST).toString(Charsets.UTF_8).trim()
        StandaloneDeviceMigrationState.fromJson(JSONObject(state.readBytes(path(id)).toString(Charsets.UTF_8)))
    }.getOrNull()

    fun write(value: StandaloneDeviceMigrationState) {
        state.writeBytes(path(value.migrationId), (value.toJson().toString(2) + "\n").toByteArray())
        state.writeBytes(LATEST, value.migrationId.toByteArray())
    }

    private fun path(id: String) = "device-migrations/${id.replace(Regex("[^A-Za-z0-9._-]"), "-").take(100)}.json"
    companion object { private const val LATEST = "device-migrations/latest.txt" }
}

object StandaloneDeviceMigrationContract {
    const val PACKAGE_SCHEMA = "edu-manager.standalone-portable-folder.v1"
    const val MANIFEST_SCHEMA = "edu-manager.standalone-portable-manifest.v1"
    const val PROFILE = "standalone-device"
    const val DESCRIPTOR_PATH = "migration.json"
    const val MANIFEST_PATH = "manifest.json"
    const val MANIFEST_HASH_PATH = "manifest.sha256"
    const val MARKER_PATH = ".edu-manager/standalone-device-migration.json"
    const val REPORT_PATH = ".edu-manager/standalone-device-migration-report.json"

    val excludedStatePrefixes = listOf(
        "offline-migrations/", "device-migrations/", "migration/", "collaboration/device/",
        "collaboration/pairing/", "collaboration/credentials/",
    )
}
