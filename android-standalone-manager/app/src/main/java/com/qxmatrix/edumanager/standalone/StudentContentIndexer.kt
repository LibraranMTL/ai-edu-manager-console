package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONObject

/** Rebuildable projection only; never moves, adopts or digests originals. Explicit roots avoid
 * indexing siblings when the student adopted a tree with an empty logical root. */
class StudentContentIndexer(private val context: Context) {
    data class Result(val indexed: Int, val complete: Boolean, val warnings: List<String>)
    fun rebuild(studentId: String): Result {
        val student = StudentIndexRepository(context).requireExact(studentId)
        val repo = ScopedContentRepository(context)
        val rows = linkedMapOf<String, ScopedContentEntity>()
        val warnings = mutableListOf<String>()
        var complete = true
        var textBudget = 4_000_000
        val now = Timestamp.now()
        val db = BusinessDatabase.get(context)
        BusinessRestoreRecovery.recover(context, db)
        val previous = db.content().list(studentId, listOf("search"), 5000, 0).associateBy { it.sourceKey }
        fun scan(rootUri: String, path: String, category: String, projectId: String = "") {
            if (path.isBlank()) return
            try {
                val store = SafWorkspaceStore(context, Uri.parse(rootUri))
                requireNotNull(store.document(path)) { "目录不可用：$category" }
                fun walk(prefix: String, depth: Int) {
                    if (depth > 24 || rows.size >= 5_000) { complete = false; return }
                    store.listDirectory(prefix).sortedBy { it.name }.forEach { file ->
                        if (rows.size >= 5_000) { complete = false; return@forEach }
                        val name = file.name.orEmpty()
                        if (name.isBlank() || name.startsWith(".")) return@forEach
                        val logical = "$prefix/$name"
                        if (file.isDirectory) walk(logical, depth + 1)
                        else if (file.isFile) {
                            var body = ""; var hash = ""
                            val key = ScopedContentPolicy.hash("$rootUri\n$logical".toByteArray())
                            val prior = previous[key]
                            val unchanged = prior?.state == "indexed" && file.lastModified() > 0 &&
                                JSONObject(prior.payload).optLong("modified") == file.lastModified() && JSONObject(prior.payload).optLong("size") == file.length()
                            if (name.substringAfterLast('.', "").lowercase() in setOf("md", "txt") && file.length() <= 256_000) {
                                if (unchanged && prior != null && prior.sourceSha256.isNotBlank()) { body = prior.bodyText.take(textBudget); hash = prior.sourceSha256 }
                                else {
                                    val bytes = store.openInputStream(logical).use { it.readBytesBounded(256_000) }
                                    body = bytes.toString(Charsets.UTF_8).take(minOf(6_000, textBudget)); hash = ScopedContentPolicy.hash(bytes)
                                }
                                textBudget -= body.length
                            }
                            val payload = JSONObject().put("category", category).put("size", file.length()).put("modified", file.lastModified())
                            rows[key] = ScopedContentEntity("search:$studentId:$key", studentId, "search", key, name, body,
                                rootUri, logical, hash, projectId, "indexed", now, now, payload.toString())
                        }
                    }
                }
                walk(path.trimEnd('/'), 0)
            } catch (error: Exception) { complete = false; warnings += "$category：${error.message ?: "读取失败"}" }
        }
        scan(student.storageRootUri, student.paths.rawPath, "原始资料")
        scan(student.storageRootUri, student.paths.summaryPath, "知识与报告")
        scan(student.storageRootUri, student.paths.outputPath, "输出结果")
        ProjectRepository(context).list().filter { studentId in it.studentIds }.forEach { project ->
            scan(project.workspaceRootUri, project.paths.workspacePath, "项目工作空间", project.id)
            listOf(project.paths.rawPath, project.paths.conceptPath, project.paths.entityPath, project.paths.summaryPath,
                project.paths.qaPath, project.paths.synthesisPath, project.paths.reportPath).distinct().forEach {
                scan(project.knowledgeRootUri, it, "项目知识", project.id)
            }
        }
        repo.replaceSearch(studentId, rows.values.toList(), complete)
        if (!complete) warnings += "索引未完整更新；旧索引保留，打开原文时重新校验。"
        return Result(rows.size, complete, warnings)
    }
}

internal fun java.io.InputStream.readBytesBounded(maximum: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8_192)
    while (true) {
        val count = read(buffer); if (count < 0) break
        require(out.size() + count <= maximum) { "内容超出读取上限" }; out.write(buffer, 0, count)
    }
    return out.toByteArray()
}
