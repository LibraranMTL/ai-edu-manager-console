package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.*
import org.json.JSONObject
import java.util.concurrent.Executors

/** Native local browser. Every callback is tied to the exact student captured at entry. */
class LearningStudioActivity : Activity() {
    private lateinit var studentId: String
    private lateinit var palette: UiPalette
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var identity: TextView
    private lateinit var query: EditText
    private lateinit var topic: EditText
    private lateinit var modules: Spinner
    private lateinit var quantity: Spinner
    private lateinit var recent: CheckBox
    private lateinit var feedback: CheckBox
    private val worker = Executors.newSingleThreadExecutor()
    private val selected = linkedSetOf<String>()
    private var mode = "search"
    private var offset = 0
    private var generation = 0
    private var running = false
    private var cancellation = ModelCancellation()
    private var answerVersion: String? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        studentId = intent.getStringExtra(EXTRA_STUDENT_ID).orEmpty()
        if (studentId.isBlank()) { finish(); return }
        val ui = UiPreferences(this); palette = ui.palette(); ui.applyOrientation(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(16, 12, 16, 12); setBackgroundColor(palette.page) }
        status = text("当前学生 · 内容与行动", 20f); root.addView(status)
        root.addView(text("搜索不上传资料。生成仅产生候选；收藏保留版本；作答待审核，不自动计为掌握。", 13f))
        query = EditText(this).apply { hint = "搜索原件、知识、项目、报告和收藏"; setSingleLine() }; root.addView(query)
        root.addView(button("搜索本机索引") { mode = "search"; offset = 0; refresh() })
        root.addView(button("更新文件索引（不移动、不消化、不上传）") {
            background("正在索引…") { val result = StudentContentIndexer(this).rebuild(studentId); "索引 ${result.indexed} 项${if (result.complete) "" else "（部分）"}\n${result.warnings.joinToString("\n")}" }
        })
        val tabs = LinearLayout(this)
        listOf("artifact" to "版本", "favorite" to "收藏", "attempt" to "作答", "draft" to "草稿").forEach { (id, label) ->
            tabs.addView(button(label) { mode = id; offset = 0; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        }; root.addView(tabs)
        val feedbackTabs = LinearLayout(this)
        listOf("review" to "审核", "action" to "行动", "action_event" to "进度", "decision" to "忽略").forEach { (id, label) ->
            feedbackTabs.addView(button(label) { mode = id; offset = 0; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        }; root.addView(feedbackTabs)
        root.addView(button("筛选当前列表／返回第一页") { offset = 0; refresh() })
        val labels = LearningStudioService.moduleLabels
        modules = Spinner(this).apply { adapter = ArrayAdapter(this@LearningStudioActivity, android.R.layout.simple_spinner_dropdown_item, labels.values.toList()) }; root.addView(modules)
        intent.getStringExtra("module")?.let { requested -> labels.keys.indexOf(requested).takeIf { it >= 0 }?.let { modules.setSelection(it); if (requested != "cards") mode = "artifact" } }
        topic = EditText(this).apply { hint = "主题、难度或研究要求（选填）"; setSingleLine() }; root.addView(topic)
        quantity = Spinner(this).apply { adapter = ArrayAdapter(this@LearningStudioActivity, android.R.layout.simple_spinner_dropdown_item, (1..10).map { "生成 $it 项" }); setSelection(2) }; root.addView(quantity)
        root.addView(button("比较当前类别的最近两个版本") { compareVersions() })
        recent = CheckBox(this).apply { text = "近期学习入口：仅使用选中的已发布报告" }; root.addView(recent)
        feedback = CheckBox(this).apply { text = "练习使用相关人工审核摘要（默认不发送，先核对预览）" }; root.addView(feedback)
        root.addView(button("生成候选（先确认云端内容）") { confirmGenerate() })
        root.addView(button("取消当前模型请求") { cancellation.cancel(); status.text = "已请求取消；服务端可能已计费，不自动重试" })
        root.addView(button("自动练习：授权／关闭／手动检查") {
            AlertDialog.Builder(this).setTitle("自动练习设置（默认关闭）").setItems(arrayOf("授权每日检查已发布报告", "关闭自动练习", "现在检查一次")) { _, choice ->
                if (choice == 0) AlertDialog.Builder(this).setTitle("授权自动模型处理")
                    .setMessage("每日满足系统条件时，发送去姓名后的已发布报告片段生成候选练习。正文仍可能含其他个人信息，请先核对报告。每个学生学习/规划每日最多预留6次请求；卡片含生成和复核2次，不承诺具体费用。换设备恢复后会关闭并重新征求授权。")
                    .setNegativeButton("取消", null).setPositiveButton("授权") { _, _ -> background("保存授权…") { StudioAutomation(this).setEnabled(studentId, true); "已授权；系统执行时间不保证精确" } }.show()
                else background("检查自动练习状态…") { if (choice == 1) { StudioAutomation(this).setEnabled(studentId, false); "已关闭" } else StudioAutomation(this).check(studentId) }
            }.show()
        })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(button("当前规划类别：自动更新设置") {
            val module = LearningStudioService.moduleLabels.keys.elementAt(modules.selectedItemPosition)
            if (module !in ResearchUpdatePolicy.modules) { status.text = "请选择规划或比赛类别"; return@button }
            AlertDialog.Builder(this).setTitle("研究更新（默认关闭）")
                .setItems(arrayOf("授权当前类别月度／档案变化更新", "关闭当前类别自动更新", "现在检查一次", "已核对未知结果（不清除模型回执）")) { _, action ->
                    if (action == 0) AlertDialog.Builder(this).setTitle("单独授权联网研究")
                        .setMessage("只发送去姓名/电话/邮箱后的规划档案、年级与目标，不发送原件。每月或档案变化时逐日更新已授权类别，每次最多一类，使用共享学习/规划额度。结果、资格和日期均需人工核验；未知调用不自动重试，换设备需重新授权。")
                        .setNegativeButton("取消", null).setPositiveButton("授权") { _, _ -> background("保存研究授权…") { ResearchUpdateService(this).setEnabled(studentId, module, true); "已授权当前类别" } }.show()
                    else if (action == 3) AlertDialog.Builder(this).setTitle("已核对服务端账单和保存结果？")
                        .setMessage("只结束调度器的未知状态，不删除模型回执；同输入未知模型请求仍会阻止重复发送。")
                        .setNegativeButton("取消", null).setPositiveButton("已核对") { _, _ -> background("保存核对…") { ResearchUpdateService(this).acknowledgeUnknown(studentId, module); "已记录核对" } }.show()
                    else background("检查研究更新…") { if (action == 1) { ResearchUpdateService(this).setEnabled(studentId, module, false); "已关闭当前类别" } else ResearchUpdateService(this).check(studentId) }
                }.show()
        })
        root.addView(list)
        root.addView(button("下一页（每页50项）") { offset += 50; refresh() })
        root.addView(button("返回") { finish() })
        val shell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(palette.page) }
        identity = text("当前学生：$studentId", 18f); shell.addView(identity)
        shell.addView(ScrollView(this).apply { addView(root) }, LinearLayout.LayoutParams(-1, 0, 1f)); setContentView(shell)
        worker.execute { val name = runCatching { StudentIndexRepository(this).requireExact(studentId).name }; runOnUiThread { if (current()) identity.text = name.fold({ "当前学生：$it" }, { "学生档案读取失败，停止处理" }) } }
        refresh()
    }
    override fun onDestroy() { generation++; cancellation.cancel(); worker.shutdownNow(); super.onDestroy() }
    override fun onResume() { super.onResume(); if (::studentId.isInitialized && !current()) finish() }
    private fun current() = !isFinishing && !isDestroyed && getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, MODE_PRIVATE)
        .getString(MainActivity.KEY_CURRENT_STUDENT_ID, "") == studentId
    private fun text(value: String, size: Float = 15f) = TextView(this).apply { text = value; textSize = size; setTextColor(palette.text); setPadding(8, 8, 8, 8) }
    private fun button(value: String, action: () -> Unit) = Button(this).apply { text = value; setOnClickListener { if (current()) action() else finish() } }
    private fun refresh() {
        if (!current()) { finish(); return }; if (running) return
        val request = ++generation; val wantedMode = mode; val search = query.text.toString(); val start = offset
        worker.execute {
            val result = runCatching { val repo = ScopedContentRepository(this); if (wantedMode == "search") repo.search(studentId, search, start) else repo.filtered(studentId, wantedMode, search, start) }
            runOnUiThread {
                if (request != generation || !current()) return@runOnUiThread
                list.removeAllViews()
                result.onSuccess { rows ->
                    status.text = "当前学生 · ${rows.size}项 · 第${start / 50 + 1}页"
                    if (rows.isEmpty()) list.addView(text("没有记录。可先更新本机索引，或返回上一页。"))
                    rows.forEach { row ->
                        if (row.kind == "search" && row.sourceSha256.isNotBlank()) list.addView(CheckBox(this).apply {
                            text = "选作来源：${row.title}"; isChecked = row.id in selected
                            setOnCheckedChangeListener { _, checked -> if (checked) { if (selected.size < 5) selected += row.id else { isChecked = false; status.text = "最多选择5份来源" } } else selected -= row.id }
                        })
                        val kindLabel = mapOf("search" to "资料", "artifact" to "版本", "favorite" to "收藏", "attempt" to "作答", "review" to "审核", "action" to "行动", "action_event" to "进度", "decision" to "选择记录", "draft" to "草稿")[row.kind] ?: row.kind
                        val stateLabel = mapOf("pending_review" to "待审核", "reviewed" to "已审核", "candidate" to "候选", "planned" to "待开展", "doing" to "进行中", "done" to "自报完成", "paused" to "已暂停", "ignored" to "已忽略", "restored" to "已恢复", "saved" to "已保存", "recorded" to "已记录", "indexed" to "已索引", "needs_user" to "需确认")[row.state] ?: row.state
                        list.addView(button("${row.title} · $kindLabel · $stateLabel\n${row.logicalPath}\n${row.updatedAt}") { details(row.id) })
                    }
                }.onFailure { status.text = "读取失败，原记录保留：${it.message}" }
            }
        }
    }
    private fun background(message: String, action: () -> String) {
        if (running) { status.text = "已有操作处理中"; return }
        running = true; status.text = message
        worker.execute {
            val result = runCatching(action)
            runOnUiThread { running = false; if (!current()) return@runOnUiThread; status.text = result.getOrElse { "操作未完成，原版本保留：${it.message}" } }
        }
    }
    private fun confirmGenerate() {
        val module = LearningStudioService.moduleLabels.keys.elementAt(modules.selectedItemPosition)
        val ids = selected.toList(); val requestTopic = topic.text.toString(); val reportMode = recent.isChecked
        val count = quantity.selectedItemPosition + 1
        val includeFeedback = feedback.isChecked
        status.text = "正在准备本地预览（尚未发送）…"
        worker.execute {
            val prepared = runCatching { StudioInputFactory(this).prepare(studentId, module, ids, requestTopic, count, reportMode, includeFeedback).input }
            runOnUiThread {
                if (!current()) return@runOnUiThread
                prepared.onFailure { status.text = "预览失败：${it.message}" }.onSuccess { input ->
        val fingerprint = ScopedContentPolicy.fingerprint(input)
        val preview = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        preview.addView(text("以下是将发送的实际内容。自动去标识不能覆盖所有个人信息，请核对全文；规划/比赛可能联网检索。未知结果不自动重试。取消不会调用模型。"))
        preview.addView(text(input.toString(2)))
        AlertDialog.Builder(this).setTitle("核对实际发送内容")
            .setView(ScrollView(this).apply { addView(preview) })
            .setNegativeButton("取消", null).setPositiveButton("确认发送") { _, _ ->
                cancellation = ModelCancellation(); val token = cancellation
                background("正在生成与校验…") {
                    val config = requireNotNull(AgentConfigurationStore(this).load()) { "请先配置模型" }
                    val service = LearningStudioService(this, ModelRuntime.provider(this, config), config.model)
                    val version = service.generate(studentId, module, ids, requestTopic, count, reportMode, token, fingerprint, includeFeedback)
                    "候选已保存在版本中：${version.title}；未经人工验收"
                }
            }.show()
                }
            }
        }
    }
    private fun details(id: String) {
        worker.execute {
            val result = runCatching { val row = ScopedContentRepository(this).exact(studentId, id); row to if (row.kind == "search" && row.sourceSha256.isNotBlank()) ContentSourceResolver(this).readText(studentId, row) else row.payload }
            runOnUiThread {
                if (!current()) return@runOnUiThread
                result.onSuccess { (row, body) ->
                    val actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
                    val dialog = AlertDialog.Builder(this).setTitle(row.title).setView(ScrollView(this).apply { addView(actions) }).setNegativeButton("关闭", null).create()
                    actions.addView(text(if (row.kind in setOf("artifact", "favorite")) readable(JSONObject(row.payload)) else body.take(60_000)))
                    if (row.kind == "search") actions.addView(button("打开原件（校验当前学生与授权目录）") {
                        worker.execute {
                            val found = runCatching { ContentSourceResolver(this).locate(studentId, ScopedContentRepository(this).exact(studentId, row.id)) }
                            runOnUiThread { if (current()) found.onSuccess { document ->
                                runCatching { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(document.uri, document.type ?: "application/octet-stream").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
                                    .onFailure { status.text = "没有可打开该格式的应用：${it.message}" }
                            }.onFailure { status.text = it.message } }
                        }
                    })
                    if (row.kind == "artifact") {
                        val module = JSONObject(row.payload).getString("module")
                        if (module != "cards") actions.addView(button("预览并分享候选摘要到云端（不上传原件）") { dialog.dismiss(); previewCloudSummary(row.id) })
                        if (module != "cards") actions.addView(button("选择建议：采纳为行动／忽略") {
                            val items = JSONObject(row.payload).getJSONObject("result").getJSONArray("items")
                            AlertDialog.Builder(this).setTitle("选择候选建议").setItems(Array(items.length()) { items.getJSONObject(it).optString("title", "建议${it + 1}") }) { _, index ->
                                AlertDialog.Builder(this).setTitle("采纳不代表已完成或已核验").setItems(arrayOf("加入行动清单", "忽略并保留记录")) { _, choice ->
                                    background("记录选择…") { val repo = ScopedContentRepository(this); if (choice == 0) repo.adopt(studentId, row.id, index) else repo.ignore(studentId, row.id, index); "已保存，点击对应列表查看" }; dialog.dismiss()
                                }.show()
                            }.show()
                        })
                        actions.addView(button("收藏这个不可变版本") { background("正在收藏…") { ScopedContentRepository(this).favorite(studentId, row.id); "已收藏；刷新不覆盖" }; dialog.dismiss() })
                        if (module == "topics") actions.addView(button("选择选题：准备项目草稿／忽略") {
                            val items = JSONObject(row.payload).getJSONObject("result").getJSONArray("items")
                            AlertDialog.Builder(this).setTitle("选择候选项").setItems(Array(items.length()) { items.getJSONObject(it).getString("title") }) { _, index ->
                                AlertDialog.Builder(this).setTitle("只记录选择，不创建项目").setItems(arrayOf("准备项目草稿", "忽略并保留选择记录")) { _, action ->
                                    background("记录选择…") { val repo = ScopedContentRepository(this); if (action == 0) { repo.draft(studentId, row.id, index); "草稿已保存。实际创建仍需原项目入口确认学生、目录和模板" } else { repo.ignore(studentId, row.id, index); "已忽略，历史建议和选择记录保留" } }; dialog.dismiss()
                                }.show()
                            }.show()
                        })
                        if (module == "cards") {
                            actions.addView(button("提交文字作答") { dialog.dismiss(); answerText(row.id) })
                            actions.addView(button("提交作答文件（本地归档，不上传）") { answerVersion = row.id; startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, ANSWER_FILE); dialog.dismiss() })
                            actions.addView(button("分享题目（无答案）") { val clean = LearningStudioPolicy.questionsOnly(JSONObject(row.payload)); startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, clean), "分享练习题")) })
                            actions.addView(button("打印题目／存为PDF（无答案）") { (getSystemService(PRINT_SERVICE) as android.print.PrintManager).print("学习练习", QuestionsPrintAdapter(this, JSONObject(row.payload)), null) })
                        }
                    } else if (row.kind == "attempt") actions.addView(button("人工审核本次作答（不自动判断掌握）") { dialog.dismiss(); reviewAnswer(row) })
                    else if (row.kind == "action") actions.addView(button("记录行动进度／结果（自报，非正式证据）") { dialog.dismiss(); progressAction(row) })
                    else if (row.kind == "decision" && row.state == "ignored") actions.addView(button("恢复建议（保留忽略记录）") {
                        background("恢复建议…") { ScopedContentRepository(this).restoreIgnored(studentId, row.id); "已恢复，可打开原版本重新采纳" }; dialog.dismiss()
                    })
                    else if (row.kind == "draft") actions.addView(button("进入原项目创建流程（仍需确认，不自动创建）") {
                        startActivity(Intent(this, MainActivity::class.java).putExtra("studioDraftId", row.id).putExtra("studioStudentId", studentId)); dialog.dismiss()
                    }) else if (row.kind == "favorite") actions.addView(button("取消收藏（保留历史版本）") { background("更新收藏…") { ScopedContentRepository(this).removeFavorite(studentId, row.id); "已取消收藏，历史版本保留" }; dialog.dismiss() })
                    dialog.show()
                }.onFailure { status.text = "无法打开：${it.message}" }
            }
        }
    }
    private fun answerText(version: String) {
        val answer = EditText(this).apply { hint = "写下作答；不会自动计为掌握" }
        AlertDialog.Builder(this).setTitle("提交文字作答").setView(answer).setNegativeButton("取消", null).setPositiveButton("保存待审核") { _, _ ->
            val value = answer.text.toString()
            background("保存作答…") { require(value.isNotBlank()); ScopedContentRepository(this).attempt(studentId, version, JSONObject().put("text", value)); "作答已保存，待审核" }
        }.show()
    }
    private fun reviewAnswer(row: ScopedContentEntity) {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        panel.addView(text("审核仅评价这次作答，不能证明独立掌握。审核人是本机填写，未经身份认证；更正会追加记录，不删除旧审核。"))
        val reviewer = EditText(this).apply { hint = "审核人／身份（例如家长、自评）" }; panel.addView(reviewer)
        val outcomes = arrayOf("correct", "partial", "revise", "unverifiable")
        val choice = Spinner(this).apply { adapter = ArrayAdapter(this@LearningStudioActivity, android.R.layout.simple_spinner_dropdown_item, listOf("本次基本正确", "本次部分正确", "需要修改", "无法判断")) }; panel.addView(choice)
        val note = EditText(this).apply { hint = "具体依据、提示情况和下一步（至少4字）" }; panel.addView(note)
        val operation = java.util.UUID.randomUUID().toString()
        AlertDialog.Builder(this).setTitle("人工审核作答").setView(panel).setNegativeButton("取消", null).setPositiveButton("保存审核") { _, _ ->
            val who = reviewer.text.toString(); val outcome = outcomes[choice.selectedItemPosition]; val reason = note.text.toString()
            background("保存审核…") { ScopedContentRepository(this).review(studentId, row.id, ScopedContentPolicy.hash(row.payload.toByteArray()), outcome, who, reason, operation); "已追加审核；原作答保留，未写入掌握结论" }
        }.show()
    }
    private fun progressAction(row: ScopedContentEntity) {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val states = arrayOf("planned", "doing", "done", "paused")
        val choice = Spinner(this).apply { adapter = ArrayAdapter(this@LearningStudioActivity, android.R.layout.simple_spinner_dropdown_item, listOf("待开展", "进行中", "自报完成", "暂停")); setSelection(states.indexOf(row.state).coerceAtLeast(0)) }; panel.addView(choice)
        val note = EditText(this).apply { hint = "进度、实际结果或依据（至少4字）" }; panel.addView(note)
        panel.addView(text("完成仅是本机自报，不会自动生成正式成果或成长证据。进度历史不会覆盖。"))
        val operation = java.util.UUID.randomUUID().toString()
        AlertDialog.Builder(this).setTitle("行动进度").setView(panel).setNegativeButton("取消", null).setPositiveButton("保存") { _, _ ->
            val next = states[choice.selectedItemPosition]; val reason = note.text.toString()
            background("保存进度…") { ScopedContentRepository(this).actionProgress(studentId, row.id, row.state, next, reason, operation); "进度已保存，历史记录可在进度列表查看" }
        }.show()
    }
    private fun previewCloudSummary(versionId: String) {
        worker.execute {
            val prepared = runCatching { CloudSummaryService(this).prepare(studentId, versionId) }
            runOnUiThread {
                if (!current()) return@runOnUiThread
                prepared.onFailure { status.text = "云分享未开始：${it.message}" }.onSuccess { preview ->
                    AlertDialog.Builder(this).setTitle("核对实际上传摘要")
                        .setView(ScrollView(this).apply { addView(text("仅上传以下摘要；原件、完整档案、作答和本机路径不上传。目标：${preview.server}\n\n${preview.text}")) })
                        .setNegativeButton("取消", null).setPositiveButton("确认上传") { _, _ ->
                            if (current()) background("核对远端清单并上传摘要…") { CloudSummaryService(this).publish(preview) }
                        }.show()
                }
            }
        }
    }
    private fun readable(payload: JSONObject): String = buildString {
        val module = payload.getString("module")
        appendLine("${LearningStudioService.moduleLabels[module]} · ${payload.optString("createdAt")}")
        appendLine("候选结果／待人工核验；模型复核不等于答案正确或学生掌握。")
        ResearchUpdatePolicy.expiryLabel(payload).takeIf(String::isNotBlank)?.let { appendLine(it) }
        val items = payload.getJSONObject("result").getJSONArray("items")
        for (i in 0 until items.length()) {
            appendLine("\n${i + 1}.")
            val item = items.getJSONObject(i)
            LearningStudioPolicy.fields.getValue(module).forEach { appendLine("$it：${item.getString(it)}") }
            appendLine("来源：${item.getJSONArray("sourceIds")}")
            if (item.has("fieldSources")) appendLine("各字段依据（待核验）：${item.getJSONObject("fieldSources")}")
        }
        val sources = payload.optJSONArray("sources")
        if (sources != null) for (i in 0 until sources.length()) {
            val source = sources.getJSONObject(i); appendLine("${source.getString("title")}\n${source.getString("url")}\n检索时间 ${source.getString("retrievedAt")} · 待核验")
        }
    }
    private fun compareVersions() {
        val module = LearningStudioService.moduleLabels.keys.elementAt(modules.selectedItemPosition)
        worker.execute {
            val result = runCatching { ScopedContentRepository(this).list(studentId, listOf("artifact"), 100)
                .filter { JSONObject(it.payload).getString("module") == module }.take(2) }
            runOnUiThread {
                if (!current()) return@runOnUiThread
                result.onSuccess { rows ->
                    val view = TextView(this).apply { text = rows.joinToString("\n\n────────\n\n") { "版本 ${it.id}\n${readable(JSONObject(it.payload))}" }.ifBlank { "尚无该类别的版本" }; setPadding(16, 16, 16, 16); setTextIsSelectable(true) }
                    AlertDialog.Builder(this).setTitle("最近两个版本对照（不覆盖）").setView(ScrollView(this).apply { addView(view) }).setPositiveButton("关闭", null).show()
                }.onFailure { status.text = it.message }
            }
        }
    }
    @Deprecated("Legacy Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != ANSWER_FILE || resultCode != RESULT_OK || !current()) return
        val uri = data?.data ?: return; val version = answerVersion ?: return; answerVersion = null
        background("校验并归档作答文件…") {
            val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: error("无法读取文件名")
            val bytes = requireNotNull(contentResolver.openInputStream(uri)).use { it.readBytesBounded(AnswerFilePolicy.MAX_BYTES) }
            val mime = AnswerFilePolicy.validate(name, bytes)
            val imported = FileAssetService(this).importValidatedBytes(studentId, name, bytes, mime, "学习卡片作答", uri.toString())
            ScopedContentRepository(this).attempt(studentId, version, JSONObject().put("material", imported.getJSONObject("material")).put("sha256", ScopedContentPolicy.hash(bytes)))
            "作答文件已归档，待审核；未调用模型"
        }
    }
    companion object { const val EXTRA_STUDENT_ID = "studentId"; private const val ANSWER_FILE = 804 }
}
