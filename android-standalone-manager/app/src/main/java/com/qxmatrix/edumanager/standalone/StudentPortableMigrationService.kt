package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.ZipInputStream

data class PendingStudentMigration(
    val baseUrl: String,
    val bearerToken: String,
    val studentId: String,
    val sessionId: String,
    val downloadUrl: String,
    val sha256: String,
    val bytes: Long,
)

data class StudentMigrationResult(val student: StudentRecord, val files: Int, val projects: Int)

class StudentPortableMigrationService(private val context: Context) {
    fun import(pending: PendingStudentMigration, targetRoot: Uri): StudentMigrationResult {
        require(pending.studentId.isNotBlank() && pending.sessionId.isNotBlank()) { "迁移会话信息不完整" }
        val target = requireNotNull(DocumentFile.fromTreeUri(context, targetRoot)) { "迁移目标目录不可用" }
        require(target.isDirectory && target.listFiles().isEmpty()) { "请选择一个空目录作为单机版学生档案目录" }

        val zip = File.createTempFile("student-migration-", ".zip", context.cacheDir)
        val stage = File(context.cacheDir, "student-migration-${pending.sessionId}")
        try {
            download(pending, zip)
            if (pending.sha256.isNotBlank()) require(sha256(zip).equals(pending.sha256, true)) { "迁移包 SHA-256 校验失败" }
            if (stage.exists()) stage.deleteRecursively()
            require(stage.mkdirs()) { "无法建立迁移校验目录" }
            extract(zip, stage)

            val migration = JSONObject(File(stage, "migration.json").readText(Charsets.UTF_8))
            val manifest = JSONObject(File(stage, "manifest.json").readText(Charsets.UTF_8))
            require(migration.getString("schema") == SCHEMA && manifest.getString("schema") == SCHEMA) { "不支持的迁移包版本" }
            val studentJson = migration.getJSONObject("student")
            require(studentJson.getString("id") == pending.studentId && manifest.getString("studentId") == pending.studentId) { "迁移包学生范围不匹配" }
            validateFiles(stage, manifest)

            val studentRepository = StudentIndexRepository(context)
            val preliminaryPaths = StudentWorkspacePaths.adopted(studentJson.getString("name"))
            val preliminary = StudentRecord.imported(
                studentJson.getString("id"), studentJson.getString("name"), studentJson.optString("grade"),
                studentJson.optString("school"), studentJson.optString("goal"), targetRoot.toString(), preliminaryPaths,
            )
            studentRepository.validateAdd(preliminary)
            val projectRepository = ProjectRepository(context)
            val projectPlans = mutableListOf<Pair<ProjectRecord, File>>()
            val projectValues = migration.optJSONArray("projects")
            if (projectValues != null) for (index in 0 until projectValues.length()) {
                val value = projectValues.getJSONObject(index)
                val source = safeFile(stage, value.getString("source"))
                if (!source.isDirectory) continue
                val record = ProjectRecord.create(
                    value.getString("name"), value.optString("type"), value.optString("description"), value.optString("objective"),
                    listOf(preliminary), targetRoot.toString(),
                ).copy(id = value.getString("id"), status = value.optString("status", "active"))
                projectRepository.validateAdd(record)
                projectPlans += record to source
            }

            val store = SafWorkspaceStore(context, targetRoot)
            val workspace = File(stage, "workspace")
            require(workspace.isDirectory) { "迁移包缺少学生档案目录" }
            var copied = copyDirectory(workspace, "", store)
            val scan = StudentWorkspaceService(context).scanAdopted(studentJson.getString("name"), targetRoot)
            val student = preliminary.copy(paths = scan.paths)
            studentRepository.add(student)
            projectPlans.forEach { (project, source) ->
                copied += copyDirectory(source, project.paths.projectRootPath, store)
                projectRepository.add(project)
            }
            GrowthModelService(context).ensure(student.id)
            return StudentMigrationResult(student, copied, projectPlans.size)
        } finally {
            zip.delete()
            stage.deleteRecursively()
        }
    }

    private fun download(pending: PendingStudentMigration, output: File) {
        val absolute = if (pending.downloadUrl.startsWith("http://") || pending.downloadUrl.startsWith("https://")) pending.downloadUrl
        else pending.baseUrl.trimEnd('/') + "/" + pending.downloadUrl.trimStart('/')
        val connection = URL(absolute).openConnection() as HttpURLConnection
        connection.connectTimeout = 10_000; connection.readTimeout = 120_000
        connection.setRequestProperty("Authorization", "Bearer ${pending.bearerToken}")
        connection.setRequestProperty("Accept", "application/zip")
        try {
            val code = connection.responseCode
            require(code in 200..299) { "下载迁移包失败：HTTP $code" }
            val declared = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
            require(declared in 1..MAX_PACKAGE_BYTES) { "迁移包大小无效或超过限制" }
            if (pending.bytes > 0) require(declared == pending.bytes) { "迁移包长度与主机快照不一致" }
            connection.inputStream.use { input -> output.outputStream().use { target ->
                val buffer = ByteArray(64 * 1024); var total = 0L
                while (true) { val read = input.read(buffer); if (read < 0) break; total += read; require(total <= MAX_PACKAGE_BYTES) { "迁移包超过限制" }; target.write(buffer, 0, read) }
            } }
        } finally { connection.disconnect() }
    }

    private fun extract(zip: File, stage: File) {
        var count = 0; var total = 0L
        ZipInputStream(zip.inputStream().buffered()).use { input ->
            while (true) {
                val entry = input.nextEntry ?: break
                val name = entry.name.replace('\\', '/').removePrefix("./")
                if (name.isBlank()) continue
                val target = safeFile(stage, name)
                if (entry.isDirectory) target.mkdirs() else {
                    require(++count <= MAX_FILES) { "迁移包文件数量超过限制" }
                    target.parentFile?.mkdirs(); target.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) { val read = input.read(buffer); if (read < 0) break; total += read; require(total <= MAX_UNPACKED_BYTES) { "迁移包解压后超过限制" }; output.write(buffer, 0, read) }
                    }
                }
                input.closeEntry()
            }
        }
    }

    private fun validateFiles(stage: File, manifest: JSONObject) {
        val files = manifest.getJSONArray("files")
        require(files.length() == manifest.getInt("fileCount")) { "迁移清单数量不一致" }
        for (index in 0 until files.length()) {
            val item = files.getJSONObject(index); val file = safeFile(stage, item.getString("path"))
            require(file.isFile && file.length() == item.getLong("bytes")) { "迁移文件缺失或长度错误：${item.getString("path")}" }
            require(sha256(file).equals(item.getString("sha256"), true)) { "迁移文件哈希错误：${item.getString("path")}" }
        }
    }

    private fun copyDirectory(source: File, prefix: String, store: SafWorkspaceStore): Int {
        var count = 0
        source.walkTopDown().filter(File::isFile).forEach { file ->
            val relative = file.relativeTo(source).invariantSeparatorsPath
            val target = if (prefix.isBlank()) relative else "$prefix/$relative"
            store.writeStreamSafely(target, mimeType(file.name)) { output -> file.inputStream().use { it.copyTo(output) } }
            count++
        }
        return count
    }

    private fun safeFile(root: File, relative: String): File {
        val normalized = relative.replace('\\', '/').removePrefix("./")
        require(normalized.isNotBlank() && !normalized.startsWith('/') && normalized.split('/').none { it == ".." || it.isBlank() }) { "迁移包包含不安全路径" }
        val file = File(root, normalized).canonicalFile
        require(file.path.startsWith(root.canonicalPath + File.separator)) { "迁移包路径越界" }
        return file
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read) }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
    private fun mimeType(name: String) = when (name.substringAfterLast('.', "").lowercase()) {
        "md", "txt" -> "text/plain"; "json" -> "application/json"; "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"; "pdf" -> "application/pdf"; else -> "application/octet-stream"
    }

    companion object {
        const val ACTION = "com.qxmatrix.edumanager.standalone.IMPORT_STUDENT_MIGRATION"
        const val SCHEMA = "edu-manager.student-portable-package.v1"
        private const val MAX_PACKAGE_BYTES = 4L * 1024 * 1024 * 1024
        private const val MAX_UNPACKED_BYTES = 12L * 1024 * 1024 * 1024
        private const val MAX_FILES = 100_000
    }
}
