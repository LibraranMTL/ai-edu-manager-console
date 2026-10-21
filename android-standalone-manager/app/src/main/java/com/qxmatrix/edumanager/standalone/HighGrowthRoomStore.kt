package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.os.Looper
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Room index for continuously growing query data. JSON/SAF remain export and recovery formats;
 * a migration marker is written only after count and aggregate fingerprint verification.
 */
class HighGrowthRoomStore(context: Context, private val db: BusinessDatabase = BusinessDatabase.get(context)) {
    private val appContext = context.applicationContext
    private val dao = db.content()

    fun migrateAndPage(studentId: String, kind: String, legacy: List<JSONObject>, limit: Int = 50, offset: Int = 0): List<JSONObject> {
        requireBackground(); requireKind(kind); StudentIndexRepository(appContext).requireExact(studentId)
        val normalized = legacy.map { normalize(studentId, kind, it) }.distinctBy { it.getString("sourceId") }
        db.runInTransaction {
            normalized.forEach { dao.project(entity(studentId, kind, it)) }
            val expected = normalized.size
            check(dao.count(studentId, kind) == expected) { "Room 迁移数量校验失败，继续保留旧数据" }
            val aggregate = aggregate(normalized)
            val migrated = if (normalized.isEmpty()) emptyList() else dao.byKeys(studentId, kind, normalized.map { it.getString("sourceId") })
            check(migrated.size == expected && aggregateEntities(migrated) == aggregate) { "Room 迁移哈希校验失败，继续保留旧数据" }
            db.tasks().metadata(BusinessMetadataEntity(marker(studentId, kind), JSONObject()
                .put("version", MIGRATION_VERSION).put("count", expected).put("aggregate", aggregate).put("verifiedAt", Timestamp.now()).toString()))
        }
        return page(studentId, kind, limit, offset)
    }

    fun page(studentId: String, kind: String, limit: Int = 50, offset: Int = 0): List<JSONObject> {
        requireBackground(); requireKind(kind); StudentIndexRepository(appContext).requireExact(studentId)
        return dao.page(studentId, kind, limit.coerceIn(1, 100), offset.coerceAtLeast(0)).map { JSONObject(it.payload) }
    }

    fun mirrorAsync(studentId: String, kind: String, rows: List<JSONObject>) {
        if (studentId.isBlank() || kind !in KINDS || rows.isEmpty()) return
        EXECUTOR.execute {
            runCatching {
                StudentIndexRepository(appContext).requireExact(studentId)
                rows.map { normalize(studentId, kind, it) }.distinctBy { it.getString("sourceId") }
                    .forEach { dao.project(entity(studentId, kind, it)) }
            }
        }
    }

    fun migrationVerified(studentId: String, kind: String): Boolean {
        requireBackground(); requireKind(kind)
        return db.tasks().metadata(marker(studentId, kind))?.let { JSONObject(it).optInt("version") == MIGRATION_VERSION } == true
    }

    private fun normalize(studentId: String, kind: String, source: JSONObject): JSONObject {
        val row = JSONObject(source.toString())
        row.put("studentId", studentId)
        val sourceId = row.optString("sourceId").ifBlank { row.optString("id") }.ifBlank { ScopedContentPolicy.fingerprint(row) }
        row.put("sourceId", sourceId)
        if (row.optString("time").isBlank()) row.put("time", row.optString("updatedAt", row.optString("createdAt", Timestamp.now())))
        if (row.optString("contentFingerprint").isBlank()) row.put("contentFingerprint", ScopedContentPolicy.fingerprint(row))
        row.put("indexKind", kind)
        return row
    }

    private fun entity(studentId: String, kind: String, row: JSONObject): ScopedContentEntity {
        val sourceId = row.getString("sourceId")
        val fingerprint = row.getString("contentFingerprint")
        val time = row.optString("time", Timestamp.now())
        return ScopedContentEntity(
            id = "high-${kind}-${ScopedContentPolicy.hash("$studentId\u0000$sourceId".toByteArray()).take(32)}",
            studentId = studentId,
            kind = kind,
            sourceKey = sourceId,
            title = row.optString("title", kind).take(500),
            bodyText = row.optString("content", row.optString("summary")).take(20_000),
            rootUri = "",
            logicalPath = row.optString("sourcePath").take(2_000),
            sourceSha256 = fingerprint,
            projectId = row.optString("projectId"),
            state = row.optString("status", "recorded"),
            createdAt = row.optString("createdAt", time),
            updatedAt = row.optString("updatedAt", time),
            payload = row.toString(),
        )
    }

    private fun aggregate(rows: List<JSONObject>) = ScopedContentPolicy.hash(rows
        .sortedBy { it.getString("sourceId") }
        .joinToString("\n") { "${it.getString("sourceId")}:${it.getString("contentFingerprint")}" }
        .toByteArray())

    private fun aggregateEntities(rows: List<ScopedContentEntity>) = ScopedContentPolicy.hash(rows
        .sortedBy { it.sourceKey }
        .joinToString("\n") { "${it.sourceKey}:${it.sourceSha256}" }
        .toByteArray())

    private fun requireBackground() = check(Looper.myLooper() != Looper.getMainLooper()) { "高增长索引须在后台访问" }
    private fun requireKind(kind: String) = require(kind in KINDS) { "不支持的高增长索引类型" }
    private fun marker(studentId: String, kind: String) = "high-growth-migration:$MIGRATION_VERSION:$studentId:$kind"

    companion object {
        const val GROWTH_EVIDENCE = "growth_evidence"
        const val GROWTH_SNAPSHOT = "growth_snapshot"
        const val REPORT_REVISION = "report_revision"
        const val CONVERSATION_CANDIDATE = "conversation_candidate"
        const val LEARNING_EVENT = "learning_event"
        const val SYNC_RECEIPT = "sync_receipt"
        private const val MIGRATION_VERSION = 1
        private val KINDS = setOf(GROWTH_EVIDENCE, GROWTH_SNAPSHOT, REPORT_REVISION, CONVERSATION_CANDIDATE, LEARNING_EVENT, SYNC_RECEIPT)
        private val EXECUTOR = Executors.newFixedThreadPool(2) { runnable -> Thread(runnable, "edu-high-growth-index").apply { isDaemon = true } }
    }
}
