package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.ColorStateList
import android.net.Uri
import android.os.Bundle
import android.text.format.Formatter
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.documentfile.provider.DocumentFile
import java.net.URLConnection

/** Read-only browser rooted strictly inside one student's authorized raw library. */
class RawMaterialBrowserActivity : Activity() {
    private lateinit var student: StudentRecord
    private lateinit var store: SafWorkspaceStore
    private lateinit var palette: UiPalette
    private lateinit var pathView: TextView
    private lateinit var statusView: TextView
    private lateinit var list: LinearLayout
    private val segments = mutableListOf<String>()
    private var startPath = ""
    private var browserTitle = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preferences = UiPreferences(this); preferences.applyOrientation(this); palette = preferences.palette()
        window.statusBarColor = palette.accentDark; window.navigationBarColor = palette.page
        student = StudentIndexRepository(this).requireExact(requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)))
        store = SafWorkspaceStore(this, Uri.parse(student.storageRootUri))
        startPath = intent.getStringExtra(EXTRA_START_PATH).orEmpty().ifBlank { student.paths.rawPath }.trimEnd('/')
        require(startPath == student.paths.rootPath || startPath == student.paths.rawPath || startPath.startsWith("${student.paths.rootPath.trimEnd('/')}/")) { "浏览路径超出当前学生范围" }
        browserTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "${student.name} · 原始资料库" }

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(16)); setBackgroundColor(palette.page) }
        val toolbar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        toolbar.addView(actionButton("返回") { finish() }, weighted())
        toolbar.addView(actionButton("上一级") { if (segments.isNotEmpty()) { segments.removeAt(segments.lastIndex); refresh() } }, weighted())
        root.addView(toolbar, matchWrap())
        root.addView(TextView(this).apply { text = browserTitle; textSize = 23f; setTextColor(palette.accentDark); setPadding(0, dp(14), 0, dp(4)) }, matchWrap())
        pathView = TextView(this).apply { textSize = 14f; setTextColor(palette.muted); setTextIsSelectable(true) }; root.addView(pathView, matchWrap())
        statusView = TextView(this).apply { textSize = 14f; setTextColor(palette.text); setPadding(0, dp(8), 0, dp(8)) }; root.addView(statusView, matchWrap())
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply { isFillViewport = true; addView(list) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        refresh()
    }

    private fun refresh() {
        val relative = currentPath()
        pathView.text = "资料路径：$relative"
        statusView.text = "正在读取……"
        list.removeAllViews()
        Thread {
            val result = runCatching { store.listDirectory(relative).filterNot { it.name.orEmpty().startsWith(".") }.sortedWith(compareByDescending<DocumentFile> { it.isDirectory }.thenBy { it.name.orEmpty().lowercase() }) }
            runOnUiThread {
                result.onSuccess(::renderEntries).onFailure {
                    statusView.text = "读取失败：${it.message ?: "未知错误"}"
                }
            }
        }.start()
    }

    private fun renderEntries(entries: List<DocumentFile>) {
        statusView.text = if (entries.isEmpty()) "当前目录为空。" else "${entries.count { it.isDirectory }} 个文件夹 · ${entries.count { it.isFile }} 个文件（只读浏览）"
        entries.forEach { entry ->
            val label = if (entry.isDirectory) "📁 ${entry.name.orEmpty()}" else "${entry.name.orEmpty()} · ${Formatter.formatShortFileSize(this, entry.length())}"
            list.addView(actionButton(label) {
                if (entry.isDirectory) {
                    val name = entry.name.orEmpty()
                    if (name.isNotBlank()) { segments += name; refresh() }
                } else showFile(entry)
            }, matchWrap())
        }
    }

    private fun showFile(file: DocumentFile) {
        val name = file.name.orEmpty().ifBlank { "未命名文件" }
        val mime = file.type.orEmpty().ifBlank { URLConnection.guessContentTypeFromName(name).orEmpty().ifBlank { "application/octet-stream" } }
        AlertDialog.Builder(this).setTitle(name)
            .setMessage("大小：${Formatter.formatFileSize(this, file.length())}\n类型：$mime\n\n原文件不会在浏览过程中被移动或修改。")
            .setNegativeButton("关闭", null)
            .setPositiveButton("打开原文件") { _, _ -> openFile(file.uri, mime) }
            .show()
    }

    private fun openFile(uri: Uri, mime: String) {
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            startActivity(Intent.createChooser(intent, "选择查看应用"))
        } catch (_: ActivityNotFoundException) {
            AlertDialog.Builder(this).setTitle("没有可用的查看应用").setMessage("设备上没有能够打开此文件类型的应用。原文件仍保留在资料库中。")
                .setPositiveButton("知道了", null).show()
        }
    }

    private fun currentPath(): String = buildList { add(startPath); addAll(segments) }.joinToString("/")
    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 15f; backgroundTintList = ColorStateList.valueOf(palette.card); setTextColor(palette.text); setOnClickListener { action() }
    }
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object { const val EXTRA_STUDENT_ID = "studentId"; const val EXTRA_START_PATH = "startPath"; const val EXTRA_TITLE = "title" }
}
