package com.qxmatrix.edumanager.standalone

import androidx.room.*
import org.json.JSONObject
import java.security.MessageDigest

/** Durable versions/attempts/favorites and a rebuildable, separately typed search projection. */
@Entity(tableName = "scoped_content", indices = [Index(value = ["studentId", "kind", "sourceKey"], unique = true),
    Index(value = ["studentId", "kind", "updatedAt"]), Index(value = ["studentId", "projectId"])])
data class ScopedContentEntity(@PrimaryKey val id: String, val studentId: String, val kind: String,
    val sourceKey: String, val title: String, val bodyText: String, val rootUri: String, val logicalPath: String,
    val sourceSha256: String, val projectId: String, val state: String, val createdAt: String, val updatedAt: String, val payload: String)

@Dao interface ScopedContentDao {
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insert(row: ScopedContentEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun project(row: ScopedContentEntity)
    @Query("SELECT COUNT(*) FROM scoped_content WHERE studentId=:studentId AND kind=:kind AND state!='removed'")
    fun count(studentId: String, kind: String): Int
    @Query("SELECT * FROM scoped_content WHERE studentId=:studentId AND kind=:kind AND state!='removed' ORDER BY updatedAt DESC,id LIMIT :limit OFFSET :offset")
    fun page(studentId: String, kind: String, limit: Int, offset: Int): List<ScopedContentEntity>
    @Query("SELECT * FROM scoped_content WHERE studentId=:studentId AND kind=:kind AND sourceKey IN (:sourceKeys)")
    fun byKeys(studentId: String, kind: String, sourceKeys: List<String>): List<ScopedContentEntity>
    @Query("SELECT * FROM scoped_content WHERE studentId = :studentId AND id = :id") fun exact(studentId: String, id: String): ScopedContentEntity?
    @Query("SELECT * FROM scoped_content WHERE studentId = :studentId AND kind = :kind AND sourceKey = :key") fun byKey(studentId: String, kind: String, key: String): ScopedContentEntity?
    @Query("SELECT * FROM scoped_content WHERE studentId = :studentId AND kind IN (:kinds) AND state != 'removed' ORDER BY updatedAt DESC,id LIMIT :limit OFFSET :offset")
    fun list(studentId: String, kinds: List<String>, limit: Int, offset: Int): List<ScopedContentEntity>
    @Query("SELECT * FROM scoped_content WHERE studentId = :studentId AND kind IN ('search','artifact','favorite','draft','action') AND state NOT IN ('removed','stale') AND (title LIKE :query ESCAPE '\\' OR bodyText LIKE :query ESCAPE '\\' OR logicalPath LIKE :query ESCAPE '\\') ORDER BY updatedAt DESC,id LIMIT :limit OFFSET :offset")
    fun search(studentId: String, query: String, limit: Int, offset: Int): List<ScopedContentEntity>
    @Query("UPDATE scoped_content SET state = 'stale' WHERE studentId = :studentId AND kind = 'search'") fun staleProjection(studentId: String)
    @Query("UPDATE scoped_content SET state = :next,updatedAt = :now WHERE studentId = :studentId AND id = :id AND kind = 'favorite'")
    fun favoriteState(studentId: String, id: String, next: String, now: String): Int
    @Query("SELECT * FROM scoped_content WHERE studentId = :studentId AND kind = :kind AND state NOT IN ('removed','stale') AND (title LIKE :query ESCAPE '\\' OR bodyText LIKE :query ESCAPE '\\' OR logicalPath LIKE :query ESCAPE '\\') ORDER BY updatedAt DESC,id LIMIT 50 OFFSET :offset")
    fun filtered(studentId: String, kind: String, query: String, offset: Int): List<ScopedContentEntity>
    @Query("UPDATE scoped_content SET state = :next,updatedAt = :now WHERE studentId = :studentId AND id = :id AND kind IN ('attempt','action','decision') AND state = :expected")
    fun transition(studentId: String, id: String, expected: String, next: String, now: String): Int
    @Query("SELECT * FROM scoped_content WHERE studentId = :studentId AND kind = 'material' ORDER BY createdAt DESC,id")
    fun materials(studentId: String): List<ScopedContentEntity>
    @Query("UPDATE scoped_content SET title=:title,bodyText=:payload,logicalPath=:path,sourceSha256=:hash,state=:state,updatedAt=:now,payload=:payload WHERE studentId=:studentId AND id=:id AND kind='material' AND payload=:expected")
    fun materialUpdate(studentId: String, id: String, expected: String, title: String, path: String, hash: String, state: String, now: String, payload: String): Int
    @Query("SELECT * FROM scoped_content WHERE kind='conversation' AND state!='removed' ORDER BY createdAt DESC,id LIMIT 20000")
    fun conversations(): List<ScopedContentEntity>
    @Query("UPDATE scoped_content SET payload=:payload,bodyText='',state=:state,updatedAt=:now WHERE id=:id AND studentId=:studentId AND kind='conversation' AND payload=:expected")
    fun conversationUpdate(studentId: String, id: String, expected: String, payload: String, state: String, now: String): Int
}

object ScopedContentPolicy {
    fun hash(value: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
    fun canonical(value: Any?): String = when (value) {
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonical(value.opt(it)) }
        is org.json.JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.opt(it)) }
        is String -> JSONObject.quote(value)
        else -> value?.toString() ?: "null"
    }
    fun fingerprint(value: JSONObject): String = hash(canonical(value).toByteArray())
    fun query(value: String): String = "%" + value.trim().take(200).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    fun requireScope(row: ScopedContentEntity, studentId: String) { require(studentId.isNotBlank() && row.studentId == studentId) { "学生作用域不匹配" } }
}
