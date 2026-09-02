package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

class CollaborationActivity : Activity() {
    private lateinit var repository: CollaborationRepository
    private lateinit var deviceList: LinearLayout
    private lateinit var studentMapList: LinearLayout
    private lateinit var exceptionList: LinearLayout
    private lateinit var summaryText: TextView
    private lateinit var nearbyStatusText: TextView
    private lateinit var nearbyToggleButton: Button
    private lateinit var palette: UiPalette
    private var busyDialog: AlertDialog? = null
    private var nearbyRunning = false
    private var createInvitationAfterNotification = false
    private var connectionAfterNotification = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!LicenseManager(this).status().active) { finish(); return }
        val ui = UiPreferences(this); ui.applyOrientation(this); palette = ui.palette()
        repository = CollaborationRepository(this)
        setContentView(buildPage())
        loadSnapshot()
    }

    private fun buildPage(): ScrollView = ScrollView(this).apply {
        setBackgroundColor(palette.page)
        addView(LinearLayout(this@CollaborationActivity).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(20), dp(22), dp(36))
            addView(TextView(this@CollaborationActivity).apply { text = "知识协作"; textSize = 28f; setTextColor(palette.heading) }, matchWrap())
            addView(TextView(this@CollaborationActivity).apply {
                text = "先建立设备信任，再按学生精确共享。支持 Windows 主机和附近 Android 单机版；不会同步原始资料、License、API Token、SAF 地址或本机密钥。"
                textSize = 15f; setTextColor(palette.muted); setPadding(0, dp(6), 0, dp(12))
            }, matchWrap())
            summaryText = statusText("正在读取本机协作状态…"); addView(summaryText, matchWrap())

            addView(sectionTitle("协作设备"), matchWrap())
            nearbyStatusText = statusText("附近接收：正在读取状态…"); addView(nearbyStatusText, matchWrap())
            nearbyToggleButton = actionButton("开启附近接收") { toggleNearbyReceiver() }; addView(nearbyToggleButton, matchWrap())
            addView(actionButton("添加协作设备") { showAddDeviceDialog() }, matchWrap())
            deviceList = LinearLayout(this@CollaborationActivity).apply { orientation = LinearLayout.VERTICAL }; addView(deviceList, matchWrap())

            addView(sectionTitle("共享学生"), matchWrap())
            addView(TextView(this@CollaborationActivity).apply {
                text = "由任一可信设备创建学生共享邀请，另一端人工选择对应学生；不会按姓名自动匹配。"
                textSize = 14f; setTextColor(palette.muted)
            }, matchWrap())
            addView(actionButton("创建学生共享邀请") { chooseDeviceAndStudentForOffer() }, matchWrap())
            addView(actionButton("粘贴并接受学生共享邀请") { chooseStudentForClipboardOffer() }, matchWrap())
            studentMapList = LinearLayout(this@CollaborationActivity).apply { orientation = LinearLayout.VERTICAL }; addView(studentMapList, matchWrap())

            addView(sectionTitle("同步异常"), matchWrap())
            exceptionList = LinearLayout(this@CollaborationActivity).apply { orientation = LinearLayout.VERTICAL }; addView(exceptionList, matchWrap())
            addView(actionButton("刷新状态") { loadSnapshot() }, matchWrap())
            addView(actionButton("返回系统设置") { finish() }, matchWrap())
        })
    }

    private fun showAddDeviceDialog() {
        val choices = arrayOf("扫描协作二维码", "输入六位临时码或连接信息", "生成本机邀请二维码和六位码")
        AlertDialog.Builder(this).setTitle("添加协作设备").setItems(choices) { _, index ->
            when (index) {
                0 -> startActivityForResult(Intent(this, CollaborationQrScannerActivity::class.java), REQUEST_QR)
                1 -> showConnectionDialog()
                else -> createNearbyInvitation()
            }
        }.show()
    }

    private fun toggleNearbyReceiver() {
        if (nearbyRunning) {
            showBusy("正在停止附近协作接收…")
            Thread {
                val result = runCatching { repository.stopNearbyReceiver() }
                Thread.sleep(250)
                runOnUiThread {
                    hideBusy()
                    result.onFailure { showMessage(it.message ?: "无法停止附近协作接收") }
                    loadSnapshot()
                }
            }.start()
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            createInvitationAfterNotification = false
            AlertDialog.Builder(this).setTitle("允许显示协作状态通知")
                .setMessage("附近接收只在持续通知存在期间运行，通知中可以随时停止接收。")
                .setNegativeButton("暂不开启", null)
                .setPositiveButton("继续") { _, _ -> requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATION) }
                .show()
        } else {
            startNearbyReceiverFromUi()
        }
    }

    private fun startNearbyReceiverFromUi() {
        showBusy("正在启动并确认附近协作接收…")
        Thread {
            val result = runCatching { repository.startNearbyReceiver() }
            runOnUiThread {
                hideBusy()
                result.onSuccess { showMessage("附近协作接收已开启；系统通知存在期间，可信设备可以连接和同步。") }
                    .onFailure { showMessage(it.message ?: "无法启动附近协作接收") }
                loadSnapshot()
            }
        }.start()
    }

    private fun showConnectionDialog(initial: String = "") {
        val input = EditText(this).apply {
            hint = "六位临时码，或完整 JSON 连接信息"
            setText(initial); minLines = 3; gravity = Gravity.TOP
        }
        AlertDialog.Builder(this).setTitle("连接协作设备")
            .setMessage("六位码会在同一局域网或热点自动发现 Windows 主机和 Android 单机版；发现失败时请粘贴完整连接信息。")
            .setView(input).setNegativeButton("取消", null).setPositiveButton("连接") { _, _ -> connect(input.text.toString()) }.show()
    }

    private fun connect(value: String) {
        if (value.trim().isBlank()) { showMessage("连接信息不能为空"); return }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            connectionAfterNotification = value
            createInvitationAfterNotification = false
            AlertDialog.Builder(this).setTitle("允许显示协作状态通知")
                .setMessage("建立设备信任后，本机会开启附近接收用于对端回传。持续通知可让你随时停止接收。")
                .setNegativeButton("取消", null)
                .setPositiveButton("继续") { _, _ -> requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATION) }
                .show()
            return
        }
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

    private fun createNearbyInvitation() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            createInvitationAfterNotification = true
            AlertDialog.Builder(this).setTitle("允许显示协作状态通知")
                .setMessage("生成邀请会同时开启附近接收；持续通知用于显示运行状态并允许随时停止。")
                .setNegativeButton("取消", null)
                .setPositiveButton("继续") { _, _ -> requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATION) }
                .show()
            return
        }
        showBusy("正在开启附近协作并生成一次性连接信息…")
        Thread {
            val result = runCatching { repository.createNearbyInvitation() }
            runOnUiThread {
                hideBusy()
                result.onSuccess { invitation ->
                    showPayloadDialog(
                        title = "连接附近 Android 单机版",
                        message = "六位临时码：${invitation.pairingCode}\n有效期至：${invitation.expiresAt}\n\n让另一台单机版扫描二维码，或输入六位码。",
                        payload = invitation.publicConnectionJson(),
                        copyLabel = "复制完整连接信息",
                    )
                    loadSnapshot()
                }.onFailure { showMessage("生成连接信息失败：${it.message ?: "未知错误"}") }
            }
        }.start()
    }

    private fun chooseDeviceAndStudentForOffer() {
        Thread {
            val result = runCatching { repository.snapshot() }
            runOnUiThread {
                result.onSuccess { snapshot ->
                    val devices = snapshot.devices.filter { it.status == "active" }
                    if (devices.isEmpty()) { showMessage("请先与 Windows 主机或另一台 Android 单机版建立设备信任"); return@onSuccess }
                    AlertDialog.Builder(this).setTitle("选择共享对象")
                        .setItems(devices.map { it.peerDisplayName }.toTypedArray()) { _, deviceIndex ->
                            chooseLocalStudentForNewOffer(devices[deviceIndex])
                        }.show()
                }.onFailure { showMessage(it.message ?: "无法读取协作设备") }
            }
        }.start()
    }

    private fun chooseLocalStudentForNewOffer(device: CollaborationDeviceEntity) {
        val students = StudentIndexRepository(this).list()
        if (students.isEmpty()) { showMessage("本机尚未建立学生档案"); return }
        AlertDialog.Builder(this).setTitle("选择本机学生")
            .setMessage("邀请只绑定所选学生 ID，不会按姓名推断对方学生。")
            .setItems(students.map { "${it.name}\n${it.id}" }.toTypedArray()) { _, index ->
                val student = students[index]
                showBusy("正在创建受设备信任保护的学生共享邀请…")
                Thread {
                    val result = runCatching { repository.createStudentMappingOffer(device.deviceBindingId, student.id) }
                    runOnUiThread {
                        hideBusy()
                        result.onSuccess { offer -> showPayloadDialog(
                            title = "学生共享邀请",
                            message = "本机学生：${student.name}\n目标设备：${device.peerDisplayName}\n\n请让目标设备扫描二维码，或复制并粘贴此邀请。",
                            payload = offer,
                            copyLabel = "复制学生共享邀请",
                        ) }.onFailure { showMessage("创建学生共享邀请失败：${it.message ?: "未知错误"}") }
                    }
                }.start()
            }.show()
    }

    private fun chooseStudentForClipboardOffer() {
        val raw = (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty().trim()
        if (raw.isBlank()) { showMessage("剪贴板中没有学生共享邀请"); return }
        chooseStudentForOffer(raw)
    }

    private fun chooseStudentForOffer(raw: String) {
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
                    showMessage("已绑定本机学生“${student.name}”，对方设备也已自动确认。学生共享关系现已在双方生效。")
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
        nearbyRunning = snapshot.nearby.running
        nearbyToggleButton.text = if (snapshot.nearby.running) "停止附近接收" else "开启附近接收"
        nearbyToggleButton.isEnabled = !snapshot.nearby.starting
        nearbyStatusText.text = buildString {
            append("附近接收：")
            append(when { snapshot.nearby.running -> "运行中"; snapshot.nearby.starting -> "正在启动"; else -> "未开启" })
            if (snapshot.nearby.invitationCode.isNotBlank()) append(" · 当前邀请 ${snapshot.nearby.invitationCode}")
            if (snapshot.nearby.lastError.isNotBlank()) append("\n需要处理：${snapshot.nearby.lastError}")
            else if (snapshot.nearby.lastEvent.isNotBlank()) append("\n${snapshot.nearby.lastEvent}")
        }
        deviceList.removeAllViews()
        if (snapshot.devices.isEmpty()) deviceList.addView(emptyText("尚未连接协作设备。"), matchWrap())
        snapshot.devices.forEach { device ->
            val card = card()
            card.addView(TextView(this).apply {
                val peerType = if (device.capabilitiesJson.contains("android-nearby-v1")) "Android 单机版" else "Windows 主机"
                val sharedCount = snapshot.studentMaps.count { it.deviceBindingId == device.deviceBindingId && it.status != "revoked" }
                text = "${device.peerDisplayName}\n$peerType · ${statusLabel(device.status)} · 共享学生 $sharedCount 个\n最近连接 ${device.lastSeenAt.ifBlank { "尚无" }}"
                textSize = 15f; setTextColor(palette.text)
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
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            if (map.status == "active") row.addView(actionButton("立即同步") {
                Thread {
                    val result = runCatching { repository.syncNow(map.studentMapId) }
                    runOnUiThread {
                        result.onSuccess { showMessage("同步已排队，将优先尝试局域网或热点，失败后尝试已有 Tailscale 地址。") }
                            .onFailure { showMessage(it.message ?: "同步排队失败") }
                        loadSnapshot()
                    }
                }.start()
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (map.status != "revoked") row.addView(actionButton(if (map.status == "active") "暂停" else "恢复") {
                changeStudentMapStatus(map, if (map.status == "active") "paused" else "active")
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (map.status != "revoked") row.addView(actionButton("解除") {
                AlertDialog.Builder(this).setTitle("解除学生共享")
                    .setMessage("本机将停止与该对端学生同步，已保存的本地档案不会删除。确认继续吗？")
                    .setNegativeButton("取消", null)
                    .setPositiveButton("解除") { _, _ -> changeStudentMapStatus(map, "revoked") }
                    .show()
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (row.childCount > 0) card.addView(row, matchWrap())
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

    private fun changeStudentMapStatus(map: CollaborationStudentMapEntity, status: String) {
        Thread {
            val result = runCatching { repository.updateStudentMapStatus(map.studentMapId, status) }
            runOnUiThread {
                result.onSuccess { loadSnapshot() }
                    .onFailure { showMessage(it.message ?: "学生共享状态更新失败") }
            }
        }.start()
    }

    @Deprecated("API 23 compatible activity result flow")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_QR && resultCode == RESULT_OK) {
            data?.getStringExtra(CollaborationQrScannerActivity.EXTRA_CONNECTION_PAYLOAD)?.let { payload ->
                val schema = runCatching { JSONObject(payload).optString("schema") }.getOrDefault("")
                if (schema == CollaborationPairingProtocol.STUDENT_MAPPING_OFFER_SCHEMA) chooseStudentForOffer(payload) else connect(payload)
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_NOTIFICATION) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            val pendingConnection = connectionAfterNotification
            connectionAfterNotification = ""
            if (createInvitationAfterNotification) createNearbyInvitation()
            else if (pendingConnection.isNotBlank()) connect(pendingConnection)
            else startNearbyReceiverFromUi()
            createInvitationAfterNotification = false
        } else {
            createInvitationAfterNotification = false
            connectionAfterNotification = ""
            AlertDialog.Builder(this).setTitle("附近接收尚未开启")
                .setMessage("通知权限未开启。可以前往系统通知设置授权后再试。")
                .setNegativeButton("稍后", null)
                .setPositiveButton("打开系统设置") { _, _ ->
                    startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                }.show()
        }
    }

    private fun showPayloadDialog(title: String, message: String, payload: String, copyLabel: String) {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(TextView(this@CollaborationActivity).apply {
                text = message; textSize = 15f; setTextColor(palette.text)
            }, matchWrap())
            addView(ImageView(this@CollaborationActivity).apply {
                setImageBitmap(CollaborationQrRenderer.render(payload, dp(340)))
                adjustViewBounds = true
                contentDescription = title
                setPadding(0, dp(12), 0, dp(8))
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(360)))
        }
        AlertDialog.Builder(this).setTitle(title).setView(content)
            .setNegativeButton("关闭", null)
            .setPositiveButton(copyLabel) { _, _ ->
                (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(title, payload))
                showMessage("已复制；连接信息仅用于当前邀请，请勿公开转发。")
            }.show()
    }

    private fun sectionTitle(value: String) = TextView(this).apply { text = value; textSize = 21f; setTextColor(palette.heading); setPadding(0, dp(22), 0, dp(8)) }
    private fun statusText(value: String) = TextView(this).apply { text = value; textSize = 14f; setTextColor(palette.text); setPadding(dp(16), dp(14), dp(16), dp(14)); YouthUi.applyStatusCard(this, palette) }
    private fun emptyText(value: String) = TextView(this).apply { text = value; textSize = 14f; setTextColor(palette.muted); setPadding(dp(8), dp(10), dp(8), dp(10)) }
    private fun card() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14)); YouthUi.applySurface(this, palette) }
    private fun actionButton(value: String, action: () -> Unit) = Button(this).apply {
        text = value
        YouthUi.applyButton(this, palette, if (value in setOf("撤销", "解除")) YouthButtonRole.DANGER else YouthButtonRole.SECONDARY)
        setOnClickListener { action() }
    }
    private fun statusLabel(value: String) = when (value) { "active" -> "已启用"; "paused" -> "已暂停"; "revoked" -> "已撤销"; else -> value }
    private fun showBusy(message: String) { hideBusy(); busyDialog = AlertDialog.Builder(this).setTitle("知识协作").setMessage(message).setCancelable(false).show() }
    private fun hideBusy() { busyDialog?.dismiss(); busyDialog = null }
    private fun showMessage(message: String) { AlertDialog.Builder(this).setTitle("知识协作").setMessage(message).setPositiveButton("知道了", null).show() }
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val REQUEST_QR = 5201
        private const val REQUEST_NOTIFICATION = 5202
    }
}
