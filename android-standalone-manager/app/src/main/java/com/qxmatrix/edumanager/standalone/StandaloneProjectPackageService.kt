package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/**
 * Explicit, offline project transfer for the standalone edition.
 *
 * A package is a user-selected SAF directory. It contains immutable payload files plus a
 * hash-protected manifest. Import remaps provider URIs and known project paths while retaining
 * project/material identities and versions. It never creates background synchronization.
 */
class StandaloneProjectPackageService(private val context: Context) {
    private val projects = ProjectRepository(context)
    private val students = StudentIndexRepository(context)

    data class ExportResult(val packageId: String, val files: Int, val bytes: Long, val projectName: String)
    data class ImportResult(
        val project: ProjectRecord,
        val files: Int,
        val bytes: Long,
        val mappedStudents: Int,
        val unresolvedStudents: List<String>,
        val resumed: Boolean,
    )

    @Synchronized
    fun exportProject(projectId: String, destinationRootUri: Uri): ExportResult {
        val project = projects.requireExact(projectId)
        require(project.materialMigrationState != "running") { "历史资料迁移中，暂不能导出项目包" }
        val destination = SafWorkspaceStore(context, destinationRootUri)
        require(destination.listRoot().isEmpty()) { "请选择一个空目录作为项目包目录" }

        val packageId = "project-package-${UUID.randomUUID()}"
        val targetPaths = ProjectPaths.managed(project.name)
        val sources = buildExportSources(project, targetPaths)
        require(sources.isNotEmpty()) { "项目目录中没有可导出的文件" }
        require(sources.size <= MAX_FILES) { "项目文件超过单个项目包上限 $MAX_FILES 项" }

        val files = JSONArray()
        var totalBytes = 0L
        sources.forEachIndexed { index, source ->
            val payloadPath = "payload/${(index + 1).toString().padStart(6, '0')}.bin"
            val expected = source.bytes?.let(::fingerprint) ?: fingerprint(source.store!!, source.relativePath!!)
            require(totalBytes <= MAX_BYTES - expected.second) { "项目包超过 ${MAX_BYTES / (1024 * 1024 * 1024)}GiB 安全上限" }
            if (source.bytes != null) {
                destination.writeStreamNewSafely(payloadPath, "application/octet-stream") { it.write(source.bytes) }
            } else {
                destination.writeStreamNewSafely(payloadPath, "application/octet-stream") { output ->
                    source.store!!.openInputStream(source.relativePath!!).use { input -> input.copyTo(output, COPY_BUFFER) }
                }
            }
            val published = fingerprint(destination, payloadPath)
            require(published == expected) { "项目包写入后校验失败：${source.targetRelativePath}" }
            totalBytes += expected.second
            files.put(JSONObject().put("payloadRelativePath", payloadPath)
                .put("targetRelativePath", source.targetRelativePath).put("sha256", expected.first)
                .put("size", expected.second).put("sourceRole", source.role))
        }

        val projectBytes = (project.toJson().toString(2) + "\n").toByteArray()
        destination.writeStreamNewSafely(PROJECT_RECORD, "application/json") { it.write(projectBytes) }
        val manifest = JSONObject().put("schema", SCHEMA).put("packageId", packageId)
            .put("createdAt", Timestamp.now()).put("projectId", project.id).put("projectName", project.name)
            .put("projectRecordSha256", fingerprint(projectBytes).first).put("files", files)
            .put("fileCount", files.length()).put("totalBytes", totalBytes)
            .put("identityPolicy", "retain-project-and-material-identities-remap-saf-and-students")
            .put("excludes", JSONArray(listOf("Agent API Key", "Android Keystore", "目录授权", "激活码", "设备码")))
        val manifestBytes = (manifest.toString(2) + "\n").toByteArray()
        destination.writeStreamNewSafely(MANIFEST, "application/json") { it.write(manifestBytes) }
        destination.writeStreamNewSafely(MANIFEST_HASH, "text/plain") {
            it.write((fingerprint(manifestBytes).first + "\n").toByteArray())
        }
        return ExportResult(packageId, files.length(), totalBytes, project.name)
    }

    @Synchronized
    fun inspectPackage(sourceRootUri: Uri): JSONObject {
        val source = SafWorkspaceStore(context, sourceRootUri)
        val manifestBytes = source.readBytes(MANIFEST)
        val expectedManifestHash = source.readBytes(MANIFEST_HASH).toString(Charsets.UTF_8).trim().lowercase()
        require(expectedManifestHash.matches(Regex("[0-9a-f]{64}"))) { "项目包清单校验值无效" }
        require(fingerprint(manifestBytes).first == expectedManifestHash) { "项目包清单已损坏或被修改" }
        val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8))
        require(manifest.optString("schema") == SCHEMA) { "不支持的项目包格式" }
        val projectBytes = source.readBytes(PROJECT_RECORD)
        require(fingerprint(projectBytes).first == manifest.getString("projectRecordSha256")) { "项目记录已损坏或被修改" }
        val original = ProjectRecord.fromJson(JSONObject(projectBytes.toString(Charsets.UTF_8)))
        require(original.id == manifest.getString("projectId") && original.name == manifest.getString("projectName")) { "项目包身份不一致" }
        val entries = validatedEntries(manifest)
        return JSONObject().put("packageId", manifest.getString("packageId")).put("projectId", original.id)
            .put("projectName", original.name).put("fileCount", entries.size)
            .put("totalBytes", manifest.optLong("totalBytes")).put("createdAt", manifest.optString("createdAt"))
    }

    @Synchronized
    fun importProject(sourceRootUri: Uri, destinationRootUri: Uri): ImportResult {
        require(sourceRootUri != destinationRootUri) { "项目包目录不能同时作为导入目标" }
        val source = SafWorkspaceStore(context, sourceRootUri)
        val manifestBytes = source.readBytes(MANIFEST)
        val expectedManifestHash = source.readBytes(MANIFEST_HASH).toString(Charsets.UTF_8).trim().lowercase()
        require(expectedManifestHash.matches(Regex("[0-9a-f]{64}")) && fingerprint(manifestBytes).first == expectedManifestHash) {
            "项目包清单已损坏或被修改"
        }
        val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8))
        require(manifest.optString("schema") == SCHEMA) { "不支持的项目包格式" }
        val projectBytes = source.readBytes(PROJECT_RECORD)
        require(fingerprint(projectBytes).first == manifest.getString("projectRecordSha256")) { "项目记录已损坏或被修改" }
        val original = ProjectRecord.fromJson(JSONObject(projectBytes.toString(Charsets.UTF_8)))
        require(original.id == manifest.getString("projectId") && original.name == manifest.getString("projectName")) { "项目包身份不一致" }
        val entries = validatedEntries(manifest)
        val destination = SafWorkspaceStore(context, destinationRootUri)
        val paths = ProjectPaths.managed(original.name)
        entries.forEach { entry -> require(entry.targetRelativePath == paths.projectRootPath || entry.targetRelativePath.startsWith("${paths.projectRootPath}/")) {
            "项目包包含目标项目范围外的路径"
        } }

        val existingById = projects.list().singleOrNull { it.id == original.id }
        if (existingById != null) {
            require(existingById.projectRootUri == destinationRootUri.toString()) { "相同项目 ID 已在其他目录中存在" }
            return ImportResult(existingById, entries.size, manifest.optLong("totalBytes"), existingById.studentIds.size, emptyList(), resumed = true)
        }
        require(projects.list().none { it.name == original.name }) { "同名学习项目已存在" }

        val markerPath = "${paths.managerPath}/project-package-import.json"
        val resumed = destination.exists(paths.projectRootPath)
        if (resumed) {
            require(destination.exists(markerPath)) { "同名项目目录已存在且不是可续传的教育管家导入" }
            val marker = JSONObject(destination.readBytes(markerPath).toString(Charsets.UTF_8))
            require(marker.optString("packageId") == manifest.getString("packageId") && marker.optString("state") != "complete") {
                "同名项目目录属于其他导入任务"
            }
        } else {
            destination.writeBytesSafely(markerPath, (JSONObject().put("schema", IMPORT_SCHEMA)
                .put("packageId", manifest.getString("packageId")).put("projectId", original.id)
                .put("state", "copying").put("startedAt", Timestamp.now()).toString(2) + "\n").toByteArray(), "application/json")
        }

        var copiedBytes = 0L
        entries.forEach { entry ->
            val sourceFingerprint = fingerprint(source, entry.payloadRelativePath)
            require(sourceFingerprint.first == entry.sha256 && sourceFingerprint.second == entry.size) {
                "项目包文件校验失败：${entry.targetRelativePath}"
            }
            if (destination.exists(entry.targetRelativePath)) {
                require(fingerprint(destination, entry.targetRelativePath) == sourceFingerprint) {
                    "导入目标存在异字节文件，已停止且未覆盖：${entry.targetRelativePath}"
                }
            } else {
                destination.writeStreamNewSafely(entry.targetRelativePath, "application/octet-stream") { output ->
                    source.openInputStream(entry.payloadRelativePath).use { input -> input.copyTo(output, COPY_BUFFER) }
                }
                require(fingerprint(destination, entry.targetRelativePath) == sourceFingerprint) {
                    "导入后校验失败：${entry.targetRelativePath}"
                }
            }
            copiedBytes += entry.size
        }

        ensureManagedKnowledgeIndexes(destination, original, paths)
        val mapping = mapStudents(original)
        val imported = original.copy(
            studentIds = mapping.first.map { it.id }, studentNames = mapping.first.map { it.name },
            projectRootUri = destinationRootUri.toString(), knowledgeRootUri = destinationRootUri.toString(),
            workspaceRootUri = destinationRootUri.toString(), workspaceMode = "managed", knowledgeMode = "managed",
            knowledgeSpaceId = "", paths = paths, knowledgeAdoption = null,
            materialStorageMode = "workspace-v1",
            materialMigrationState = if (original.materialMigrationState == "complete") "complete" else "partial",
        )
        val completedMarker = JSONObject().put("schema", IMPORT_SCHEMA).put("packageId", manifest.getString("packageId"))
            .put("projectId", imported.id).put("state", "complete").put("completedAt", Timestamp.now())
            .put("studentMappings", JSONArray().also { array -> mapping.first.forEach { student ->
                array.put(JSONObject().put("studentId", student.id).put("studentName", student.name))
            } }).put("unresolvedStudents", JSONArray(mapping.second))
        projects.addImportedIdempotent(imported)
        destination.writeBytesSafely(markerPath, (completedMarker.toString(2) + "\n").toByteArray(), "application/json")
        return ImportResult(imported, entries.size, copiedBytes, mapping.first.size, mapping.second, resumed)
    }

    private fun buildExportSources(project: ProjectRecord, target: ProjectPaths): List<ExportSource> {
        val control = SafWorkspaceStore(context, Uri.parse(project.projectRootUri))
        val output = linkedMapOf<String, ExportSource>()
        fun addTree(store: SafWorkspaceStore, sourceRoot: String, targetRoot: String, role: String) {
            if (sourceRoot.isBlank()) return
            store.listFiles(sourceRoot, MAX_FILES + 1, 32, includeHidden = true).forEach { file ->
                val suffix = file.relativePath.removePrefix(sourceRoot).trimStart('/')
                if (suffix.isBlank()) return@forEach
                val destination = if (suffix.isBlank()) targetRoot else "$targetRoot/$suffix"
                if (destination == "${target.managerPath}/project-package-import.json") return@forEach
                if (destination == "${target.managerPath}/project-materials/registry.json") return@forEach
                require(!output.containsKey(destination)) { "项目内存在无法唯一映射的文件：$destination" }
                output[destination] = ExportSource(store, file.relativePath, destination, role)
            }
        }
        addTree(control, project.paths.projectRootPath, target.projectRootPath, "project-control")
        if (project.knowledgeMode == "adopted") {
            val knowledge = SafWorkspaceStore(context, Uri.parse(project.knowledgeRootUri))
            listOf(
                Triple(project.paths.rawPath, target.rawPath, "raw"), Triple(project.paths.conceptPath, target.conceptPath, "concept"),
                Triple(project.paths.entityPath, target.entityPath, "entity"), Triple(project.paths.summaryPath, target.summaryPath, "summary"),
                Triple(project.paths.qaPath, target.qaPath, "qa"), Triple(project.paths.synthesisPath, target.synthesisPath, "synthesis"),
                Triple(project.paths.reportPath, target.reportPath, "report"), Triple(project.paths.contributionPath, target.contributionPath, "contribution"),
            ).forEach { (sourceRoot, targetRoot, role) -> addTree(knowledge, sourceRoot, targetRoot, role) }
        }
        val registrySource = "${project.paths.managerPath}/project-materials/registry.json"
        if (control.exists(registrySource)) {
            val registry = JSONObject(control.readBytes(registrySource).toString(Charsets.UTF_8))
            val rewritten = rewritePaths(registry, pathMappings(project.paths, target)) as JSONObject
            val bytes = (rewritten.toString(2) + "\n").toByteArray()
            val destination = "${target.managerPath}/project-materials/registry.json"
            output[destination] = ExportSource(null, null, destination, "material-registry", bytes)
        }
        return output.values.toList().also { require(it.size <= MAX_FILES) { "项目文件超过单个项目包上限 $MAX_FILES 项" } }
    }

    private fun pathMappings(source: ProjectPaths, target: ProjectPaths): List<Pair<String, String>> = listOf(
        source.projectRootPath to target.projectRootPath, source.knowledgeRootPath to target.knowledgeRootPath,
        source.rawPath to target.rawPath, source.conceptPath to target.conceptPath, source.entityPath to target.entityPath,
        source.summaryPath to target.summaryPath, source.qaPath to target.qaPath, source.synthesisPath to target.synthesisPath,
        source.reportPath to target.reportPath, source.contributionPath to target.contributionPath,
    ).filter { it.first.isNotBlank() }.distinctBy { it.first }.sortedByDescending { it.first.length }

    private fun rewritePaths(value: Any?, mappings: List<Pair<String, String>>): Any? = when (value) {
        is JSONObject -> JSONObject().also { output -> value.keys().forEach { key -> output.put(key, rewritePaths(value.opt(key), mappings)) } }
        is JSONArray -> JSONArray().also { output -> for (index in 0 until value.length()) output.put(rewritePaths(value.opt(index), mappings)) }
        is String -> mappings.firstNotNullOfOrNull { (source, target) ->
            when { value == source -> target; value.startsWith("$source/") -> target + value.removePrefix(source); else -> null }
        } ?: value
        else -> value
    }

    private fun validatedEntries(manifest: JSONObject): List<PackageEntry> {
        val files = manifest.getJSONArray("files")
        require(files.length() in 1..MAX_FILES) { "项目包文件数量无效" }
        val payloads = mutableSetOf<String>(); val targets = mutableSetOf<String>(); var total = 0L
        val entries = (0 until files.length()).map { index ->
            val item = files.getJSONObject(index)
            val payload = normalizedPath(item.getString("payloadRelativePath"))
            val target = normalizedPath(item.getString("targetRelativePath"))
            val hash = item.getString("sha256").lowercase(); val size = item.getLong("size")
            require(payload.startsWith("payload/") && hash.matches(Regex("[0-9a-f]{64}")) && size >= 0L) { "项目包文件清单无效" }
            require(payloads.add(payload) && targets.add(target)) { "项目包包含重复文件映射" }
            require(total <= MAX_BYTES - size) { "项目包超过安全容量上限" }; total += size
            PackageEntry(payload, target, hash, size)
        }
        require(total == manifest.getLong("totalBytes")) { "项目包总容量与清单不一致" }
        return entries
    }

    private fun normalizedPath(value: String) = WorkspacePath.segments(value).joinToString("/").also {
        require(it == value.replace('\\', '/')) { "项目包路径未规范化" }
    }

    private fun mapStudents(project: ProjectRecord): Pair<List<StudentRecord>, List<String>> {
        val available = students.list(); val mapped = linkedMapOf<String, StudentRecord>(); val unresolved = mutableListOf<String>()
        project.studentIds.forEachIndexed { index, oldId ->
            val name = project.studentNames.getOrNull(index).orEmpty()
            val direct = available.singleOrNull { it.id == oldId }
            val byName = available.filter { it.name == name }
            val resolved = direct ?: byName.singleOrNull()
            if (resolved != null) mapped[resolved.id] = resolved else unresolved += name.ifBlank { oldId }
        }
        return mapped.values.toList() to unresolved
    }

    private fun ensureManagedKnowledgeIndexes(store: SafWorkspaceStore, original: ProjectRecord, paths: ProjectPaths) {
        listOf(paths.workspacePath, paths.stagingPath, paths.knowledgeRootPath, paths.rawPath, paths.conceptPath, paths.entityPath,
            paths.summaryPath, paths.qaPath, paths.synthesisPath, paths.reportPath, paths.contributionPath).forEach(store::ensureDirectory)
        if (!store.exists("${paths.knowledgeRootPath}/index.md")) store.writeBytesSafely("${paths.knowledgeRootPath}/index.md",
            "# ${original.name} 项目知识空间\n\n本项目由显式项目包导入；项目身份和资料版本保持，目录授权已重映射到本机。\n".toByteArray(), "text/markdown")
        if (!store.exists("${paths.knowledgeRootPath}/log.md")) store.writeBytesSafely("${paths.knowledgeRootPath}/log.md",
            "# ${original.name} 项目处理日志\n\n".toByteArray(), "text/markdown")
    }

    private fun fingerprint(store: SafWorkspaceStore, path: String): Pair<String, Long> {
        val digest = MessageDigest.getInstance("SHA-256"); var size = 0L
        store.openInputStream(path).use { input ->
            val buffer = ByteArray(COPY_BUFFER)
            while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read); size += read }
        }
        return digest.digest().hex() to size
    }
    private fun fingerprint(bytes: ByteArray): Pair<String, Long> =
        MessageDigest.getInstance("SHA-256").digest(bytes).hex() to bytes.size.toLong()
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

    private data class ExportSource(
        val store: SafWorkspaceStore?, val relativePath: String?, val targetRelativePath: String,
        val role: String, val bytes: ByteArray? = null,
    )
    private data class PackageEntry(val payloadRelativePath: String, val targetRelativePath: String, val sha256: String, val size: Long)

    companion object {
        const val SCHEMA = "edu-manager.android-project-package.v1"
        const val IMPORT_SCHEMA = "edu-manager.android-project-package-import.v1"
        const val MAX_FILES = 20_000
        const val MAX_BYTES = 8L * 1024 * 1024 * 1024
        private const val COPY_BUFFER = 128 * 1024
        private const val MANIFEST = "manifest.json"
        private const val MANIFEST_HASH = "manifest.sha256"
        private const val PROJECT_RECORD = "project.json"
    }
}
