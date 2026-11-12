package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

/** Local project material, report and outcome center. No Windows host API is involved. */
class ProjectMaterialsActivity : Activity() {
    private lateinit var project: ProjectRecord
    private lateinit var service: LocalProjectMaterialService
    private lateinit var palette: UiPalette
    private lateinit var status: TextView
    private lateinit var list: LinearLayout
    private lateinit var tabs: LinearLayout
    private var view = "dashboard"
    private var pendingRelinkMaterialId: String? = null
    private var actualCategories: Map<String, String> = emptyMap()
    private var searchText = ""
    private var initialStudentId = ""
    private var initiallyStudentScoped = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preferences = UiPreferences(this); preferences.applyOrientation(this); palette = preferences.palette()
        initialStudentId = getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, MODE_PRIVATE)
            .getString(MainActivity.KEY_CURRENT_STUDENT_ID, "").orEmpty()
        project = ProjectRepository(this).requireExact(requireNotNull(intent.getStringExtra(EXTRA_PROJECT_ID)))
        initiallyStudentScoped = initialStudentId in project.studentIds
        view = intent.getStringExtra(EXTRA_INITIAL_TAB)?.takeIf { it in setOf("dashboard", "materials", "knowledge", "outcomes", "pending", "contributions") } ?: "dashboard"
        service = LocalProjectMaterialService(this)
        window.statusBarColor = palette.page; window.navigationBarColor = palette.page

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(12)); setBackgroundColor(palette.page) }
        root.addView(TextView(this).apply { text = "${project.name} · 项目工作台"; textSize = 23f; setTextColor(palette.heading) }, matchWrap())
        root.addView(TextView(this).apply { text = "统一管理项目资料、知识、进展报告、导师建议和成果；本机是该单机项目的权威节点。"; textSize = 13f; setTextColor(palette.muted); setPadding(0, dp(4), 0, dp(8)) }, matchWrap())
        status = TextView(this).apply { textSize = 13f; setTextColor(palette.text); setPadding(dp(10), dp(8), dp(10), dp(8)) }
        root.addView(status, matchWrap())
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(button("导入") { chooseFiles() }, weighted())
        actions.addView(button("扫描") { background("正在扫描工作空间") {
            val result = service.scanWorkspace(project.id)
            "扫描完成：新增 ${result.added}、更新 ${result.updated}、未变化 ${result.unchanged}、登记位置缺失 ${result.unavailable}${if (result.truncated) "；超过5000项，本次仅为部分覆盖，不判定缺失" else ""}"
        } }, weighted())
        actions.addView(button("自动建议") { background("正在生成分类建议") { "已生成 ${service.suggestClassifications(project.id)} 条可解释建议" } }, weighted())
        root.addView(actions, matchWrap())
        root.addView(button("批量确认当前分类建议") { confirmSuggestedClassifications() }, matchWrap())
        val second = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        second.addView(button("本机整理") { organizationMenu() }, weighted())
        second.addView(button("加入消化队列") { background("正在固定资料版本并加入本机队列") {
            val job = ProjectDigestQueue(this).enqueue(project.id)
            "已加入本机持久队列：${digestQueueLabel(job.optString("status"))}。资料管理无需等待AI；系统满足网络、电量和空间条件后处理。"
        } }, weighted())
        second.addView(button("历史迁移") { migrationMenu() }, weighted())
        root.addView(second, matchWrap())
        root.addView(button("自动核对未知任务") { background("正在核对固定来源和本机结果检查点") {
            val queue = ProjectDigestQueue(this); val result = queue.reconcileUnknowns(project.id)
            runCatching { queue.enqueueAutomatic(project.id) }
            "已从本机检查点恢复 ${result.optInt("recovered")} 项；仍无法确定 ${result.optInt("retainedUnknown")} 项。没有重复调用模型。"
        } }, matchWrap())
        root.addView(button("授权固定资料单次重试") {
            AlertDialog.Builder(this).setTitle("授权单次重试")
                .setMessage("上次模型请求的结果未知，可能已经产生费用。确认后仅对该任务的固定资料版本重试一次，保留原未知记录；如果再次中断或结果未知，不会自动重复调用。")
                .setNegativeButton("取消", null).setPositiveButton("授权一次") { _, _ -> background("正在核对原任务和固定来源") {
                    val queue = ProjectDigestQueue(this); val old = requireNotNull(queue.latest(project.id))
                    queue.authorizeUnknownRetry(project.id, old.getString("jobId")); "已授权原固定资料单次重试，等待系统执行。"
                } }.show()
        }, matchWrap())
        root.addView(button("核对并结束结果未知的消化任务") {
            AlertDialog.Builder(this).setTitle("人工核对未知结果")
                .setMessage("请先检查项目知识目录和模型计费。本操作仅结束未知任务，不删除原文件或生成结果，也不自动再次调用模型。")
                .setNegativeButton("尚未核对", null).setPositiveButton("已核对，结束") { _, _ -> background("更新未知任务") {
                    val queue = ProjectDigestQueue(this); val job = requireNotNull(queue.latest(project.id))
                    queue.acknowledgeUnknown(project.id, job.getString("jobId")); "已结束未知任务；确需再次消化时请明确重新加入队列"
                } }.show()
        }, matchWrap())
        root.addView(button("项目关闭检查") { showCloseChecklist() }, matchWrap())
        val third = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        third.addView(button("修复目录授权") { rebindMenu() }, weighted())
        third.addView(button("导出显式项目包") { confirmProjectExport() }, weighted())
        root.addView(third, matchWrap())
        tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(8), 0, dp(6)) }
        listOf("dashboard" to "项目仪表盘", "materials" to "项目资料", "pending" to "待整理", "knowledge" to "项目知识",
            "outcomes" to "报告成果", "contributions" to "贡献证据").forEach { (id, label) ->
            tabs.addView(button(label) { view = id; refresh() }.apply { tag = id }, weighted())
        }
        root.addView(tabs, matchWrap())
        val search = EditText(this).apply { hint = "搜索文件名或原件路径"; setSingleLine(); setTextColor(palette.text) }
        val searchRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        searchRow.addView(search, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        searchRow.addView(button("查找") { searchText = search.text.toString(); refresh() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(searchRow, matchWrap())
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply { isFillViewport = true; addView(list) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(button("返回学习项目") { finish() }, matchWrap())
        setContentView(root); refresh()
        if (savedInstanceState == null && intent.getBooleanExtra(EXTRA_OPEN_MENTOR, false)) root.post {
            if (!isFinishing && !isDestroyed) mentorDialog()
        }
    }

    override fun onResume() {
        super.onResume()
        val currentStudentId = getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, MODE_PRIVATE)
            .getString(MainActivity.KEY_CURRENT_STUDENT_ID, "").orEmpty()
        if (currentStudentId != initialStudentId) { finish(); return }
        if (initiallyStudentScoped && runCatching {
                currentStudentId in ProjectRepository(this).requireExact(project.id).studentIds
            }.getOrDefault(false).not()) { finish(); return }
        if (::list.isInitialized) refresh()
    }

    @Deprecated("Classic picker result is retained for minSdk 23 compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_EXPORT_PACKAGE) {
            if (resultCode != RESULT_OK || data?.data == null) return
            val destination = data.data!!
            runCatching { contentResolver.takePersistableUriPermission(destination,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
            background("正在导出可校验项目包") {
                val result = StandaloneProjectPackageService(this).exportProject(project.id, destination)
                ProjectDashboardService(this).recordBackup(project.id)
                "项目包已导出：${result.files} 个文件，${result.bytes} 字节。它是显式离线副本，不会建立后台同步。"
            }
            return
        }
        if (requestCode in setOf(REQUEST_REBIND_CONTROL, REQUEST_REBIND_KNOWLEDGE)) {
            if (resultCode != RESULT_OK || data?.data == null) return
            val root = data.data!!
            runCatching { contentResolver.takePersistableUriPermission(root,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
            runCatching {
                if (requestCode == REQUEST_REBIND_CONTROL) service.rebindControlRoot(project.id, root)
                else service.rebindAdoptedKnowledgeRoot(project.id, root)
            }.onSuccess { project = it; status.text = "目录授权已重新绑定；项目和资料身份保持不变。"; refresh() }
                .onFailure { message("目录授权修复失败", it.message ?: "未知错误") }
            return
        }
        if (requestCode == REQUEST_RELINK_MATERIAL) {
            val materialId = pendingRelinkMaterialId.also { pendingRelinkMaterialId = null }
            if (resultCode != RESULT_OK || data?.data == null || materialId == null) return
            val uri = data.data!!
            background("正在核对同字节原件") {
                service.relinkMissingFromUri(project.id, materialId, uri, displayName(uri), contentResolver.getType(uri).orEmpty())
                "同字节原件已复制到本机项目工作空间；资料ID和版本保持不变。"
            }
            return
        }
        if (requestCode != REQUEST_IMPORT || resultCode != RESULT_OK || data == null) return
        val uris = buildList {
            data.clipData?.let { clip -> for (index in 0 until clip.itemCount) add(clip.getItemAt(index).uri) }
            data.data?.let(::add)
        }.distinct()
        if (uris.isEmpty()) return
        background("正在导入 ${uris.size} 份资料") {
            var success = 0; val failures = mutableListOf<String>()
            uris.forEach { uri -> runCatching {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                service.importUri(project.id, uri, displayName(uri), contentResolver.getType(uri).orEmpty())
            }.onSuccess { success++ }.onFailure { failures += (it.message ?: "导入失败") } }
            "导入完成：成功 $success，失败 ${failures.size}${if (failures.isEmpty()) "" else "\n${failures.take(3).joinToString("\n")}"}"
        }
    }

    private fun refresh() {
        project = ProjectRepository(this).requireExact(project.id)
        list.removeAllViews()
        tabs.children().forEach { it.isEnabled = it.tag != view }
        val summary = runCatching { service.status(project.id) }.getOrElse { JSONObject().put("error", it.message) }
        actualCategories = runCatching { service.categories(project.id) }.getOrDefault(emptyMap())
        val digestJob = runCatching { ProjectDigestQueue(this).latest(project.id) }.getOrNull()
        status.text = if (summary.has("error")) "读取失败：${summary.optString("error")}" else
            "统一原件 ${summary.optInt("materials")} · 需整理 ${summary.optInt("pending")} · 待消化 ${summary.optInt("digestPending")} · 来源异常 ${summary.optInt("unavailable")}\n迁移状态：${migrationLabel(summary.optString("migrationState"))} · 自动整理：${if (summary.optBoolean("organizationEnabled")) "已授权" else "未授权"}" +
                if (digestJob == null) "" else "\n消化队列：${digestQueueLabel(digestJob.optString("status"))} · ${digestJob.optString("message")}"
        when (view) {
            "dashboard" -> renderDashboardAsync()
            "materials", "pending" -> runCatching { service.list(project.id, view, searchText) }
                .onSuccess(::renderMaterials).onFailure { empty("资料读取失败：${it.message}；原件未修改。") }
            "knowledge" -> renderKnowledge()
            "outcomes" -> renderOutcomes()
            else -> renderContributions()
        }
    }

    private fun renderDashboardAsync() {
        list.addView(TextView(this).apply { text = "正在读取项目依据…"; textSize = 14f; setTextColor(palette.muted) }, matchWrap())
        Thread {
            val result = runCatching { ProjectDashboardService(this).dashboard(project.id) }
            runOnUiThread {
                if (isFinishing || isDestroyed || view != "dashboard") return@runOnUiThread
                list.removeAllViews()
                result.onFailure { empty("仪表盘读取失败：${it.message}") }.onSuccess { value ->
                    list.addView(TextView(this).apply {
                        text = "阶段：${value.optString("stage")}\n资料 ${value.optInt("materials")} · 知识 ${value.optInt("knowledge")} · 任务 ${value.optInt("tasks")} · 成果 ${value.optInt("outputs")}\n待处理资料 ${value.optInt("pendingMaterials")} · 待消化 ${value.optInt("pendingDigest")} · 贡献材料 ${value.optInt("contributions")}"
                        textSize = 16f; setTextColor(palette.text); setPadding(dp(12), dp(14), dp(12), dp(14))
                    }, matchWrap())
                    val pending = value.getJSONArray("pendingItems")
                    if (pending.length() == 0) empty("项目关闭检查已全部满足。") else for (index in 0 until pending.length()) {
                        val item = pending.getJSONObject(index)
                        list.addView(TextView(this).apply { text = "• ${item.optString("title")}：${item.optString("detail")}"; textSize = 14f; setTextColor(palette.text); setPadding(dp(10), dp(7), dp(10), dp(7)) }, matchWrap())
                    }
                }
            }
        }.start()
    }

    private fun showCloseChecklist() {
        status.text = "正在执行项目关闭检查…"
        Thread {
            val dashboard = ProjectDashboardService(this); val result = runCatching { dashboard.closeChecklist(project.id) }
            runOnUiThread {
                result.onFailure { message("检查失败", it.message ?: "项目未改变") }.onSuccess { issues ->
                    if (issues.length() > 0) {
                        val detail = (0 until issues.length()).joinToString("\n") { index -> val item = issues.getJSONObject(index); "• ${item.optString("title")}：${item.optString("detail")}" }
                        message("暂不能关闭项目", detail)
                    } else AlertDialog.Builder(this).setTitle("关闭 ${project.name}？").setMessage("检查已通过。关闭后项目保留全部资料、知识、成果和历史，不执行删除。")
                        .setNegativeButton("取消", null).setPositiveButton("确认关闭") { _, _ -> Thread {
                            val closed = runCatching { dashboard.close(project.id) }
                            runOnUiThread { closed.onSuccess { project = it; status.text = "项目已关闭并保留全部历史。"; refresh() }
                                .onFailure { message("关闭未完成", it.message ?: "项目状态未改变") } }
                        }.start() }.show()
                }
            }
        }.start()
    }

    private fun renderMaterials(items: List<JSONObject>) {
        if (items.isEmpty()) { empty("当前视图没有资料。可导入文件或扫描用户直接放入工作空间的文件。"); return }
        items.forEach { item ->
            val classification = item.optJSONObject("classification") ?: JSONObject()
            val categoryId = classification.optString("categoryId"); val suggested = classification.optString("suggestedCategoryId")
            val category = actualCategories[categoryId] ?: if (categoryId.isNotBlank()) "原分类目录已移除" else
                if (suggested.isBlank()) "待分类" else "建议：${actualCategories[suggested] ?: "类别已失效"}"
            val card = button("${item.optString("title")}\nv${item.optInt("version")} · $category · ${processingLabel(item.optJSONObject("processing")?.optString("state").orEmpty())}\n${item.optJSONObject("location")?.optString("relativePath").orEmpty()}") {
                materialMenu(item)
            }
            card.textAlignment = View.TEXT_ALIGNMENT_VIEW_START; list.addView(card, matchWrap())
        }
    }

    private fun materialMenu(item: JSONObject) {
        val choices = mutableListOf<String>(); val actions = mutableListOf<() -> Unit>()
        val suggestion = item.optJSONObject("classification")?.optString("suggestedCategoryId").orEmpty()
        if (suggestion in actualCategories) { choices += "采用建议：${actualCategories[suggestion]}"; actions += {
            runCatching { service.classify(project.id, item.getString("materialId"), suggestion) }
                .onSuccess { refresh() }.onFailure { message("分类失败", it.message ?: "未知错误") }
        } }
        choices += "人工选择项目分类"; actions += { classificationDialog(item) }
        choices += "打开本机原件"; actions += { openMaterial(item.getString("materialId")) }
        if (item.optString("availability", "available") != "available") {
            choices += "用同字节文件重新定位"; actions += {
                pendingRelinkMaterialId = item.getString("materialId")
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), REQUEST_RELINK_MATERIAL)
            }
        }
        AlertDialog.Builder(this).setTitle(item.optString("title")).setItems(choices.toTypedArray()) { _, which -> actions[which]() }
            .setNegativeButton("关闭", null).show()
    }

    private fun classificationDialog(item: JSONObject) {
        val entries = actualCategories.entries.toList()
        if (entries.isEmpty()) { message("没有可用分类", "请先在项目工作空间创建分类文件夹，然后重新扫描。收件箱和研究暂存不是正式分类。") ; return }
        AlertDialog.Builder(this).setTitle("确认项目分类").setItems(entries.map { it.value }.toTypedArray()) { _, which ->
            runCatching { service.classify(project.id, item.getString("materialId"), entries[which].key) }
                .onSuccess { status.text = "已人工确认“${entries[which].value}”；原件位置没有改变。"; refresh() }
                .onFailure { message("分类失败", it.message ?: "未知错误") }
        }.show()
    }

    private fun confirmSuggestedClassifications() {
        val candidates = service.list(project.id, "materials").filter {
            val classification = it.optJSONObject("classification")
            classification?.optString("suggestedCategoryId").orEmpty().isNotBlank() && classification?.optBoolean("manualLocked") != true
        }.take(LocalProjectMaterialPolicy.MAX_BATCH)
        if (candidates.isEmpty()) { message("没有待确认建议", "请先生成建议；线索不足的资料会继续保持待分类。") ; return }
        val preview = candidates.take(10).joinToString("\n") {
            "• ${it.optString("title")} → ${actualCategories[it.optJSONObject("classification")?.optString("suggestedCategoryId")] ?: "类别已失效"}"
        }
        AlertDialog.Builder(this).setTitle("确认 ${candidates.size} 条分类建议")
            .setMessage("$preview${if (candidates.size > 10) "\n…另 ${candidates.size - 10} 条" else ""}\n\n确认后记为人工批量确认，后台规则不能覆盖；这一步不移动原件。")
            .setNegativeButton("取消", null).setPositiveButton("确认本批") { _, _ ->
                background("正在保存人工批量确认") {
                    val result = service.acceptSuggestedClassifications(project.id, candidates.map { it.getString("materialId") }.toSet())
                    "批量确认完成：成功 ${result.optInt("succeeded")}，跳过 ${result.optInt("skipped")}"
                }
            }.show()
    }

    private fun renderKnowledge() {
        val files = runCatching { service.knowledgeFiles(project.id) }.getOrElse { empty("知识目录读取失败：${it.message}"); return }
        list.addView(button("打开完整项目知识空间") { openProjectKnowledge() }, matchWrap())
        if (files.isEmpty()) empty("当前还没有项目知识。分类不会自动生成知识；请执行有可用Agent的受控消化。")
        else files.take(200).forEach { file -> list.addView(TextView(this).apply { text = "• ${file.name}\n  ${file.relativePath}"; textSize = 14f; setTextColor(palette.text); setPadding(dp(10), dp(8), dp(10), dp(8)) }, matchWrap()) }
    }

    private fun renderContributions() {
        val files = runCatching { service.contributionFiles(project.id) }.getOrElse {
            empty("贡献目录读取失败：${it.message}"); return
        }
        list.addView(TextView(this).apply {
            text = "资料整理和知识消化不会自动认定学生贡献。这里只显示已经进入项目贡献目录的候选/审核材料；正式贡献仍须绑定固定资料版本并经审核确认。"
            textSize = 14f; setTextColor(palette.muted); setPadding(dp(10), dp(10), dp(10), dp(12))
        }, matchWrap())
        if (files.isEmpty()) empty("当前没有项目贡献材料。分类或消化完成不会自动生成学生贡献。")
        else {
            list.addView(button("在完整项目知识空间中核对") { openProjectKnowledge() }, matchWrap())
            files.forEach { file -> list.addView(TextView(this).apply {
                text = "• ${file.name}\n  ${file.relativePath}"; textSize = 14f; setTextColor(palette.text); setPadding(dp(10), dp(8), dp(10), dp(8))
            }, matchWrap()) }
        }
    }

    private fun renderOutcomes() {
        val outcomes = ProjectOutcomeService(this)
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(button("生成/更新综合报告") { background("正在根据固定项目证据生成项目综合报告") {
            val result = outcomes.generateProgressReport(project.id)
            if (result.optBoolean("reused")) "当前证据未变化，已核对并沿用已发布综合报告" else "新的项目综合报告已校验并发布"
        } }, weighted())
        actions.addView(button("项目导师") { mentorDialog() }, weighted())
        actions.addView(button("查看报告原文") { openProjectKnowledge() }, weighted())
        list.addView(actions, matchWrap())
        list.addView(TextView(this).apply {
            text = "项目报告只汇总本机固定证据；成果文件存在不代表成果质量或个人贡献已确认。项目导师提供任务提示词；复制不会自动读取、发送或修改项目资料。"
            textSize = 14f; setTextColor(palette.muted); setPadding(dp(10), dp(10), dp(10), dp(12))
        }, matchWrap())
        val entries = runCatching { outcomes.listOutcomes(project.id) }.getOrElse { empty("成果库读取失败：${it.message}"); return }
        if (entries.isEmpty()) { empty("当前没有项目报告或成果文件。资料完成消化后，完整自动模式会生成并发布项目进展报告。") ; return }
        entries.forEach { entry ->
            val kind = when (entry.optString("kind")) { "progress_report" -> "项目综合报告"; "mentor_advice" -> "导师建议"; else -> "成果文件" }
            val card = button("${entry.optString("title")}\n$kind · ${entry.optString("status")}\n${entry.optString("path")}") {
                if (entry.optString("kind") == "output_file") openProjectOutput(entry.optString("path")) else openProjectKnowledge()
            }
            card.textAlignment = View.TEXT_ALIGNMENT_VIEW_START; list.addView(card, matchWrap())
        }
    }

    private fun mentorDialog() {
        val studentId = getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, MODE_PRIVATE)
            .getString(MainActivity.KEY_CURRENT_STUDENT_ID, "").orEmpty()
        val student = runCatching { StudentIndexRepository(this).requireExact(studentId) }.getOrNull()
        if (student == null) {
            android.widget.Toast.makeText(this, "请先选择当前学生", android.widget.Toast.LENGTH_LONG).show()
            return
        }
        MentorDialogs.project(this, student, project)
    }

    private fun organizationMenu() {
        val enabled = runCatching { service.status(project.id).optBoolean("organizationEnabled") }.getOrDefault(false)
        val choices = if (enabled) arrayOf("立即整理一次", "关闭自动整理授权", "核对中断整理", "撤销最近整理批次")
            else arrayOf("一次授权启用", "仅保留逻辑分类", "核对中断整理", "撤销最近整理批次")
        AlertDialog.Builder(this).setTitle("本机项目资料整理").setMessage("只处理收件箱直属的安全普通文件；人工分类优先。代码、网页、CAD、附件依赖、同名冲突或提供者不支持安全切换时保持原位。")
            .setItems(choices) { _, which ->
                if (which == 2) background("正在核对整理现场（不删除文件）") {
                    val result = service.recoverOrganization(project.id)
                    "核对完成：已恢复 ${result.optInt("recovered")}，需人工复核 ${result.optInt("attention")}；有歧义时保留所有文件。"
                } else if (which == 3) AlertDialog.Builder(this).setTitle("撤销最近整理批次")
                    .setMessage("仅恢复原件位置，不改变人工分类、消化或贡献状态。文件已修改、原位置被占用或登记变化时逐项拒绝，不覆盖文件。")
                    .setNegativeButton("取消", null).setPositiveButton("安全撤销") { _, _ ->
                        background("正在撤销最近整理批次") {
                            val result = service.undoLatestOrganization(project.id)
                            "撤销完成：成功 ${result.optInt("succeeded")}，未撤销 ${result.optInt("failed")}；异常原件保留。"
                        }
                    }.show()
                else if (!enabled && which == 0) {
                    service.configureOrganization(project.id, true); status.text = "已授权本机安全整理；不会扩大到知识目录或外部应用。"; refresh()
                } else if (enabled && which == 1) {
                    service.configureOrganization(project.id, false); refresh()
                } else if (enabled && which == 0) background("正在整理安全资料") {
                    val result = service.organizeInbox(project.id); "整理完成：成功 ${result.optInt("succeeded")}，异常 ${result.optInt("failed")}"
                }
            }.setNegativeButton("取消", null).show()
    }

    private fun migrationMenu() {
        AlertDialog.Builder(this).setTitle("历史资料迁移与恢复")
            .setMessage("迁移不是启动时自动执行。先预览再逐项校验；中断现场保留，回滚只在来源、目标、备份和登记仍可唯一核对时执行。")
            .setItems(arrayOf("预览并执行本批安全项", "恢复中断状态", "安全回滚最近一次迁移")) { _, which ->
                when (which) {
                    0 -> previewMigration()
                    1 -> background("正在核对中断现场") {
                        val result = service.recoverMigration(project.id)
                        "恢复核对完成：可恢复 ${result.optInt("recovered")}，需人工核对 ${result.optInt("attention")}"
                    }
                    else -> AlertDialog.Builder(this).setTitle("确认安全回滚")
                        .setMessage("仅回滚最近一次仍满足完整哈希、登记位置和无覆盖条件的迁移项。任何后续变化都会逐项拒绝；备份继续保留。")
                        .setNegativeButton("取消", null).setPositiveButton("执行回滚") { _, _ ->
                            background("正在从迁移备份安全回滚") {
                                val result = service.rollbackLatestMigration(project.id)
                                "回滚完成：成功 ${result.optInt("succeeded")}，失败 ${result.optInt("failed")}；状态 ${migrationLabel(result.optString("migrationState"))}"
                            }
                        }.show()
                }
            }.setNegativeButton("取消", null).show()
    }

    private fun previewMigration() {
        background("正在只读预览历史资料") {
            val preview = service.previewMigration(project.id)
            val items = preview.getJSONArray("items"); var migrate = 0; var associate = 0; var preserve = 0
            val safeIds = linkedSetOf<String>()
            for (index in 0 until items.length()) items.getJSONObject(index).let {
                when (it.getString("action")) { "migrate" -> { migrate++; safeIds += it.getString("itemId") }; "associate" -> { associate++; safeIds += it.getString("itemId") }; else -> preserve++ }
            }
            runOnUiThread {
                AlertDialog.Builder(this).setTitle("历史资料迁移预览")
                    .setMessage("工作空间原位登记 $associate · 可迁移 $migrate · 保留原位 $preserve。\n\n外部接管知识库、附件依赖、目标冲突均不会移动。每批最多50项，迁移前后逐份校验并保留备份。")
                    .setNegativeButton("只保留预览", null).setPositiveButton("执行本批安全项") { _, _ ->
                        if (safeIds.isEmpty()) message("无需执行", "本次没有可安全迁移的项目。")
                        else background("正在执行受控迁移") {
                            val result = service.executeMigration(project.id, safeIds.take(LocalProjectMaterialPolicy.MAX_BATCH).toSet())
                            "迁移结果：成功 ${result.optInt("succeeded")}，待核对 ${result.optInt("attention")}；状态 ${migrationLabel(result.optString("migrationState"))}"
                        }
                    }.show()
            }
            "迁移预览完成"
        }
    }

    private fun chooseFiles() {
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true).addCategory(Intent.CATEGORY_OPENABLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), REQUEST_IMPORT)
    }

    private fun confirmProjectExport() {
        AlertDialog.Builder(this).setTitle("导出项目包")
            .setMessage("请选择一个空目录。项目包会保存项目工作空间、原件、知识、资料登记与固定版本，并保留项目/资料身份；不会导出激活码、设备码、Agent API Key、Keystore 或目录授权。\n\n这是显式离线交换，不会与另一台设备自动同步。")
            .setNegativeButton("取消", null).setPositiveButton("选择空目录") { _, _ ->
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION), REQUEST_EXPORT_PACKAGE)
            }.show()
    }

    private fun rebindMenu() {
        val choices = if (project.knowledgeMode == "adopted") arrayOf("重新授权项目控制/工作空间", "重新授权外部项目知识库")
            else arrayOf("重新授权本机项目根目录")
        AlertDialog.Builder(this).setTitle("修复项目目录授权")
            .setMessage("请选择原项目所在的授权根目录。系统只核对项目结构和登记身份，不按文件名猜测另一份项目，也不会搬动原件。")
            .setItems(choices) { _, which ->
                val request = if (project.knowledgeMode == "adopted" && which == 1) REQUEST_REBIND_KNOWLEDGE else REQUEST_REBIND_CONTROL
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION), request)
            }.setNegativeButton("取消", null).show()
    }

    private fun openMaterial(materialId: String) {
        runCatching { service.materialDocument(project.id, materialId) }.onSuccess { (uri, mime) ->
            try { startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "打开项目原件")) }
            catch (_: ActivityNotFoundException) { message("没有查看应用", "设备上没有能够打开此文件类型的应用。原件保持不变。") }
        }.onFailure { message("原件不可用", it.message ?: "请重新授权项目目录") }
    }

    private fun openProjectOutput(path: String) {
        runCatching {
            require(path == project.paths.outputPath || path.startsWith("${project.paths.outputPath.trimEnd('/')}/")) { "成果路径超出当前项目" }
            val document = requireNotNull(SafWorkspaceStore(this, Uri.parse(project.projectRootUri)).document(path)) { "成果文件不存在" }
            require(document.isFile) { "成果记录不是文件" }
            document.uri to document.type.orEmpty().ifBlank { "application/octet-stream" }
        }.onSuccess { (uri, mime) ->
            try { startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "打开项目成果")) }
            catch (_: ActivityNotFoundException) { message("没有查看应用", "设备上没有能够打开此成果类型的应用。") }
        }.onFailure { message("成果不可用", it.message ?: "请重新授权项目目录") }
    }

    private fun openProjectKnowledge() { startActivity(Intent(this, MarkdownBrowserActivity::class.java)
        .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_PROJECT)
        .putExtra(MarkdownBrowserActivity.EXTRA_PROJECT_ID, project.id).putExtra(MarkdownBrowserActivity.EXTRA_TITLE, "${project.name} · 项目知识")) }

    private fun background(working: String, task: () -> String) {
        status.text = working
        Thread { val result = runCatching(task); runOnUiThread { result.onSuccess { status.text = it; refresh() }
            .onFailure { status.text = "未完成：${it.message ?: "未知错误"}" } } }.start()
    }

    private fun displayName(uri: Uri): String {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0).orEmpty().ifBlank { "项目资料" }
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "项目资料"
    }
    private fun migrationLabel(value: String) = when (value) { "complete" -> "已统一"; "partial" -> "部分统一"; "attention" -> "需要核对"; "running" -> "迁移中"; "previewed" -> "已预览"; else -> "旧模式" }
    private fun processingLabel(value: String) = when (value) { "completed" -> "已消化"; "failed" -> "消化异常"; else -> "待消化" }
    private fun digestQueueLabel(value: String) = when (value) { "queued" -> "等待系统条件"; "running" -> "处理中"; "completed" -> "已完成"; "needs_user" -> "结果未知，须核对"; "cancelled" -> "已人工结束"; "failed" -> "异常，可重新加入"; else -> value.ifBlank { "未排队" } }
    private fun message(title: String, body: String) { AlertDialog.Builder(this).setTitle(title).setMessage(body).setPositiveButton("知道了", null).show() }
    private fun empty(text: String) { list.addView(TextView(this).apply { this.text = text; textSize = 14f; setTextColor(palette.muted); setPadding(dp(14), dp(28), dp(14), dp(28)) }, matchWrap()) }
    private fun button(label: String, action: () -> Unit) = Button(this).apply { text = label; YouthUi.applyButton(this, palette, YouthButtonRole.SECONDARY); setOnClickListener { action() } }
    private fun LinearLayout.children() = (0 until childCount).map(::getChildAt)
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROJECT_ID = "projectId"
        const val EXTRA_INITIAL_TAB = "initialTab"
        const val EXTRA_OPEN_MENTOR = "openMentor"
        private const val REQUEST_IMPORT = 3401
        private const val REQUEST_EXPORT_PACKAGE = 3402
        private const val REQUEST_REBIND_CONTROL = 3403
        private const val REQUEST_REBIND_KNOWLEDGE = 3404
        private const val REQUEST_RELINK_MATERIAL = 3405
    }
}
