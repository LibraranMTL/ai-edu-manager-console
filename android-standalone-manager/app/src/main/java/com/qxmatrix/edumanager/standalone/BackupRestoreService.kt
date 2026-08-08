package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import org.bouncycastle.crypto.generators.SCrypt
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.io.SequenceInputStream
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Android transport for the Windows migration-package/manifest v1 business contract. */
class BackupRestoreService(private val context: Context) {
    private val random = SecureRandom()

    fun exportPackage(destination: Uri, password: CharArray): JSONObject {
        val migrationId = "migration-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}"
        val manifestFiles = JSONArray(); var totalBytes = 0L
        var key: ByteArray? = null
        var roots: List<RootSpec> = emptyList()
        try {
            require(password.size >= 8) { "备份密码至少需要 8 个字符" }
            roots = collectRoots()
            requireDestinationOutsideManagedRoots(destination, roots)
            val sources = collectSources(roots)
            val salt = ByteArray(16).also(random::nextBytes)
            key = deriveKey(password, salt)
            val encryptionKey = requireNotNull(key)
            context.contentResolver.openOutputStream(destination, "w")?.use { raw ->
                ZipOutputStream(raw.buffered()).use { zip ->
                    for (source in sources) {
                        val encrypted = encryptSource(source, encryptionKey)
                        val payloadPath = safePackagePath("payload/${source.category}/${source.scopeId}/${source.relativePath}.enc")
                        zip.putNextEntry(ZipEntry(payloadPath)); FileInputStream(encrypted.file).use { it.copyTo(zip) }; zip.closeEntry()
                        manifestFiles.put(JSONObject().put("category", source.category).put("scopeId", source.scopeId)
                            .put("relativePath", source.relativePath).put("destinationRelativePath", source.destinationRelativePath)
                            .put("payloadRelativePath", payloadPath).put("size", encrypted.plainBytes).put("sha256", encrypted.plainSha256)
                            .put("storedSha256", encrypted.storedSha256).put("iv", encrypted.iv).put("authTag", encrypted.authTag))
                        totalBytes += encrypted.plainBytes; encrypted.file.delete()
                    }
                    val manifest = JSONObject().put("schema", MANIFEST_SCHEMA).put("migrationId", migrationId).put("appVersion", APP_VERSION)
                        .put("createdAt", Timestamp.now()).put("encrypted", true)
                        .put("encryption", JSONObject().put("algorithm", "aes-256-gcm").put("kdf", "scrypt").put("salt", android.util.Base64.encodeToString(salt, android.util.Base64.NO_WRAP)).put("N", 16384).put("r", 8).put("p", 1))
                        .put("identityPolicy", "new-device-uri-and-agent-reauthorization").put("roots", JSONArray().also { array -> roots.forEach { array.put(it.toJson()) } })
                        .put("files", manifestFiles).put("excludedSensitiveData", JSONArray(listOf("agent-api-token", "android-keystore-key", "media-projection-grant", "old-saf-grants")))
                    val manifestBytes = (manifest.toString(2) + "\n").toByteArray()
                    putBytes(zip, "manifest.json", manifestBytes); putBytes(zip, "manifest.sha256", (sha256(manifestBytes) + "  manifest.json\n").toByteArray())
                    val descriptor = JSONObject().put("schema", PACKAGE_SCHEMA).put("migrationId", migrationId).put("appVersion", APP_VERSION)
                        .put("createdAt", manifest.getString("createdAt")).put("encrypted", true).put("fileCount", manifestFiles.length()).put("totalBytes", totalBytes)
                    putBytes(zip, "migration.json", (descriptor.toString(2) + "\n").toByteArray())
                }
            } ?: error("无法写入备份文件")
        } catch (error: Throwable) {
            if (!cleanupFailedDestination(destination, roots)) {
                error.addSuppressed(IllegalStateException("备份失败后的空目标文件未能自动清理"))
            }
            throw error
        } finally { password.fill('\u0000'); key?.fill(0) }
        return JSONObject().put("migrationId", migrationId).put("fileCount", manifestFiles.length()).put("totalBytes", totalBytes)
    }

    fun restorePackage(source: Uri, targetRoot: Uri, password: CharArray): JSONObject {
        val localZip = File.createTempFile("edu-restore-", ".zip", context.cacheDir)
        val stage = File(context.cacheDir, "edu-restore-${UUID.randomUUID()}").apply { mkdirs() }
        try {
            require(password.size >= 8) { "备份密码至少需要 8 个字符" }
            val target = requireNotNull(DocumentFile.fromTreeUri(context, targetRoot)) { "恢复目标目录不可用" }
            require(target.listFiles().isEmpty()) { "恢复目标目录必须为空，避免覆盖现有家庭资料" }
            context.contentResolver.openInputStream(source)?.use { input -> FileOutputStream(localZip).use { input.copyTo(it) } } ?: error("无法读取备份包")
            ZipFile(localZip).use { zip ->
                val names = zip.entries().asSequence().map { safePackagePath(it.name) }.toList()
                require(names.size == names.toSet().size) { "备份包包含重复文件" }
                val descriptor = JSONObject(readSmall(zip, "migration.json")); require(descriptor.getString("schema") == PACKAGE_SCHEMA) { "不支持的迁移包" }
                require(compareVersions(APP_VERSION, descriptor.getString("appVersion")) >= 0) { "备份来自更高版本，请先升级 APK" }
                val manifestBytes = readSmallBytes(zip, "manifest.json"); val checksum = readSmall(zip, "manifest.sha256").trim().substringBefore(' ')
                require(sha256(manifestBytes) == checksum) { "迁移包清单校验失败" }
                val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8)); require(manifest.getString("schema") == MANIFEST_SCHEMA && manifest.getString("migrationId") == descriptor.getString("migrationId")) { "迁移包清单结构无效" }
                val encryption = manifest.getJSONObject("encryption"); require(encryption.getString("kdf") == "scrypt" && encryption.getString("algorithm") == "aes-256-gcm") { "迁移包加密方式不受支持" }
                val salt = android.util.Base64.decode(encryption.getString("salt"), android.util.Base64.NO_WRAP); val key = deriveKey(password, salt)
                val entries = manifest.getJSONArray("files")
                require(stage.usableSpace >= descriptor.getLong("totalBytes") * 11 / 10) { "设备暂存空间不足，至少需要备份原始容量的 110%" }
                try {
                    for (index in 0 until entries.length()) decryptEntry(zip, entries.getJSONObject(index), key, stage)
                } finally { key.fill(0) }
                val roots = manifest.getJSONArray("roots").toObjects().associateBy { it.getString("originalUri") }
                remapStagedState(stage, roots, targetRoot.toString())
                val stateSnapshot = snapshotPrivateState()
                try {
                    restoreManagedFiles(stage, entries, targetRoot)
                    applyStagedState(stage)
                } catch (error: Throwable) {
                    restorePrivateSnapshot(stateSnapshot); throw error
                }
                val report = JSONObject().put("schema", "edu-manager.migration-report.v1").put("migrationId", manifest.getString("migrationId"))
                    .put("restoredAt", Timestamp.now()).put("fileCount", entries.length()).put("totalBytes", descriptor.getLong("totalBytes"))
                    .put("targetRootUri", targetRoot.toString()).put("agentReconfigurationRequired", true).put("oldSafGrantsReplaced", true)
                SafWorkspaceStore(context, targetRoot).writeBytesSafely(".edu-manager/migration-report.json", (report.toString(2) + "\n").toByteArray(), "application/json")
                return report
            }
        } finally { password.fill('\u0000'); localZip.delete(); stage.deleteRecursively() }
    }

    private fun collectRoots(): List<RootSpec> {
        val uris = linkedSetOf<String>(); SafRootGrant(context).currentRootUri()?.toString()?.let(uris::add)
        StudentIndexRepository(context).list().forEach { uris.add(it.storageRootUri) }
        ProjectRepository(context).list().forEach { uris.add(it.projectRootUri); uris.add(it.workspaceRootUri); uris.add(it.knowledgeRootUri) }
        return uris.filter(String::isNotBlank).mapIndexed { index, uri -> RootSpec("root-$index", uri, if (index == 0) "" else ".edu-manager/migrated-external/root-$index") }
    }

    private fun requireDestinationOutsideManagedRoots(destination: Uri, roots: List<RootSpec>) {
        val destinationId = runCatching { DocumentsContract.getDocumentId(destination) }.getOrNull() ?: return
        roots.forEach { root ->
            val rootUri = Uri.parse(root.originalUri)
            if (rootUri.authority != destination.authority) return@forEach
            val rootId = runCatching { DocumentsContract.getTreeDocumentId(rootUri) }.getOrNull() ?: return@forEach
            require(destinationId != rootId && !destinationId.startsWith("$rootId/")) {
                "迁移包不能保存在正在备份的资料根目录内，请选择下载目录或其他独立位置"
            }
        }
    }

    private fun cleanupFailedDestination(destination: Uri, roots: List<RootSpec>): Boolean {
        val resolver = context.contentResolver
        runCatching { resolver.openOutputStream(destination, "wt")?.use { } }
        if (runCatching { DocumentsContract.deleteDocument(resolver, destination) }.getOrDefault(false)) return true
        if (runCatching { resolver.delete(destination, null, null) > 0 }.getOrDefault(false)) return true
        val destinationId = runCatching { DocumentsContract.getDocumentId(destination) }.getOrNull() ?: return false
        for (root in roots) {
            val rootUri = Uri.parse(root.originalUri)
            if (rootUri.authority != destination.authority) continue
            val rootId = runCatching { DocumentsContract.getTreeDocumentId(rootUri) }.getOrNull() ?: continue
            if (destinationId == rootId || !destinationId.startsWith("$rootId/")) continue
            val segments = destinationId.removePrefix(rootId).trimStart('/').split('/').filter(String::isNotBlank)
            if (segments.isEmpty()) continue
            var parent = DocumentFile.fromTreeUri(context, rootUri) ?: continue
            for (segment in segments.dropLast(1)) parent = parent.findFile(segment) ?: return true
            val target = parent.findFile(segments.last()) ?: return true
            if (runCatching { target.delete() }.getOrDefault(false)) return true
        }
        return false
    }

    private fun collectSources(roots: List<RootSpec>): List<Source> {
        val output = mutableListOf<Source>()
        roots.forEach { root ->
            val document = requireNotNull(DocumentFile.fromTreeUri(context, Uri.parse(root.originalUri))) { "已授权资料根目录不可用" }
            walkDocument(document, "") { file, relative ->
                output += Source("managed", root.id, relative, child(root.destinationPrefix, relative), file.length()) { context.contentResolver.openInputStream(file.uri) ?: error("无法读取 $relative") }
            }
        }
        val stateRoot = File(context.filesDir, "education-manager-state")
        if (stateRoot.isDirectory) stateRoot.walkTopDown().filter { it.isFile && !it.name.endsWith(".bak") && !it.name.endsWith(".new") }.forEach { file ->
            val relative = file.relativeTo(stateRoot).invariantSeparatorsPath
            output += Source("state", "app-state", relative, relative, file.length()) { FileInputStream(file) }
        }
        return output
    }

    private fun walkDocument(directory: DocumentFile, prefix: String, accept: (DocumentFile, String) -> Unit) {
        directory.listFiles().sortedBy { it.name }.forEach { child ->
            val name = child.name?.trim().orEmpty(); require(name.isNotBlank() && name !in setOf(".", "..") && !name.contains('/')) { "资料目录包含不可迁移名称" }
            val relative = if (prefix.isBlank()) name else "$prefix/$name"
            if (child.isDirectory) walkDocument(child, relative, accept) else if (child.isFile) accept(child, relative)
        }
    }

    private fun encryptSource(source: Source, key: ByteArray): Encrypted {
        val temporary = File.createTempFile("edu-backup-", ".enc", context.cacheDir); val iv = ByteArray(12).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv)) }
        val digest = MessageDigest.getInstance("SHA-256"); var count = 0L
        source.open().use { input -> CipherOutputStream(FileOutputStream(temporary), cipher).use { output ->
            val buffer = ByteArray(64 * 1024); while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read); output.write(buffer, 0, read); count += read }
        } }
        require(source.expectedBytes < 0 || source.expectedBytes == count) { "备份期间源文件发生变化：${source.relativePath}" }
        val tag = ByteArray(16); RandomAccessFile(temporary, "rw").use { file -> require(file.length() >= tag.size); file.seek(file.length() - tag.size); file.readFully(tag); file.setLength(file.length() - tag.size) }
        return Encrypted(temporary, count, digest.digest().hex(), sha256(temporary), android.util.Base64.encodeToString(iv, android.util.Base64.NO_WRAP), android.util.Base64.encodeToString(tag, android.util.Base64.NO_WRAP))
    }

    private fun decryptEntry(zip: ZipFile, entry: JSONObject, key: ByteArray, stage: File) {
        val payload = safePackagePath(entry.getString("payloadRelativePath")); val zipEntry = requireNotNull(zip.getEntry(payload)) { "迁移包缺少 ${entry.getString("relativePath")}" }
        zip.getInputStream(zipEntry).use { require(sha256(it) == entry.getString("storedSha256")) { "迁移包载荷校验失败：${entry.getString("relativePath")}" } }
        val iv = android.util.Base64.decode(entry.getString("iv"), android.util.Base64.NO_WRAP); val tag = android.util.Base64.decode(entry.getString("authTag"), android.util.Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv)) }
        val target = safeStageFile(stage, "${entry.getString("category")}/${entry.getString("scopeId")}/${entry.getString("relativePath")}")
        target.parentFile?.mkdirs(); val digest = MessageDigest.getInstance("SHA-256"); var count = 0L
        val combined = SequenceInputStream(zip.getInputStream(zipEntry), ByteArrayInputStream(tag))
        CipherInputStream(combined, cipher).use { input -> FileOutputStream(target).use { output ->
            val buffer = ByteArray(64 * 1024); while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read); output.write(buffer, 0, read); count += read }
        } }
        require(count == entry.getLong("size") && digest.digest().hex() == entry.getString("sha256")) { "恢复文件原文校验失败：${entry.getString("relativePath")}" }
    }

    private fun restoreManagedFiles(stage: File, entries: JSONArray, targetRoot: Uri) {
        val store = SafWorkspaceStore(context, targetRoot)
        for (index in 0 until entries.length()) {
            val entry = entries.getJSONObject(index); if (entry.getString("category") != "managed") continue
            val source = safeStageFile(stage, "managed/${entry.getString("scopeId")}/${entry.getString("relativePath")}")
            store.writeStreamSafely(entry.getString("destinationRelativePath"), "application/octet-stream") { output -> source.inputStream().use { it.copyTo(output) } }
        }
    }

    private fun remapStagedState(stage: File, roots: Map<String, JSONObject>, targetUri: String) {
        val studentsFile = File(stage, "state/app-state/students.json"); val replacements = mutableListOf<Pair<String, String>>()
        if (studentsFile.isFile) {
            val students = JSONArray(studentsFile.readText())
            for (index in 0 until students.length()) {
                val student = students.getJSONObject(index); val root = roots[student.getString("storageRootUri")] ?: error("学生资料根目录不在迁移清单")
                val prefix = root.getString("destinationPrefix")
                for (key in listOf("rootPath", "rawPath", "summaryPath", "agentPath", "outputPath")) {
                    val old = student.optString(key); val next = child(prefix, old); if (old.isNotBlank() && old != next) replacements += old to next; student.put(key, next)
                }
                student.put("storageRootUri", targetUri).put("pathDialect", "android-saf-relative-v1")
            }
            studentsFile.writeText(students.toString(2))
        }
        val projectsFile = File(stage, "state/app-state/projects.json")
        if (projectsFile.isFile) {
            val root = JSONObject(projectsFile.readText()); val projects = root.getJSONArray("projects")
            for (index in 0 until projects.length()) {
                val project = projects.getJSONObject(index)
                val projectPrefix = roots[project.getString("projectRootUri")]?.getString("destinationPrefix") ?: error("项目根目录不在迁移清单")
                val knowledgePrefix = roots[project.getString("knowledgeRootUri")]?.getString("destinationPrefix") ?: error("项目知识根目录不在迁移清单")
                val pathGroups = mapOf(projectPrefix to listOf("projectRootPath", "managerPath", "workspacePath", "stagingPath", "agentPath", "outputPath"), knowledgePrefix to listOf("knowledgeRootPath", "rawPath", "conceptPath", "entityPath", "summaryPath", "qaPath", "synthesisPath", "reportPath", "contributionPath", "promotionPath"))
                pathGroups.forEach { (prefix, keys) -> keys.forEach { key -> val old = project.optString(key); val next = child(prefix, old); if (old.isNotBlank() && old != next) replacements += old to next; project.put(key, next) } }
                project.put("projectRootUri", targetUri).put("workspaceRootUri", targetUri).put("knowledgeRootUri", targetUri).put("pathDialect", "android-saf-relative-v1")
            }
            projectsFile.writeText(root.toString(2))
        }
        val assets = File(stage, "state/app-state/asset-index.json")
        if (assets.isFile && replacements.isNotEmpty()) { val value = JSONObject(assets.readText()); rewriteStrings(value, replacements.sortedByDescending { it.first.length }); assets.writeText(value.toString(2)) }
    }

    private fun rewriteStrings(value: Any?, replacements: List<Pair<String, String>>): Any? {
        when (value) {
            is JSONObject -> value.keys().forEach { key -> value.put(key, rewriteStrings(value.opt(key), replacements)) }
            is JSONArray -> for (index in 0 until value.length()) value.put(index, rewriteStrings(value.opt(index), replacements))
            is String -> replacements.firstOrNull { value == it.first || value.startsWith("${it.first}/") }?.let { return it.second + value.removePrefix(it.first) }
        }
        return value
    }

    private fun snapshotPrivateState(): Map<String, ByteArray> { val root = File(context.filesDir, "education-manager-state"); return if (!root.isDirectory) emptyMap() else root.walkTopDown().filter(File::isFile).associate { it.relativeTo(root).invariantSeparatorsPath to it.readBytes() } }
    private fun restorePrivateSnapshot(snapshot: Map<String, ByteArray>) { snapshot.forEach { (path, bytes) -> PrivateStateStore(context).writeBytes(path, bytes) } }
    private fun applyStagedState(stage: File) { val root = File(stage, "state/app-state"); if (root.isDirectory) root.walkTopDown().filter(File::isFile).forEach { PrivateStateStore(context).writeBytes(it.relativeTo(root).invariantSeparatorsPath, it.readBytes()) } }

    private fun deriveKey(password: CharArray, salt: ByteArray): ByteArray = SCrypt.generate(String(password).toByteArray(Charsets.UTF_8), salt, 16384, 8, 1, 32)
    private fun putBytes(zip: ZipOutputStream, name: String, bytes: ByteArray) { zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry() }
    private fun readSmall(zip: ZipFile, name: String) = readSmallBytes(zip, name).toString(Charsets.UTF_8)
    private fun readSmallBytes(zip: ZipFile, name: String): ByteArray { val entry = requireNotNull(zip.getEntry(name)) { "迁移包缺少 $name" }; require(entry.size in 0..5L * 1024 * 1024); return zip.getInputStream(entry).use { it.readBytes() } }
    private fun safePackagePath(value: String): String = value.replace('\\', '/').also { path -> require(path.isNotBlank() && !path.startsWith('/') && !Regex("^[A-Za-z]:").containsMatchIn(path) && path.split('/').none { it in setOf("", ".", "..") }) { "迁移包路径无效" } }
    private fun safeStageFile(root: File, relative: String): File { val target = File(root, safePackagePath(relative)).canonicalFile; require(target.path.startsWith(root.canonicalPath + File.separator)); return target }
    private fun child(prefix: String, path: String): String = when { prefix.isBlank() -> path; path.isBlank() -> prefix; else -> "$prefix/$path" }
    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).hex()
    private fun sha256(file: File) = FileInputStream(file).use { sha256(it) }
    private fun sha256(input: InputStream): String { val digest = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(64 * 1024); while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read) }; return digest.digest().hex() }
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
    private fun compareVersions(left: String, right: String): Int { val a = left.split(Regex("[.+-]")).map { it.toIntOrNull() ?: 0 }; val b = right.split(Regex("[.+-]")).map { it.toIntOrNull() ?: 0 }; for (index in 0 until maxOf(a.size, b.size)) { val value = (a.getOrNull(index) ?: 0).compareTo(b.getOrNull(index) ?: 0); if (value != 0) return value }; return 0 }

    private data class RootSpec(val id: String, val originalUri: String, val destinationPrefix: String) { fun toJson() = JSONObject().put("id", id).put("originalUri", originalUri).put("destinationPrefix", destinationPrefix) }
    private data class Source(val category: String, val scopeId: String, val relativePath: String, val destinationRelativePath: String, val expectedBytes: Long, val open: () -> InputStream)
    private data class Encrypted(val file: File, val plainBytes: Long, val plainSha256: String, val storedSha256: String, val iv: String, val authTag: String)

    companion object { const val PACKAGE_SCHEMA = "edu-manager.migration-package.v1"; const val MANIFEST_SCHEMA = "edu-manager.migration-manifest.v1"; const val APP_VERSION = "1.0.0" }
}
