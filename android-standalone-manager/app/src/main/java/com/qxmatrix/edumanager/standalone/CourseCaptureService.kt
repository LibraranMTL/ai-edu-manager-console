package com.qxmatrix.edumanager.standalone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.UUID

class CourseCaptureService : Service() {
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var worker: HandlerThread? = null
    private lateinit var main: Handler
    private var stopping = false
    private var paused = false
    private var lastEvaluatedAt = 0L
    private var lastSavedAt = 0L
    private var lastSignature: IntArray? = null
    private var startedAt = 0L
    private var saved = 0
    private lateinit var sessionId: String
    private lateinit var studentId: String
    private lateinit var studentName: String
    private lateinit var rootUri: String
    private lateinit var rawPath: String
    private lateinit var courseId: String
    private lateinit var courseProvider: String
    private lateinit var courseUrl: String
    private var captureKind = "course"
    private var captureMode = "smart"
    private var projectId = ""
    private var projectName = ""
    private val capturedFiles = JSONArray()

    override fun onCreate() {
        super.onCreate(); main = Handler(mainLooper); createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> { captureKind = intent.getStringExtra("capture_kind")?.takeIf { it in setOf("course", "material") } ?: "course"; startForegroundCompat(notification("正在准备屏幕采集")); startProjection(intent) }
            ACTION_PAUSE -> { paused = true; updateNotification("屏幕采集已暂停") }
            ACTION_RESUME -> { paused = false; updateNotification("正在采集学习资料") }
            ACTION_STOP -> stopCapture("manual")
        }
        return START_NOT_STICKY
    }

    @Suppress("DEPRECATION")
    private fun startProjection(intent: Intent) {
        if (projection != null) return
        studentId = requiredExtra(intent, "student_id"); studentName = requiredExtra(intent, "student_name")
        rootUri = requiredExtra(intent, "root_uri"); rawPath = requiredExtra(intent, "raw_path")
        captureMode = intent.getStringExtra("capture_mode")?.takeIf { it in setOf("smart", "change", "interval") } ?: "smart"
        projectId = intent.getStringExtra("project_id").orEmpty(); projectName = intent.getStringExtra("project_name").orEmpty()
        if (projectId.isNotBlank()) require(ProjectRepository(this).requireExact(projectId).studentIds.contains(studentId)) { "关联项目未绑定当前学生" }
        if (captureKind == "course") {
            courseId = requiredExtra(intent, "course_id"); courseProvider = requiredExtra(intent, "course_provider"); courseUrl = requiredExtra(intent, "course_url")
        } else { courseId = ""; courseProvider = ""; courseUrl = "" }
        StudentIndexRepository(this).requireExact(studentId)
        if (captureKind == "course") PlatformCourse.normalizeUrl(courseUrl, intent.getStringArrayListExtra("allowed_hosts") ?: arrayListOf())
        startedAt = System.currentTimeMillis(); sessionId = "${if (captureKind == "course") "course" else "android-capture"}-${startedAt}-${UUID.randomUUID().toString().take(8)}"
        val resultData = intent.getParcelableExtra<Intent>("result_data") ?: return stopCapture("permission_missing")
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager ?: return stopCapture("projection_unavailable")
        projection = manager.getMediaProjection(intent.getIntExtra("result_code", 0), resultData) ?: return stopCapture("permission_denied")
        projection?.registerCallback(object : MediaProjection.Callback() { override fun onStop() { stopCapture("projection_stopped") } }, main)
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION") (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        val width = maxOf(1, metrics.widthPixels); val height = maxOf(1, metrics.heightPixels)
        worker = HandlerThread("education-screen-capture").apply { start() }
        val handler = Handler(requireNotNull(worker).looper)
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2).also { imageReader ->
            imageReader.setOnImageAvailableListener({ onImageAvailable(it, width, height) }, handler)
        }
        display = projection?.createVirtualDisplay(
            "AI Education Screen Capture", width, height, maxOf(1, metrics.densityDpi),
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader?.surface, null, handler,
        )
        updateState("capturing"); updateNotification(if (captureKind == "course") "正在采集课程屏幕" else "正在采集学习资料")
        main.postDelayed({ stopCapture("duration_complete") }, MAX_DURATION_MS)
    }

    private fun onImageAvailable(source: ImageReader, width: Int, height: Int) {
        var image: Image? = null; var bitmap: Bitmap? = null
        try {
            image = source.acquireLatestImage() ?: return
            val now = System.currentTimeMillis()
            if (paused || stopping || now - lastEvaluatedAt < SAMPLE_INTERVAL_MS) return
            lastEvaluatedAt = now; bitmap = imageToBitmap(image, width, height)
            val signature = signature(bitmap); val difference = signatureDifference(lastSignature, signature)
            val elapsed = if (lastSavedAt == 0L) Long.MAX_VALUE else now - lastSavedAt
            val shouldSave = when (captureMode) {
                "change" -> difference >= CHANGE_THRESHOLD && elapsed >= MIN_SAVE_INTERVAL_MS
                "interval" -> elapsed >= FIXED_INTERVAL_MS
                else -> difference > EXACT_DUPLICATE && elapsed >= MIN_SAVE_INTERVAL_MS && (difference >= CHANGE_THRESHOLD || elapsed >= MAX_SAVE_INTERVAL_MS)
            }
            if (shouldSave) {
                saveBitmap(bitmap, now, difference); lastSignature = signature; lastSavedAt = now
            }
        } catch (_: Exception) { updateState("error") }
        finally { image?.close(); bitmap?.recycle() }
    }

    private fun imageToBitmap(image: Image, width: Int, height: Int): Bitmap {
        val plane = image.planes[0]; val padding = plane.rowStride - plane.pixelStride * width
        val padded = Bitmap.createBitmap(width + padding / plane.pixelStride, height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(plane.buffer)
        return Bitmap.createBitmap(padded, 0, 0, width, height).also { if (it !== padded) padded.recycle() }
    }

    private fun signature(bitmap: Bitmap): IntArray {
        val small = Bitmap.createScaledBitmap(bitmap, 16, 16, true); val pixels = IntArray(256)
        small.getPixels(pixels, 0, 16, 0, 0, 16, 16); small.recycle()
        for (index in pixels.indices) pixels[index] = (Color.red(pixels[index]) * .299 + Color.green(pixels[index]) * .587 + Color.blue(pixels[index]) * .114).toInt()
        return pixels
    }

    private fun signatureDifference(previous: IntArray?, current: IntArray): Double {
        if (previous == null || previous.size != current.size) return 1.0
        return current.indices.sumOf { kotlin.math.abs(previous[it] - current[it]) / 255.0 } / current.size
    }

    private fun saveBitmap(bitmap: Bitmap, capturedAt: Long, difference: Double) {
        val output = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output); val bytes = output.toByteArray()
        val filename = "capture-$capturedAt.jpg"; val folder = if (captureKind == "course") "课程采集" else "屏幕采集"; val relative = "$rawPath/$folder/$sessionId/$filename"
        SafWorkspaceStore(this, Uri.parse(rootUri)).writeBytesSafely(relative, bytes, "image/jpeg")
        val itemId = "${if (captureKind == "course") "course-item" else "capture-item"}-$capturedAt"
        val item = JSONObject().put("captureItemId", itemId).put("capturedAt", capturedAt)
            .put("sourceType", "android_screenshot").put("studentId", studentId).put("courseId", courseId)
            .put("courseProvider", courseProvider).put("courseUrl", courseUrl).put("difference", difference)
            .put("projectId", projectId).put("projectName", projectName).put("captureMode", captureMode)
            .put("path", relative).put("sha256", sha256(bytes)).put("bytes", bytes.size)
        SafWorkspaceStore(this, Uri.parse(rootUri)).writeBytesSafely("$relative.json", item.toString(2).toByteArray(), "application/json")
        FileAssetService(this).registerCapturedFile(
            studentId = studentId,
            logicalPath = relative,
            bytes = bytes,
            captureSessionId = sessionId,
            captureItemId = itemId,
            projectId = projectId,
            projectName = projectName,
            courseId = courseId,
            courseProvider = courseProvider,
            courseUrl = courseUrl,
        )
        capturedFiles.put(item); saved += 1; updateState(if (paused) "paused" else "capturing"); updateNotification("正在采集学习资料 · 已保留 $saved 张")
    }

    @Synchronized private fun stopCapture(reason: String) {
        if (stopping) return; stopping = true; main.removeCallbacksAndMessages(null)
        reader?.setOnImageAvailableListener(null, null); display?.release(); display = null; reader?.close(); reader = null
        val current = projection; projection = null; current?.stop(); worker?.quitSafely(); worker = null
        val completedAt = System.currentTimeMillis()
        if (::studentId.isInitialized && ::sessionId.isInitialized) runCatching {
            if (captureKind == "course") CourseCaptureRepository(this).appendCompleted(studentId, courseId, courseProvider, courseUrl, sessionId, startedAt, completedAt, rootUri, rawPath, capturedFiles)
            val session = JSONObject().put("schema", "edu-manager.android-capture-session.v1").put("captureProtocolVersion", ProtocolBaseline.CAPTURE_PROTOCOL_VERSION)
                .put("sessionId", sessionId).put("studentId", studentId).put("studentName", studentName).put("courseId", courseId)
                .put("courseProvider", courseProvider).put("courseUrl", courseUrl).put("startedAt", startedAt).put("endedAt", completedAt)
                .put("captureKind", captureKind).put("captureMode", captureMode).put("projectId", projectId).put("projectName", projectName)
                .put("endReason", reason).put("savedCount", saved).put("capturedFiles", capturedFiles)
            val folder = if (captureKind == "course") "课程采集" else "屏幕采集"
            SafWorkspaceStore(this, Uri.parse(rootUri)).writeBytesSafely("$rawPath/$folder/$sessionId/session.json", session.toString(2).toByteArray(), "application/json")
        }
        updateState("completed"); stopForeground(true); stopSelf()
    }

    private fun requiredExtra(intent: Intent, key: String): String = requireNotNull(intent.getStringExtra(key)?.trim()).also { require(it.isNotBlank()) { "缺少 $key" } }
    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun updateState(status: String) { getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_STATUS, status).putString(KEY_SESSION_ID, if (::sessionId.isInitialized) sessionId else "").putString(KEY_STUDENT_ID, if (::studentId.isInitialized) studentId else "").putString(KEY_CAPTURE_KIND, captureKind).putInt(KEY_SAVED, saved).apply() }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder.setSmallIcon(android.R.drawable.ic_menu_camera).setContentTitle(if (captureKind == "course") "AI教育管家课程采集" else "AI教育管家资料采集").setContentText(text)
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(action(android.R.drawable.ic_media_pause, if (paused) "继续" else "暂停", if (paused) ACTION_RESUME else ACTION_PAUSE, 1))
            .addAction(action(android.R.drawable.ic_menu_close_clear_cancel, "结束", ACTION_STOP, 2)).build()
    }

    private fun action(icon: Int, title: String, action: String, request: Int): Notification.Action {
        val pending = PendingIntent.getService(this, request, Intent(this, CourseCaptureService::class.java).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(icon, title, pending).build()
    }
    private fun updateNotification(text: String) { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification(text)) }
    private fun startForegroundCompat(value: Notification) { if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, value, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(NOTIFICATION_ID, value) }
    private fun createChannel() { if (Build.VERSION.SDK_INT >= 26) (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(CHANNEL_ID, "学习资料屏幕采集", NotificationManager.IMPORTANCE_LOW)) }
    override fun onDestroy() { if (!stopping) stopCapture("service_destroyed"); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.qxmatrix.edumanager.standalone.coursecapture.START"
        const val ACTION_PAUSE = "com.qxmatrix.edumanager.standalone.coursecapture.PAUSE"
        const val ACTION_RESUME = "com.qxmatrix.edumanager.standalone.coursecapture.RESUME"
        const val ACTION_STOP = "com.qxmatrix.edumanager.standalone.coursecapture.STOP"
        const val PREFS = "course_capture_state"; const val KEY_STATUS = "status"; const val KEY_SESSION_ID = "session_id"; const val KEY_STUDENT_ID = "student_id"; const val KEY_CAPTURE_KIND = "capture_kind"; const val KEY_SAVED = "saved"
        private const val CHANNEL_ID = "course_screen_capture"; private const val NOTIFICATION_ID = 5301
        private const val SAMPLE_INTERVAL_MS = 2_000L; private const val MIN_SAVE_INTERVAL_MS = 5_000L; private const val FIXED_INTERVAL_MS = 30_000L; private const val MAX_SAVE_INTERVAL_MS = 90_000L
        private const val MAX_DURATION_MS = 30L * 60 * 1000; private const val EXACT_DUPLICATE = .003; private const val CHANGE_THRESHOLD = .12
    }
}
