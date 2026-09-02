package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import org.json.JSONObject

/** Lightweight Android counterpart of the Windows conversation inbox and candidate governance. */
class ConversationKnowledgeActivity : Activity() {
    private lateinit var conversations: ConversationImportService
    private lateinit var candidates: ConversationCandidateRepository
    private lateinit var governance: ConversationKnowledgeGovernanceService
    private lateinit var students: StudentIndexRepository
    private lateinit var palette: UiPalette
    private lateinit var list: LinearLayout
    private lateinit var search: EditText
    private var studentId = ""
    private var focusRecordId = ""
    private var tab = KnowledgeTab.INBOX

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preferences = UiPreferences(this); preferences.applyOrientation(this); palette = preferences.palette()
        conversations = ConversationImportService(this); candidates = ConversationCandidateRepository(this)
        governance = ConversationKnowledgeGovernanceService(this); students = StudentIndexRepository(this)
        studentId = intent.getStringExtra(EXTRA_STUDENT_ID).orEmpty()
        focusRecordId = intent.getStringExtra(EXTRA_RECORD_ID).orEmpty()
        setContentView(buildScreen())
        render()
    }

    private fun buildScreen(): LinearLayout {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(16), dp(18), dp(20)); setBackgroundColor(palette.page)
        }
        page.addView(TextView(this).apply { text = "智能体对话知识管理"; textSize = 25f; setTextColor(palette.heading) }, matchWrap())
        page.addView(TextView(this).apply {
            text = "只管理用户主动粘贴、选择或分享的对话。原文保持不可变，提取结果先进入候选，审核后才写入知识库。"
            textSize = 14f; setTextColor(palette.muted); setPadding(0, dp(4), 0, dp(8))
        }, matchWrap())
        val records = students.list()
        if (studentId.isBlank() || records.none { it.id == studentId }) studentId = records.firstOrNull()?.id.orEmpty()
        val spinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@ConversationKnowledgeActivity, android.R.layout.simple_spinner_dropdown_item, records.map { it.name })
            setSelection(records.indexOfFirst { it.id == studentId }.coerceAtLeast(0))
            onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                    studentId = records.getOrNull(position)?.id.orEmpty(); render()
                }
            }
        }
        page.addView(spinner, matchWrap())
        page.addView(button("导入新的对话") {
            startActivity(Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_CONVERSATION_IMPORT, true))
        }, matchWrap())
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        KnowledgeTab.entries.forEach { item -> tabs.addView(button(item.label) { tab = item; render() }) }
        page.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(tabs) }, matchWrap())
        search = EditText(this).apply {
            hint = "搜索来源、摘要、主题或候选内容"; setSingleLine(true)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = render()
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        page.addView(search, matchWrap())
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        page.addView(ScrollView(this).apply { addView(list) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        return page
    }

    private fun render() {
        if (!::list.isInitialized) return
        list.removeAllViews()
        if (studentId.isBlank()) {
            empty("尚无学生档案", "请先返回教育档案新建或接管学生档案。")
            return
        }
        val query = if (::search.isInitialized) search.text.toString().trim() else ""
        when (tab) {
            KnowledgeTab.INBOX -> renderRecords(conversations.list(studentId).filter { it.optString("digestStatus") == "pending" }, query, "收件箱为空", "导入对话后可在这里浏览、分析并进入消化流程。")
            KnowledgeTab.PROCESSING -> renderRecords(conversations.list(studentId).filter { it.optString("digestStatus") in setOf("running", "failed") }, query, "没有处理中对话", "失败任务会保留原文，可在这里重试。")
            KnowledgeTab.CANDIDATES -> renderCandidates(query)
            KnowledgeTab.ARCHIVED -> renderRecords(conversations.list(studentId).filter { it.optString("digestStatus") == "completed" }, query, "尚无已消化对话", "完成消化后，对话原文和结果会作为可追溯档案保留。")
            KnowledgeTab.TRASH -> renderRecords(conversations.trashed(studentId), query, "回收站为空", "移入回收站的未消化对话可恢复或永久删除。")
        }
    }

    private fun renderRecords(source: List<JSONObject>, query: String, emptyTitle: String, emptyBody: String) {
        val values = source.filter { recordSearchText(it).contains(query, true) }
        if (values.isEmpty()) { empty(emptyTitle, emptyBody); return }
        values.forEach { record ->
            val analysis = record.optJSONObject("analysis") ?: JSONObject()
            val details = buildString {
                append("${record.optString("sourceAgent")} · ${record.optString("projectName").ifBlank { record.optString("studentName") }}\n")
                append("${digestLabel(record.optString("digestStatus"))} · ${record.optInt("messageCount")} 条消息 · ${record.optString("importedAt")}\n")
                if (analysis.optString("summary").isNotBlank()) append(analysis.optString("summary").take(180))
            }
            val card = card(details)
            if (record.getString("recordId") == focusRecordId) card.setBackgroundColor(palette.accentSoft)
            card.addView(button("浏览原文") { openConversation(record.getString("recordId"), false) }, matchWrap())
            if (record.optString("lifecycleStatus") == "trashed") {
                card.addView(button("恢复") { runAction("正在恢复") { conversations.restore(record.getString("recordId")) } }, matchWrap())
                card.addView(button("永久删除") { confirmPermanentDelete(record) }, matchWrap())
            } else {
                card.addView(button("本地分析") { runAction("正在分析") { conversations.analyze(record.getString("recordId")) } }, matchWrap())
                when (record.optString("digestStatus")) {
                    "completed" -> card.addView(button("查看消化结果") { openConversation(record.getString("recordId"), true) }, matchWrap())
                    "running" -> Unit
                    else -> card.addView(button(if (record.optString("digestStatus") == "failed") "重试消化" else "进入消化流程") { confirmDigest(record) }, matchWrap())
                }
                card.addView(button("移入回收站") { confirmTrash(record) }, matchWrap())
            }
            list.addView(card, matchWrap())
        }
    }

    private fun renderCandidates(query: String) {
        val values = candidates.list(studentId).filter { candidateSearchText(it).contains(query, true) }
        if (values.isEmpty()) { empty("没有候选知识", "先对对话执行消化，概念、事实、问答、行动和成长证据才会进入待审核区。") ; return }
        val pending = values.filter { it.optString("status") in setOf("pending", "conflict") }.take(50)
        if (pending.isNotEmpty()) list.addView(button("确认采用当前待审核（最多 50 条）") { confirmBatch(pending) }, matchWrap())
        values.forEach { candidate ->
            val details = "${candidateTypeLabel(candidate.optString("type"))} · ${candidateStatusLabel(candidate.optString("status"))}\n${candidate.optString("content")}\n来源：${candidate.optString("sourceUri")}"
            val card = card(details)
            when (candidate.optString("status")) {
                "confirmed" -> card.addView(button("撤回采用") { runAction("正在撤回") { governance.rollback(candidate.getString("id")) } }, matchWrap())
                "pending", "conflict", "revoked" -> {
                    card.addView(button("确认采用") { runAction("正在写入知识库") { governance.confirm(candidate.getString("id")) } }, matchWrap())
                    card.addView(button("编辑候选") { editCandidate(candidate) }, matchWrap())
                    card.addView(button("标记冲突") { runAction("正在更新") { candidates.updateStatus(candidate.getString("id"), "conflict") } }, matchWrap())
                    card.addView(button("驳回") { runAction("正在更新") { candidates.updateStatus(candidate.getString("id"), "rejected") } }, matchWrap())
                    card.addView(button("标记过期") { runAction("正在更新") { candidates.updateStatus(candidate.getString("id"), "expired") } }, matchWrap())
                }
                "rejected", "expired" -> card.addView(button("恢复待审核") { runAction("正在恢复") { candidates.updateStatus(candidate.getString("id"), "pending") } }, matchWrap())
            }
            list.addView(card, matchWrap())
        }
    }

    private fun editCandidate(candidate: JSONObject) {
        val input = EditText(this).apply { setText(candidate.optString("content")); minLines = 5; maxLines = 12; gravity = Gravity.TOP }
        val dialog = AlertDialog.Builder(this).setTitle("编辑候选表达").setMessage("只修改候选表达，原始对话、来源 URI 和 SHA-256 不会改变。")
            .setView(input).setNegativeButton("取消", null).setPositiveButton("保存", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val value = input.text.toString().trim(); if (value.isBlank()) { input.error = "候选内容不能为空"; return@setOnClickListener }
                dialog.dismiss(); runAction("正在保存候选") { candidates.updateContent(candidate.getString("id"), value) }
            }
        }
        dialog.show()
    }

    private fun confirmBatch(values: List<JSONObject>) {
        AlertDialog.Builder(this).setTitle("批量确认采用")
            .setMessage("将逐条验证不可变原文和归属范围，再写入可撤回的受管知识记录。共 ${values.size} 条，继续吗？")
            .setNegativeButton("取消", null).setPositiveButton("继续") { _, _ ->
                runAction("正在批量采用") { values.forEach { governance.confirm(it.getString("id")) }; JSONObject().put("ok", true) }
            }.show()
    }

    private fun confirmDigest(record: JSONObject) {
        AlertDialog.Builder(this).setTitle("进入消化流程").setMessage("将读取该范围的 AGENT.md，并只生成有来源、可审核的候选知识。")
            .setNegativeButton("取消", null).setPositiveButton("开始") { _, _ -> runAction("正在消化对话") { ConversationDigestService(this).digest(record.getString("recordId")) } }.show()
    }

    private fun confirmTrash(record: JSONObject) {
        AlertDialog.Builder(this).setTitle("移入回收站").setMessage("原文不会立即删除；可在回收站恢复。已消化记录仍保留证据依赖。")
            .setNegativeButton("取消", null).setPositiveButton("移入") { _, _ -> runAction("正在移动") { conversations.trash(record.getString("recordId")) } }.show()
    }

    private fun confirmPermanentDelete(record: JSONObject) {
        AlertDialog.Builder(this).setTitle("永久删除").setMessage("仅允许永久删除没有消化结果、没有候选或已采用依赖的对话。操作不可恢复。")
            .setNegativeButton("取消", null).setPositiveButton("永久删除") { _, _ -> runAction("正在删除") { governance.permanentlyDelete(record.getString("recordId")) } }.show()
    }

    private fun runAction(title: String, action: () -> Any) {
        val progress = AlertDialog.Builder(this).setTitle(title).setView(ProgressBar(this)).setCancelable(false).create().also { it.show() }
        Thread {
            val result = runCatching(action)
            runOnUiThread { progress.dismiss(); result.onSuccess { focusRecordId = ""; render() }.onFailure { showError(it.message ?: "操作失败") } }
        }.start()
    }

    private fun openConversation(recordId: String, digest: Boolean) {
        startActivity(Intent(this, MarkdownBrowserActivity::class.java)
            .putExtra(MarkdownBrowserActivity.EXTRA_MODE, if (digest) MarkdownBrowserActivity.MODE_CONVERSATION_DIGEST else MarkdownBrowserActivity.MODE_CONVERSATION)
            .putExtra(MarkdownBrowserActivity.EXTRA_CONVERSATION_ID, recordId)
            .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, if (digest) "对话消化结果" else "对话历史原文"))
    }

    private fun empty(title: String, body: String) {
        list.addView(card("$title\n$body").apply {
            addView(button("导入新的对话") { startActivity(Intent(this@ConversationKnowledgeActivity, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_CONVERSATION_IMPORT, true)) }, matchWrap())
        }, matchWrap())
    }

    private fun card(value: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14)); YouthUi.applySurface(this, palette)
        addView(TextView(this@ConversationKnowledgeActivity).apply { text = value; textSize = 14f; setTextColor(palette.text); setPadding(0, 0, 0, dp(6)) }, matchWrap())
    }
    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        val role = when {
            label in setOf("永久删除", "移入回收站", "驳回") -> YouthButtonRole.DANGER
            label in setOf("导入新的对话", "确认采用当前待审核（最多 50 条）") -> YouthButtonRole.PRIMARY
            else -> YouthButtonRole.SECONDARY
        }
        YouthUi.applyButton(this, palette, role)
        setOnClickListener { action() }
    }
    private fun showError(message: String) = AlertDialog.Builder(this).setTitle("操作失败").setMessage(message).setPositiveButton("知道了", null).show()
    private fun recordSearchText(value: JSONObject) = listOf(value.optString("sourceAgent"), value.optString("studentName"), value.optString("projectName"), value.optJSONObject("analysis")?.toString().orEmpty()).joinToString(" ")
    private fun candidateSearchText(value: JSONObject) = listOf(value.optString("type"), value.optString("content"), value.optString("evidenceExcerpt"), value.optString("status")).joinToString(" ")
    private fun digestLabel(value: String) = when (value) { "completed" -> "已消化"; "running" -> "处理中"; "failed" -> "处理失败"; else -> "待处理" }
    private fun candidateTypeLabel(value: String) = when (value) { "concept" -> "概念"; "entity" -> "实体"; "qa" -> "问答"; "action_item" -> "行动"; "growth_evidence" -> "成长证据"; else -> "学习事实" }
    private fun candidateStatusLabel(value: String) = when (value) { "confirmed" -> "已采用"; "rejected" -> "已驳回"; "conflict" -> "有冲突"; "expired" -> "已过期"; "revoked" -> "已撤回"; else -> "待审核" }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) }

    private enum class KnowledgeTab(val label: String) { INBOX("收件箱"), PROCESSING("待处理"), CANDIDATES("候选知识"), ARCHIVED("已归档"), TRASH("回收站") }
    companion object { const val EXTRA_STUDENT_ID = "student_id"; const val EXTRA_RECORD_ID = "record_id" }
}
