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

/** Browser rooted strictly inside one student's authorized archive, with opt-in single-file deletion in the raw library. */
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
    private var allowDelete = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preferences = UiPreferences(this); preferences.applyOrientation(this); palette = preferences.palette()
        window.statusBarColor = palette.page; window.navigationBarColor = palette.page
        student = StudentIndexRepository(this).requireExact(requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)))
        store = SafWorkspaceStore(this, Uri.parse(student.storageRootUri))
        startPath = intent.getStringExtra(EXTRA_START_PATH).orEmpty().ifBlank { student.paths.rawPath }.trimEnd('/')
        val allowed = listOf(student.paths.rootPath, student.paths.rawPath, student.paths.summaryPath, student.paths.outputPath).filter(String::isNotBlank)
        require(allowed.any { startPath == it || startPath.startsWith("${it.trimEnd('/')}/") }) { "浏览路径超出当前学生范围" }
        browserTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "${student.name} · 原始资料库" }
        allowDelete = intent.getBooleanExtra(EXTRA_ALLOW_DELETE, false) &&
            (startPath == student.paths.rawPath.trimEnd('/') || startPath.startsWith("${student.paths.rawPath.trimEnd('/')}/"))

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(16)); setBackgroundColor(palette.page) }
        val toolbar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        toolbar.addView(actionButton("返回") { finish() }, weighted())
        toolbar.addView(actionButton("上一级") { if (segments.isNotEmpty()) { segments.removeAt(segments.lastIndex); refresh() } }, weighted())
        root.addView(toolbar, matchWrap())
        root.addView(TextView(this).apply { text = browserTitle; textSize = 23f; setTextColor(palette.heading); setPadding(0, dp(14), 0, dp(4)) }, matchWrap())
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
            val result = runCatching {
                store.listDirectory(relative)
                    .filterNot { it.name.orEmpty().startsWith(".") }
                    .sortedWith(
                        compareByDescending<DocumentFile> { it.isDirectory }
                            .thenByDescending {
                                StudentArchiveCompatibility.archiveDateMillis(
                                    it.lastModified(),
                                    "$relative/${it.name.orEmpty()}",
                                )
                            }
                            .thenBy { it.name.orEmpty().lowercase() },
                    )
            }
            runOnUiThread {
                result.onSuccess(::renderEntries).onFailure {
                    statusView.text = "读取失败：${it.message ?: "未知错误"}"
                }
            }
        }.start()
    }

    private fun renderEntries(entries: List<DocumentFile>) {
        val mode = if (allowDelete) "可打开、分享或删除单份原件" else "只读浏览"
        statusView.text = if (entries.isEmpty()) "当前目录为空。" else "${entries.count { it.isDirectory }} 个文件夹 · ${entries.count { it.isFile }} 个文件（文件夹优先，文档按日期从新到旧，$mode）"
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
        val logicalPath = "${currentPath().trimEnd('/')}/$name"
        val canDelete = allowDelete && logicalPath.startsWith("${student.paths.rawPath.trimEnd('/')}/")
        val actions = buildList {
            add("打开原文件")
            add("分享／导出原件")
            if (canDelete) add("删除原件")
        }.toTypedArray()
        AlertDialog.Builder(this).setTitle(name)
            .setMessage("大小：${Formatter.formatFileSize(this, file.length())}\n类型：$mime" +
                if (canDelete) "\n\n删除仅作用于当前学生的这份原件。" else "\n\n当前入口为只读浏览。")
            .setItems(actions) { _, which -> when (actions[which]) {
                "打开原文件" -> openFile(file.uri, mime)
                "分享／导出原件" -> shareFile(file, name, mime)
                else -> confirmDelete(file, logicalPath, name)
            } }
            .setNegativeButton("关闭", null)
            .show()
    }

    private fun shareFile(file: DocumentFile, name: String, mime: String) {
        val share = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, file.uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        share.clipData = android.content.ClipData.newUri(contentResolver, name, file.uri)
        runCatching { startActivity(Intent.createChooser(share, "选择保存或分享应用（仅此原件）")) }
            .onFailure { statusView.text = "没有可用导出应用，原件保留" }
    }

    private fun confirmDelete(file: DocumentFile, logicalPath: String, name: String) {
        AlertDialog.Builder(this).setTitle("永久删除这份原件？")
            .setMessage("学生：${student.name}\n文件：$name\n大小：${Formatter.formatFileSize(this, file.length())}\n\n原件会从资料库删除，并从资料队列及文件资产索引中标记为已移除；既有报告和历史版本不会被连带删除。此操作不可恢复。")
            .setNegativeButton("取消", null)
            .setPositiveButton("确认删除") { _, _ -> deleteOriginal(logicalPath, name) }
            .show()
    }

    private fun deleteOriginal(logicalPath: String, name: String) {
        statusView.text = "正在删除 $name……"
        Thread {
            val result = runCatching { FileAssetService(this).deleteStudentOriginal(student.id, logicalPath) }
            runOnUiThread {
                result.onSuccess { statusView.text = "$name 已删除；历史报告仍保留。"; refresh() }
                    .onFailure { statusView.text = "删除失败：${it.message ?: "未知错误"}；原件未被重复处理。" }
            }
        }.start()
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
        text = label
        YouthUi.applyButton(this, palette, if (label in setOf("返回", "上一级")) YouthButtonRole.COMPACT else YouthButtonRole.SECONDARY)
        setOnClickListener { action() }
    }
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_STUDENT_ID = "studentId"
        const val EXTRA_START_PATH = "startPath"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ALLOW_DELETE = "allowDelete"
    }
}
