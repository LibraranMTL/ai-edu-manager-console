package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.util.concurrent.Executors

/** Evidence-first mastery, timeline, growth dimensions and report history. */
class LearningInsightsActivity : Activity() {
    private lateinit var studentId: String
    private lateinit var palette: UiPalette
    private lateinit var title: TextView
    private lateinit var list: LinearLayout
    private val worker = Executors.newSingleThreadExecutor()
    private var view = "mastery"
    private var generation = 0
    private lateinit var query: EditText
    private var offset = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        studentId = intent.getStringExtra(EXTRA_STUDENT_ID).orEmpty()
        if (studentId.isBlank()) { finish(); return }
        val ui = UiPreferences(this); ui.applyOrientation(this); palette = ui.palette()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(12)); setBackgroundColor(palette.page) }
        title = text("正在读取学习依据…", 21f); root.addView(title)
        root.addView(text("只读取已确认或已保存的本机事件；不会因打开、刷新或切换学生调用模型或联网批处理。", 13f))
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("mastery" to "知识点掌握", "timeline" to "学习时间线", "dimensions" to "维度变化", "reports" to "报告历史").forEach { (id, label) ->
            tabs.addView(button(label) { view = id; offset = 0; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(tabs)
        query = EditText(this).apply { hint = "搜索标题、状态、时间或来源"; setSingleLine(true) }
        root.addView(query)
        val paging = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        paging.addView(button("筛选／第一页") { offset = 0; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        paging.addView(button("上一页") { offset = (offset - PAGE_SIZE).coerceAtLeast(0); refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        paging.addView(button("下一页") { offset += PAGE_SIZE; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(paging)
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply { addView(list) }, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(button("返回") { finish() })
        setContentView(root)
    }

    override fun onResume() { super.onResume(); refresh() }
    override fun onPause() { generation++; super.onPause() }
    override fun onDestroy() { generation++; worker.shutdownNow(); super.onDestroy() }

    private fun refresh() {
        val request = ++generation
        val wantedView = view
        val keyword = query.text.toString().trim()
        val start = offset
        worker.execute {
            val result = runCatching {
                val student = StudentIndexRepository(this).requireExact(studentId)
                val store = LearningInsightsStore(this)
                val rows = when (wantedView) {
                    "timeline" -> store.timeline(studentId)
                    "dimensions" -> store.dimensions(studentId)
                    "reports" -> store.reportRevisions(studentId)
                    else -> store.mastery(studentId)
                }
                student.name to rows.filter { keyword.isBlank() || it.toString().contains(keyword, true) }.drop(start).take(PAGE_SIZE)
            }
            runOnUiThread {
                if (request != generation || isFinishing || isDestroyed) return@runOnUiThread
                list.removeAllViews()
                result.onSuccess { (name, rows) ->
                    title.text = "$name · ${viewLabel()}"
                    if (rows.isEmpty()) list.addView(text(emptyLabel(), 15f)) else rows.forEach(::renderRow)
                }.onFailure { title.text = "学习分析读取失败"; list.addView(text(it.message ?: "原记录保留", 15f)) }
            }
        }
    }

    private fun renderRow(row: JSONObject) {
        val label = when (view) {
            "mastery" -> "${row.optString("title")}\n${row.optString("status")} · 作答 ${row.optInt("attemptCount")} 次 · 跨时正确 ${row.optInt("crossTimeCorrectCount")} 次"
            "timeline" -> "${row.optString("title")}\n${row.optString("summary")} · ${row.optString("time")}"
            "dimensions" -> "${row.optString("title")}\n已确认 ${row.optInt("confirmed")} · 继续观察 ${row.optInt("watching")} · 待审核 ${row.optInt("pending")}"
            else -> "四份报告整组修订 · ${row.optString("generationPeriod")}\n依据 ${row.optJSONObject("evidenceSummary")?.optInt("referencedEvidenceCount") ?: 0} 条 · 云端 ${row.optString("cloudStatus")} · ${row.optString("time")}"
        }
        list.addView(button(label) { showEvidence(row) })
    }

    private fun showEvidence(row: JSONObject) {
        val sourceIds = row.optJSONArray("sourceIds")?.let { values -> (0 until values.length()).map { values.optString(it) } }
            ?: row.optJSONArray("reports")?.let { values -> (0 until values.length()).map { values.getJSONObject(it).optString("sourceId") } }
            ?: listOf(row.optString("sourceId"))
        val projectId = row.optString("projectId")
        val message = "时间：${row.optString("time")}\n内容指纹：${row.optString("contentFingerprint")}\n来源：\n${sourceIds.joinToString("\n")}"
        val dialog = AlertDialog.Builder(this).setTitle(row.optString("title", viewLabel())).setMessage(message).setNegativeButton("关闭", null)
        when {
            projectId.isNotBlank() -> dialog.setPositiveButton("打开项目依据") { _, _ -> startActivity(Intent(this, ProjectMaterialsActivity::class.java).putExtra(ProjectMaterialsActivity.EXTRA_PROJECT_ID, projectId)) }
            view == "mastery" -> dialog.setPositiveButton("打开学习卡片与作答") { _, _ -> startActivity(Intent(this, LearningStudioActivity::class.java).putExtra(LearningStudioActivity.EXTRA_STUDENT_ID, studentId).putExtra("module", "cards")) }
            view == "timeline" -> dialog.setPositiveButton("打开资料与来源") { _, _ -> startActivity(Intent(this, MainActivity::class.java)) }
        }
        dialog.show()
    }

    private fun viewLabel() = when (view) { "timeline" -> "学习时间线"; "dimensions" -> "维度变化"; "reports" -> "报告历史"; else -> "知识点掌握" }
    private fun emptyLabel() = when (view) {
        "mastery" -> "还没有学习卡片或作答。没有原始作答时不会标记为“较稳定”。"
        "reports" -> "还没有 1.2.9 之后发布的整组报告修订；现有报告不会被覆盖。"
        else -> "当前没有可显示的已保存依据。"
    }
    private fun text(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; setTextColor(palette.text); setPadding(0, dp(8), 0, dp(8)) }
    private fun button(label: String, action: () -> Unit) = Button(this).apply { text = label; YouthUi.applyButton(this, palette, YouthButtonRole.COMPACT); setOnClickListener { action() } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_STUDENT_ID = "student_id"
        private const val PAGE_SIZE = 50
    }
}
