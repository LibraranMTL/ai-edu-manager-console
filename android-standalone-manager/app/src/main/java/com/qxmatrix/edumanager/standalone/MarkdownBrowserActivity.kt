package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MarkdownBrowserActivity : Activity() {
    private data class Document(
        val title: String,
        val path: String,
        val rootUri: String,
        val content: String? = null,
        val lastModified: Long = 0L,
    )

    private lateinit var titleView: TextView
    private lateinit var statusView: TextView
    private lateinit var pickerButton: Button
    private lateinit var modeButton: Button
    private lateinit var webView: WebView
    private lateinit var rawView: TextView
    private var documents = emptyList<Document>()
    private var current: Document? = null
    private var currentText = ""
    private var rendered = true
    private var documentRequest = 0
    private var popupMode = false
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        val mode = intent.getStringExtra(EXTRA_MODE)
        popupMode = mode in setOf(MODE_ARCHIVE, MODE_REPORT, MODE_PROJECT, MODE_GROWTH_PROFILE)
        if (popupMode) setTheme(android.R.style.Theme_Material_Light_Dialog)
        super.onCreate(savedInstanceState)
        val ui = UiPreferences(this); ui.applyOrientation(this); val palette = ui.palette()
        window.statusBarColor = palette.page; window.navigationBarColor = palette.page
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(18, 18, 18, 18); setBackgroundColor(palette.page) }
        val toolbar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        toolbar.addView(Button(this).apply { text = "返回"; YouthUi.applyButton(this, palette, YouthButtonRole.COMPACT); setOnClickListener { finish() } }, weighted())
        pickerButton = Button(this).apply { text = "选择文档"; YouthUi.applyButton(this, palette, YouthButtonRole.COMPACT); isEnabled = false; setOnClickListener { showPicker() } }; toolbar.addView(pickerButton, weighted())
        modeButton = Button(this).apply { text = "查看原文"; YouthUi.applyButton(this, palette, YouthButtonRole.COMPACT); isEnabled = false; setOnClickListener { rendered = !rendered; updateDisplay() } }; toolbar.addView(modeButton, weighted())
        root.addView(toolbar, matchWrap())
        titleView = TextView(this).apply { text = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Markdown 阅读器" }; textSize = 24f; setTextColor(palette.heading); setPadding(4, 14, 4, 4) }; root.addView(titleView, matchWrap())
        statusView = TextView(this).apply { text = "正在读取文档…"; textSize = 14f; setTextColor(palette.muted); setPadding(4, 4, 4, 10) }; root.addView(statusView, matchWrap())
        val content = FrameLayout(this)
        webView = WebView(this).apply {
            setBackgroundColor(Color.WHITE); settings.javaScriptEnabled = false; settings.allowFileAccess = false; settings.allowContentAccess = false
            settings.defaultTextEncodingName = "UTF-8"; webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = openExternal(request?.url)
                @Deprecated("API 23 compatibility") override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = openExternal(url?.let(Uri::parse))
            }
        }
        rawView = TextView(this).apply { setTextColor(Color.rgb(31, 41, 55)); textSize = 16f; setPadding(18, 18, 18, 40); setBackgroundColor(Color.WHITE); visibility = View.GONE; setTextIsSelectable(true) }
        content.addView(webView, frameMatch())
        val rawScroll = ScrollView(this).apply { visibility = View.GONE; addView(rawView, matchWrap()) }
        content.addView(rawScroll, frameMatch())
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        if (mode == MODE_REPORT) {
            val output = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            output.addView(Button(this).apply {
                text = "复制正文"
                setOnClickListener {
                    if (current != null && !isUnavailableReport(currentText)) (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                        .setPrimaryClip(ClipData.newPlainText(titleView.text, MarkdownRenderer.reportBody(currentText)))
                }
            }, weighted())
            output.addView(Button(this).apply {
                text = "打印、导出与分享"
                setOnClickListener {
                    if (current != null && !isUnavailableReport(currentText)) startActivity(Intent(this@MarkdownBrowserActivity, EducationPublicationActivity::class.java)
                        .putExtra(EducationPublicationActivity.EXTRA_STUDENT_ID, intent.getStringExtra(EXTRA_STUDENT_ID))
                        .putExtra(EducationPublicationActivity.EXTRA_REPORT_ID, intent.getStringExtra(EXTRA_REPORT_ID)))
                }
            }, weighted())
            root.addView(output, matchWrap())
        }
        setContentView(root)
        if (popupMode) window.setLayout((resources.displayMetrics.widthPixels * .92f).toInt(), (resources.displayMetrics.heightPixels * .86f).toInt())
        postSlowLoadNotice(documentRequest)
        Thread {
            val result = runCatching { loadDocuments() }
            runOnUiThread { if (!isFinishing && !isDestroyed) result.onSuccess(::applyDocuments).onFailure { showFailure(it.message ?: "读取失败") } }
        }.start()
    }

    private fun loadDocuments(): List<Document> = when (intent.getStringExtra(EXTRA_MODE)) {
        MODE_ARCHIVE -> {
            val student = StudentIndexRepository(this).requireExact(requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)))
            val store = SafWorkspaceStore(this, Uri.parse(student.storageRootUri))
            val category = intent.getStringExtra(EXTRA_ARCHIVE_CATEGORY).orEmpty()
            val roots = when (category) {
                "资料摘要" -> listOf("${student.paths.summaryPath}/摘要库")
                "综合汇总" -> listOf("${student.paths.summaryPath}/综合汇总库")
                "问答精华" -> listOf("${student.paths.summaryPath}/问答精华库", "${student.paths.summaryPath}/问答库")
                "概念库" -> listOf("${student.paths.summaryPath}/概念库")
                "实体库" -> listOf("${student.paths.summaryPath}/实体库")
                "成长模型", "学情报告" -> StudentArchiveCompatibility.archiveRoots(student, category) + StudentArchiveCompatibility.legacyArchiveRoots(student)
                "项目贡献" -> listOf("${student.paths.summaryPath}/项目贡献", "${student.paths.summaryPath}/成长模型")
                else -> listOf(student.paths.summaryPath)
            }
            val contributionPaths = if (category == "项目贡献") listOf(
                "${student.paths.summaryPath.trimEnd('/')}/成长模型/系统生成/项目贡献.md",
                "${student.paths.summaryPath.trimEnd('/')}/成长模型/项目贡献.md",
            ).filter { runCatching { store.exists(it) }.getOrDefault(false) } else emptyList()
            if (contributionPaths.isNotEmpty()) contributionPaths.map { path ->
                Document(path.substringAfterLast('/'), path, student.storageRootUri)
            } else {
            val exact = roots.filter(String::isNotBlank).asSequence().map { root ->
                store.listMarkdownFiles(listOf(root), maximum = 500, maximumDepth = 6).filter { file -> when (category) {
                    "成长模型" -> StudentArchiveCompatibility.isGrowthDocumentPath(file.relativePath)
                    "学情报告" -> StudentArchiveCompatibility.isReportDocumentPath(file.relativePath)
                    "项目贡献" -> file.relativePath.contains("项目贡献")
                    else -> true
                } }
            }.firstOrNull { it.isNotEmpty() }.orEmpty()
            val discovered = if (exact.isNotEmpty() || category !in setOf("成长模型", "学情报告")) emptyList() else {
                store.findArchiveMarkdownFiles(
                    relativeRoots = StudentArchiveCompatibility.fallbackSearchRoots(student),
                    expectedFileNames = StudentArchiveCompatibility.archiveDocumentNames(category),
                    pathTerms = StudentArchiveCompatibility.archivePathTerms(category),
                    preferredTerms = StudentArchiveCompatibility.archivePreferredTerms(student, category),
                    allowRoot = student.knowledgeBaseMode == "adopted",
                ).filter { file -> when (category) {
                    "成长模型" -> StudentArchiveCompatibility.isGrowthDocumentPath(file.relativePath)
                    else -> StudentArchiveCompatibility.isReportDocumentPath(file.relativePath)
                } }
            }
            StudentArchiveCompatibility.newestFirst((exact + discovered).distinctBy { it.relativePath })
                .map {
                    Document(
                        it.name,
                        it.relativePath,
                        student.storageRootUri,
                        lastModified = StudentArchiveCompatibility.archiveDateMillis(it.lastModified, it.relativePath),
                    )
                }
            }
        }
        MODE_GROWTH_PROFILE -> {
            val student = StudentIndexRepository(this).requireExact(requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)))
            val store = SafWorkspaceStore(this, Uri.parse(student.storageRootUri))
            val exact = StudentArchiveCompatibility.archiveRoots(student, "成长模型").asSequence()
                .flatMap { root -> store.listMarkdownFiles(listOf(root), maximum = 500, maximumDepth = 8).asSequence() }
                .filter { StudentArchiveCompatibility.isGrowthProfileDocumentPath(it.relativePath) }
                .distinctBy { it.relativePath }
                .toList()
            val discovered = if (exact.isNotEmpty()) emptyList() else store.findArchiveMarkdownFiles(
                relativeRoots = StudentArchiveCompatibility.fallbackSearchRoots(student),
                expectedFileNames = StudentArchiveCompatibility.growthProfileDocumentNames,
                pathTerms = StudentArchiveCompatibility.archivePathTerms("成长模型"),
                preferredTerms = StudentArchiveCompatibility.archivePreferredTerms(student, "成长模型"),
                allowRoot = student.knowledgeBaseMode == "adopted",
            ).filter { StudentArchiveCompatibility.isGrowthProfileDocumentPath(it.relativePath) }
            val latest = StudentArchiveCompatibility.newestFirst((exact + discovered).distinctBy { it.relativePath }).firstOrNull()
                ?: error("接管资料中还没有能力画像 Markdown 文件。请先完成资料整理和成长模型更新；原有资料不会被修改。")
            listOf(Document(latest.name, latest.relativePath, student.storageRootUri,
                lastModified = StudentArchiveCompatibility.archiveDateMillis(latest.lastModified, latest.relativePath)))
        }
        MODE_PROJECT -> {
            val project = ProjectRepository(this).requireExact(requireNotNull(intent.getStringExtra(EXTRA_PROJECT_ID)))
            intent.getStringExtra(EXTRA_STUDENT_ID)?.let { require(it in project.studentIds) { "项目归属已变化" } }
            if (intent.getBooleanExtra(EXTRA_PROJECT_REPORT_ONLY, false)) {
                val reports = ProjectOutcomeService(this).listOutcomes(project.id).filter { it.optString("kind") == "progress_report" }
                reports.map { Document(it.optString("title"), it.getString("path"), project.knowledgeRootUri) }
            } else {
            val roots = if (project.paths.knowledgeRootPath.isNotBlank()) listOf(project.paths.knowledgeRootPath) else listOf(
                project.paths.conceptPath, project.paths.entityPath, project.paths.summaryPath, project.paths.qaPath,
                project.paths.synthesisPath, project.paths.reportPath, project.paths.contributionPath,
            )
            SafWorkspaceStore(this, Uri.parse(project.knowledgeRootUri)).listMarkdownFiles(roots).map { Document(it.name, it.relativePath, project.knowledgeRootUri) }
            }
        }
        MODE_REPORT -> {
            val studentId = requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)); val reportId = requireNotNull(intent.getStringExtra(EXTRA_REPORT_ID))
            val definition = GrowthModelService.REPORTS.singleOrNull { it.id == reportId } ?: error("未知学情报告")
            listOf(Document(definition.title, definition.fileName, "", GrowthModelService(this).readPublishedReport(studentId, reportId)))
        }
        MODE_OCR -> {
            val studentId = requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)); val materialId = requireNotNull(intent.getStringExtra(EXTRA_MATERIAL_ID))
            val student = StudentIndexRepository(this).requireExact(studentId)
            val material = FileAssetService(this).materials(studentId).singleOrNull { it.optString("id") == materialId } ?: error("未找到指定资料")
            val path = material.optString("ocrMarkdownPath"); require(material.optString("ocrStatus") == "completed" && path.isNotBlank()) { "该资料还没有可查看的 OCR 结果" }
            val allowedRoot = if (student.paths.rootPath.isBlank()) ".edu-manager/ocr" else "${student.paths.rootPath}/.edu-manager/ocr"
            require(path.startsWith("${allowedRoot.trimEnd('/')}/")) { "OCR 结果路径超出当前学生范围" }
            listOf(Document("${material.optString("fileName")} · OCR 结果", path, student.storageRootUri))
        }
        MODE_MATERIAL_DIGEST -> {
            val studentId = requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID)); val materialId = requireNotNull(intent.getStringExtra(EXTRA_MATERIAL_ID))
            val student = StudentIndexRepository(this).requireExact(studentId)
            val material = FileAssetService(this).materials(studentId).singleOrNull { it.optString("id") == materialId } ?: error("未找到指定资料")
            val path = material.optString("digestArtifactPath"); require(path.isNotBlank()) { "该记录没有可查看的消化产物" }
            require(path == student.paths.summaryPath || path.startsWith("${student.paths.summaryPath.trimEnd('/')}/")) { "消化产物路径超出当前学生范围" }
            listOf(Document("${material.optString("fileName")} · 消化结果", path, student.storageRootUri))
        }
        MODE_CONVERSATION -> {
            val recordId = requireNotNull(intent.getStringExtra(EXTRA_CONVERSATION_ID))
            val service = ConversationImportService(this)
            val record = service.requireExact(recordId)
            listOf(Document(
                "${record.optString("sourceAgent")} · 对话原文",
                record.optString("contentPath"),
                "",
                service.readContent(recordId),
            ))
        }
        MODE_CONVERSATION_DIGEST -> {
            val recordId = requireNotNull(intent.getStringExtra(EXTRA_CONVERSATION_ID))
            val service = ConversationImportService(this)
            val record = service.requireExact(recordId)
            listOf(Document(
                "${record.optString("sourceAgent")} · 对话消化结果",
                record.optString("digestArtifactPath"),
                "",
                service.readDigestArtifact(recordId),
            ))
        }
        else -> error("未知 Markdown 浏览模式")
    }

    private fun applyDocuments(value: List<Document>) {
        documents = value
        if (value.isEmpty()) { showFailure("当前目录没有可浏览的 Markdown 文档。") ; return }
        pickerButton.isEnabled = value.size > 1; modeButton.isEnabled = true
        val archiveHint = if (intent.getStringExtra(EXTRA_MODE) == MODE_ARCHIVE) "，已按日期从新到旧排列" else ""
        statusView.text = if (value.size == 1) "已打开 1 份文档$archiveHint" else "共 ${value.size} 份文档$archiveHint，可点击“选择文档”切换"
        if (intent.getStringExtra(EXTRA_MODE) == MODE_ARCHIVE) showPicker() else openDocument(value.first())
    }

    private fun showPicker() {
        AlertDialog.Builder(this).setTitle("选择 Markdown 文档").setItems(documents.map {
            val date = if (it.lastModified > 0L) archiveDateFormat.format(Date(it.lastModified)) else "日期未知"
            "${it.title} · $date\n${it.path}"
        }.toTypedArray()) { _, which -> openDocument(documents[which]) }.show()
    }

    private fun openDocument(document: Document) {
        val request = ++documentRequest
        current = null
        statusView.text = "正在读取文档…"
        postSlowLoadNotice(request)
        Thread {
          val result = runCatching {
            if (intent.getStringExtra(EXTRA_MODE) == MODE_PROJECT) {
                val projectId = requireNotNull(intent.getStringExtra(EXTRA_PROJECT_ID))
                intent.getStringExtra(EXTRA_STUDENT_ID)?.let {
                    require(it in ProjectRepository(this).requireExact(projectId).studentIds) { "项目归属已变化" }
                }
                LocalProjectMaterialService(this).requireGeneratedKnowledgeCurrent(projectId, document.path)
                ProjectOutcomeService(this).requireOutcomeSourcesCurrent(projectId, document.path)
            }
            val maximumBytes = if (intent.getStringExtra(EXTRA_MODE) in setOf(MODE_CONVERSATION, MODE_CONVERSATION_DIGEST)) MAX_CONVERSATION_BYTES else MAX_MARKDOWN_BYTES
            val text = document.content ?: SafWorkspaceStore(this, Uri.parse(document.rootUri)).readBytes(document.path).also { require(it.size <= maximumBytes) { "Markdown 文档超过浏览上限" } }.toString(Charsets.UTF_8)
            require(text.toByteArray().size <= maximumBytes) { "Markdown 文档超过浏览上限" }; text
          }
          runOnUiThread {
              if (request != documentRequest || isFinishing || isDestroyed) return@runOnUiThread
              result.onSuccess {
                  current = document
                  currentText = it
                  titleView.text = document.title
                  statusView.text = if (intent.getStringExtra(EXTRA_MODE) == MODE_REPORT) when {
                      isUnavailableReport(it) -> "观察草稿已失效；正式报告尚未生成"
                      Regex("(?mi)^status:\\s*draft\\s*$").containsMatchIn(it) -> "观察草稿，仅供参考"
                      else -> "报告只读查看"
                  } else "只读查看"
                  updateDisplay()
              }.onFailure { showFailure(it.message ?: "读取文档失败") }
          }
        }.start()
    }

    /** A SAF takeover or a running automatic batch may take longer than a document read.
     * Keep the modal responsive and explain that the original files remain untouched. */
    private fun postSlowLoadNotice(request: Int) {
        mainHandler.postDelayed({
            if (!isFinishing && !isDestroyed && request == documentRequest && current == null) {
                statusView.text = "正在安全核对接管资料与自动处理任务；可返回继续使用，完成后重新打开即可。原始文件不会被移动或覆盖。"
            }
        }, SLOW_LOAD_NOTICE_MILLIS)
    }

    private fun updateDisplay() {
        rawView.text = currentText; rawView.visibility = if (rendered) View.GONE else View.VISIBLE; webView.visibility = if (rendered) View.VISIBLE else View.GONE
        (rawView.parent as View).visibility = rawView.visibility
        modeButton.text = if (rendered) "查看原文" else "阅读模式"
        if (rendered) {
            val displayText = currentText.removePrefix(GrowthProjectionDocuments.MARKER).trimStart('\r', '\n')
            val body = if (intent.getStringExtra(EXTRA_MODE) == MODE_REPORT) MarkdownRenderer.reportBody(displayText) else displayText
            webView.loadDataWithBaseURL("https://local.edu-manager/", MarkdownRenderer.html(body), "text/html", "UTF-8", null)
        }
    }

    private fun showFailure(message: String) { statusView.text = message; currentText = "# 无法显示\n\n$message"; modeButton.isEnabled = false; updateDisplay() }
    private fun isUnavailableReport(text: String) = Regex("(?mi)^status:\\s*unavailable\\s*$").containsMatchIn(text)
    private fun openExternal(uri: Uri?): Boolean { if (uri?.scheme !in setOf("https", "http")) return true; runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }; return true }
    private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun frameMatch() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    override fun onDestroy() { if (::webView.isInitialized) { webView.stopLoading(); webView.loadUrl("about:blank"); webView.destroy() }; super.onDestroy() }

    companion object {
        private const val SLOW_LOAD_NOTICE_MILLIS = 4_000L
        const val EXTRA_PROJECT_REPORT_ONLY = "project_report_only"
        const val EXTRA_MODE = "mode"; const val EXTRA_TITLE = "title"; const val EXTRA_STUDENT_ID = "student_id"; const val EXTRA_PROJECT_ID = "project_id"; const val EXTRA_REPORT_ID = "report_id"; const val EXTRA_MATERIAL_ID = "material_id"; const val EXTRA_CONVERSATION_ID = "conversation_id"; const val EXTRA_ARCHIVE_CATEGORY = "archive_category"
        const val MODE_ARCHIVE = "archive"; const val MODE_PROJECT = "project"; const val MODE_REPORT = "report"; const val MODE_GROWTH_PROFILE = "growth_profile"; const val MODE_OCR = "ocr"; const val MODE_MATERIAL_DIGEST = "material_digest"; const val MODE_CONVERSATION = "conversation"; const val MODE_CONVERSATION_DIGEST = "conversation_digest"
        private const val MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
        private const val MAX_CONVERSATION_BYTES = 5 * 1024 * 1024
        private val archiveDateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
    }
}
