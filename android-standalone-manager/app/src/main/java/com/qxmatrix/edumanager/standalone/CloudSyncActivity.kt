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

/** User-facing cloud scope, delivery receipts, explicit originals and candidate inbox. */
class CloudSyncActivity : Activity() {
    private lateinit var studentId: String
    private lateinit var palette: UiPalette
    private lateinit var status: TextView
    private lateinit var list: LinearLayout
    private val worker = Executors.newSingleThreadExecutor()
    private var generation = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        studentId = intent.getStringExtra(EXTRA_STUDENT_ID).orEmpty()
        if (studentId.isBlank()) { finish(); return }
        val ui = UiPreferences(this); ui.applyOrientation(this); palette = ui.palette()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(12)); setBackgroundColor(palette.page) }
        status = text("正在读取云同步状态…", 21f); root.addView(status)
        root.addView(text("五类资料分别授权；默认仅学情报告。原始照片、录音、视频和本地知识库不会自动镜像。", 13f))
        root.addView(button("学生基础信息字段预览") { showProfilePreview() })
        root.addView(button("选择五类同步范围") { showScopeDialog() })
        root.addView(button("逐项选择学习资料原件") { showMaterialDialog() })
        root.addView(button("云端成果收件箱") { showInbox() })
        root.addView(button("受限远程 Agent 任务") { showRemoteAgentActions() })
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
        worker.execute {
            val result = runCatching {
                val student = StudentIndexRepository(this).requireExact(studentId)
                Triple(student, CloudReportSync(this).status(studentId), CloudSyncReceiptStore(this).list(studentId).take(100))
            }
            runOnUiThread {
                if (request != generation || isFinishing || isDestroyed) return@runOnUiThread
                list.removeAllViews()
                result.onSuccess { (student, cloud, receipts) ->
                    status.text = "${student.name} · 云同步"
                    list.addView(text("自动同步：${if (cloud.enabled) "已开启" else "已关闭"}\n许可范围：${cloud.materialCategories.map(::categoryLabel).joinToString("、").ifBlank { "未选择资料" }}\n最近送达：${if (cloud.lastSyncAt > 0) java.text.DateFormat.getDateTimeInstance().format(java.util.Date(cloud.lastSyncAt)) else "尚无"}${if (cloud.lastError.isBlank()) "" else "\n需要帮助：${cloud.lastError}"}", 15f))
                    list.addView(text("同步结果", 18f))
                    if (receipts.isEmpty()) list.addView(text("暂无回执。", 14f))
                    receipts.forEach { row -> list.addView(text("${receiptLabel(row.optString("status"))} · ${row.optString("time")}\n${row.optString("detail")}", 14f)) }
                }.onFailure { status.text = "云同步状态读取失败"; list.addView(text(it.message ?: "原记录保留", 14f)) }
            }
        }
    }

    private fun showProfilePreview() {
        worker.execute {
            val result = runCatching {
                val student = StudentIndexRepository(this).requireExact(studentId)
                listOf("姓名" to student.name, "年级" to student.grade, "学校" to student.school, "学习目标" to student.goal,
                    "当前地区" to student.planningProfile.currentRegion, "生日" to student.planningProfile.birthDate)
                    .filter { it.second.isNotBlank() }.joinToString("\n") { "${it.first}：${it.second}" }
            }
            runOnUiThread { AlertDialog.Builder(this).setTitle("开启云同步后发送的基础字段")
                .setMessage(result.getOrElse { "读取失败：${it.message}" }.ifBlank { "当前没有可发送的非空基础字段。健康资料不在此范围，仍需独立许可。" } + "\n\n健康资料默认关闭，不随这些字段发送。")
                .setPositiveButton("知道了", null).show() }
        }
    }

    private fun showScopeDialog() {
        val sync = CloudReportSync(this); val cloud = sync.status(studentId)
        if (!cloud.configured) { message("尚未开通", "请先从学情报告的云端菜单开通当前学生。") ; return }
        val ids = CATEGORY_ORDER
        val checked = BooleanArray(ids.size) { ids[it] in cloud.materialCategories }
        AlertDialog.Builder(this).setTitle("分别选择同步资料")
            .setMultiChoiceItems(ids.map(::categoryLabel).toTypedArray(), checked) { _, which, value -> checked[which] = value }
            .setMessage("取消某类只停止后续发送，不自动删除云端既有版本。学习资料原件还需逐项选择。")
            .setNegativeButton("取消", null).setPositiveButton("确认许可") { _, _ ->
                val selected = ids.filterIndexed { index, _ -> checked[index] }.toSet()
                worker.execute {
                    val result = runCatching { sync.setUploadScope(studentId, selected) }
                    runOnUiThread { result.onSuccess { refresh() }.onFailure { message("许可未更新", it.message ?: "原许可保持不变") } }
                }
            }.show()
    }

    private fun showMaterialDialog() {
        val sync = CloudReportSync(this); val cloud = sync.status(studentId)
        if ("learning_material" !in cloud.materialCategories) { message("尚未授权学习资料", "请先在五类同步范围中开启“学习资料”。") ; return }
        worker.execute {
            val result = runCatching { FileAssetService(this).materials(studentId).take(200) to sync.selectedRawMaterials(studentId) }
            runOnUiThread {
                result.onFailure { message("资料读取失败", it.message ?: "原选择保持不变") }.onSuccess { (materials, selected) ->
                    if (materials.isEmpty()) { message("没有学习资料", "请先导入资料。") ; return@onSuccess }
                    val checked = BooleanArray(materials.size) { materials[it].optString("id") in selected }
                    AlertDialog.Builder(this).setTitle("逐项选择原件（最大 20 MB/份）")
                        .setMultiChoiceItems(materials.map { "${it.optString("fileName")} · ${it.optLong("size") / 1024} KB" }.toTypedArray(), checked) { _, which, value -> checked[which] = value }
                        .setNegativeButton("取消", null).setPositiveButton("保存选择") { _, _ -> worker.execute {
                            val saved = runCatching { materials.forEachIndexed { index, item -> sync.selectRawMaterial(studentId, item.getString("id"), checked[index]) } }
                            runOnUiThread { saved.onSuccess { refresh() }.onFailure { message("选择未完整保存", it.message ?: "请重试") } }
                        } }.show()
                }
            }
        }
    }

    private fun showInbox() {
        val sync = CloudReportSync(this)
        if (!sync.cloudInboxEnabled(studentId)) {
            AlertDialog.Builder(this).setTitle("开通成果收件箱")
                .setMessage("这会为本机另建只读许可。上传许可不会自动产生读取许可；远程 Agent 结果仍只作为候选，必须再次确认学生、来源和内容。")
                .setNegativeButton("取消", null).setPositiveButton("开通") { _, _ -> worker.execute {
                    val result = runCatching { sync.enableCloudInbox(studentId) }
                    runOnUiThread { result.onSuccess { message("已开通", "现在可以查看发给本机的候选成果。") }.onFailure { message("开通失败", it.message ?: "上传许可未改变") } }
                } }.show()
            return
        }
        worker.execute {
            val result = runCatching { sync.listCloudInbox(studentId) }
            runOnUiThread {
                result.onFailure { message("收件箱读取失败", it.message ?: "本地知识未改变") }.onSuccess { rows ->
                    if (rows.isEmpty()) { message("成果收件箱", "当前没有待确认成果。") ; return@onSuccess }
                    AlertDialog.Builder(this).setTitle("选择候选成果")
                        .setItems(rows.map { "${it.optString("provider")} · ${it.optString("taskType")} · ${it.optString("status")}" }.toTypedArray()) { _, which -> leaseAndReview(rows[which]) }.show()
                }
            }
        }
    }

    private fun leaseAndReview(summary: JSONObject) {
        val sync = CloudReportSync(this); val submissionId = summary.getString("submissionId")
        worker.execute {
            val result = runCatching { sync.leaseCloudInbox(studentId, submissionId) }
            runOnUiThread {
                result.onFailure { message("候选读取失败", it.message ?: "本地知识未改变") }.onSuccess { leased ->
                    val payload = leased.optJSONObject("payload") ?: JSONObject()
                    val projectId = leased.optString("projectId")
                    val projectValid = projectId.isBlank() || ProjectRepository(this).list().any { it.id == projectId && studentId in it.studentIds }
                    if (!projectValid) {
                        worker.execute { runCatching { sync.settleCloudInbox(studentId, submissionId, leased.getString("leaseId"), false, "项目范围不属于当前学生") } }
                        message("成果已隔离", "项目范围与当前学生不一致，未写入候选知识。")
                        return@onSuccess
                    }
                    AlertDialog.Builder(this).setTitle("确认学生、来源和候选内容")
                        .setMessage("学生：${StudentIndexRepository(this).requireExact(studentId).name}\n来源：${leased.optString("provider")}\n项目：${projectId.ifBlank { "无" }}\n指纹：${leased.optString("contentSha256")}\n\n${payload.toString(2).take(3000)}")
                        .setNegativeButton("暂不接收", null).setPositiveButton("保存为候选") { _, _ -> worker.execute {
                            val saved = runCatching {
                                val row = ScopedContentRepository(this).insertInboxCandidate(studentId, submissionId, leased.optString("provider"), payload, leased.getString("contentSha256"), projectId)
                                sync.settleCloudInbox(studentId, submissionId, leased.getString("leaseId"), true)
                                row
                            }
                            runOnUiThread { saved.onSuccess { message("已保存为候选", "未直接修改成长模型、报告或已确认知识。") }.onFailure { message("保存未完成", it.message ?: "原知识保持不变") } }
                        } }.show()
                }
            }
        }
    }

    private fun showRemoteAgentActions() {
        val sync = CloudReportSync(this)
        if (!sync.cloudInboxEnabled(studentId)) { message("尚未开通成果收件箱", "远程 Agent 必须使用独立只读许可并把结果送入候选收件箱。请先开通成果收件箱。") ; return }
        AlertDialog.Builder(this).setTitle("受限远程 Agent")
            .setItems(arrayOf("发起 15 分钟只读任务", "查看任务状态")) { _, which -> if (which == 0) issueRemoteAgent() else showRemoteAgentStatuses() }
            .setNegativeButton("关闭", null).show()
    }

    private fun issueRemoteAgent() {
        val sync = CloudReportSync(this); val cloud = sync.status(studentId)
        val choices = listOf("资料整理建议" to "material_digest_candidate", "规划候选核验" to "planning_candidate_review", "学习卡片草案" to "learning_card_candidate")
        AlertDialog.Builder(this).setTitle("选择任务（只读）")
            .setItems(choices.map { it.first }.toTypedArray()) { _, which ->
                val taskType = choices[which].second
                val providers = listOf("codex" to "Codex", "workbuddy" to "WorkBuddy")
                AlertDialog.Builder(this).setTitle("选择远程执行器").setItems(providers.map { it.second }.toTypedArray()) providerChoice@{ _, providerIndex ->
                    val categories = cloud.materialCategories
                    if (categories.isEmpty()) { message("没有可读资料范围", "请先选择至少一类云同步资料并等待送达。") ; return@providerChoice }
                    worker.execute {
                        val result = runCatching { sync.issueRemoteAgentSession(studentId, providers[providerIndex].first, taskType, categories) }
                        runOnUiThread {
                            result.onFailure { message("任务未发起", it.message ?: "许可未扩大") }.onSuccess { session ->
                                val handoff = JSONObject().put("service", sync.serviceAddress()).put("sessionId", session.getString("sessionId"))
                                    .put("sessionToken", session.getString("sessionToken")).put("provider", session.getString("provider"))
                                    .put("taskId", session.getString("taskId")).put("executionId", session.getString("executionId"))
                                    .put("taskType", session.getString("taskType")).put("expiresAt", session.getLong("expiresAt"))
                                AlertDialog.Builder(this).setTitle("任务会话已创建")
                                    .setMessage("会话 15 分钟后失效，只能读取所选学生与资料类别；结果只能提交到候选收件箱。将下面的临时任务交给受信任的 Windows 或云端执行器。")
                                    .setNegativeButton("关闭", null).setPositiveButton("分享临时任务") { _, _ ->
                                        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_TEXT, handoff.toString()), "发送给远程执行器"))
                                    }.show()
                            }
                        }
                    }
                }.show()
            }.show()
    }

    private fun showRemoteAgentStatuses() {
        val sync = CloudReportSync(this)
        worker.execute {
            val result = runCatching { sync.remoteAgentStatuses(studentId) }
            runOnUiThread {
                result.onFailure { message("状态读取失败", it.message ?: "不会重新发起任务") }.onSuccess { rows ->
                    if (rows.isEmpty()) { message("远程任务", "本机还没有发起过远程任务。") ; return@onSuccess }
                    AlertDialog.Builder(this).setTitle("远程任务状态")
                        .setItems(rows.map { "${it.optString("taskType")} · ${it.optString("status")}\n${it.optString("sessionId").takeLast(12)}" }.toTypedArray()) { _, which ->
                            val row = rows[which]; AlertDialog.Builder(this).setTitle(row.optString("taskType"))
                                .setMessage("状态：${row.optString("status")}\n创建：${java.util.Date(row.optLong("createdAt"))}\n到期：${java.util.Date(row.optLong("expiresAt"))}\n成果：${row.optString("resultSubmissionId").ifBlank { "尚未提交" }}")
                                .setNegativeButton("关闭", null).setPositiveButton("撤销未完成会话") { _, _ -> worker.execute {
                                    val revoked = runCatching { sync.revokeRemoteAgentSession(studentId, row.getString("sessionId")) }
                                    runOnUiThread { revoked.onSuccess { message("撤销请求已记录", "已完成或已入收件箱的成果不会被删除。") }.onFailure { message("撤销失败", it.message ?: "请刷新状态") } }
                                } }.show()
                        }.show()
                }
            }
        }
    }

    private fun categoryLabel(id: String) = when (id) { "learning_report" -> "学情报告"; "learning_material" -> "学习资料"; "topic_suggestion" -> "选题建议"; "competition_recommendation" -> "比赛推荐"; "learning_card" -> "学习卡片"; else -> id }
    private fun receiptLabel(status: String) = when (status) { "queued" -> "等待发送"; "network_recovered" -> "网络恢复"; "delivered" -> "已送达"; "withdrawn" -> "已撤回后续发送"; "failed" -> "需要帮助"; else -> status }
    private fun message(title: String, body: String) { AlertDialog.Builder(this).setTitle(title).setMessage(body).setPositiveButton("知道了", null).show() }
    private fun text(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; setTextColor(palette.text); setPadding(0, dp(8), 0, dp(8)) }
    private fun button(label: String, action: () -> Unit) = Button(this).apply { text = label; YouthUi.applyButton(this, palette, YouthButtonRole.COMPACT); setOnClickListener { action() } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_STUDENT_ID = "student_id"
        private val CATEGORY_ORDER = listOf("learning_report", "learning_material", "topic_suggestion", "competition_recommendation", "learning_card")
    }
}
