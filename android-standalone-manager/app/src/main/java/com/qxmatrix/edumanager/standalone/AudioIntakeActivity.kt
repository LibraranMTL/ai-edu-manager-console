package com.qxmatrix.edumanager.standalone

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Bundle
import android.provider.OpenableColumns
import android.text.InputType
import android.widget.*
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/** Foreground, user-initiated recording only. Leaving this screen stops the microphone. */
class AudioIntakeActivity : Activity() {
    private lateinit var studentId: String
    private lateinit var status: TextView
    private val worker = Executors.newSingleThreadExecutor()
    private var recorder: MediaRecorder? = null
    private var localFile: File? = null
    private var materialId: String? = null
    private var cancellation = ModelCancellation()
    private var busy = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        studentId = intent.getStringExtra("studentId").orEmpty()
        if (studentId.isBlank()) { finish(); return }
        val recovered = runCatching { PrivateStateStore(this).readIfPresent("audio-capture/$studentId.json")?.let { JSONObject(it.toString(Charsets.UTF_8)) } }
        if (recovered.isFailure) {
            setContentView(TextView(this).apply { text = "录音恢复记录无法读取。已停止新录音，原缓存未删除；请保留应用数据后核对。" }); return
        }
        val pending = recovered.getOrNull()
        pending?.optString("cacheName")?.takeIf { Regex("^edu-audio-[A-Za-z0-9_-]+\\.m4a$").matches(it) }?.let { name ->
            File(cacheDir, name).takeIf(File::isFile)?.let { localFile = it }
        }
        val ui = UiPreferences(this); ui.applyOrientation(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(16, 16, 16, 16); setBackgroundColor(ui.palette().page) }
        status = TextView(this).apply { text = "录音与独立 ASR\n录音先存本机。聊天/视觉模型不能代替转写服务。"; textSize = 18f }; root.addView(status)
        fun button(label: String, action: () -> Unit) { root.addView(Button(this).apply { text = label; setOnClickListener { if (current()) action() else finish() } }) }
        button("导入已有音频（不上传）") { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE), PICK_AUDIO) }
        button("开始本机录音（最长10分钟）") {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                PermissionRationale.request(this, Manifest.permission.RECORD_AUDIO, MIC_PERMISSION,
                    R.string.permission_microphone_title, R.string.permission_microphone_reason) { status.text = "未启用麦克风，仍可使用其他资料导入功能。" }
            } else startRecording()
        }
        button("停止录音并保存原件") { stopRecording(); saveRecording() }
        button("放弃未归档录音") {
            AlertDialog.Builder(this).setTitle("放弃本机录音缓存？").setMessage("仅删除这段尚未归档的录音缓存，不影响任何已归档原件。")
                .setNegativeButton("保留", null).setPositiveButton("放弃") { _, _ ->
                    stopRecording(); localFile?.delete(); localFile = null
                    PrivateStateStore(this).writeBytes("audio-capture/$studentId.json", "{}".toByteArray()); status.text = "未归档录音缓存已删除，不能恢复"
                }.show()
        }
        button("选择已归档音频") { chooseMaterial() }
        button("独立配置兼容 ASR 服务") { settings() }
        button("转写所选音频（本次发送前确认）") { confirmTranscribe() }
        button("取消转写请求") { cancellation.cancel(); status.text = "已请求取消，服务端可能已计费；不自动重试" }
        button("返回") { finish() }
        val shell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val identity = TextView(this).apply { text = "当前学生：$studentId"; textSize = 18f; setPadding(16, 12, 16, 12) }; shell.addView(identity)
        shell.addView(ScrollView(this).apply { addView(root) }, LinearLayout.LayoutParams(-1, 0, 1f)); setContentView(shell)
        worker.execute { val name = runCatching { StudentIndexRepository(this).requireExact(studentId).name }; runOnUiThread { if (current()) identity.text = name.fold({ "当前学生：$it" }, { "学生档案读取失败，停止处理" }) } }
    }
    private fun current() = !isFinishing && !isDestroyed && getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, MODE_PRIVATE)
        .getString(MainActivity.KEY_CURRENT_STUDENT_ID, "") == studentId
    override fun onPause() { stopRecording(); super.onPause() }
    override fun onDestroy() { stopRecording(); cancellation.cancel(); worker.shutdownNow(); super.onDestroy() }
    @Suppress("DEPRECATION")
    private fun startRecording() {
        if (busy || recorder != null) return
        if (localFile != null) { status.text = "上次录音尚未保存，请先点击停止并保存原件"; return }
        runCatching {
            val file = File.createTempFile("edu-audio-", ".m4a", cacheDir)
            val capture = MediaRecorder()
            try {
                capture.setAudioSource(MediaRecorder.AudioSource.MIC); capture.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                capture.setAudioEncoder(MediaRecorder.AudioEncoder.AAC); capture.setAudioChannels(1); capture.setAudioSamplingRate(16_000); capture.setAudioEncodingBitRate(64_000)
                capture.setOutputFile(file.absolutePath); capture.setMaxDuration(600_000); capture.setMaxFileSize(AudioSourcePolicy.MAX_BYTES.toLong())
                capture.setOnInfoListener { _, _, _ -> stopRecording(); status.text = "达到录音上限，已停止；请保存原件" }
                capture.prepare()
                PrivateStateStore(this).writeBytes("audio-capture/$studentId.json", JSONObject().put("cacheName", file.name).put("studentId", studentId).toString().toByteArray())
                capture.start(); localFile = file; recorder = capture
                status.text = "正在录音，仅限当前界面。离开界面会停止，尚未上传。"
            } catch (error: Throwable) { capture.release(); file.delete(); throw error }
        }.onFailure { status.text = "录音未开始：${it.message}" }
    }
    private fun stopRecording() {
        val capture = recorder ?: return; recorder = null
        runCatching { capture.stop() }.onFailure { status.text = "录音过短或中断，请核对原件" }
        capture.release()
    }
    private fun saveRecording() {
        val file = localFile ?: return
        background("归档录音原件…") {
            val bytes = file.inputStream().use { it.readBytesBounded(AudioSourcePolicy.MAX_BYTES) }
            AudioSourcePolicy.validate(file.name, bytes)
            val result = FileAssetService(this).importValidatedBytes(studentId, "录音-${Timestamp.now().replace(':', '-')}.m4a", bytes, "audio/mp4", "Android 用户录音")
            materialId = result.getJSONObject("material").getString("id")
            file.delete(); localFile = null
            PrivateStateStore(this).writeBytes("audio-capture/$studentId.json", "{}".toByteArray())
            "录音原件已归档，尚未转写或上传"
        }
    }
    private fun background(message: String, action: () -> String) {
        if (busy) { status.text = "已有操作进行中"; return }; busy = true; status.text = message
        worker.execute { val result = runCatching(action); runOnUiThread { busy = false; if (current()) status.text = result.getOrElse { "未完成，原件保留：${it.message}" } } }
    }
    private fun chooseMaterial() {
        worker.execute {
            val result = runCatching { FileAssetService(this).materials(studentId).filter { it.optString("fileName").substringAfterLast('.').lowercase() in setOf("mp3", "wav", "m4a", "mp4", "ogg", "webm") }.take(100) }
            runOnUiThread {
                if (!current()) return@runOnUiThread
                result.onSuccess { rows -> AlertDialog.Builder(this).setTitle("选择当前学生音频（最近100项）").setItems(rows.map { it.optString("fileName") }.toTypedArray()) { _, index -> materialId = rows[index].getString("id"); status.text = "已选 ${rows[index].getString("fileName")}" }.setNegativeButton("取消", null).show() }
                    .onFailure { status.text = it.message }
            }
        }
    }
    private fun settings() {
        val store = AgentConfigurationStore(this, "local_asr"); val old = store.publicProfile()
        val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val endpoint = EditText(this).apply { hint = "独立 ASR 基础地址（例如兼容服务的 /v1）"; setText(old?.endpoint.orEmpty()) }; form.addView(endpoint)
        val model = EditText(this).apply { hint = "ASR 模型 ID，不是聊天模型"; setText(old?.model.orEmpty()) }; form.addView(model)
        val key = EditText(this).apply { hint = "独立 API Key；同地址可留空保留"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }; form.addView(key)
        AlertDialog.Builder(this).setTitle("ASR 独立设置").setView(form).setNegativeButton("取消", null).setPositiveButton("保存") { _, _ ->
            runCatching { store.saveOrUpdate(endpoint.text.toString(), model.text.toString(), key.text.toString().takeIf(String::isNotBlank)) }
                .onSuccess { status.text = "独立设置已保存；尚未确认真实转写能力，不复用聊天凭据" }.onFailure { status.text = it.message }
        }.show()
    }
    private fun confirmTranscribe() {
        val id = materialId ?: run { status.text = "请先导入、录音或选择已归档音频"; return }
        AlertDialog.Builder(this).setTitle("本次音频转写授权")
            .setMessage("会把所选音频发送到单独配置的 ASR 地址。音频可能包含姓名、声音等个人信息，请确认已获得录音和发送授权。转写仅为 machine_observed／待审核，不推断能力。")
            .setNegativeButton("取消", null).setPositiveButton("授权本次发送") { _, _ ->
                cancellation = ModelCancellation(); val token = cancellation
                background("正在转写，未知结果不自动重试…") { AudioTranscriptionService(this).transcribe(studentId, id, true, token); "转写候选已归档，可继续消化；尚未审核" }
            }.show()
    }
    @Deprecated("Legacy permission API")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == MIC_PERMISSION && current() && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startRecording()
    }
    @Deprecated("Legacy result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PICK_AUDIO || resultCode != RESULT_OK || !current()) return
        val uri = data?.data ?: return
        background("校验并归档音频，不上传…") {
            val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: error("无法读取名称")
            val bytes = requireNotNull(contentResolver.openInputStream(uri)).use { it.readBytesBounded(AudioSourcePolicy.MAX_BYTES) }
            AudioSourcePolicy.validate(name, bytes)
            materialId = FileAssetService(this).importValidatedBytes(studentId, name, bytes, "audio/*", "Android 音频导入", uri.toString()).getJSONObject("material").getString("id")
            "音频原件已归档，未上传"
        }
    }
    companion object { private const val PICK_AUDIO = 805; private const val MIC_PERMISSION = 806 }
}
