package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.widget.Button
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
    private var filter = "all"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        studentId = intent.getStringExtra(EXTRA_STUDENT_ID).orEmpty()
        if (studentId.isBlank()) { finish(); return }
        val ui = UiPreferences(this); palette = ui.palette(); ui.applyOrientation(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(12)); setBackgroundColor(palette.page) }
        status = text("正在读取当前学生任务…", 20f); root.addView(status)
        root.addView(text("仅当前学生及其关联项目。刷新不会重复处理；结果未知的任务需从原入口核对后恢复。", 13f))
        val controls = LinearLayout(this)
        listOf("all" to "全部", "active" to "处理中", "help" to "需要处理", "done" to "已完成").forEach { (id, label) ->
            controls.addView(button(label) { filter = id; refresh() }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(controls)
        root.addView(button("刷新本机状态") { refresh() })
        root.addView(button("核对未知消化／云摘要结果（不自动重试）") { recoverUnknown() })
        root.addView(button("查看本机 AI 安全上限（非账单）") {
            worker.execute {
                val result = runCatching {
                    StudentIndexRepository(this).requireExact(studentId)
                    val db = BusinessDatabase.get(this); BusinessRestoreRecovery.recover(this, db)
                    listOf("text" to 600, "vision" to 300, "research" to 60, "asr" to 120).joinToString("\n") { (category, cap) ->
                        "$category：${db.tasks().metadata("model-budget:${Timestamp.now().take(7)}:$category") ?: "0"} / $cap 次"
                    } + "\n\n为整个家庭设备的保守安全上限，不是付费额度或费用估算。失败与未知预留不自动退还；实际权益以服务器为准。"
                }
                runOnUiThread { if (currentScope()) AlertDialog.Builder(this).setTitle("本月调用安全上限").setMessage(result.getOrElse { "读取失败，不能当作零用量" }).setPositiveButton("关闭", null).show() }
            }
        })
        root.addView(button("修复当前学生资料清单副本（不移动原件）") {
            worker.execute {
                val result = runCatching { StudentMaterialRepository(this, StudentIndexRepository(this).requireExact(studentId)).repairProjection() }
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
                Snapshot(student.name, tasks, jobs, db.ledger().calls(studentId), CloudReportSync(this).status(studentId),
                    db.tasks().metadata("studio-auto-result:$studentId")?.let(::JSONObject),
                    db.tasks().metadata("studio-budget:$studentId:${Timestamp.now().take(10)}")?.let { JSONObject(it).getInt("reserved") } ?: 0)
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
        "help" -> state in setOf("failed", "needs_user", "unknown")
        "done" -> state in setOf("succeeded", "cancelled", "superseded")
        else -> true
    }
    private fun render(snapshot: Snapshot) {
        status.text = "${snapshot.name} · 任务中心"
        list.addView(text("资料任务（最近100条）", 18f))
        val tasks = snapshot.tasks.filter { matches(TaskCenterPolicy.viewState(it)) }
        if (tasks.isEmpty()) list.addView(text("该筛选下没有任务。", 14f))
        tasks.forEach { task ->
            list.addView(button("${task.optString("title")} · ${TaskCenterPolicy.label(TaskCenterPolicy.viewState(task))}\n${task.optString("updatedAt")}") { details(task.getString("id")) })
        }
        list.addView(text("关联项目（每项目最近一次队列）", 18f))
        snapshot.jobs.filter { matches(TaskCenterPolicy.viewState(it.second)) }.forEach { (project, job) ->
            list.addView(button("${project.name} · ${TaskCenterPolicy.label(TaskCenterPolicy.viewState(job))}\n${job.optString("message")}") {
                if (currentScope()) startActivity(Intent(this, ProjectMaterialsActivity::class.java).putExtra(ProjectMaterialsActivity.EXTRA_PROJECT_ID, project.id))
            })
        }
        list.addView(text("模型回执（最近50条；用量未知不计为0）", 18f))
        list.addView(text("学习/规划今日预留请求 ${snapshot.reserved}/${StudioBudget.DAILY_CAP}；该上限不是金额估算，失败和未知请求不自动退款。", 14f))
        snapshot.automation?.let { list.addView(text("自动练习：${TaskCenterPolicy.label(it.optString("state"))}\n${it.optString("checkedAt")} · ${it.optString("message")}", 14f)) }
        snapshot.calls.filter { matches(it.state) }.forEach { call ->
            list.addView(text("${call.model} · ${TaskCenterPolicy.label(call.state)} · ${call.elapsedMs} ms\n输入 ${call.inputTokens?.toString() ?: "未知"} / 输出 ${call.outputTokens?.toString() ?: "未知"} Token${if (call.errorCode.isBlank()) "" else "\n${call.errorCode}"}", 14f))
        }
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
    private fun recoverUnknown() {
        worker.execute {
            val result = runCatching { UnknownOutcomeRecovery(this).pending(studentId) }
            runOnUiThread {
                if (!currentScope()) return@runOnUiThread
                result.onFailure(::showError).onSuccess { rows ->
                    if (rows.isEmpty()) { status.text = "当前学生没有此类未知结果"; return@onSuccess }
                    AlertDialog.Builder(this).setTitle("选择需核对的记录").setItems(rows.map { "${if (it.name.startsWith("digest-request:")) "资料消化" else "云摘要"} · ${it.name.takeLast(12)}" }.toTypedArray()) { _, index ->
                        val row = rows[index]; val payload = JSONObject(row.payload)
                        val note = android.widget.EditText(this).apply { hint = "填写已核对的账单、文件或云端清单结果"; minLines = 3 }
                        AlertDialog.Builder(this).setTitle("允许下一次明确操作重试？")
                            .setMessage("请先核对服务端账单、本机产物和云端回收站。再次发送可能重复计费；授权不删除原回执，也不会立即或后台重试。之后仍需返回原入口明确操作。\n\n记录：${row.name}\n${payload.toString(2)}")
                            .setView(note).setNegativeButton("取消", null).setPositiveButton("已核对，单次授权") { _, _ ->
                                val text = note.text.toString()
                                worker.execute {
                                    val saved = runCatching { require(currentScope()); UnknownOutcomeRecovery(this).authorize(studentId, row.name, ScopedContentPolicy.fingerprint(payload), text) }
                                    runOnUiThread { if (currentScope()) saved.onSuccess { status.text = "已记录单次授权；请返回原入口操作，未自动重试" }.onFailure(::showError) }
                                }
                            }.show()
                    }.show()
                }
            }
        }
    }
    private fun text(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; setTextColor(palette.text); setPadding(0, dp(8), 0, dp(8)) }
    private fun button(label: String, action: () -> Unit) = Button(this).apply { text = label; isAllCaps = false; setTextColor(palette.accentDark); setOnClickListener { action() } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private data class Snapshot(val name: String, val tasks: List<JSONObject>, val jobs: List<Pair<ProjectRecord, JSONObject>>, val calls: List<ModelCallEntity>, val cloud: CloudReportStatus, val automation: JSONObject?, val reserved: Int)
    companion object { const val EXTRA_STUDENT_ID = "student_id" }
}
