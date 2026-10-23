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
    private var view = TAB_MASTERY
    private var requestedSourceId = ""
    private var generation = 0
    private lateinit var query: EditText
    private var offset = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        studentId = intent.getStringExtra(EXTRA_STUDENT_ID).orEmpty()
        if (studentId.isBlank()) { finish(); return }
        view = normalizeTab(savedInstanceState?.getString(STATE_TAB) ?: intent.getStringExtra(EXTRA_INITIAL_TAB))
        requestedSourceId = intent.getStringExtra(EXTRA_SOURCE_ID).orEmpty()
        val ui = UiPreferences(this); ui.applyOrientation(this); palette = ui.palette()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(12)); setBackgroundColor(palette.page) }
        title = text("正在读取学习依据…", 21f); root.addView(title)
        root.addView(text("只读取已确认或已保存的本机依据；不会因打开、刷新或切换学生调用模型或联网批处理。", 13f))
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf(TAB_MASTERY to "知识点掌握", TAB_TIMELINE to "学习时间线", TAB_DIMENSIONS to "维度变化", TAB_REPORTS to "报告历史").forEach { (id, label) ->
            tabs.addView(button(label) { view = id; offset = 0; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(tabs)
        query = EditText(this).apply { hint = "搜索标题、状态、时间或来源"; setSingleLine(true) }
        query.setText(savedInstanceState?.getString(STATE_QUERY).orEmpty())
        offset = savedInstanceState?.getInt(STATE_OFFSET, 0) ?: 0
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
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(STATE_TAB, view)
        outState.putString(STATE_QUERY, query.text.toString().take(200))
        outState.putInt(STATE_OFFSET, offset)
        super.onSaveInstanceState(outState)
    }
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
                    if (requestedSourceId.isNotBlank()) {
                        rows.firstOrNull(::matchesRequestedSource)?.let { row ->
                            requestedSourceId = ""
                            showEvidence(row)
                        }
                    }
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
            view == TAB_MASTERY -> dialog.setPositiveButton("打开学习卡片与作答") { _, _ -> startActivity(Intent(this, LearningStudioActivity::class.java).putExtra(LearningStudioActivity.EXTRA_STUDENT_ID, studentId).putExtra(LearningStudioActivity.EXTRA_INITIAL_MODE, "artifact").putExtra("module", "cards")) }
            view == TAB_TIMELINE -> dialog.setPositiveButton("打开对应记录") { _, _ -> openTimelineSource(row) }
            view == TAB_REPORTS -> dialog.setPositiveButton("打开这组报告") { _, _ -> openReportRevision(row) }
        }
        dialog.show()
    }

    private fun openTimelineSource(row: JSONObject) {
        val sourceId = row.optString("sourceId")
        when (row.optString("kind")) {
            "conversation" -> startActivity(Intent(this, ConversationKnowledgeActivity::class.java)
                .putExtra(ConversationKnowledgeActivity.EXTRA_STUDENT_ID, studentId)
                .putExtra(ConversationKnowledgeActivity.EXTRA_RECORD_ID, sourceId))
            "material" -> worker.execute {
                val source = runCatching { ScopedContentRepository(this).exact(studentId, sourceId) }
                runOnUiThread {
                    source.onSuccess { record ->
                        val parent = record.logicalPath.substringBeforeLast('/', "")
                        startActivity(Intent(this, RawMaterialBrowserActivity::class.java)
                            .putExtra(RawMaterialBrowserActivity.EXTRA_STUDENT_ID, studentId)
                            .putExtra(RawMaterialBrowserActivity.EXTRA_START_PATH, parent)
                            .putExtra(RawMaterialBrowserActivity.EXTRA_TITLE, "资料来源 · ${record.title}"))
                    }.onFailure { AlertDialog.Builder(this).setTitle("来源暂时无法打开").setMessage(it.message ?: "原始记录仍保留").setPositiveButton("知道了", null).show() }
                }
            }
            "attempt", "review", "artifact", "action", "action_event", "decision" -> startActivity(Intent(this, LearningStudioActivity::class.java)
                .putExtra(LearningStudioActivity.EXTRA_STUDENT_ID, studentId)
                .putExtra(LearningStudioActivity.EXTRA_INITIAL_MODE, row.optString("kind"))
                .putExtra("module", "cards"))
            else -> startActivity(Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_SECTION, AppSection.MATERIALS.name))
        }
    }

    private fun openReportRevision(row: JSONObject) {
        val reports = row.optJSONArray("reports") ?: return
        val items = (0 until reports.length()).map { reports.getJSONObject(it) }
        AlertDialog.Builder(this).setTitle("选择报告").setItems(items.map { it.optString("title", "学情报告") }.toTypedArray()) { _, index ->
            val report = items[index]
            startActivity(Intent(this, MarkdownBrowserActivity::class.java)
                .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_REPORT)
                .putExtra(MarkdownBrowserActivity.EXTRA_STUDENT_ID, studentId)
                .putExtra(MarkdownBrowserActivity.EXTRA_REPORT_ID, report.optString("reportId"))
                .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, report.optString("title", "学情报告")))
        }.setNegativeButton("关闭", null).show()
    }

    private fun matchesRequestedSource(row: JSONObject): Boolean {
        if (row.optString("sourceId") == requestedSourceId) return true
        val ids = row.optJSONArray("sourceIds") ?: return false
        return (0 until ids.length()).any { ids.optString(it) == requestedSourceId }
    }

    private fun normalizeTab(raw: String?): String = raw?.takeIf { it in setOf(TAB_MASTERY, TAB_TIMELINE, TAB_DIMENSIONS, TAB_REPORTS) } ?: TAB_MASTERY
    private fun viewLabel() = when (view) { TAB_TIMELINE -> "学习时间线"; TAB_DIMENSIONS -> "维度变化"; TAB_REPORTS -> "报告历史"; else -> "知识点掌握" }
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
        const val EXTRA_INITIAL_TAB = "initial_tab"
        const val EXTRA_SOURCE_ID = "source_id"
        const val TAB_MASTERY = "mastery"
        const val TAB_TIMELINE = "timeline"
        const val TAB_DIMENSIONS = "dimensions"
        const val TAB_REPORTS = "reports"
        private const val STATE_TAB = "insights_tab"
        private const val STATE_QUERY = "insights_query"
        private const val STATE_OFFSET = "insights_offset"
        private const val PAGE_SIZE = 50
    }
}
