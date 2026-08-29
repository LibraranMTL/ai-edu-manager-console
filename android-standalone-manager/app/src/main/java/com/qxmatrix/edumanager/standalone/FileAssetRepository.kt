package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

class StudentMaterialRepository(context: Context, private val student: StudentRecord) {
    private val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
    private val filePath = child(student.paths.rootPath, ".edu-manager/materials.json")

    fun list(): List<JSONObject> = readRoot().optJSONArray("materials").toObjects()

    fun upsert(material: JSONObject): List<JSONObject> {
        require(material.getString("studentId") == student.id) { "资料不能写入其他学生档案" }
        val items = list().toMutableList()
        val index = items.indexOfFirst { it.optString("id") == material.getString("id") }
        if (index >= 0) items[index] = material else items.add(0, material)
        write(items)
        return items
    }

    fun transition(materialId: String, next: MaterialStatus): JSONObject {
        val items = list().toMutableList()
        val index = items.indexOfFirst { it.optString("id") == materialId }
        require(index >= 0) { "未找到指定资料" }
        val current = MaterialStatus.normalize(items[index].optString("status"))
        require(current.canTransitionTo(next)) { "不允许从 ${current.wireValue} 转换到 ${next.wireValue}" }
        items[index].put("status", next.wireValue).put("statusUpdatedAt", Timestamp.now())
        write(items)
        return items[index]
    }

    fun patch(materialId: String, values: JSONObject): JSONObject {
        val items = list().toMutableList(); val index = items.indexOfFirst { it.optString("id") == materialId }
        require(index >= 0) { "未找到指定资料" }
        values.keys().forEach { key -> if (key !in setOf("id", "studentId", "absolutePath")) items[index].put(key, values.opt(key)) }
        items[index].put("statusUpdatedAt", Timestamp.now()); write(items); return items[index]
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

    fun list(): List<JSONObject> = try {
        JSONObject(state.readBytes(PATH).toString(Charsets.UTF_8)).optJSONArray("assets").toObjects()
    } catch (_: Exception) { emptyList() }

    fun upsertBySha1(candidate: JSONObject): JSONObject {
        val assets = list().toMutableList()
        val index = assets.indexOfFirst { it.optString("sha1") == candidate.getString("sha1") }
        val merged = if (index < 0) candidate else merge(assets[index], candidate)
        if (index < 0) assets.add(0, merged) else assets[index] = merged
        require(assets.size <= MAX_ASSET_RECORDS) { "文件资产索引超过 $MAX_ASSET_RECORDS 项，请先归档后继续导入" }
        val root = JSONObject().put("version", 1).put("updatedAt", Timestamp.now())
            .put("assets", JSONArray().also { array -> assets.forEach(array::put) })
        state.writeBytes(PATH, (root.toString(2) + "\n").toByteArray())
        return merged
    }

    fun forStudent(studentId: String): List<JSONObject> = list().filter { asset ->
        asset.optString("ownerStudentId") == studentId || asset.optJSONArray("linkedStudents").strings().contains(studentId)
    }

    private fun merge(existing: JSONObject, candidate: JSONObject): JSONObject = JSONObject(existing.toString()).apply {
        put("linkedStudents", mergeStrings(existing.optJSONArray("linkedStudents"), candidate.optJSONArray("linkedStudents")))
        put("linkedProjects", mergeStrings(existing.optJSONArray("linkedProjects"), candidate.optJSONArray("linkedProjects")))
        put("references", mergeReferences(existing.optJSONArray("references"), candidate.optJSONArray("references")))
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

    companion object {
        private const val PATH = "asset-index.json"
        private const val MAX_ASSET_RECORDS = 50_000
    }
}

internal fun JSONArray?.toObjects(): List<JSONObject> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) optJSONObject(index)?.let(::add)
}

internal fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) add(optString(index))
}
