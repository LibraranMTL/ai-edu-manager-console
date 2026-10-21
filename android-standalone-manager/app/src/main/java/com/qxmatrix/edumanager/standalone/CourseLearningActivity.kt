package com.qxmatrix.edumanager.standalone

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class CourseLearningActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var captureButton: Button
    private lateinit var status: TextView
    private lateinit var student: StudentRecord
    private lateinit var course: PlatformCourse
    private var selectedCaptureMode = "smart"
    private val refreshHandler = Handler(Looper.getMainLooper())
    private val refreshCapture = object : Runnable {
        override fun run() {
            if (::captureButton.isInitialized) refreshCaptureState()
            refreshHandler.postDelayed(this, 1_500L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ui = UiPreferences(this)
        ui.applyOrientation(this)
        val palette = ui.palette()
        window.statusBarColor = palette.page
        window.navigationBarColor = palette.page
        student = StudentIndexRepository(this).requireExact(requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)))
        course = PlatformCourse.fromJson(org.json.JSONObject(requireNotNull(intent.getStringExtra(EXTRA_COURSE_JSON))))
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(palette.page); setPadding(dp(14), dp(12), dp(14), dp(12)) }
        val toolbar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        toolbar.addView(Button(this).apply { text = "返回课程中心"; YouthUi.applyButton(this, palette, YouthButtonRole.COMPACT); setOnClickListener { finish() } }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        captureButton = Button(this).apply { text = "开始采集课程资料"; YouthUi.applyButton(this, palette, YouthButtonRole.PRIMARY); setOnClickListener { handleCapturePrimary() } }
        toolbar.addView(captureButton, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)); layout.addView(toolbar)
        status = TextView(this).apply { text = "${course.name} · ${course.provider}\n采集仅在你点击并通过 Android 系统授权后开始。"; setTextColor(palette.text); setPadding(8, 12, 8, 12) }
        layout.addView(status)
        webView = WebView(this); configureCourseWebView(); layout.addView(webView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(layout); webView.loadUrl(course.url); refreshCaptureState(); refreshHandler.post(refreshCapture)
        val autoStartCapture = intent.getBooleanExtra(EXTRA_AUTO_START_CAPTURE, false)
        intent.removeExtra(EXTRA_AUTO_START_CAPTURE)
        if (autoStartCapture && savedInstanceState == null) {
            captureButton.post { handleCapturePrimary() }
        }
    }

    private fun configureCourseWebView() {
        webView.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false
            allowFileAccessFromFileURLs = false; allowUniversalAccessFromFileURLs = false
            javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(false); setGeolocationEnabled(false)
            mediaPlaybackRequiresUserGesture = true
            if (Build.VERSION.SDK_INT >= 21) mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            if (Build.VERSION.SDK_INT >= 26) safeBrowsingEnabled = true
        }
        if (Build.VERSION.SDK_INT >= 21) CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.webViewClient = object : WebViewClient() {
            @Deprecated("API 23 compatibility") override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = !isAllowedCourseUrl(url)
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = !isAllowedCourseUrl(request?.url?.toString())
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
                if (isAllowedCourseUrl(request?.url?.toString())) super.shouldInterceptRequest(view, request)
                else WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) { if (isAllowedCourseUrl(url)) status.text = "${course.name} · 安全学习页已打开" }
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: android.net.http.SslError?) { handler?.cancel(); status.text = "课程页面证书校验失败，已停止访问。" }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) { if (request?.isForMainFrame == true) status.text = "课程页面加载失败，请检查网络后重试。" }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) { request?.deny() }
            override fun onShowFileChooser(webView: WebView?, callback: android.webkit.ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean { callback?.onReceiveValue(null); return true }
        }
        webView.setDownloadListener { _, _, _, _, _ -> status.text = "课程下载已阻止；课程资料请使用受控屏幕采集。" }
    }

    private fun isAllowedCourseUrl(value: String?): Boolean = runCatching {
        PlatformCourse.normalizeUrl(value.orEmpty(), course.allowedHosts); true
    }.getOrDefault(false)

    private fun handleCapturePrimary() {
        val prefs = getSharedPreferences(CourseCaptureService.PREFS, MODE_PRIVATE)
        val active = prefs.getString(CourseCaptureService.KEY_STATUS, "idle") in setOf("capturing", "paused")
        val activeStudentId = prefs.getString(CourseCaptureService.KEY_STUDENT_ID, "").orEmpty()
        if (active && activeStudentId.isNotBlank() && activeStudentId != student.id) {
            AlertDialog.Builder(this).setTitle("已有其他学生的采集任务")
                .setMessage("请先从持续通知结束当前采集，再为 ${student.name} 启动课程采集。课程学习仍可继续。")
                .setPositiveButton("知道了", null).show()
            return
        }
        if (active) {
            AlertDialog.Builder(this).setTitle("结束课程采集？").setMessage("已保存的截图和课程采集记录会保留在当前学生原始资料库。")
                .setNegativeButton("继续采集", null).setPositiveButton("结束") { _, _ ->
                    startService(Intent(this, CourseCaptureService::class.java).setAction(CourseCaptureService.ACTION_STOP))
                    captureButton.postDelayed({ refreshCaptureState(); status.text = "课程采集已结束，截图和会话记录已保存。" }, 800)
                }.show()
            return
        }
        val labels = arrayOf("智能混合（推荐）", "画面变化时采集", "固定间隔（每 30 秒）")
        val modes = arrayOf("smart", "change", "interval")
        AlertDialog.Builder(this).setTitle("选择课程采集模式").setSingleChoiceItems(labels, modes.indexOf(selectedCaptureMode)) { dialog, which ->
            selectedCaptureMode = modes[which]; dialog.dismiss()
            AlertDialog.Builder(this).setTitle("采集当前课程屏幕")
                .setMessage("模式：${captureModeLabel(selectedCaptureMode)}\n\nAndroid 将显示系统录屏授权。采集期间会持续显示通知；截图只写入 ${student.name} 的原始资料库。")
                .setNegativeButton("取消", null).setPositiveButton("继续") { _, _ -> requestProjection() }.show()
        }.setNegativeButton("取消", null).show()
    }

    private fun requestProjection() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            PermissionRationale.request(this, Manifest.permission.POST_NOTIFICATIONS, REQUEST_NOTIFICATION,
                R.string.permission_notification_title, R.string.permission_notification_reason) { requestCaptureProjection() }
            return
        }
        requestCaptureProjection()
    }

    private fun requestCaptureProjection() {
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_SCREEN_CAPTURE)
    }

    @Deprecated("API 23 compatibility")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_NOTIFICATION) requestCaptureProjection()
    }

    @Deprecated("API 23 compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_SCREEN_CAPTURE || resultCode != RESULT_OK || data == null) { if (requestCode == REQUEST_SCREEN_CAPTURE) status.text = "未授权屏幕采集，课程学习可继续。"; return }
        val start = Intent(this, CourseCaptureService::class.java).setAction(CourseCaptureService.ACTION_START)
            .putExtra("result_code", resultCode).putExtra("result_data", data)
            .putExtra("capture_kind", "course").putExtra("capture_mode", selectedCaptureMode)
            .putExtra("student_id", student.id).putExtra("student_name", student.name).putExtra("root_uri", student.storageRootUri).putExtra("raw_path", student.paths.rawPath)
            .putExtra("course_id", course.courseId).putExtra("course_provider", course.provider).putExtra("course_url", webView.url ?: course.url)
            .putStringArrayListExtra("allowed_hosts", ArrayList(course.allowedHosts))
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(start) else startService(start)
        status.text = "课程采集已开始 · ${captureModeLabel(selectedCaptureMode)}；可从持续通知暂停或结束。"; captureButton.postDelayed({ refreshCaptureState() }, 500)
    }

    private fun refreshCaptureState() {
        val prefs = getSharedPreferences(CourseCaptureService.PREFS, MODE_PRIVATE); val state = prefs.getString(CourseCaptureService.KEY_STATUS, "idle")
        val active = state in setOf("capturing", "paused"); val activeStudentId = prefs.getString(CourseCaptureService.KEY_STUDENT_ID, "").orEmpty()
        val saved = prefs.getInt(CourseCaptureService.KEY_SAVED, 0)
        captureButton.text = if (active && activeStudentId.isNotBlank() && activeStudentId != student.id) "其他学生正在采集" else if (active) "结束采集（已保存 $saved 张）" else "选择模式并开始采集"
        if (active && activeStudentId == student.id) status.text = "${course.name} · 正在采集 · 已保存 $saved 张\n可从持续通知暂停或结束。"
    }

    private fun captureModeLabel(mode: String): String = when (mode) {
        "change" -> "画面变化时采集"
        "interval" -> "固定间隔（每 30 秒）"
        else -> "智能混合"
    }

    override fun onResume() { super.onResume(); if (::captureButton.isInitialized) refreshCaptureState() }
    override fun onDestroy() { refreshHandler.removeCallbacks(refreshCapture); if (::webView.isInitialized) { webView.stopLoading(); webView.loadUrl("about:blank"); webView.clearHistory(); webView.destroy() }; super.onDestroy() }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_STUDENT_ID = "student_id"; const val EXTRA_COURSE_JSON = "course_json"; const val EXTRA_AUTO_START_CAPTURE = "auto_start_capture"
        private const val REQUEST_SCREEN_CAPTURE = 9106; private const val REQUEST_NOTIFICATION = 9107
    }
}
