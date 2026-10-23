package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

class StudentMaterialRepository(private val context: Context, private val student: StudentRecord) {
    private val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
    private val filePath = child(student.paths.rootPath, ".edu-manager/materials.json")

    private fun legacy(): List<JSONObject> {
        val root = readRoot(); require(root.getString("studentId") == student.id) { "资料索引学生不匹配，停止读取和写入" }
        val array = root.getJSONArray("materials")
        val records = List(array.length()) { array.getJSONObject(it) }
        require(records.all { it.getString("studentId") == student.id && it.getString("id").isNotBlank() } && records.map { it.getString("id") }.distinct().size == records.size) { "资料索引条目不完整或重复" }
        return records.map { source ->
        val item = JSONObject(source.toString())
        val alreadyDigested = item.optString("digestedAt").isNotBlank() ||
            item.optString("digestArtifactPath").isNotBlank()
        if (alreadyDigested && MaterialStatus.normalize(item.optString("status")) == MaterialStatus.PENDING_DIGEST) {
            item.put("status", MaterialStatus.PROCESSED.wireValue)
        }
        item
        }
    }

    private fun <T> access(action: (RoomMaterialStore) -> T): T = MaterialDatabaseAccess.run {
        synchronized(MaterialDatabaseAccess.lock(student.id)) {
            StudentIndexRepository(context).requireExact(student.id)
            val db = BusinessDatabase.get(context); BusinessRestoreRecovery.recover(context, db)
            val room = RoomMaterialStore(db, student.id); room.migrate(::legacy); action(room)
        }
    }
    fun list(): List<JSONObject> = access { it.list() }
    fun repairProjection() = access { room -> write(room.list()); room.projectionComplete() }

    fun upsert(material: JSONObject): List<JSONObject> = access { room ->
        require(material.getString("studentId") == student.id) { "资料不能写入其他学生档案" }
        val items = room.change { items ->
        val index = items.indexOfFirst { it.optString("id") == material.getString("id") }
        if (index >= 0) items[index] = material else items.add(0, material)
            items.toList()
        }
        write(items); room.projectionComplete(); items
    }

    fun transition(materialId: String, next: MaterialStatus): JSONObject = access { room ->
        val result = room.change { items ->
        val index = items.indexOfFirst { it.optString("id") == materialId }
        require(index >= 0) { "未找到指定资料" }
        val current = MaterialStatus.normalize(items[index].optString("status"))
        require(current.canTransitionTo(next)) { "不允许从 ${current.wireValue} 转换到 ${next.wireValue}" }
        items[index].put("status", next.wireValue).put("statusUpdatedAt", Timestamp.now())
            items[index]
        }
        write(room.list()); room.projectionComplete(); result
    }

    fun patch(materialId: String, values: JSONObject): JSONObject = access { room ->
        val result = room.change { items ->
        val index = items.indexOfFirst { it.optString("id") == materialId }
        require(index >= 0) { "未找到指定资料" }
        values.keys().forEach { key -> if (key !in setOf("id", "studentId", "absolutePath")) items[index].put(key, values.opt(key)) }
        items[index].put("statusUpdatedAt", Timestamp.now()); items[index]
        }
        write(room.list()); room.projectionComplete(); result
    }

    private fun readRoot(): JSONObject = if (store.exists(filePath)) JSONObject(store.readBytes(filePath).toString(Charsets.UTF_8))
        else JSONObject().put("version", 1).put("studentId", student.id).put("materials", JSONArray())

    private fun write(items: List<JSONObject>) {
        require(items.size <= MAX_MATERIAL_RECORDS) { "单个学生资料记录超过 $MAX_MATERIAL_RECORDS 份，请先归档后继续导入" }
        val root = JSONObject().put("version", 1).put("studentId", student.id).put("studentName", student.name)
            .put("updatedAt", Timestamp.now()).put("materials", JSONArray().also { array -> items.forEach(array::put) })
        store.writeBytesSafely(filePath, (root.toString(2) + "\n").toByteArray(), "application/json")
    }

    private fun child(root: String, path: String) = if (root.isBlank()) path else "$root/$path"

    companion object { private const val MAX_MATERIAL_RECORDS = 20_000 }
}

class AssetIndexRepository(context: Context) {
    private val state = PrivateStateStore(context)

    fun list(): List<JSONObject> = synchronized(LOCK) {
        val bytes = state.readIfPresent(PATH) ?: return@synchronized emptyList()
        val array = JSONObject(bytes.toString(Charsets.UTF_8)).getJSONArray("assets")
        List(array.length()) { array.getJSONObject(it) }.also { items ->
            require(items.all { it.getString("assetId").isNotBlank() } && items.map { it.getString("assetId") }.distinct().size == items.size) { "资产索引损坏，停止写入" }
        }
    }

    fun upsertBySha1(candidate: JSONObject): JSONObject = synchronized(LOCK) {
        val assets = list().toMutableList()
        val index = assets.indexOfFirst { it.optString("sha1") == candidate.getString("sha1") }
        val merged = if (index < 0) candidate else merge(assets[index], candidate)
        if (index < 0) assets.add(0, merged) else assets[index] = merged
        write(assets)
        merged
    }

    fun markStudentOriginalRemoved(studentId: String, logicalPath: String, sha1: String, removedAt: String) = synchronized(LOCK) {
        val assets = list().toMutableList()
        val index = assets.indexOfFirst { asset ->
            (sha1.isNotBlank() && asset.optString("sha1") == sha1) ||
                asset.optJSONArray("references").toObjects().any { it.optString("spaceType") == "student" && it.optString("spaceId") == studentId && it.optString("path") == logicalPath }
        }
        if (index < 0) return@synchronized
        val updated = JSONObject(assets[index].toString())
        val references = JSONArray()
        updated.optJSONArray("references").toObjects().forEach { source ->
            val reference = JSONObject(source.toString())
            if (reference.optString("spaceType") == "student" && reference.optString("spaceId") == studentId && reference.optString("path") == logicalPath) {
                reference.put("role", "student_raw_removed").put("removedAt", removedAt)
            }
            references.put(reference)
        }
        updated.put("references", references).put("updatedAt", removedAt)
        val hasLiveReference = references.toObjects().any { !it.optString("role").endsWith("_removed") }
        if (!hasLiveReference && updated.optJSONArray("linkedProjects").strings().isEmpty()) updated.put("status", "removed").put("removedAt", removedAt)
        assets[index] = updated
        write(assets)
    }

    fun forStudent(studentId: String): List<JSONObject> = list().filter { asset ->
        asset.optString("ownerStudentId") == studentId || asset.optJSONArray("linkedStudents").strings().contains(studentId)
    }

    private fun merge(existing: JSONObject, candidate: JSONObject): JSONObject = JSONObject(existing.toString()).apply {
        put("linkedStudents", mergeStrings(existing.optJSONArray("linkedStudents"), candidate.optJSONArray("linkedStudents")))
        put("linkedProjects", mergeStrings(existing.optJSONArray("linkedProjects"), candidate.optJSONArray("linkedProjects")))
        put("references", mergeReferences(existing.optJSONArray("references"), candidate.optJSONArray("references")))
        put("status", candidate.optString("status").ifBlank { existing.optString("status", "active") })
        if (optString("status") != "removed") remove("removedAt")
        put("updatedAt", Timestamp.now())
    }

    private fun mergeStrings(left: JSONArray?, right: JSONArray?) = JSONArray().also { output ->
        (left.strings() + right.strings()).distinct().filter(String::isNotBlank).forEach(output::put)
    }

    private fun mergeReferences(left: JSONArray?, right: JSONArray?) = JSONArray().also { output ->
        (left.toObjects() + right.toObjects()).distinctBy {
            "${it.optString("spaceType")}|${it.optString("spaceId")}|${it.optString("role")}|${it.optString("path")}"
        }.forEach(output::put)
    }

    private fun write(assets: List<JSONObject>) {
        require(assets.size <= MAX_ASSET_RECORDS) { "文件资产索引超过 $MAX_ASSET_RECORDS 项，请先归档后继续导入" }
        val root = JSONObject().put("version", 1).put("updatedAt", Timestamp.now())
            .put("assets", JSONArray().also { array -> assets.forEach(array::put) })
        state.writeBytes(PATH, (root.toString(2) + "\n").toByteArray())
    }

    companion object {
        private const val PATH = "asset-index.json"
        private const val MAX_ASSET_RECORDS = 50_000
        private val LOCK = Any()
    }
}

internal fun JSONArray?.toObjects(): List<JSONObject> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) optJSONObject(index)?.let(::add)
}

internal fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) add(optString(index))
}
