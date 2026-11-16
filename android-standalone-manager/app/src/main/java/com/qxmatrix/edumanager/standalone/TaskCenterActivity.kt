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

/** Scoped, local diagnostics. Neither opening nor refreshing starts any AI work. */
class TaskCenterActivity : Activity() {
    private lateinit var studentId: String
    private lateinit var palette: UiPalette
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private val worker = Executors.newSingleThreadExecutor()
    private var generation = 0
    private var filter = "active"
    private lateinit var query: EditText
    private var offset = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        studentId = intent.getStringExtra(EXTRA_STUDENT_ID).orEmpty()
        if (studentId.isBlank()) { finish(); return }
        val ui = UiPreferences(this); palette = ui.palette(); ui.applyOrientation(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(12)); setBackgroundColor(palette.page) }
        status = text("正在读取当前学生任务…", 20f); root.addView(status)
        root.addView(text("仅显示当前学生及其关联项目。系统会先自动重试、降级或核对回执；只有归属不明、不可消解冲突、未知结果或永久失败才需要处理。", 13f))
        val controls = LinearLayout(this)
        listOf("active" to "处理中", "help" to "需要处理", "history" to "历史记录").forEach { (id, label) ->
            controls.addView(button(label) { filter = id; offset = 0; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(controls)
        query = EditText(this).apply { hint = "搜索任务、状态或项目"; setSingleLine(true) }
        root.addView(query)
        val paging = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        paging.addView(button("筛选／第一页") { offset = 0; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        paging.addView(button("上一页") { offset = (offset - PAGE_SIZE).coerceAtLeast(0); refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        paging.addView(button("下一页") { offset += PAGE_SIZE; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(paging)
        root.addView(button("刷新本机状态") { refresh() })
        root.addView(button("立即检查并续跑可恢复任务") {
            status.text = "正在核对原任务、回执和重试时间…"
            worker.execute {
                val result = runCatching { AutomationReconciliationService(this).reconcile() }
                runOnUiThread {
                    if (!currentScope()) return@runOnUiThread
                    status.text = result.fold({ "对账完成：续跑 ${it.optInt("requeued")}，补回执 ${it.optInt("recovered")}，需要处理 ${it.optInt("needsAttention")}" },
                        { "对账未完成，原任务和资料均已保留：${it.message}" })
                    refresh()
                }
            }
        })
        root.addView(button("高级详情（技术回执与安全上限）") {
            showTechnicalDetails()
        })
        root.addView(button("修复当前学生资料清单副本（不移动原件）") {
            worker.execute {
                val result = runCatching {
                    StudentMaterialRepository(this, StudentIndexRepository(this).requireExact(studentId)).repairProjection()
                }
                runOnUiThread { if (currentScope()) status.text = result.fold({ "清单副本已根据 Room 修复，原件未移动" }, { "副本修复未完成，Room 登记保留：${it.message}" }) }
            }
        })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply { addView(list) }, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(button("返回") { finish() }); setContentView(root)
    }
    override fun onResume() { super.onResume(); if (::list.isInitialized) refresh() }
    override fun onPause() { generation++; super.onPause() }
    override fun onDestroy() { generation++; worker.shutdownNow(); super.onDestroy() }

    private fun currentScope() = !isFinishing && !isDestroyed &&
        getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, MODE_PRIVATE).getString(MainActivity.KEY_CURRENT_STUDENT_ID, "") == studentId
    private fun refresh() {
        if (!currentScope()) { finish(); return }
        val request = ++generation
        status.text = "正在读取当前学生任务…"
        worker.execute {
            val result = runCatching {
                val student = StudentIndexRepository(this).requireExact(studentId)
                val projects = ProjectRepository(this).list().filter { studentId in it.studentIds }
                val tasks = TaskRepository(this).listForStudent(studentId, projects.map { it.id })
                val jobs = projects.mapNotNull { project -> ProjectDigestQueue(this).latest(project.id)?.let { project to it } }
                val db = BusinessDatabase.get(this)
                Snapshot(student.name, tasks, jobs, CloudReportSync(this).status(studentId),
                    db.tasks().metadata("studio-auto-result:$studentId")?.let(::JSONObject))
            }
            runOnUiThread {
                if (request != generation || !currentScope()) return@runOnUiThread
                list.removeAllViews()
                result.onSuccess(::render).onFailure { status.text = "任务读取失败，原记录保留"; list.addView(text(it.message ?: "请稍后重试", 15f)) }
            }
        }
    }
    private fun matches(state: String) = when (filter) {
        "active" -> state in setOf("queued", "running", "waiting_network", "waiting_quota")
        "help" -> state == "needs_user"
        "history" -> state in setOf("succeeded", "cancelled", "superseded", "failed")
        else -> state in setOf("queued", "running", "waiting_network", "waiting_quota")
    }
    private fun render(snapshot: Snapshot) {
        status.text = "${snapshot.name} · 任务中心"
        list.addView(text("资料任务（最近100条）", 18f))
        val keyword = query.text.toString().trim()
        val tasks = snapshot.tasks.filter { matches(TaskCenterPolicy.viewState(it)) }
            .filter { keyword.isBlank() || listOf(it.optString("title"), it.optString("status"), it.optString("message")).any { value -> value.contains(keyword, true) } }
            .drop(offset).take(PAGE_SIZE)
        if (tasks.isEmpty()) list.addView(text("该筛选下没有任务。", 14f))
        tasks.forEach { task ->
            list.addView(button("${task.optString("title")} · ${TaskCenterPolicy.label(TaskCenterPolicy.viewState(task))}\n${task.optString("updatedAt")}") { details(task.getString("id")) })
        }
        list.addView(text("关联项目（每项目最近一次队列）", 18f))
        snapshot.jobs.filter { matches(TaskCenterPolicy.viewState(it.second)) }
            .filter { keyword.isBlank() || it.first.name.contains(keyword, true) || it.second.optString("message").contains(keyword, true) }
            .drop(offset).take(PAGE_SIZE).forEach { (project, job) ->
            list.addView(button("${project.name} · ${TaskCenterPolicy.label(TaskCenterPolicy.viewState(job))}\n${job.optString("message")}") {
                if (currentScope()) startActivity(Intent(this, ProjectMaterialsActivity::class.java).putExtra(ProjectMaterialsActivity.EXTRA_PROJECT_ID, project.id))
            })
        }
        snapshot.automation?.let { list.addView(text("智能参考建议：${TaskCenterPolicy.label(it.optString("state"))}\n${it.optString("checkedAt")} · ${it.optString("message")}", 14f)) }
        val cloud = snapshot.cloud
        list.addView(text("云端报告", 18f))
        list.addView(text(when {
            !cloud.configured -> "未开通；本机资料仍可使用。"
            cloud.lastError.isNotBlank() -> "需要处理：${cloud.lastError}"
            !cloud.enabled -> "自动上传已关闭"
            cloud.pendingServerState.isNotBlank() -> "等待同步授权状态：${cloud.pendingServerState}"
            else -> "自动上传已开启；最近同步回执 ${if (cloud.lastSyncAt > 0) java.util.Date(cloud.lastSyncAt).toString() else "尚无"}"
        }, 14f))
    }
    private fun showTechnicalDetails() {
        worker.execute {
            val result = runCatching {
                StudentIndexRepository(this).requireExact(studentId)
                val db = BusinessDatabase.get(this); BusinessRestoreRecovery.recover(this, db)
                val limits = listOf("text", "vision", "research", "asr").joinToString("\n") { category ->
                    "$category：${db.tasks().metadata("model-budget:${Timestamp.now().take(7)}:$category") ?: "0"} 次"
                }
                val reserved = db.tasks().metadata("studio-budget:$studentId:${Timestamp.now().take(10)}")?.let { JSONObject(it).optInt("reserved") } ?: 0
                val calls = db.ledger().calls(studentId).take(50).joinToString("\n\n") { call ->
                    "${call.model} · ${TaskCenterPolicy.label(call.state)} · ${call.elapsedMs} ms\n输入 ${call.inputTokens?.toString() ?: "未知"} / 输出 ${call.outputTokens?.toString() ?: "未知"}${if (call.errorCode.isBlank()) "" else " · ${call.errorCode}"}"
                }.ifBlank { "暂无模型回执" }
                "$limits\n学习/规划今日预留：$reserved 次\n\n最近模型回执：\n$calls\n\n以上为本机调用记录，不是账单；未知用量不计为 0，也不会自动重试。"
            }
            runOnUiThread { if (currentScope()) AlertDialog.Builder(this).setTitle("高级技术详情").setMessage(result.getOrElse { "读取失败，不能当作零用量" }).setPositiveButton("关闭", null).show() }
        }
    }
    private fun details(taskId: String) {
        val request = generation
        worker.execute {
            val result = runCatching {
                val repo = TaskRepository(this); val task = repo.requireExact(taskId)
                val projects = ProjectRepository(this).list().filter { studentId in it.studentIds }.map { it.id }.toSet()
                require(TaskCenterPolicy.visible(task, studentId, projects)) { "任务不属于当前学生" }
                task to repo.events(taskId)
            }
            runOnUiThread {
                if (request != generation || !currentScope()) return@runOnUiThread
                result.onSuccess { (task, events) ->
                    val message = "状态：${TaskCenterPolicy.label(TaskCenterPolicy.viewState(task))}\n尝试次数：${task.optInt("attempt")}\n${task.optJSONObject("error")?.optString("message").orEmpty()}\n\n最近事件：\n" + events.joinToString("\n") { "${it.optString("at")} · ${it.optString("type")}" }
                    val dialog = AlertDialog.Builder(this).setTitle(task.optString("title")).setMessage(message).setNegativeButton("关闭", null)
                    if (TaskCenterPolicy.canCancel(task, studentId)) dialog.setPositiveButton("取消未启动任务") { _, _ ->
                        worker.execute {
                            val cancelled = runCatching { require(currentScope()); TaskRepository(this).cancelQueued(taskId, studentId) }
                            runOnUiThread { if (currentScope()) { cancelled.onFailure { showError(it) }; refresh() } }
                        }
                    }
                    dialog.show()
                }.onFailure(::showError)
            }
        }
    }
    private fun showError(error: Throwable) { AlertDialog.Builder(this).setTitle("操作未完成").setMessage(error.message ?: "原记录保留").setPositiveButton("知道了", null).show() }
    private fun text(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; setTextColor(palette.text); setPadding(0, dp(8), 0, dp(8)) }
    private fun button(label: String, action: () -> Unit) = Button(this).apply { text = label; YouthUi.applyButton(this, palette, YouthButtonRole.COMPACT); setOnClickListener { action() } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private data class Snapshot(val name: String, val tasks: List<JSONObject>, val jobs: List<Pair<ProjectRecord, JSONObject>>, val cloud: CloudReportStatus, val automation: JSONObject?)
    companion object {
        const val EXTRA_STUDENT_ID = "student_id"
        private const val PAGE_SIZE = 50
    }
}
