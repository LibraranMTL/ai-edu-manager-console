package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/**
 * Local-authority project material service for the standalone Android edition.
 * Files stay inside user-authorized SAF trees; JSON records hold identity and workflow state.
 */
class LocalProjectMaterialService(private val context: Context) {
    private val projects = ProjectRepository(context)

    data class ScanResult(val added: Int, val updated: Int, val unchanged: Int, val unavailable: Int, val truncated: Boolean)

    fun categories(projectId: String): LinkedHashMap<String, String> = categories(projects.requireExact(projectId))
    private fun categories(project: ProjectRecord): LinkedHashMap<String, String> = WorkspaceCategoryPolicy.categories(
        controlStore(project).listDirectory(project.paths.workspacePath).filter { it.isDirectory }.mapNotNull { it.name })

    @Synchronized fun status(projectId: String): JSONObject {
        val project = projects.requireExact(projectId)
        val registry = readRegistry(project)
        val materials = registry.getJSONArray("materials")
        val categoryIds = categories(project).keys
        var pending = 0; var unavailable = 0; var digestPending = 0
        for (index in 0 until materials.length()) {
            val item = materials.getJSONObject(index)
            if (WorkspaceCategoryPolicy.needsOrganization(item, categoryIds)) pending++
            if (item.optJSONObject("processing")?.optString("state") in setOf("pending", "failed")) digestPending++
            if (item.optString("availability", "available") != "available") unavailable++
        }
        val operations = registry.optJSONArray("operations")
        val lastOperation = if (operations != null && operations.length() > 0) {
            operations.optJSONObject(operations.length() - 1)
        } else JSONObject.NULL
        return JSONObject().put("projectId", project.id).put("storageMode", project.materialStorageMode)
            .put("migrationState", project.materialMigrationState).put("revision", registry.optInt("revision"))
            .put("materials", materials.length()).put("pending", pending).put("digestPending", digestPending).put("unavailable", unavailable)
            .put("organizationEnabled", registry.optJSONObject("organization")?.optBoolean("enabled", false) == true)
            .put("lastOperation", lastOperation)
    }

    @Synchronized fun rebindControlRoot(projectId: String, rootUri: Uri): ProjectRecord {
        val project = projects.requireExact(projectId)
        require(project.materialMigrationState != "running") { "历史资料迁移中，不能更换目录授权" }
        val store = SafWorkspaceStore(context, rootUri)
        require(store.exists(project.paths.projectRootPath) && store.exists(project.paths.workspacePath) && store.exists(project.paths.agentPath)) {
            "所选目录中未找到该项目的控制目录、工作空间或AGENT.md"
        }
        val registry = registryPath(project)
        if (store.exists(registry)) {
            val parsed = JSONObject(store.readBytes(registry).toString(Charsets.UTF_8))
            require(parsed.optString("schema") == LocalProjectMaterialPolicy.SCHEMA && parsed.optString("projectId") == project.id) {
                "所选目录中的项目资料登记身份不匹配"
            }
        }
        val uri = rootUri.toString()
        val updated = project.copy(projectRootUri = uri, workspaceRootUri = uri,
            knowledgeRootUri = if (project.knowledgeMode == "managed") uri else project.knowledgeRootUri)
        projects.update(updated); return updated
    }

    @Synchronized fun rebindAdoptedKnowledgeRoot(projectId: String, rootUri: Uri): ProjectRecord {
        val project = projects.requireExact(projectId)
        require(project.knowledgeMode == "adopted") { "本项目知识空间与控制目录使用同一授权，无需单独修复" }
        require(project.materialMigrationState != "running") { "历史资料迁移中，不能更换目录授权" }
        val store = SafWorkspaceStore(context, rootUri)
        val required = listOf(project.paths.rawPath, project.paths.conceptPath, project.paths.entityPath,
            project.paths.summaryPath, project.paths.qaPath, project.paths.synthesisPath).filter(String::isNotBlank)
        require(required.all(store::exists)) { "所选目录不包含该项目原有的完整知识Schema" }
        val updated = project.copy(knowledgeRootUri = rootUri.toString())
        projects.update(updated); return updated
    }

    @Synchronized fun list(projectId: String, view: String = "materials", search: String = ""): List<JSONObject> {
        val project = projects.requireExact(projectId)
        val registry = readRegistry(project)
        val categoryIds = categories(project).keys
        val query = search.trim().lowercase()
        return registry.getJSONArray("materials").objects().filter { item ->
            val pending = WorkspaceCategoryPolicy.needsOrganization(item, categoryIds)
            (view != "pending" || pending) && (query.isBlank() || item.optString("title").lowercase().contains(query)
                || item.optJSONObject("location")?.optString("relativePath").orEmpty().lowercase().contains(query))
        }.sortedByDescending { it.optString("updatedAt") }
    }

    @Synchronized fun scanWorkspace(projectId: String): ScanResult {
        val project = projects.requireExact(projectId)
        require(project.status !in setOf("sealed", "archived")) { "项目当前只读" }
        require(project.materialMigrationState != "running") { "历史资料迁移中，扫描暂缓" }
        val store = controlStore(project)
        require(store.exists(project.paths.workspacePath)) { "项目工作空间不可用，请重新授权原目录" }
        val files = store.listFiles(project.paths.workspacePath,
            LocalProjectMaterialPolicy.MAX_SCAN_FILES + 1, maximumDepth = 24)
            .filterNot { it.relativePath == "${project.paths.workspacePath}/工作空间结构.md" }
        val selected = files.take(LocalProjectMaterialPolicy.MAX_SCAN_FILES)
        val registry = readRegistry(project)
        val actualCategories = categories(project)
        var added = 0; var updated = 0; var unchanged = 0
        selected.forEach { file ->
            val observed = fingerprint(store, file.relativePath)
            when (register(registry, "workspace", file.relativePath, observed.first, observed.second,
                "workspace_scan", "workspace-scan:${file.relativePath}:${observed.first}")) {
                "added" -> added++
                "updated" -> updated++
                else -> unchanged++
            }
            WorkspaceCategoryPolicy.categoryAt(file.relativePath, project.paths.workspacePath, actualCategories)?.let { category ->
                val item = registry.getJSONArray("materials").objects().single {
                    it.getJSONObject("location").optString("rootId") == "workspace" &&
                        it.getJSONObject("location").optString("relativePath") == file.relativePath
                }
                if (WorkspaceCategoryPolicy.adoptExplicitDirectory(item, category))
                    item.put("recordRevision", item.optInt("recordRevision") + 1).put("updatedAt", Timestamp.now())
            }
        }
        val truncated = files.size > LocalProjectMaterialPolicy.MAX_SCAN_FILES
        var unavailable = 0
        if (!truncated) {
            val seen = selected.map { it.relativePath }.toHashSet()
            registry.getJSONArray("materials").objects().filter { item ->
                val location = item.optJSONObject("location")
                location?.optString("rootId") == "workspace" && location.optString("relativePath").startsWith("${project.paths.workspacePath}/")
            }.forEach { item ->
                val location = item.getJSONObject("location").getString("relativePath")
                if (location !in seen && item.optString("availability", "available") == "available") {
                    item.put("availability", "missing").put("availabilityReason", "完整扫描未在登记位置发现原件")
                        .put("updatedAt", Timestamp.now()); unavailable++
                }
            }
        }
        registry.put("lastScan", JSONObject().put("at", Timestamp.now()).put("files", selected.size)
            .put("coverage", if (truncated) "partial" else "complete").put("truncated", truncated).put("unavailable", unavailable))
        writeRegistry(project, registry)
        return ScanResult(added, updated, unchanged, unavailable, truncated)
    }

    @Synchronized fun importUri(projectId: String, sourceUri: Uri, displayName: String, mimeType: String = "application/octet-stream"): JSONObject {
        val project = projects.requireExact(projectId)
        require(project.materialStorageMode == "workspace-v1") { "旧项目须先完成受控迁移预览" }
        require(project.status !in setOf("sealed", "archived") && project.materialMigrationState != "running") { "项目当前不可写" }
        val store = controlStore(project)
        val directory = "${project.paths.workspacePath}/收件箱"
        store.ensureDirectory(directory)
        val target = uniquePath(store, directory, LocalProjectMaterialPolicy.safeFilename(displayName))
        val digest = MessageDigest.getInstance("SHA-256"); var size = 0L
        store.writeStreamNewSafely(target, mimeType.ifBlank { "application/octet-stream" }) { output ->
            context.contentResolver.openInputStream(sourceUri)?.use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer); if (read < 0) break
                    output.write(buffer, 0, read); digest.update(buffer, 0, read); size += read
                }
            } ?: error("无法读取所选资料")
        }
        val sha256 = digest.digest().hex()
        val checked = fingerprint(store, target)
        require(checked.first == sha256 && checked.second == size) { "导入后字节校验失败" }
        val registry = readRegistry(project)
        register(registry, "workspace", target, sha256, size, "local_import",
            "local-import:${UUID.randomUUID()}")
        writeRegistry(project, registry)
        return registry.getJSONArray("materials").objects().single { it.getJSONObject("location").getString("relativePath") == target }
    }

    @Synchronized fun relinkMissingFromUri(projectId: String, materialId: String, sourceUri: Uri,
                                            displayName: String, mimeType: String = "application/octet-stream"): JSONObject {
        val project = projects.requireExact(projectId); requireWritable(project)
        val registry = readRegistry(project); val item = material(registry, materialId)
        require(item.optString("availability", "available") != "available") { "当前登记位置仍可用，无需重新定位" }
        val digest = MessageDigest.getInstance("SHA-256"); var size = 0L
        val directory = "${project.paths.workspacePath}/收件箱/重新定位"
        val target = uniquePath(controlStore(project), directory, LocalProjectMaterialPolicy.safeFilename(displayName))
        controlStore(project).writeStreamNewSafely(target, mimeType.ifBlank { "application/octet-stream" }) { output ->
            context.contentResolver.openInputStream(sourceUri)?.use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) { val read = input.read(buffer); if (read < 0) break
                    output.write(buffer, 0, read); digest.update(buffer, 0, read); size += read }
            } ?: error("无法读取所选文件")
        }
        val hash = digest.digest().hex()
        if (hash != item.getString("sha256") || size != item.getLong("size")) {
            runCatching { controlStore(project).deleteFileIfExists(target) }
            error("所选文件与资料当前版本字节不一致，未重新绑定")
        }
        val old = item.getJSONObject("location")
        item.getJSONArray("legacyAliases").put(JSONObject(old.toString()).put("movedAt", Timestamp.now()).put("reason", "same_bytes_relink"))
        item.put("location", JSONObject().put("rootId", "workspace").put("relativePath", target))
            .put("availability", "available").put("availabilityReason", "")
            .put("recordRevision", item.optInt("recordRevision") + 1).put("updatedAt", Timestamp.now())
        addSource(item, "same_bytes_relink", "relink:${UUID.randomUUID()}")
        writeRegistry(project, registry); return JSONObject(item.toString())
    }

    @Synchronized fun suggestClassifications(projectId: String): Int {
        val project = projects.requireExact(projectId); val registry = readRegistry(project)
        requireWritable(project)
        val actualCategories = categories(project)
        var changed = 0
        registry.getJSONArray("materials").objects().forEach { item ->
            val classification = item.getJSONObject("classification")
            if (!classification.optBoolean("manualLocked") && classification.optString("categoryId").isBlank()) {
                val relative = item.getJSONObject("location").getString("relativePath").removePrefix("${project.paths.workspacePath}/")
                LocalProjectMaterialPolicy.suggestedCategory(relative)?.let { category ->
                    val matches = actualCategories.filter { LocalProjectMaterialPolicy.suggestedCategory(it.value) == category }
                    val actualId = matches.keys.singleOrNull() ?: return@let
                    classification.put("suggestedCategoryId", actualId).put("suggestionReason", "依据文件名匹配唯一实际工作空间类别；人工确认前不移动原件。")
                    item.put("recordRevision", item.optInt("recordRevision") + 1).put("updatedAt", Timestamp.now()); changed++
                }
            }
        }
        if (changed > 0) writeRegistry(project, registry)
        return changed
    }

    /** Reversible logical categorization. Originals stay in place until separate organization consent. */
    @Synchronized fun autoClassify(projectId: String): Int {
        val project = projects.requireExact(projectId); requireWritable(project)
        val registry = readRegistry(project); val actual = categories(project); val store = controlStore(project)
        var changed = 0
        registry.getJSONArray("materials").objects().forEach { item ->
            if (changed >= LocalProjectMaterialPolicy.MAX_BATCH) return@forEach
            val classification = item.optJSONObject("classification") ?: return@forEach
            val location = item.optJSONObject("location") ?: return@forEach
            if (classification.optBoolean("manualLocked") || classification.optString("categoryId").isNotBlank() ||
                item.optString("adoption") != "accepted" || item.optString("availability") != "available" ||
                location.optString("rootId") != "workspace") return@forEach
            val relative = location.optString("relativePath")
            val choice = LocalProjectMaterialPolicy.automaticCategory(item.optString("title"), actual) ?: return@forEach
            if (relative.isBlank() || item.optString("sha256").isBlank() ||
                runCatching { fingerprint(store, relative).first }.getOrNull() != item.optString("sha256")) return@forEach
            classification.put("categoryId", choice.first).put("source", "automatic_rule")
                .put("status", "auto_provisional").put("manualLocked", false).put("suggestedCategoryId", "")
                .put("suggestionReason", choice.second).put("classifiedAt", Timestamp.now())
            item.put("organizationState", "classified").put("recordRevision", item.optInt("recordRevision") + 1)
                .put("updatedAt", Timestamp.now()); changed++
        }
        if (changed > 0) writeRegistry(project, registry)
        return changed
    }

    @Synchronized fun classify(projectId: String, materialId: String, categoryId: String) {
        val project = projects.requireExact(projectId); requireWritable(project)
        require(categoryId in categories(project)) { "工作空间中不存在该分类文件夹，请刷新分类" }
        val registry = readRegistry(project); val item = material(registry, materialId)
        item.getJSONObject("classification").put("categoryId", categoryId).put("source", "human")
            .put("manualLocked", true).put("status", "user_classified").put("suggestedCategoryId", "")
        item.put("organizationState", "classified").put("recordRevision", item.optInt("recordRevision") + 1)
            .put("updatedAt", Timestamp.now())
        writeRegistry(project, registry)
    }

    @Synchronized fun acceptSuggestedClassifications(projectId: String, materialIds: Set<String>): JSONObject {
        require(materialIds.isNotEmpty() && materialIds.size <= LocalProjectMaterialPolicy.MAX_BATCH) { "批量确认须选择1到${LocalProjectMaterialPolicy.MAX_BATCH}项" }
        val project = projects.requireExact(projectId); requireWritable(project)
        val registry = readRegistry(project); val results = JSONArray(); var succeeded = 0; var skipped = 0
        val actualCategories = categories(project)
        materialIds.forEach { materialId ->
            val item = material(registry, materialId); val classification = item.getJSONObject("classification")
            val suggestion = classification.optString("suggestedCategoryId")
            val result = JSONObject().put("materialId", materialId)
            if (classification.optBoolean("manualLocked") || suggestion !in actualCategories) {
                result.put("status", "skipped").put("message", "建议不存在或已有人工分类"); skipped++
            } else {
                classification.put("categoryId", suggestion).put("source", "human_batch_confirmation")
                    .put("manualLocked", true).put("status", "user_classified").put("suggestedCategoryId", "")
                item.put("organizationState", "classified").put("recordRevision", item.optInt("recordRevision") + 1)
                    .put("updatedAt", Timestamp.now())
                result.put("status", "succeeded").put("categoryId", suggestion); succeeded++
            }
            results.put(result)
        }
        writeRegistry(project, registry)
        return JSONObject().put("succeeded", succeeded).put("skipped", skipped).put("results", results)
    }

    @Synchronized fun configureOrganization(projectId: String, enabled: Boolean) {
        val project = projects.requireExact(projectId); requireWritable(project)
        val registry = readRegistry(project)
        registry.put("organization", registry.optJSONObject("organization")?.put("enabled", enabled)
            ?.put("authorizedAt", if (enabled) Timestamp.now() else "") ?: JSONObject().put("enabled", enabled))
        writeRegistry(project, registry)
    }

    @Synchronized fun organizeInbox(projectId: String): JSONObject {
        synchronized(LOCK) {
        val project = projects.requireExact(projectId); requireWritable(project)
        val registry = readRegistry(project)
        require(registry.getJSONArray("operations").objects().none {
            it.optString("kind") in setOf("organization", "organization_undo") && it.optString("status") == "running"
        }) { "有未完成整理，请先核对中断现场" }
        require(registry.optJSONObject("organization")?.optBoolean("enabled") == true) { "尚未授权本机自动整理" }
        val operation = JSONObject().put("operationId", "organization-${UUID.randomUUID()}")
            .put("kind", "organization").put("status", "running").put("createdAt", Timestamp.now()).put("items", JSONArray())
        registry.getJSONArray("operations").put(operation); writeRegistry(project, registry)
        val store = controlStore(project); var succeeded = 0; var failed = 0
        val actualCategories = categories(project)
        val eligible = registry.getJSONArray("materials").objects().filter { item ->
            val relative = item.getJSONObject("location").getString("relativePath")
            LocalProjectMaterialPolicy.canAutoOrganize(relative, item.optString("adoption"),
                item.getJSONObject("classification").optString("categoryId"), item.getJSONObject("classification").optBoolean("manualLocked"),
                actualCategories.keys, "${project.paths.workspacePath}/收件箱/") && item.optString("availability", "available") == "available"
        }.take(LocalProjectMaterialPolicy.MAX_BATCH)
        eligible.forEach { item ->
            val location = item.getJSONObject("location"); val relative = location.getString("relativePath")
            val category = item.getJSONObject("classification").optString("categoryId")
            val target = "${project.paths.workspacePath}/${actualCategories.getValue(category)}/${relative.substringAfterLast('/')}"
            val receipt = JSONObject().put("materialId", item.getString("materialId")).put("source", relative).put("target", target)
                .put("sha256", item.getString("sha256")).put("status", "prepared")
            operation.getJSONArray("items").put(receipt); writeRegistry(project, registry)
            try {
                require(!store.exists(target)) { "目标已有同名文件" }
                require(fingerprint(store, relative).first == item.getString("sha256")) { "原件已有变化，请先重新扫描" }
                copyVerified(store, relative, store, target, item.getString("sha256"))
                receipt.put("status", "copied"); writeRegistry(project, registry)
                // Recheck immediately before deletion. Keep both copies if anything changed.
                require(fingerprint(store, relative).first == item.getString("sha256")) { "复制期间原件变化，保留两份文件待复核" }
                require(fingerprint(store, target).first == item.getString("sha256")) { "复制目标已有变化，保留原件待复核" }
                store.deleteFileIfExists(relative)
                val aliases = item.optJSONArray("legacyAliases") ?: JSONArray().also { item.put("legacyAliases", it) }
                aliases.put(JSONObject().put("rootId", "workspace").put("relativePath", relative).put("movedAt", Timestamp.now()))
                location.put("relativePath", target)
                item.put("recordRevision", item.optInt("recordRevision") + 1).put("updatedAt", Timestamp.now())
                receipt.put("status", "succeeded"); succeeded++
            } catch (error: Throwable) {
                receipt.put("status", if (receipt.optString("status") == "copied") "needs_user" else "failed")
                    .put("message", error.message ?: "整理失败"); failed++
            }
            writeRegistry(project, registry)
        }
        operation.put("status", if (failed == 0) "succeeded" else if (succeeded > 0) "partial" else "failed")
            .put("completedAt", Timestamp.now()).put("succeeded", succeeded).put("failed", failed)
        writeRegistry(project, registry)
        return operation
        }
    }

    /** Recovery never deletes either copy. Only a uniquely verified post-move location is adopted. */
    fun recoverOrganization(projectId: String): JSONObject = synchronized(LOCK) {
        val project = projects.requireExact(projectId); requireWritable(project)
        val registry = readRegistry(project); val store = controlStore(project)
        var recovered = 0; var attention = 0
        registry.getJSONArray("operations").objects().filter {
            it.optString("kind") in setOf("organization", "organization_undo") && it.optString("status") == "running"
        }.forEach { operation ->
            val undo = operation.optString("kind") == "organization_undo"
            var operationAttention = 0
            operation.getJSONArray("items").objects().filter { it.optString("status") in setOf("prepared", "copied", "needs_user") }.forEach { receipt ->
                val item = material(registry, receipt.getString("materialId"))
                val oldPath = receipt.getString("source"); val newPath = receipt.getString("target")
                val hash = receipt.getString("sha256")
                val location = item.getJSONObject("location")
                val decision = FileOrganizationRecoveryPolicy.decision(
                    if (store.exists(oldPath)) fingerprint(store, oldPath).first else null,
                    if (store.exists(newPath)) fingerprint(store, newPath).first else null,
                    hash, item.optString("sha256"), location.optString("relativePath"), oldPath, newPath)
                if (decision == "adopt_target") {
                    item.getJSONArray("legacyAliases").put(JSONObject().put("rootId", "workspace").put("relativePath", oldPath)
                        .put("reason", "organization_recovery").put("movedAt", Timestamp.now()))
                    location.put("relativePath", newPath)
                    item.put("recordRevision", item.optInt("recordRevision") + 1).put("updatedAt", Timestamp.now())
                    receipt.put("status", "succeeded"); recovered++
                } else if (decision == "keep_source") {
                    receipt.put("status", "cancelled").put("message", "未切换原件；保留原位置")
                    recovered++
                } else {
                    receipt.put("status", "needs_user").put("message", "存在多份文件、后续修改或缺失；保留现场，不自动删除")
                    attention++; operationAttention++
                }
            }
            operation.put("status", if (operationAttention == 0) "recovered" else "attention").put("completedAt", Timestamp.now())
            if (undo && operation.getJSONArray("items").objects().all { it.optString("status") == "succeeded" }) registry.getJSONArray("operations").objects().singleOrNull {
                it.optString("operationId") == operation.optString("sourceOperationId")
            }?.put("rolledBack", true)
        }
        writeRegistry(project, registry)
        JSONObject().put("recovered", recovered).put("attention", attention)
    }

    /** Physical-only undo. It never changes the user's selected category, digest or evidence state. */
    fun undoLatestOrganization(projectId: String): JSONObject = synchronized(LOCK) {
        val project = projects.requireExact(projectId); requireWritable(project)
        val registry = readRegistry(project); val store = controlStore(project)
        require(registry.getJSONArray("operations").objects().none {
            it.optString("kind") in setOf("organization", "organization_undo") && it.optString("status") == "running"
        }) { "请先核对中断整理" }
        val original = registry.getJSONArray("operations").objects().lastOrNull {
            it.optString("kind") == "organization" && !it.optBoolean("rolledBack") &&
                it.getJSONArray("items").objects().any { entry -> entry.optString("status") == "succeeded" }
        } ?: error("没有可撤销的整理批次")
        val undo = JSONObject().put("operationId", "organization-undo-${UUID.randomUUID()}")
            .put("kind", "organization_undo").put("sourceOperationId", original.getString("operationId"))
            .put("status", "running").put("createdAt", Timestamp.now()).put("items", JSONArray())
        registry.getJSONArray("operations").put(undo); writeRegistry(project, registry)
        var succeeded = 0; var failed = 0
        original.getJSONArray("items").objects().filter { it.optString("status") == "succeeded" }.forEach { moved ->
            val oldPath = moved.getString("target"); val restored = moved.getString("source")
            val receipt = JSONObject().put("materialId", moved.getString("materialId")).put("source", oldPath)
                .put("target", restored).put("sha256", moved.getString("sha256")).put("status", "prepared")
            undo.getJSONArray("items").put(receipt); writeRegistry(project, registry)
            try {
                val item = material(registry, moved.getString("materialId")); val hash = moved.getString("sha256")
                require(item.optString("sha256") == hash && item.getJSONObject("location").optString("relativePath") == oldPath) { "登记已有后续变化，不能撤销" }
                require(!store.exists(restored)) { "原位置已有文件，不能覆盖" }
                require(fingerprint(store, oldPath).first == hash) { "整理后原件已有修改，不能撤销" }
                copyVerified(store, oldPath, store, restored, hash)
                receipt.put("status", "copied"); writeRegistry(project, registry)
                require(fingerprint(store, oldPath).first == hash) { "撤销期间文件变化，保留两份待复核" }
                require(fingerprint(store, restored).first == hash) { "恢复副本已有变化，保留两份待复核" }
                // Commit the verified restored location BEFORE removing the organized copy.
                item.getJSONArray("legacyAliases").put(JSONObject().put("rootId", "workspace").put("relativePath", oldPath)
                    .put("reason", "organization_undo").put("movedAt", Timestamp.now()))
                item.getJSONObject("location").put("relativePath", restored)
                item.put("recordRevision", item.optInt("recordRevision") + 1).put("updatedAt", Timestamp.now())
                writeRegistry(project, registry)
                store.deleteFileIfExists(oldPath)
                receipt.put("status", "succeeded"); moved.put("status", "rolled_back"); succeeded++
            } catch (error: Exception) {
                receipt.put("status", if (receipt.optString("status") == "copied") "needs_user" else "failed")
                    .put("message", error.message ?: "撤销失败"); failed++
            }
            writeRegistry(project, registry)
        }
        undo.put("status", if (failed == 0) "succeeded" else "partial").put("succeeded", succeeded).put("failed", failed)
            .put("completedAt", Timestamp.now())
        if (failed == 0) original.put("rolledBack", true)
        writeRegistry(project, registry)
        JSONObject().put("succeeded", succeeded).put("failed", failed)
    }

    @Synchronized fun previewMigration(projectId: String): JSONObject {
        val project = projects.requireExact(projectId); require(project.materialMigrationState != "running") { "迁移正在执行" }
        val registry = readRegistry(project); val items = JSONArray()
        fun enumerate(store: SafWorkspaceStore, root: String, rootId: String, kind: String, external: Boolean = false) {
            if (root.isBlank()) return
            store.listFiles(root, LocalProjectMaterialPolicy.MAX_SCAN_FILES, 24).forEach { file ->
                val suffix = file.relativePath.removePrefix(root).trimStart('/')
                if (suffix.isBlank()) return@forEach
                val target = "${project.paths.workspacePath}/收件箱/历史迁移/${if (rootId == "legacy_raw") "旧原始资料库" else "旧研究暂存"}/$suffix"
                val action = LocalProjectMaterialPolicy.migrationDisposition(if (external) "adopted_external" else kind,
                    file.relativePath, controlStore(project).exists(target))
                val observed = fingerprint(store, file.relativePath)
                items.put(JSONObject().put("itemId", "migration-${sha256("$rootId:${file.relativePath}:${observed.first}").take(32)}")
                    .put("rootId", rootId).put("sourceKind", if (external) "adopted_external" else kind)
                    .put("sourceRelativePath", file.relativePath).put("targetRelativePath", target)
                    .put("title", file.name).put("sha256", observed.first).put("size", observed.second).put("action", action))
            }
        }
        enumerate(controlStore(project), project.paths.workspacePath, "workspace", "workspace")
        enumerate(if (project.knowledgeMode == "adopted") knowledgeStore(project) else controlStore(project),
            project.paths.rawPath, "legacy_raw", "legacy_raw", project.knowledgeMode == "adopted")
        enumerate(controlStore(project), project.paths.stagingPath, "legacy_staging", "legacy_staging")
        val preview = JSONObject().put("previewId", "preview-${UUID.randomUUID()}").put("createdAt", Timestamp.now())
            .put("items", items).put("registryRevision", registry.optInt("revision"))
        registry.put("migrationPreview", preview); writeRegistry(project, registry)
        projects.update(project.copy(materialMigrationState = "previewed"))
        return preview
    }

    @Synchronized fun executeMigration(projectId: String, itemIds: Set<String>): JSONObject {
        val original = projects.requireExact(projectId); requireWritable(original, allowLegacy = true)
        val registry = readRegistry(original); val preview = requireNotNull(registry.optJSONObject("migrationPreview")) { "请先预览历史迁移" }
        require(preview.optInt("registryRevision") <= registry.optInt("revision")) { "迁移预览版本无效" }
        val selected = preview.getJSONArray("items").objects().filter { it.getString("itemId") in itemIds && it.getString("action") in setOf("associate", "migrate") }
        require(selected.isNotEmpty() && selected.size <= LocalProjectMaterialPolicy.MAX_BATCH) { "没有可执行迁移项或批次过大" }
        var project = original.copy(materialMigrationState = "running"); projects.update(project)
        val operation = JSONObject().put("operationId", "migration-${UUID.randomUUID()}").put("kind", "migration")
            .put("status", "running").put("createdAt", Timestamp.now()).put("items", JSONArray())
        registry.getJSONArray("operations").put(operation); writeRegistry(project, registry)
        var succeeded = 0; var attention = 0
        selected.forEach { plan ->
            val receipt = JSONObject(plan.toString()).put("status", "pending")
            operation.getJSONArray("items").put(receipt); writeRegistry(project, registry)
            try {
                val sourceStore = sourceStore(project, plan.getString("rootId")); val source = plan.getString("sourceRelativePath")
                val current = fingerprint(sourceStore, source); require(current.first == plan.getString("sha256") && current.second == plan.getLong("size")) { "来源在预览后已变化" }
                if (plan.getString("action") == "associate") {
                    register(registry, "workspace", source, current.first, current.second, "history_migration",
                        "migration-associate:${plan.getString("itemId")}")
                } else {
                    val target = plan.getString("targetRelativePath")
                    require(!controlStore(project).exists(target)) { "迁移目标已被占用" }
                    receipt.put("status", "copying"); writeRegistry(project, registry)
                    copyVerified(sourceStore, source, controlStore(project), target, current.first)
                    receipt.put("status", "target_copied"); writeRegistry(project, registry)
                    val backup = "${project.paths.managerPath}/project-materials/migration-backups/${operation.getString("operationId")}/${plan.getString("rootId")}/${plan.getString("itemId")}-${LocalProjectMaterialPolicy.safeFilename(source.substringAfterLast('/'))}"
                    copyVerified(sourceStore, source, controlStore(project), backup, current.first)
                    receipt.put("status", "backup_ready").put("backupRelativePath", backup); writeRegistry(project, registry)
                    val existing = registry.getJSONArray("materials").objects().singleOrNull {
                        it.getJSONObject("location").optString("rootId") == plan.getString("rootId") &&
                            it.getJSONObject("location").optString("relativePath") == source
                    }
                    register(registry, "workspace", target, current.first, current.second, "history_migration",
                        "migration:${plan.getString("itemId")}", existing?.optString("materialId").orEmpty())
                    receipt.put("status", "registered"); writeRegistry(project, registry)
                    val latest = fingerprint(sourceStore, source); require(latest.first == current.first) { "切换前来源已变化" }
                    try { sourceStore.deleteFileIfExists(source); receipt.put("status", "succeeded") }
                    catch (error: Throwable) { receipt.put("status", "source_retained").put("message", error.message ?: "旧来源保留"); attention++ }
                }
                if (receipt.getString("status") != "source_retained") { receipt.put("status", "succeeded"); succeeded++ }
            } catch (error: Throwable) {
                receipt.put("status", if (receipt.optString("status") in setOf("target_copied", "backup_ready", "registered")) "recovery_required" else "failed")
                    .put("message", error.message ?: "迁移失败"); attention++
            }
            writeRegistry(project, registry)
        }
        val preserved = preview.getJSONArray("items").objects().count { it.getString("action").startsWith("preserve") }
        val state = if (attention > 0) "attention" else if (preserved > 0 || selected.size < preview.getJSONArray("items").length()) "partial" else "complete"
        operation.put("status", if (attention > 0) "attention" else "succeeded").put("completedAt", Timestamp.now())
            .put("succeeded", succeeded).put("attention", attention)
        project = project.copy(materialStorageMode = if (attention > 0) project.materialStorageMode else "workspace-v1",
            materialMigrationState = state); projects.update(project); writeRegistry(project, registry)
        return operation.put("migrationState", state)
    }

    @Synchronized fun recoverMigration(projectId: String): JSONObject {
        val project = projects.requireExact(projectId); val registry = readRegistry(project)
        val operation = registry.getJSONArray("operations").objects().lastOrNull { it.optString("kind") == "migration" && it.optString("status") == "running" }
            ?: return JSONObject().put("ok", true).put("recovered", 0).put("message", "没有待恢复迁移")
        var recovered = 0; var attention = 0
        operation.getJSONArray("items").objects().forEach { item ->
            when (item.optString("status")) {
                "target_copied", "backup_ready", "registered" -> {
                    item.put("status", "recovery_required").put("message", "检测到中断现场；源、目标和备份均保留，请在本机重新预览后核对。")
                    attention++
                }
                "pending", "copying" -> {
                    item.put("status", "failed").put("message", "中断前未完成安全切换；原来源保留，可重新预览。")
                    recovered++
                }
            }
        }
        operation.put("status", if (attention > 0) "attention" else "partial").put("completedAt", Timestamp.now())
        projects.update(project.copy(materialMigrationState = if (attention > 0) "attention" else "partial"))
        writeRegistry(project, registry)
        return JSONObject().put("ok", attention == 0).put("recovered", recovered).put("attention", attention)
    }

    @Synchronized fun rollbackLatestMigration(projectId: String): JSONObject {
        var project = projects.requireExact(projectId)
        require(project.materialMigrationState != "running") { "迁移仍在运行，请先执行中断恢复" }
        val registry = readRegistry(project)
        val sourceOperation = registry.getJSONArray("operations").objects().lastOrNull { operation ->
            operation.optString("kind") == "migration" && operation.optJSONArray("items")?.objects()?.any {
                it.optString("action") == "migrate" && it.optString("status") in setOf("succeeded", "source_retained")
            } == true && !operation.optBoolean("rolledBack")
        } ?: error("没有可安全回滚的迁移操作")
        val rollback = JSONObject().put("operationId", "migration-rollback-${UUID.randomUUID()}")
            .put("kind", "migration_rollback").put("sourceOperationId", sourceOperation.getString("operationId"))
            .put("status", "running").put("createdAt", Timestamp.now()).put("items", JSONArray())
        registry.getJSONArray("operations").put(rollback); writeRegistry(project, registry)
        var succeeded = 0; var failed = 0
        sourceOperation.getJSONArray("items").objects().filter {
            it.optString("action") == "migrate" && it.optString("status") in setOf("succeeded", "source_retained")
        }.forEach { migrated ->
            val receipt = JSONObject().put("itemId", migrated.getString("itemId")).put("status", "pending")
            rollback.getJSONArray("items").put(receipt)
            try {
                val hash = migrated.getString("sha256"); val source = migrated.getString("sourceRelativePath")
                val target = migrated.getString("targetRelativePath"); val backup = migrated.getString("backupRelativePath")
                val originalStore = sourceStore(project, migrated.getString("rootId")); val workspace = controlStore(project)
                require(workspace.exists(backup) && fingerprint(workspace, backup).first == hash) { "迁移备份缺失或损坏" }
                require(workspace.exists(target) && fingerprint(workspace, target).first == hash) { "迁移后目标已变化，不能回滚" }
                if (originalStore.exists(source)) require(fingerprint(originalStore, source).first == hash) { "原位置已有异字节文件，不能覆盖" }
                else copyVerified(workspace, backup, originalStore, source, hash)
                val item = registry.getJSONArray("materials").objects().singleOrNull {
                    val location = it.optJSONObject("location")
                    location?.optString("rootId") == "workspace" && location.optString("relativePath") == target && it.optString("sha256") == hash
                } ?: error("资料登记已发生后续变化，不能回滚")
                item.getJSONArray("legacyAliases").put(JSONObject().put("rootId", "workspace")
                    .put("relativePath", target).put("movedAt", Timestamp.now()).put("reason", "migration_rollback"))
                item.put("location", JSONObject().put("rootId", migrated.getString("rootId")).put("relativePath", source))
                    .put("recordRevision", item.optInt("recordRevision") + 1).put("updatedAt", Timestamp.now())
                writeRegistry(project, registry)
                workspace.deleteFileIfExists(target)
                receipt.put("status", "succeeded"); succeeded++
            } catch (error: Throwable) {
                receipt.put("status", "failed").put("message", error.message ?: "安全回滚失败"); failed++
            }
            writeRegistry(project, registry)
        }
        rollback.put("status", if (failed == 0) "succeeded" else if (succeeded > 0) "partial" else "failed")
            .put("succeeded", succeeded).put("failed", failed).put("completedAt", Timestamp.now())
        if (failed == 0) sourceOperation.put("rolledBack", true).put("rolledBackAt", Timestamp.now())
        project = project.copy(materialStorageMode = "legacy", materialMigrationState = if (failed == 0) "partial" else "attention")
        projects.update(project); writeRegistry(project, registry)
        return rollback.put("migrationState", project.materialMigrationState)
    }

    /** Fail closed before producing current reports when registered source bytes cannot be verified. */
    @Synchronized fun requireCurrentOriginalsIntact(projectId: String) {
        val project = projects.requireExact(projectId)
        val items = readRegistry(project).getJSONArray("materials").objects()
        items.filter { it.optString("adoption") == "accepted" }.forEach { item ->
            val location = item.optJSONObject("location")
            val expected = item.optString("sha256")
            val actual = if (location == null || expected.isBlank()) null else runCatching {
                fingerprint(sourceStore(project, location.getString("rootId")), location.getString("relativePath")).first
            }.getOrNull()
            require(actual != null && actual == expected) { "项目原件不可用或已变化：${item.optString("title")}；保留历史成果，请重新扫描或恢复原件后再生成报告" }
        }
    }

    fun readMaterialBytes(projectId: String, materialId: String): ByteArray {
        val project = projects.requireExact(projectId); val registry = readRegistry(project); val item = material(registry, materialId)
        return sourceStore(project, item.getJSONObject("location").getString("rootId"))
            .readBytes(item.getJSONObject("location").getString("relativePath"))
    }

    fun readFrozenVersionBytes(projectId: String, materialId: String, versionNumber: Int, expectedSha256: String): ByteArray {
        val project = projects.requireExact(projectId); val registry = readRegistry(project); val item = material(registry, materialId)
        val version = item.getJSONArray("versions").objects().singleOrNull { it.optInt("version") == versionNumber }
            ?: throw java.io.FileNotFoundException("资料固定版本不存在：$materialId v$versionNumber")
        require(version.optString("sha256") == expectedSha256) { "资料固定版本校验值不一致" }
        val snapshot = version.optString("snapshot")
        require(snapshot.isNotBlank()) { "资料版本尚未生成固定快照" }
        val bytes = controlStore(project).readBytes(snapshot)
        require(sha256(bytes) == expectedSha256) { "资料固定快照已损坏" }
        return bytes
    }

    fun materialDocument(projectId: String, materialId: String): Pair<Uri, String> {
        val project = projects.requireExact(projectId); val registry = readRegistry(project); val item = material(registry, materialId)
        val location = item.getJSONObject("location")
        val document = sourceStore(project, location.getString("rootId")).document(location.getString("relativePath"))
            ?: throw java.io.FileNotFoundException(item.optString("title"))
        return document.uri to document.type.orEmpty().ifBlank { "application/octet-stream" }
    }

    fun freezeVersion(projectId: String, materialId: String): JSONObject = synchronized(LOCK) {
        val project = projects.requireExact(projectId); val registry = readRegistry(project); val item = material(registry, materialId)
        val currentVersion = item.getInt("version")
        val version = item.getJSONArray("versions").objects().single { versionItem ->
            versionItem.getInt("version") == currentVersion
        }
        if (version.optString("snapshot").isBlank()) {
            val snapshot = "${project.paths.managerPath}/project-materials/snapshots/${item.getString("sha256")}"
            val source = item.getJSONObject("location")
            if (!controlStore(project).exists(snapshot)) copyVerified(sourceStore(project, source.getString("rootId")),
                source.getString("relativePath"), controlStore(project), snapshot, item.getString("sha256"))
            else require(fingerprint(controlStore(project), snapshot).first == item.getString("sha256")) { "固定版本快照校验失败" }
            version.put("snapshot", snapshot); writeRegistry(project, registry)
        }
        JSONObject(item.toString())
    }

    @Synchronized fun markProcessed(projectId: String, materialIds: Set<String>, artifactPath: String, operationId: String) {
        val project = projects.requireExact(projectId); val registry = readRegistry(project)
        materialIds.forEach { id -> material(registry, id).getJSONObject("processing")
            .put("state", "completed").put("processedVersion", material(registry, id).getInt("version"))
            .put("artifactPath", artifactPath).put("operationId", operationId).put("completedAt", Timestamp.now()) }
        writeRegistry(project, registry)
    }

    @Synchronized fun markProcessedVersions(projectId: String, versions: Map<String, Int>, artifactPath: String, operationId: String) {
        val project = projects.requireExact(projectId); val registry = readRegistry(project)
        versions.forEach { (id, processedVersion) ->
            val item = material(registry, id); val processing = item.getJSONObject("processing")
            processing.put("processedVersion", processedVersion).put("artifactPath", artifactPath)
                .put("operationId", operationId).put("completedAt", Timestamp.now())
            processing.put("state", if (item.getInt("version") == processedVersion) "completed" else "pending")
        }
        writeRegistry(project, registry)
    }

    fun knowledgeFiles(projectId: String): List<SafWorkspaceStore.MarkdownFile> {
        val project = projects.requireExact(projectId); val roots = listOf(project.paths.conceptPath, project.paths.entityPath,
            project.paths.summaryPath, project.paths.qaPath, project.paths.synthesisPath, project.paths.reportPath).filter(String::isNotBlank)
        return knowledgeStore(project).listMarkdownFiles(roots, maximum = 500)
    }

    fun contributionFiles(projectId: String): List<SafWorkspaceStore.MarkdownFile> {
        val project = projects.requireExact(projectId)
        if (project.paths.contributionPath.isBlank()) return emptyList()
        return knowledgeStore(project).listMarkdownFiles(listOf(project.paths.contributionPath), maximum = 200)
    }

    private fun requireWritable(project: ProjectRecord, allowLegacy: Boolean = false) {
        require(project.status !in setOf("sealed", "archived")) { "项目当前只读" }
        require(project.materialMigrationState != "running") { "历史资料迁移中，暂不可写" }
        require(allowLegacy || project.materialStorageMode == "workspace-v1") { "旧项目须先迁移" }
    }

    private fun controlStore(project: ProjectRecord) = SafWorkspaceStore(context, Uri.parse(project.projectRootUri))
    private fun knowledgeStore(project: ProjectRecord) = SafWorkspaceStore(context, Uri.parse(project.knowledgeRootUri))
    private fun sourceStore(project: ProjectRecord, rootId: String) = when (rootId) {
        "legacy_raw" -> if (project.knowledgeMode == "adopted") knowledgeStore(project) else controlStore(project)
        else -> controlStore(project)
    }
    private fun registryPath(project: ProjectRecord) = "${project.paths.managerPath}/project-materials/registry.json"

    private fun readRegistry(project: ProjectRecord): JSONObject {
        val store = controlStore(project); val path = registryPath(project)
        if (!store.exists(path)) return emptyRegistry(project)
        return JSONObject(store.readBytes(path).toString(Charsets.UTF_8)).also {
            require(it.optString("schema") == LocalProjectMaterialPolicy.SCHEMA && it.optString("projectId") == project.id) { "项目资料登记损坏或范围不匹配" }
        }
    }

    /** Returns only a persisted registry, never an invented empty snapshot. */
    @Synchronized fun persistedSnapshotFingerprint(projectId: String): String? {
        val project = projects.requireExact(projectId)
        if (!controlStore(project).exists(registryPath(project))) return null
        return AutomationMaterialPolicy.projectFingerprint(readRegistry(project))
    }

    private fun writeRegistry(project: ProjectRecord, registry: JSONObject) {
        synchronized(LOCK) {
            val store = controlStore(project); val path = registryPath(project)
            val persisted = if (store.exists(path)) JSONObject(store.readBytes(path).toString(Charsets.UTF_8)).optInt("revision") else 0
            require(persisted == registry.optInt("revision")) { "另一项任务已更新资料登记，停止覆盖；请刷新后重试" }
            registry.put("revision", registry.optInt("revision") + 1).put("updatedAt", Timestamp.now())
            store.writeBytesSafely(path, (registry.toString(2) + "\n").toByteArray(), "application/json")
        }
        context.getSharedPreferences("reference-suggestion-project-changes", Context.MODE_PRIVATE).edit()
            .putString(project.id, registry.optString("updatedAt")).apply()
        project.studentIds.forEach { StudioAutomation.enqueueCheck(context, it) }
        runCatching {
            AutomationOrchestrator(context).emit(
                AutomationEventType.PROJECT_SNAPSHOT_CHANGED,
                studentId = "",
                sourceFingerprint = AutomationMaterialPolicy.projectFingerprint(registry),
                projectId = project.id,
            )
        }
    }

    private fun emptyRegistry(project: ProjectRecord) = JSONObject().put("schema", LocalProjectMaterialPolicy.SCHEMA)
        .put("projectId", project.id).put("revision", 0).put("updatedAt", Timestamp.now())
        .put("materials", JSONArray()).put("operations", JSONArray())
        .put("organization", JSONObject().put("enabled", false))
        .put("categories", JSONArray().also { array -> categories(project).forEach { (id, name) ->
            array.put(JSONObject().put("categoryId", id).put("name", name)) } })

    private fun register(registry: JSONObject, rootId: String, relativePath: String, sha256: String, size: Long,
                         sourceType: String, eventId: String, requestedMaterialId: String = ""): String {
        val materials = registry.getJSONArray("materials"); val all = materials.objects()
        var item = all.singleOrNull { it.getJSONObject("location").optString("rootId") == rootId
            && it.getJSONObject("location").optString("relativePath") == relativePath }
        if (item == null && requestedMaterialId.isNotBlank()) item = all.singleOrNull { it.optString("materialId") == requestedMaterialId }
        if (item == null) {
            item = JSONObject().put("materialId", if (requestedMaterialId.isBlank()) "material-${UUID.randomUUID()}" else requestedMaterialId)
                .put("version", 1).put("recordRevision", 1).put("title", relativePath.substringAfterLast('/'))
                .put("location", JSONObject().put("rootId", rootId).put("relativePath", relativePath))
                .put("sha256", sha256).put("size", size).put("availability", "available").put("adoption", "accepted")
                .put("classification", JSONObject().put("categoryId", "").put("suggestedCategoryId", "").put("source", "").put("manualLocked", false))
                .put("organizationState", "unclassified").put("processing", JSONObject().put("state", "pending").put("processedVersion", 0))
                .put("sources", JSONArray()).put("versions", JSONArray().put(version(1, sha256, size))).put("legacyAliases", JSONArray())
                .put("createdAt", Timestamp.now()).put("updatedAt", Timestamp.now()); materials.put(item)
            addSource(item, sourceType, eventId); return "added"
        }
        val oldLocation = item.getJSONObject("location")
        if (oldLocation.optString("rootId") != rootId || oldLocation.optString("relativePath") != relativePath) {
            item.getJSONArray("legacyAliases").put(JSONObject(oldLocation.toString()).put("movedAt", Timestamp.now()))
            item.put("location", JSONObject().put("rootId", rootId).put("relativePath", relativePath))
        }
        if (item.getString("sha256") != sha256) {
            val next = item.getInt("version") + 1
            item.put("version", next).put("sha256", sha256).put("size", size)
                .put("processing", JSONObject().put("state", "pending").put("processedVersion", item.optJSONObject("processing")?.optInt("processedVersion") ?: 0))
            item.getJSONArray("versions").put(version(next, sha256, size))
            item.put("recordRevision", item.optInt("recordRevision") + 1).put("updatedAt", Timestamp.now()); addSource(item, sourceType, eventId)
            return "updated"
        }
        addSource(item, sourceType, eventId); item.put("availability", "available").put("updatedAt", Timestamp.now())
        return "unchanged"
    }

    private fun addSource(item: JSONObject, type: String, eventId: String) {
        if (item.getJSONArray("sources").objects().none { it.optString("eventId") == eventId })
            item.getJSONArray("sources").put(JSONObject().put("type", type).put("eventId", eventId).put("createdAt", Timestamp.now()))
    }
    private fun version(number: Int, hash: String, size: Long) = JSONObject().put("version", number).put("sha256", hash)
        .put("size", size).put("snapshot", "").put("registeredAt", Timestamp.now())
    private fun material(registry: JSONObject, id: String) = registry.getJSONArray("materials").objects().singleOrNull { it.optString("materialId") == id }
        ?: throw NoSuchElementException("未找到项目资料")

    private fun fingerprint(store: SafWorkspaceStore, path: String): Pair<String, Long> {
        val digest = MessageDigest.getInstance("SHA-256"); var size = 0L
        store.openInputStream(path).use { input -> val buffer = ByteArray(DEFAULT_BUFFER_SIZE); while (true) {
            val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read); size += read
        } }
        return digest.digest().hex() to size
    }

    private fun copyVerified(sourceStore: SafWorkspaceStore, source: String, targetStore: SafWorkspaceStore, target: String, expectedHash: String) {
        val digest = MessageDigest.getInstance("SHA-256")
        targetStore.writeStreamNewSafely(target, "application/octet-stream") { output -> sourceStore.openInputStream(source).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE); while (true) { val read = input.read(buffer); if (read < 0) break
                output.write(buffer, 0, read); digest.update(buffer, 0, read) }
        } }
        if (digest.digest().hex() != expectedHash || fingerprint(targetStore, target).first != expectedHash) {
            error("复制后字节校验失败；原件和已写入副本均保留待复核")
        }
    }

    private fun uniquePath(store: SafWorkspaceStore, directory: String, filename: String): String {
        val stem = filename.substringBeforeLast('.', filename); val extension = filename.substringAfterLast('.', "")
        for (index in 1..10_000) {
            val name = if (index == 1) filename else "$stem ($index)${if (extension.isBlank()) "" else ".$extension"}"
            val path = "$directory/$name"; if (!store.exists(path)) return path
        }
        error("同名资料过多")
    }

    private fun sha256(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).hex()
    private fun sha256(value: ByteArray) = MessageDigest.getInstance("SHA-256").digest(value).hex()
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
    private fun JSONArray.objects() = (0 until length()).mapNotNull { optJSONObject(it) }

    companion object { private val LOCK = Any() }
}
