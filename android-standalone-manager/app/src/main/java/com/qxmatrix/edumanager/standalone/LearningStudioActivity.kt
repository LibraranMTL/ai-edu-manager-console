package com.qxmatrix.edumanager.standalone

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.widget.*
import org.json.JSONObject
import java.util.concurrent.Executors

/** Student-scoped reference suggestions. Technical receipts and immutable history stay behind details. */
class LearningStudioActivity : Activity() {
    private lateinit var studentId: String
    private lateinit var palette: UiPalette
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var identity: TextView
    private lateinit var moduleFilter: Spinner
    private val worker = Executors.newSingleThreadExecutor()
    private var mode = MODE_SUGGESTIONS
    private var offset = 0
    private var generation = 0
    private var running = false
    private var answerVersion: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        studentId = intent.getStringExtra(EXTRA_STUDENT_ID).orEmpty()
        if (studentId.isBlank()) { finish(); return }
        mode = normalizeMode(savedInstanceState?.getString(STATE_MODE) ?: intent.getStringExtra(EXTRA_INITIAL_MODE))
        offset = savedInstanceState?.getInt(STATE_OFFSET, 0) ?: 0
        val ui = UiPreferences(this); palette = ui.palette(); ui.applyOrientation(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 12, 16, 12)
            setBackgroundColor(palette.page)
        }
        status = text("正在读取智能参考建议…", 18f); root.addView(status)
        root.addView(text("系统根据当前学生资料自动更新参考建议。建议只用于启发和安排下一步，不替用户作决定。", 14f))

        val firstTabs = LinearLayout(this)
        firstTabs.addView(button("为你生成的建议") { switchMode(MODE_SUGGESTIONS) }, LinearLayout.LayoutParams(0, -2, 1f))
        firstTabs.addView(button("今日学习与下一步") { switchMode(MODE_TODAY) }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(firstTabs)
        val secondTabs = LinearLayout(this)
        secondTabs.addView(button("我的进展") { switchMode(MODE_PROGRESS) }, LinearLayout.LayoutParams(0, -2, 1f))
        secondTabs.addView(button("历史建议") { switchMode(MODE_HISTORY) }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(secondTabs)

        val labels = listOf("全部类别") + LearningStudioService.moduleLabels.values
        moduleFilter = Spinner(this).apply {
            adapter = ArrayAdapter(this@LearningStudioActivity, android.R.layout.simple_spinner_dropdown_item, labels)
        }
        root.addView(moduleFilter)
        val requestedModule = savedInstanceState?.getString(STATE_MODULE) ?: intent.getStringExtra("module")
        LearningStudioService.moduleLabels.keys.indexOf(requestedModule).takeIf { it >= 0 }?.let { moduleFilter.setSelection(it + 1) }
        moduleFilter.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (::list.isInitialized) { offset = 0; refresh() }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }

        val controls = LinearLayout(this)
        controls.addView(button("建议设置") { showSuggestionSettings() }, LinearLayout.LayoutParams(0, -2, 1f))
        controls.addView(button("立即更新") {
            StudioAutomation.enqueueCheck(this, studentId)
            status.text = "已安排更新；可以继续使用应用，完成后会自动显示"
        }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(controls)
        root.addView(button("从公共模板添加学习卡") { showPublicLearningCards() })

        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list)
        root.addView(button("下一页") { offset += PAGE_SIZE; refresh() })
        root.addView(button("返回") { finish() })

        val shell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(palette.page) }
        identity = text("当前学生：$studentId", 18f); shell.addView(identity)
        shell.addView(ScrollView(this).apply { addView(root) }, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(shell)

        worker.execute {
            val name = runCatching { StudentIndexRepository(this).requireExact(studentId).name }
            runOnUiThread { if (current()) identity.text = name.fold({ "当前学生：$it" }, { "学生档案读取失败" }) }
        }
        refresh()
    }

    override fun onDestroy() { generation++; worker.shutdownNow(); super.onDestroy() }
    override fun onResume() { super.onResume(); if (::studentId.isInitialized && !current()) finish() }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(STATE_MODE, mode)
        outState.putString(STATE_MODULE, selectedModule())
        outState.putInt(STATE_OFFSET, offset)
        super.onSaveInstanceState(outState)
    }

    private fun current() = !isFinishing && !isDestroyed &&
        getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, MODE_PRIVATE)
            .getString(MainActivity.KEY_CURRENT_STUDENT_ID, "") == studentId

    private fun text(value: String, size: Float = 15f) = TextView(this).apply {
        text = value; textSize = size; setTextColor(palette.text); setPadding(8, 8, 8, 8)
    }
    private fun button(value: String, action: () -> Unit) = Button(this).apply {
        text = value; minHeight = 48
        setOnClickListener { if (current()) action() else finish() }
    }
    private fun switchMode(next: String) { mode = next; offset = 0; refresh() }
    private fun selectedModule(): String = if (!::moduleFilter.isInitialized || moduleFilter.selectedItemPosition <= 0) ""
        else LearningStudioService.moduleLabels.keys.elementAt(moduleFilter.selectedItemPosition - 1)

    private fun refresh() {
        if (!current()) { finish(); return }
        if (running || !::list.isInitialized) return
        val request = ++generation; val wantedMode = mode; val module = selectedModule(); val start = offset
        worker.execute {
            val result = runCatching { loadRows(ScopedContentRepository(this), wantedMode, module, start) }
            runOnUiThread {
                if (request != generation || !current()) return@runOnUiThread
                list.removeAllViews()
                result.onSuccess { rows ->
                    status.text = "${modeLabel(wantedMode)} · ${rows.size} 项 · 第 ${start / PAGE_SIZE + 1} 页"
                    if (rows.isEmpty()) list.addView(text(emptyMessage(wantedMode)))
                    rows.forEach { row ->
                        list.addView(button(rowLabel(row)) { details(row.id) })
                    }
                }.onFailure {
                    status.text = "暂时无法读取；原有记录已保留"
                    list.addView(text(it.message ?: "请稍后重试"))
                }
            }
        }
    }

    private fun loadRows(repo: ScopedContentRepository, wantedMode: String, module: String, start: Int): List<ScopedContentEntity> {
        val rows = when (wantedMode) {
            MODE_TODAY -> repo.list(studentId, listOf("artifact", "action"), 100).filter { row ->
                (row.kind == "artifact" && payloadModule(row) == "cards") || (row.kind == "action" && row.state in setOf("planned", "doing"))
            }
            MODE_PROGRESS -> repo.list(studentId, listOf("attempt", "review", "action", "action_event"), 100)
            MODE_HISTORY -> repo.list(studentId, listOf("artifact", "favorite", "draft", "decision"), 100)
            else -> repo.list(studentId, listOf("artifact"), 100).distinctBy(::payloadModule)
        }
        return rows.filter { module.isBlank() || payloadModule(it) == module }.drop(start).take(PAGE_SIZE)
    }

    private fun payloadModule(row: ScopedContentEntity): String = runCatching {
        val payload = JSONObject(row.payload)
        payload.optString("module").ifBlank {
            payload.optJSONObject("candidateSnapshot")?.optString("module")
                ?: payload.optJSONObject("evidenceSnapshot")?.optString("module").orEmpty()
        }
    }.getOrDefault("")

    private fun rowLabel(row: ScopedContentEntity): String {
        val kind = when (row.kind) {
            "artifact" -> if (payloadModule(row) == "cards") "学习卡片" else "参考建议"
            "favorite" -> "已留存"
            "attempt" -> "学习记录"
            "review" -> "历史反馈"
            "action" -> "下一步"
            "action_event" -> "进展记录"
            "decision" -> "不感兴趣"
            "draft" -> "项目灵感"
            else -> "记录"
        }
        val state = when (row.state) {
            "candidate", "available" -> "可参考"
            "pending_review", "reviewed", "recorded" -> "已记录"
            "planned" -> "待开始"
            "doing" -> "进行中"
            "done" -> "已完成"
            "paused" -> "已暂停"
            "ignored" -> "不再显示"
            "restored" -> "已恢复"
            "saved" -> "已留存"
            "needs_user" -> "项目灵感"
            else -> row.state
        }
        return "${row.title} · $kind · $state\n${row.updatedAt}"
    }

    private fun details(id: String) {
        worker.execute {
            val result = runCatching { ScopedContentRepository(this).exact(studentId, id) }
            runOnUiThread {
                if (!current()) return@runOnUiThread
                result.onSuccess { row -> showDetails(row) }
                    .onFailure { status.text = "暂时无法打开；原记录仍保留" }
            }
        }
    }

    private fun showDetails(row: ScopedContentEntity) {
        val actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val payload = runCatching { JSONObject(row.payload) }.getOrNull()
        actions.addView(text(if (row.kind in setOf("artifact", "favorite") && payload != null) readable(payload) else row.payload.take(60_000)))
        val dialog = AlertDialog.Builder(this).setTitle(row.title)
            .setView(ScrollView(this).apply { addView(actions) }).setNegativeButton("关闭", null).create()

        if (row.kind == "artifact" && payload != null) {
            val module = payload.optString("module")
            if (module == "cards") {
                actions.addView(button("提交文字作答") { dialog.dismiss(); answerText(row.id) })
                actions.addView(button("提交作答文件（本地归档）") {
                    answerVersion = row.id
                    startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, ANSWER_FILE)
                    dialog.dismiss()
                })
                actions.addView(button("分享题目（无答案）") {
                    val clean = LearningStudioPolicy.questionsOnly(payload)
                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, clean), "分享练习题"))
                })
                actions.addView(button("打印题目／存为PDF（无答案）") {
                    (getSystemService(PRINT_SERVICE) as android.print.PrintManager).print("学习练习", QuestionsPrintAdapter(this, payload), null)
                })
            } else {
                actions.addView(button("选择一项作为下一步") { dialog.dismiss(); chooseNextStep(row) })
                if (module == "topics") actions.addView(button("据此创建项目") { dialog.dismiss(); chooseProjectIdea(row) })
                actions.addView(button("分享参考摘要到云端") { dialog.dismiss(); previewCloudSummary(row.id) })
            }
            actions.addView(button("留存这份建议") {
                dialog.dismiss(); background("正在留存…", refreshAfter = true) {
                    ScopedContentRepository(this).favorite(studentId, row.id); "已留存；历史版本不会被覆盖"
                }
            })
        } else if (row.kind == "favorite") {
            actions.addView(button("取消留存") {
                dialog.dismiss(); background("正在更新…", refreshAfter = true) {
                    ScopedContentRepository(this).removeFavorite(studentId, row.id); "已取消留存；历史建议仍保留"
                }
            })
        } else if (row.kind == "decision" && row.state == "ignored") {
            actions.addView(button("重新显示这项建议") {
                dialog.dismiss(); background("正在恢复…", refreshAfter = true) {
                    ScopedContentRepository(this).restoreIgnored(studentId, row.id); "已恢复显示"
                }
            })
        } else if (row.kind == "draft") {
            actions.addView(button("据此创建项目") {
                startActivity(Intent(this, MainActivity::class.java).putExtra("studioDraftId", row.id).putExtra("studioStudentId", studentId))
                dialog.dismiss()
            })
        } else if (row.kind == "action") {
            actions.addView(button("更新我的进展") { dialog.dismiss(); progressAction(row) })
        }
        dialog.show()
    }

    private fun chooseNextStep(row: ScopedContentEntity) {
        val items = JSONObject(row.payload).getJSONObject("result").getJSONArray("items")
        AlertDialog.Builder(this).setTitle("选择一项参考建议")
            .setItems(Array(items.length()) { items.getJSONObject(it).optString("title", "建议 ${it + 1}") }) { _, index ->
                AlertDialog.Builder(this).setTitle("接下来怎么处理？")
                    .setItems(arrayOf("加入下一步", "不感兴趣")) { _, action ->
                        background("正在保存…", refreshAfter = true) {
                            val repo = ScopedContentRepository(this)
                            if (action == 0) { repo.adopt(studentId, row.id, index); "已加入下一步" }
                            else { repo.ignore(studentId, row.id, index); "以后不再优先显示这项建议" }
                        }
                    }.show()
            }.show()
    }

    private fun chooseProjectIdea(row: ScopedContentEntity) {
        val items = JSONObject(row.payload).getJSONObject("result").getJSONArray("items")
        AlertDialog.Builder(this).setTitle("选择项目灵感")
            .setItems(Array(items.length()) { items.getJSONObject(it).optString("title", "项目灵感 ${it + 1}") }) { _, index ->
                background("正在准备项目…") {
                    val draft = ScopedContentRepository(this).draft(studentId, row.id, index)
                    runOnUiThread {
                        if (current()) startActivity(Intent(this, MainActivity::class.java)
                            .putExtra("studioDraftId", draft.id).putExtra("studioStudentId", studentId))
                    }
                    "已准备可编辑项目"
                }
            }.show()
    }

    private fun answerText(version: String) {
        val answer = EditText(this).apply { hint = "写下作答"; minLines = 3 }
        AlertDialog.Builder(this).setTitle("提交文字作答").setView(answer)
            .setNegativeButton("取消", null).setPositiveButton("保存作答") { _, _ ->
                val value = answer.text.toString()
                background("保存作答…", refreshAfter = true) {
                    require(value.isNotBlank()) { "作答不能为空" }
                    ScopedContentRepository(this).attempt(studentId, version, JSONObject().put("text", value))
                    "作答已保存并回流；参考建议和报告会在处理完成后更新"
                }
            }.show()
    }

    private fun showPublicLearningCards() {
        if (running) { status.text = "已有操作处理中"; return }
        running = true; status.text = "正在读取已签名的公共学习卡…"
        worker.execute {
            val result = runCatching { PublicLearningCardService(this).available(studentId) }
            runOnUiThread {
                running = false
                if (!current()) return@runOnUiThread
                result.onFailure { status.text = "暂时无法读取公共学习卡：${it.message}" }.onSuccess { choices ->
                    if (choices.isEmpty()) {
                        status.text = "当前语言和年级暂无适用的公共学习卡"
                        return@onSuccess
                    }
                    AlertDialog.Builder(this).setTitle("选择公共学习卡")
                        .setItems(choices.map { "${it.subject} · ${it.prompt}" }.toTypedArray()) { _, index ->
                            val choice = choices[index]
                            mode = MODE_TODAY; offset = 0
                            background("正在创建学生专属学习卡…", refreshAfter = true) {
                                PublicLearningCardService(this).instantiate(studentId, choice.templateRevision)
                                "学习卡已加入今日学习；公共模板本身未写入学生档案"
                            }
                        }.setNegativeButton("取消", null).show()
                }
            }
        }
    }

    private fun progressAction(row: ScopedContentEntity) {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val states = arrayOf("planned", "doing", "done", "paused")
        val choice = Spinner(this).apply {
            adapter = ArrayAdapter(this@LearningStudioActivity, android.R.layout.simple_spinner_dropdown_item,
                listOf("待开始", "进行中", "已完成", "暂时搁置"))
            setSelection(states.indexOf(row.state).coerceAtLeast(0))
        }
        val note = EditText(this).apply { hint = "补充说明（选填）"; minLines = 2 }
        panel.addView(choice); panel.addView(note)
        val operation = java.util.UUID.randomUUID().toString()
        AlertDialog.Builder(this).setTitle("更新我的进展").setView(panel)
            .setNegativeButton("取消", null).setPositiveButton("保存") { _, _ ->
                val next = states[choice.selectedItemPosition]
                val reason = note.text.toString().trim().ifBlank { "用户更新进展" }
                background("保存进展…", refreshAfter = true) {
                    ScopedContentRepository(this).actionProgress(studentId, row.id, row.state, next, reason, operation)
                    StudioAutomation.enqueueCheck(this, studentId)
                    "进展已保存；系统会自动更新相关建议"
                }
            }.show()
    }

    private fun showSuggestionSettings() {
        worker.execute {
            val state = runCatching { Triple(StudioAutomation(this).enabled(studentId),
                ResearchUpdateService(this).networkEnabled(studentId), LearningReminderStore(this).enabled(studentId)) }
            runOnUiThread {
                if (!current()) return@runOnUiThread
                state.onFailure { status.text = "暂时无法读取设置" }.onSuccess { (enabled, network, reminder) ->
                    // Huawei's AlertDialog implementation drops setItems when it is combined
                    // with setMessage. Keep all controls in a concrete, touch-sized view instead.
                    val panel = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(18, 8, 18, 4)
                        addView(text("自动建议：${if (enabled) "已开启" else "已关闭"}\n联网参考：${if (network) "已允许" else "未允许"}\n学习提醒：${if (reminder) "已开启" else "已关闭"}", 17f))
                    }
                    var dialog: AlertDialog? = null
                    fun settingButton(label: String, action: () -> Unit) {
                        panel.addView(button(label) { dialog?.dismiss(); action() },
                            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                    }
                    settingButton(if (enabled) "关闭智能参考建议" else "开启智能参考建议") {
                        if (enabled) background("正在关闭…") {
                                StudioAutomation(this).setEnabled(studentId, false); "已关闭自动更新；已有建议继续保留"
                            } else confirmEnableAutomation()
                    }
                    settingButton(if (network) "关闭联网参考建议" else "允许联网参考建议") {
                        if (network) background("正在关闭联网更新…") {
                                ResearchUpdateService(this).setNetworkEnabled(studentId, false); "已关闭联网更新；已有建议继续保留"
                            } else confirmNetworkPermission()
                    }
                    settingButton(if (reminder) "关闭自动学习提醒" else "开启自动学习提醒") {
                        if (reminder) background("正在关闭提醒…") {
                                LearningReminderStore(this).setEnabled(studentId, false); "已关闭学习提醒"
                            } else confirmLearningReminder()
                    }
                    settingButton("立即更新") { StudioAutomation.enqueueCheck(this, studentId); status.text = "已安排更新" }
                    dialog = AlertDialog.Builder(this).setTitle("智能参考建议设置")
                        .setView(panel).setNegativeButton("返回", null).show()
                }
            }
        }
    }

    private fun confirmEnableAutomation() {
        AlertDialog.Builder(this).setTitle("开启智能参考建议")
            .setMessage("系统会在资料、学习结果或项目信息变化后自动更新建议，并每月检查一次。建议仅供参考，不会替你报名、申请或修改档案。")
            .setNegativeButton("取消", null).setPositiveButton("开启") { _, _ ->
                background("正在开启…") { StudioAutomation(this).setEnabled(studentId, true); "已开启；系统将在后台分批更新" }
            }.show()
    }

    private fun confirmNetworkPermission() {
        AlertDialog.Builder(this).setTitle("允许联网参考建议")
            .setMessage("联网时仅发送脱敏后的学习档案、年级、目标和必要结构化依据；不默认上传原始文件、照片、录音、完整对话或完整知识库。你可以随时关闭。")
            .setNegativeButton("取消", null).setPositiveButton("允许") { _, _ ->
                background("正在保存许可…") {
                    StudioAutomation(this).setEnabled(studentId, true)
                    ResearchUpdateService(this).setNetworkEnabled(studentId, true)
                    "已允许；八类参考建议将按额度分批自动更新"
                }
            }.show()
    }

    private fun confirmLearningReminder() {
        AlertDialog.Builder(this).setTitle("开启自动学习提醒")
            .setMessage("每天最多提醒一次未完成的学习卡片和下一步。提醒只读取本地状态，不联网，也不会触发模型调用。")
            .setNegativeButton("取消", null).setPositiveButton("开启") { _, _ ->
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION)
                } else enableLearningReminder()
            }.show()
    }

    private fun enableLearningReminder() = background("正在开启提醒…") {
        LearningReminderStore(this).setEnabled(studentId, true); "已开启自动学习提醒"
    }

    private fun previewCloudSummary(versionId: String) {
        worker.execute {
            val prepared = runCatching { CloudSummaryService(this).prepare(studentId, versionId) }
            runOnUiThread {
                if (!current()) return@runOnUiThread
                prepared.onFailure { status.text = "云分享未开始：${it.message}" }.onSuccess { preview ->
                    AlertDialog.Builder(this).setTitle("分享参考摘要")
                        .setView(ScrollView(this).apply { addView(text("仅上传以下摘要；原件、完整档案、作答和本机路径不上传。\n\n${preview.text}")) })
                        .setNegativeButton("取消", null).setPositiveButton("确认上传") { _, _ ->
                            if (current()) background("正在上传参考摘要…") { CloudSummaryService(this).publish(preview) }
                        }.show()
                }
            }
        }
    }

    private fun readable(payload: JSONObject): String = buildString {
        val module = payload.optString("module")
        appendLine("${LearningStudioService.moduleLabels[module] ?: "参考建议"} · ${payload.optString("createdAt")}")
        appendLine("以下内容仅供参考，不替用户作决定。")
        ResearchUpdatePolicy.expiryLabel(payload).takeIf(String::isNotBlank)?.let { appendLine(it) }
        val items = payload.optJSONObject("result")?.optJSONArray("items") ?: return@buildString
        for (i in 0 until items.length()) {
            appendLine("\n${i + 1}.")
            val item = items.getJSONObject(i)
            val visibleFields = if (module == "cards") listOf("question") else LearningStudioPolicy.fields[module].orEmpty()
            visibleFields.forEach { field -> appendLine("$field：${item.optString(field)}") }
        }
        if (module == "cards") appendLine("\n答案与解析不会在作答前显示。")
        appendLine("\n查看依据与历史")
        val sources = payload.optJSONArray("sources")
        if (sources != null) for (i in 0 until sources.length()) {
            val source = sources.getJSONObject(i)
            appendLine("${source.optString("title")}\n${source.optString("url")}\n检索时间 ${source.optString("retrievedAt")}")
        }
        if (module in setOf("competitions", "pathways", "schools")) appendLine("请以官方最新通知为准。")
    }

    private fun background(message: String, refreshAfter: Boolean = false, action: () -> String) {
        if (running) { status.text = "已有操作处理中"; return }
        running = true; status.text = message
        worker.execute {
            val result = runCatching(action)
            runOnUiThread {
                running = false
                if (!current()) return@runOnUiThread
                status.text = result.getOrElse { "操作暂未完成；原有记录已保留：${it.message}" }
                if (refreshAfter) refresh()
            }
        }
    }

    @Deprecated("Legacy Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != ANSWER_FILE || resultCode != RESULT_OK || !current()) return
        val uri = data?.data ?: return; val version = answerVersion ?: return; answerVersion = null
        background("校验并归档作答文件…", refreshAfter = true) {
            val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            } ?: error("无法读取文件名")
            val bytes = requireNotNull(contentResolver.openInputStream(uri)).use { it.readBytesBounded(AnswerFilePolicy.MAX_BYTES) }
            val mime = AnswerFilePolicy.validate(name, bytes)
            val imported = FileAssetService(this).importValidatedBytes(studentId, name, bytes, mime, "学习卡片作答", uri.toString())
            ScopedContentRepository(this).attempt(studentId, version,
                JSONObject().put("material", imported.getJSONObject("material")).put("sha256", ScopedContentPolicy.hash(bytes)))
            "作答文件已归档并回流；参考建议和报告会在处理完成后更新"
        }
    }

    @Deprecated("Legacy permission result API")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != NOTIFICATION_PERMISSION || !current()) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) enableLearningReminder()
        else status.text = "未开启通知权限；其他功能不受影响"
    }

    private fun normalizeMode(value: String?): String = when (value) {
        MODE_TODAY, "action" -> MODE_TODAY
        MODE_PROGRESS, "attempt", "review", "action_event" -> MODE_PROGRESS
        MODE_HISTORY, "search", "favorite", "draft", "decision" -> MODE_HISTORY
        else -> MODE_SUGGESTIONS
    }
    private fun modeLabel(value: String) = when (value) {
        MODE_TODAY -> "今日学习与下一步"
        MODE_PROGRESS -> "我的进展"
        MODE_HISTORY -> "历史建议"
        else -> "为你生成的建议"
    }
    private fun emptyMessage(value: String) = when (value) {
        MODE_TODAY -> "今天暂无待办。开启智能参考建议后，学习卡片和下一步会自动出现在这里。"
        MODE_PROGRESS -> "完成学习卡片或更新下一步后，这里会显示进展。"
        MODE_HISTORY -> "尚无历史建议；新建议生成后会自动保留版本。"
        else -> "建议正在准备。请确认已开启智能参考建议；已有资料完成整理后会自动更新。"
    }

    companion object {
        const val EXTRA_STUDENT_ID = "studentId"
        const val EXTRA_INITIAL_MODE = "initialMode"
        private const val MODE_SUGGESTIONS = "suggestions"
        private const val MODE_TODAY = "today"
        private const val MODE_PROGRESS = "progress"
        private const val MODE_HISTORY = "history"
        private const val STATE_MODE = "studio_mode"
        private const val STATE_MODULE = "studio_module"
        private const val STATE_OFFSET = "studio_offset"
        private const val ANSWER_FILE = 804
        private const val NOTIFICATION_PERMISSION = 805
        private const val PAGE_SIZE = 50
    }
}
