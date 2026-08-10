package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class CollaborationActivity : Activity() {
    private lateinit var repository: CollaborationRepository
    private lateinit var deviceList: LinearLayout
    private lateinit var studentMapList: LinearLayout
    private lateinit var exceptionList: LinearLayout
    private lateinit var summaryText: TextView
    private var busyDialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!LicenseManager(this).status().active) { finish(); return }
        repository = CollaborationRepository(this)
        setContentView(buildPage())
        loadSnapshot()
    }

    private fun buildPage(): ScrollView = ScrollView(this).apply {
        setBackgroundColor(0xFFF4F8F7.toInt())
        addView(LinearLayout(this@CollaborationActivity).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(20), dp(22), dp(36))
            addView(TextView(this@CollaborationActivity).apply { text = "知识协作"; textSize = 28f; setTextColor(0xFF173B37.toInt()) }, matchWrap())
            addView(TextView(this@CollaborationActivity).apply {
                text = "先建立设备信任，再按学生精确共享。不会同步原始资料、License、API Token、SAF 地址或本机密钥。"
                textSize = 15f; setTextColor(0xFF526B68.toInt()); setPadding(0, dp(6), 0, dp(12))
            }, matchWrap())
            summaryText = statusText("正在读取本机协作状态…"); addView(summaryText, matchWrap())

            addView(sectionTitle("协作设备"), matchWrap())
            addView(actionButton("扫描 Windows 主机连接二维码") { startActivityForResult(Intent(this@CollaborationActivity, CollaborationQrScannerActivity::class.java), REQUEST_QR) }, matchWrap())
            addView(actionButton("输入六位临时码或粘贴连接信息") { showConnectionDialog() }, matchWrap())
            deviceList = LinearLayout(this@CollaborationActivity).apply { orientation = LinearLayout.VERTICAL }; addView(deviceList, matchWrap())

            addView(sectionTitle("共享学生"), matchWrap())
            addView(TextView(this@CollaborationActivity).apply {
                text = "从已信任 Windows 主机复制学生共享邀请，在此选择本机对应的确切学生；不会按姓名自动匹配。"
                textSize = 14f; setTextColor(0xFF526B68.toInt())
            }, matchWrap())
            addView(actionButton("粘贴并接受学生共享邀请") { chooseStudentForClipboardOffer() }, matchWrap())
            studentMapList = LinearLayout(this@CollaborationActivity).apply { orientation = LinearLayout.VERTICAL }; addView(studentMapList, matchWrap())

            addView(sectionTitle("同步异常"), matchWrap())
            exceptionList = LinearLayout(this@CollaborationActivity).apply { orientation = LinearLayout.VERTICAL }; addView(exceptionList, matchWrap())
            addView(actionButton("刷新状态") { loadSnapshot() }, matchWrap())
            addView(actionButton("返回系统设置") { finish() }, matchWrap())
        })
    }

    private fun showConnectionDialog(initial: String = "") {
        val input = EditText(this).apply {
            hint = "六位临时码，或完整 JSON 连接信息"
            setText(initial); minLines = 3; gravity = Gravity.TOP
        }
        AlertDialog.Builder(this).setTitle("连接协作设备")
            .setMessage("六位码会在同一局域网自动发现 Windows 主机；发现失败时请粘贴完整连接信息。")
            .setView(input).setNegativeButton("取消", null).setPositiveButton("连接") { _, _ -> connect(input.text.toString()) }.show()
    }

    private fun connect(value: String) {
        if (value.trim().isBlank()) { showMessage("连接信息不能为空"); return }
        showBusy("正在验证设备身份并建立信任…")
        Thread {
            val result = runCatching { repository.joinDevice(value) }
            runOnUiThread {
                hideBusy()
                result.onSuccess { showMessage("已与“${it.peerDisplayName}”建立设备信任。设备只需配对一次。") ; loadSnapshot() }
                    .onFailure { showMessage("连接失败：${it.message ?: "未知错误"}") }
            }
        }.start()
    }

    private fun chooseStudentForClipboardOffer() {
        val raw = (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty().trim()
        if (raw.isBlank()) { showMessage("剪贴板中没有学生共享邀请"); return }
        val students = StudentIndexRepository(this).list()
        if (students.isEmpty()) { showMessage("本机尚未建立学生档案，不能接受学生共享邀请"); return }
        AlertDialog.Builder(this).setTitle("选择本机对应学生")
            .setMessage("必须人工核对学生；不会按姓名猜测。")
            .setItems(students.map { "${it.name}\n${it.id}" }.toTypedArray()) { _, index ->
                val student = students[index]
                AlertDialog.Builder(this).setTitle("确认学生映射")
                    .setMessage("将邀请中的远端学生与本机“${student.name}”（${student.id}）建立共享关系。确认无误吗？")
                    .setNegativeButton("取消", null).setPositiveButton("确认") { _, _ -> acceptStudentOffer(raw, student) }.show()
            }.show()
    }

    private fun acceptStudentOffer(raw: String, student: StudentRecord) {
        showBusy("正在校验设备信任和学生目录授权…")
        Thread {
            val result = runCatching { repository.acceptStudentMapping(raw, student.id) }
            runOnUiThread {
                hideBusy()
                result.onSuccess {
                    showMessage("已绑定本机学生“${student.name}”，Windows 主机也已自动确认。学生共享关系现已在双方生效。")
                    loadSnapshot()
                }.onFailure { showMessage("接受学生共享失败：${it.message ?: "未知错误"}") }
            }
        }.start()
    }

    private fun loadSnapshot() {
        Thread {
            val result = runCatching { repository.initialize(); repository.snapshot() }
            runOnUiThread { result.onSuccess(::renderSnapshot).onFailure { summaryText.text = "协作状态读取失败：${it.message ?: "未知错误"}" } }
        }.start()
    }

    private fun renderSnapshot(snapshot: CollaborationSnapshot) {
        summaryText.text = "可信设备 ${snapshot.devices.count { it.status == "active" }} 台 · 共享学生 ${snapshot.studentMaps.count { it.status == "active" }} 个 · 等待任务 ${snapshot.pendingQueueCount} 个"
        deviceList.removeAllViews()
        if (snapshot.devices.isEmpty()) deviceList.addView(emptyText("尚未连接协作设备。"), matchWrap())
        snapshot.devices.forEach { device ->
            val card = card()
            card.addView(TextView(this).apply {
                text = "${device.peerDisplayName}\n${statusLabel(device.status)} · 最近连接 ${device.lastSeenAt.ifBlank { "尚无" }}"
                textSize = 15f; setTextColor(0xFF173B37.toInt())
            }, matchWrap())
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            if (device.status != "revoked") row.addView(actionButton(if (device.status == "active") "本机暂停" else "恢复") {
                changeDeviceStatus(device, if (device.status == "active") "paused" else "active")
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (device.status != "revoked") row.addView(actionButton("撤销") {
                AlertDialog.Builder(this).setTitle("撤销设备信任")
                    .setMessage("撤销后本机会删除该设备的协作凭据；如需恢复，必须重新配对。确认继续吗？")
                    .setNegativeButton("取消", null).setPositiveButton("撤销") { _, _ -> changeDeviceStatus(device, "revoked") }.show()
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            card.addView(row, matchWrap()); deviceList.addView(card, matchWrap())
        }

        studentMapList.removeAllViews()
        if (snapshot.studentMaps.isEmpty()) studentMapList.addView(emptyText("尚未添加共享学生。"), matchWrap())
        val localStudents = StudentIndexRepository(this).list().associateBy { it.id }
        snapshot.studentMaps.forEach { map ->
            val card = card()
            card.addView(statusText(
                "${localStudents[map.localStudentId]?.name ?: map.localStudentId} ↔ ${map.peerStudentName.ifBlank { map.peerStudentId }}\n${statusLabel(map.status)} · 精确学生 ID 映射",
            ), matchWrap())
            if (map.status == "active") card.addView(actionButton("立即同步") {
                Thread {
                    val result = runCatching { repository.syncNow(map.studentMapId) }
                    runOnUiThread {
                        result.onSuccess { showMessage("同步已排队，将优先尝试局域网，失败后尝试 Tailscale。") }
                            .onFailure { showMessage(it.message ?: "同步排队失败") }
                        loadSnapshot()
                    }
                }.start()
            }, matchWrap())
            studentMapList.addView(card, matchWrap())
        }

        exceptionList.removeAllViews()
        if (snapshot.exceptions.isEmpty()) exceptionList.addView(emptyText("当前没有同步异常或未处理冲突。"), matchWrap())
        snapshot.exceptions.forEach { exception ->
            exceptionList.addView(statusText("学生 ${exception.localStudentId}\n${exception.message}\n${exception.createdAt}"), matchWrap())
        }
        exceptionList.addView(actionButton("查看高级连接信息") {
            showMessage("本机节点：${snapshot.node.nodeId}\n设备绑定：${snapshot.devices.joinToString { it.deviceBindingId }.ifBlank { "无" }}\n协议与密钥默认隐藏；此页不会显示共享密钥或 SAF 地址。")
        }, matchWrap())
    }

    private fun changeDeviceStatus(device: CollaborationDeviceEntity, status: String) {
        Thread {
            val result = runCatching { repository.updateDeviceStatus(device.deviceBindingId, status) }
            runOnUiThread { result.onSuccess { loadSnapshot() }.onFailure { showMessage(it.message ?: "状态更新失败") } }
        }.start()
    }

    @Deprecated("API 23 compatible activity result flow")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_QR && resultCode == RESULT_OK) {
            data?.getStringExtra(CollaborationQrScannerActivity.EXTRA_CONNECTION_PAYLOAD)?.let(::connect)
        }
    }

    private fun sectionTitle(value: String) = TextView(this).apply { text = value; textSize = 21f; setTextColor(0xFF173B37.toInt()); setPadding(0, dp(22), 0, dp(8)) }
    private fun statusText(value: String) = TextView(this).apply { text = value; textSize = 14f; setTextColor(0xFF2B4C48.toInt()); setBackgroundColor(Color.WHITE); setPadding(dp(14), dp(12), dp(14), dp(12)) }
    private fun emptyText(value: String) = TextView(this).apply { text = value; textSize = 14f; setTextColor(0xFF6B7F7C.toInt()); setPadding(dp(8), dp(10), dp(8), dp(10)) }
    private fun card() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE); setPadding(dp(14), dp(12), dp(14), dp(12)) }
    private fun actionButton(value: String, action: () -> Unit) = Button(this).apply { text = value; isAllCaps = false; setOnClickListener { action() } }
    private fun statusLabel(value: String) = when (value) { "active" -> "已启用"; "paused" -> "已暂停"; "revoked" -> "已撤销"; else -> value }
    private fun showBusy(message: String) { hideBusy(); busyDialog = AlertDialog.Builder(this).setTitle("知识协作").setMessage(message).setCancelable(false).show() }
    private fun hideBusy() { busyDialog?.dismiss(); busyDialog = null }
    private fun showMessage(message: String) { AlertDialog.Builder(this).setTitle("知识协作").setMessage(message).setPositiveButton("知道了", null).show() }
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object { private const val REQUEST_QR = 5201 }
}
