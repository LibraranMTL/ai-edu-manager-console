package com.qxmatrix.edumanager.standalone

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class ScreenCaptureActivity : Activity() {
    private lateinit var student: StudentRecord
    private lateinit var status: TextView
    private lateinit var primary: Button
    private var projectId = ""
    private var projectName = ""
    private var selectedMode = "smart"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); UiPreferences(this).applyOrientation(this)
        student = StudentIndexRepository(this).requireExact(requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)))
        projectId = intent.getStringExtra(EXTRA_PROJECT_ID).orEmpty(); projectName = intent.getStringExtra(EXTRA_PROJECT_NAME).orEmpty()
        if (projectId.isNotBlank()) require(ProjectRepository(this).requireExact(projectId).studentIds.contains(student.id)) { "关联项目未绑定当前学生" }
        val palette = UiPreferences(this).palette()
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(22), dp(22), dp(28)); setBackgroundColor(palette.page) }
        layout.addView(TextView(this).apply { text = "连续屏幕采集"; textSize = 26f; setTextColor(palette.heading) }, matchWrap())
        status = TextView(this).apply { textSize = 15f; setTextColor(palette.text); setPadding(dp(16), dp(15), dp(16), dp(15)); YouthUi.applyStatusCard(this, palette) }; layout.addView(status, matchWrap())
        primary = Button(this).apply { text = "选择模式并开始"; YouthUi.applyButton(this, palette, YouthButtonRole.PRIMARY); setOnClickListener { handlePrimary() } }; layout.addView(primary, matchWrap())
        layout.addView(Button(this).apply { text = "返回资料中心"; YouthUi.applyButton(this, palette, YouthButtonRole.SECONDARY); setOnClickListener { finish() } }, matchWrap())
        setContentView(layout); refreshState()
    }

    private fun handlePrimary() {
        val prefs = getSharedPreferences(CourseCaptureService.PREFS, MODE_PRIVATE)
        val active = state() in setOf("capturing", "paused")
        val activeStudentId = prefs.getString(CourseCaptureService.KEY_STUDENT_ID, "").orEmpty()
        if (active && activeStudentId.isNotBlank() && activeStudentId != student.id) {
            AlertDialog.Builder(this).setTitle("已有其他学生的采集任务")
                .setMessage("为避免资料归属混淆，请先从持续通知结束当前采集，再为 ${student.name} 启动新采集。")
                .setPositiveButton("知道了", null).show()
            return
        }
        if (active) {
            AlertDialog.Builder(this).setTitle("结束屏幕采集？").setMessage("已保存截图会保留在 ${student.name} 的原始资料库，并进入文件资产中心。")
                .setNegativeButton("继续采集", null).setPositiveButton("结束") { _, _ -> startService(Intent(this, CourseCaptureService::class.java).setAction(CourseCaptureService.ACTION_STOP)); primary.postDelayed({ refreshState() }, 700) }.show()
            return
        }
        val modes = arrayOf("智能混合", "内容变化", "固定间隔（30秒）")
        AlertDialog.Builder(this).setTitle("选择采集模式").setItems(modes) { _, which ->
            selectedMode = listOf("smart", "change", "interval")[which]
            AlertDialog.Builder(this).setTitle("开始连续屏幕采集").setMessage("Android 将显示系统录屏授权。采集期间持续显示通知；截图只写入 ${student.name} 的资料库${if (projectName.isBlank()) "" else "，并关联项目 $projectName"}。")
                .setNegativeButton("取消", null).setPositiveButton("继续") { _, _ -> requestProjection() }.show()
        }.show()
    }

    private fun requestProjection() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATION)
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION") startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE)
    }

    @Deprecated("API 23 compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        if (resultCode != RESULT_OK || data == null) { status.text = "未授权屏幕采集，没有创建资料。"; return }
        val service = Intent(this, CourseCaptureService::class.java).setAction(CourseCaptureService.ACTION_START)
            .putExtra("capture_kind", "material").putExtra("capture_mode", selectedMode)
            .putExtra("result_code", resultCode).putExtra("result_data", data)
            .putExtra("student_id", student.id).putExtra("student_name", student.name)
            .putExtra("root_uri", student.storageRootUri).putExtra("raw_path", student.paths.rawPath)
            .putExtra("project_id", projectId).putExtra("project_name", projectName)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service) else startService(service)
        status.text = "屏幕采集已开始；可从持续通知暂停或结束。"; primary.postDelayed({ refreshState() }, 500)
    }

    private fun state() = getSharedPreferences(CourseCaptureService.PREFS, MODE_PRIVATE).getString(CourseCaptureService.KEY_STATUS, "idle").orEmpty()
    private fun refreshState() {
        val prefs = getSharedPreferences(CourseCaptureService.PREFS, MODE_PRIVATE); val currentState = state(); val active = currentState in setOf("capturing", "paused")
        val kind = prefs.getString(CourseCaptureService.KEY_CAPTURE_KIND, "").orEmpty(); val saved = prefs.getInt(CourseCaptureService.KEY_SAVED, 0)
        val activeStudentId = prefs.getString(CourseCaptureService.KEY_STUDENT_ID, "").orEmpty(); val belongsHere = activeStudentId.isBlank() || activeStudentId == student.id
        val errorCode = prefs.getString(CourseCaptureService.KEY_ERROR_CODE, "").orEmpty()
        val errorDetail = prefs.getString(CourseCaptureService.KEY_ERROR_DETAIL, "").orEmpty()
        val errorMessage = when (errorCode) {
            "permission_missing", "permission_denied" -> "系统未授予屏幕录制权限，请重新开始并在系统窗口中允许。"
            "projection_unavailable" -> "当前系统不支持屏幕投射服务，请重启平板后重试。"
            "write_failed" -> "截图无法写入学生资料目录，请在系统设置检查目录授权、剩余空间和 U 盘连接。"
            "start_failed" -> "屏幕采集启动失败，请检查通知权限、目录授权后重试。"
            else -> errorDetail.ifBlank { "屏幕采集未能运行。" }
        }
        status.text = when {
            active && !belongsHere -> "另一学生的屏幕采集正在运行。请从持续通知结束后再为 ${student.name} 采集。"
            active -> "正在${if (kind == "course") "采集课程" else "采集学习资料"} · 已保存 $saved 张\n学生：${student.name}${if (projectName.isBlank()) "" else " · 项目：$projectName"}\n持续通知已启用，可从通知暂停或结束。"
            currentState == "error" && belongsHere -> "采集失败：$errorMessage${if (errorDetail.isBlank() || errorDetail == errorMessage) "" else "\n详情：$errorDetail"}"
            else -> "学生：${student.name}${if (projectName.isBlank()) "" else " · 项目：$projectName"}\n采集结果将进入原始资料库和文件资产中心。"
        }
        primary.text = if (active && belongsHere) "结束当前采集（已保存 $saved 张）" else if (active) "当前有其他采集任务" else "选择模式并开始"
    }

    override fun onResume() { super.onResume(); if (::status.isInitialized) refreshState() }
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_STUDENT_ID = "student_id"; const val EXTRA_PROJECT_ID = "project_id"; const val EXTRA_PROJECT_NAME = "project_name"
        private const val REQUEST_CAPTURE = 9201; private const val REQUEST_NOTIFICATION = 9202
    }
}
