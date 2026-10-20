package com.qxmatrix.edumanager.standalone

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

@SuppressLint("SetJavaScriptEnabled", "SetTextI18n")
class EducationPublicationActivity : Activity() {
    private lateinit var student: StudentRecord
    private lateinit var definition: LearningReportDefinition
    private lateinit var validated: ValidatedEducationReport
    private lateinit var draft: EducationPublicationDraft
    private lateinit var webView: WebView
    private lateinit var status: TextView
    private lateinit var templateSpinner: Spinner
    private lateinit var formatSpinner: Spinner
    private lateinit var monochromeSwitch: CheckBox
    private lateinit var generateButton: Button
    private val repository by lazy { EducationPublicationRepository(this) }
    private var template = EducationPublicationPolicy.TEMPLATES.first()
    private var format = "pdf"
    private var overrideMarkdown: String? = null
    private var pendingSave: File? = null
    private var pageReady = false
    private var restorePreviewAfterPrint = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ui = UiPreferences(this); ui.applyOrientation(this); val palette = ui.palette()
        window.statusBarColor = palette.page; window.navigationBarColor = palette.page
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14)); setBackgroundColor(palette.page) }
        val title = TextView(this).apply { text = "学情报告输出"; textSize = 25f; setTextColor(palette.heading); YouthUi.applyTitleBanner(this, palette) }
        root.addView(title, matchWrap())
        status = TextView(this).apply { text = "正在核验正式报告…"; textSize = 14f; setTextColor(palette.muted); setPadding(dp(6), dp(10), dp(6), dp(8)) }
        root.addView(status, matchWrap())

        val wideLayout = resources.configuration.screenWidthDp >= 700
        val controls = LinearLayout(this).apply { orientation = if (wideLayout) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL }
        templateSpinner = Spinner(this); controls.addView(templateSpinner, weighted())
        formatSpinner = Spinner(this); controls.addView(formatSpinner, weighted())
        monochromeSwitch = CheckBox(this).apply { text = "黑白模式"; setTextColor(palette.text); setPadding(dp(8), 0, dp(8), 0); setOnCheckedChangeListener { _, _ -> refreshPreview() } }
        controls.addView(monochromeSwitch, wrapWrap())
        root.addView(controls, matchWrap())

        val actions = GridLayout(this).apply { columnCount = if (wideLayout) 5 else 2 }
        fun action(label: String, role: YouthButtonRole = YouthButtonRole.COMPACT, click: () -> Unit): Button = Button(this).apply {
            text = label; YouthUi.applyButton(this, palette, role); setOnClickListener { click() }; isEnabled = false
        }
        fun addAction(button: Button) = actions.addView(button, GridLayout.LayoutParams().apply {
            width = 0; height = ViewGroup.LayoutParams.WRAP_CONTENT; columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f); setMargins(dp(3), dp(2), dp(3), dp(2))
        })
        val edit = action("编辑副本") { editDraft() }; addAction(edit)
        val agent = action("高级：Agent 精选") { enhanceWithAgent() }; addAction(agent)
        generateButton = action("生成文件", YouthButtonRole.PRIMARY) { generateOutput() }; addAction(generateButton)
        val print = action("打印/另存 PDF") { printDocument() }; addAction(print)
        val history = action("最近输出") { showRecentOutputs() }; addAction(history)
        root.addView(actions, matchWrap())

        webView = WebView(this).apply {
            setBackgroundColor(Color.WHITE); settings.javaScriptEnabled = true; settings.allowFileAccess = false; settings.allowContentAccess = false
            settings.defaultTextEncodingName = "UTF-8"; setLayerType(View.LAYER_TYPE_SOFTWARE, null)
            webViewClient = previewClient()
        }
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(8) })
        setContentView(root)

        Thread {
            val result = runCatching {
                val studentId = requireNotNull(intent.getStringExtra(EXTRA_STUDENT_ID))
                val reportId = requireNotNull(intent.getStringExtra(EXTRA_REPORT_ID))
                student = StudentIndexRepository(this).requireExact(studentId)
                definition = GrowthModelService.REPORTS.singleOrNull { it.id == reportId } ?: error("未知学情报告")
                val source = GrowthModelService(this).readPublishedReport(student.id, definition.id)
                validated = EducationPublicationPolicy.validatePublishedReport(student.id, definition.title, source)
                draft = EducationPublicationPolicy.buildDraft(validated, template.id)
            }
            runOnUiThread {
                result.onSuccess {
                    templateSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, EducationPublicationPolicy.TEMPLATES.map { "${it.name} · ${it.description}" })
                    templateSpinner.setSelection(0)
                    templateSpinner.onItemSelectedListener = SimpleItemSelectedListener { index ->
                        val selectedTemplate = EducationPublicationPolicy.TEMPLATES[index]
                        runCatching { EducationPublicationPolicy.buildDraft(validated, selectedTemplate.id) }
                            .onSuccess { selectedDraft ->
                                template = selectedTemplate; draft = selectedDraft; overrideMarkdown = null; updateFormatOptions(); refreshPreview()
                            }.onFailure { error ->
                                status.text = "${selectedTemplate.name}不适用于当前报告，请选择正式报告。"
                                showMessage("无法使用该版式", error.message ?: "当前报告缺少可提取的正文要点")
                                templateSpinner.setSelection(EducationPublicationPolicy.TEMPLATES.indexOf(template))
                            }
                    }
                    listOf(edit, agent, generateButton, print, history).forEach { it.isEnabled = true }
                    updateFormatOptions(); refreshPreview()
                    status.text = "${student.name} · ${definition.title} · 已核验正式报告；可选择版式和格式后生成、保存、分享或打印。"
                }.onFailure { error ->
                    status.text = error.message ?: "报告核验失败"; showMessage("无法输出", error.message ?: "报告核验失败")
                }
            }
        }.start()
    }

    private fun updateFormatOptions() {
        formatSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, template.formats.map(::formatLabel))
        formatSpinner.setSelection(0); format = template.formats.first()
        formatSpinner.onItemSelectedListener = SimpleItemSelectedListener { index -> format = template.formats[index]; refreshPreview() }
    }

    private fun refreshPreview() {
        if (!::draft.isInitialized) return
        pageReady = false
        webView.webViewClient = previewClient()
        webView.loadDataWithBaseURL("https://local.edu-manager/", currentHtml(), "text/html", "UTF-8", null)
    }

    private fun previewClient() = object : WebViewClient() {
        override fun onPageFinished(view: WebView?, url: String?) { pageReady = true }
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = openExternal(request?.url)
        @Deprecated("API 23 compatibility") override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = openExternal(url?.let(Uri::parse))
    }

    private fun openExternal(uri: Uri?): Boolean {
        if (uri == null || (uri.scheme == "https" && uri.host == "local.edu-manager")) return false
        if (uri.scheme in setOf("https", "http")) runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        return true
    }

    private fun currentHtml(outputFormat: String = format) = EducationPublicationRenderer.html(draft, student.name, colorMode(), outputFormat, overrideMarkdown)

    private fun editDraft() {
        val editor = EditText(this).apply {
            setText(overrideMarkdown ?: draft.renderedMarkdown()); textSize = 15f; minLines = 16; setPadding(dp(16), dp(12), dp(16), dp(12))
        }
        val scroller = ScrollView(this).apply { addView(editor, matchWrap()) }
        AlertDialog.Builder(this).setTitle("编辑输出副本（不修改正式报告）").setView(scroller).setNegativeButton("取消", null)
            .setNeutralButton("恢复自动内容") { _, _ -> overrideMarkdown = null; draft = EducationPublicationPolicy.buildDraft(validated, template.id); refreshPreview() }
            .setPositiveButton("应用到预览") { _, _ ->
                val value = editor.text.toString().trim(); if (value.isBlank()) showMessage("未应用", "输出副本不能为空。")
                else { overrideMarkdown = value + "\n"; draft = draft.copy(edited = true, generationMethod = "user_edited"); refreshPreview() }
            }.show()
    }

    private fun enhanceWithAgent() {
        val configuration = runCatching { AgentConfigurationStore(this).load() }.getOrNull()
        if (configuration == null) { showMessage("未配置任务 Agent", "普通导出、卡片和打印不依赖 Agent。若要使用高级精选，请先在系统设置配置任务 Agent。") ; return }
        val dialog = AlertDialog.Builder(this).setTitle("Agent 正在精选原文").setMessage("仅允许选择原文句子；校验失败会保留当前自动草稿。请稍候…").setCancelable(false).create().apply { show() }
        Thread {
            val result = runCatching {
                require(template.id != "formal") { "正式报告无需 Agent 精选" }
                val response = OpenAiCompatibleAgentAdapter(configuration, this, student.id).execute(
                    "你是教育内容出版工具。只能从用户提供的报告中逐字选择完整句子，不得改写、补充或推断。只输出 JSON。",
                    "从下面报告选择最多 8 个最重要的原文句子。返回 {\"quotes\":[\"逐字原句\"]}。\n\n${validated.markdown.take(60_000)}",
                )
                val jsonText = response.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
                val values = JSONObject(jsonText).getJSONArray("quotes")
                val selected = buildList { for (index in 0 until values.length()) add(values.getString(index)) }
                EducationPublicationPolicy.buildAgentSelectedDraft(EducationPublicationPolicy.buildDraft(validated, template.id), validated.markdown, selected)
            }
            runOnUiThread {
                dialog.dismiss()
                result.onSuccess { draft = it; overrideMarkdown = null; refreshPreview(); showMessage("Agent 精选已应用", "所有要点均通过逐字原文校验。") }
                    .onFailure { showMessage("已保留自动草稿", "Agent 超时、格式异常或原文校验未通过：${it.message ?: "未知错误"}\n\n普通输出仍可继续。") }
            }
        }.start()
    }

    private fun generateOutput() {
        if (!pageReady && format != "markdown") { showMessage("预览尚未完成", "请稍候片刻后再生成。") ; return }
        generateButton.isEnabled = false
        status.text = "正在生成${formatLabel(format)}…"
        val output = repository.cacheFile("${student.name}-${definition.title}-${template.name}", if (format == "markdown") "md" else format)
        if (format == "markdown") {
            runCatching { output.writeText(overrideMarkdown ?: draft.renderedMarkdown(), Charsets.UTF_8); finishGeneratedOutput(output) }
                .onFailure(::outputFailed)
        } else prepareWebViewForOutput(format) {
            runCatching {
                if (format == "png") renderPng(output) else renderPdf(output)
                finishGeneratedOutput(output)
            }.onFailure(::outputFailed)
        }
    }

    private fun prepareWebViewForOutput(outputFormat: String, after: () -> Unit) {
        pageReady = false
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = openExternal(request?.url)
            @Deprecated("API 23 compatibility") override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = openExternal(url?.let(Uri::parse))
            override fun onPageFinished(view: WebView, url: String?) {
                view.evaluateJavascript("Math.max(document.body.scrollHeight,document.documentElement.scrollHeight).toString()") { value ->
                    val cssHeight = value.trim('"').toDoubleOrNull()?.toInt() ?: 1920
                    val width = 1080; val height = (cssHeight * resources.displayMetrics.density).toInt().coerceAtLeast(1200)
                    view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
                    view.layout(0, 0, width, height); pageReady = true; view.webViewClient = previewClient(); view.postDelayed(after, 120)
                }
            }
        }
        webView.loadDataWithBaseURL("https://local.edu-manager/", currentHtml(outputFormat), "text/html", "UTF-8", null)
    }

    private fun renderPng(output: File) {
        val width = webView.measuredWidth.coerceAtLeast(1080); val height = webView.measuredHeight.coerceAtLeast(1440)
        require(height <= MAX_PNG_HEIGHT) { "卡片内容过长，请精简后重试，或改用 PDF 输出完整内容" }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).drawColor(Color.WHITE); webView.draw(Canvas(bitmap))
        output.outputStream().use { require(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) { "PNG 编码失败" } }
        bitmap.recycle()
    }

    private fun renderPdf(output: File) {
        val document = PdfDocument(); val card = template.id == "growth-card"
        val pageWidth = if (card) 540 else 595; val pageHeight = if (card) 960 else 842; val margin = if (card) 24 else 36
        val sourceWidth = webView.measuredWidth.coerceAtLeast(1080); val sourceHeight = webView.measuredHeight.coerceAtLeast(1200)
        val scale = (pageWidth - margin * 2).toFloat() / sourceWidth; val sourcePageHeight = ((pageHeight - margin * 2) / scale).toInt().coerceAtLeast(1)
        val pages = ((sourceHeight + sourcePageHeight - 1) / sourcePageHeight).coerceAtLeast(1)
        try {
            repeat(pages) { index ->
                val page = document.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, index + 1).create())
                page.canvas.drawColor(Color.WHITE); page.canvas.save(); page.canvas.clipRect(margin, margin, pageWidth - margin, pageHeight - margin)
                page.canvas.translate(margin.toFloat(), margin.toFloat()); page.canvas.scale(scale, scale); page.canvas.translate(0f, -(index * sourcePageHeight).toFloat()); webView.draw(page.canvas); page.canvas.restore()
                page.canvas.drawText("${index + 1} / $pages", (pageWidth - 58).toFloat(), (pageHeight - 15).toFloat(), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.DKGRAY; textSize = 9f })
                document.finishPage(page)
            }
            output.outputStream().use { document.writeTo(it) }
        } finally { document.close() }
    }

    private fun finishGeneratedOutput(output: File) {
        val record = repository.add(student, definition.id, validated.title, validated.sourceHash, template, format, colorMode(), output, draft.edited || overrideMarkdown != null, draft.generationMethod)
        generateButton.isEnabled = true; status.text = "已生成 ${output.name} · ${humanSize(output.length())}"
        AlertDialog.Builder(this).setTitle("${template.name}已生成").setMessage("文件保存在应用输出区，可保存到 U 盘/本机、分享或稍后从“最近输出”再次打开。")
            .setNegativeButton("关闭", null).setNeutralButton("分享") { _, _ -> share(record) }.setPositiveButton("保存到…") { _, _ -> chooseSaveDestination(record) }.show()
        refreshPreview()
    }

    private fun outputFailed(error: Throwable) { generateButton.isEnabled = true; status.text = "生成失败：${error.message ?: "未知错误"}"; showMessage("生成失败", error.message ?: "未知错误") }

    private fun printDocument() {
        if (!::draft.isInitialized) return
        status.text = "正在准备打印预览…"
        prepareWebViewForOutput("pdf") {
            runCatching {
                val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
                val name = "${student.name}-${definition.title}-${template.name}"
                printManager.print(name, webView.createPrintDocumentAdapter(name), PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).setColorMode(if (monochromeSwitch.isChecked) PrintAttributes.COLOR_MODE_MONOCHROME else PrintAttributes.COLOR_MODE_COLOR).build())
            }.onSuccess {
                restorePreviewAfterPrint = true
                status.text = "已打开系统打印服务 · ${definition.title}"
            }.onFailure { error ->
                status.text = "打印服务不可用"
                showMessage("无法打开打印服务", error.message ?: "请检查系统是否已启用打印服务，或先生成 PDF 文件。")
                refreshPreview()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (restorePreviewAfterPrint && ::draft.isInitialized) {
            restorePreviewAfterPrint = false
            refreshPreview()
        }
    }

    private fun chooseSaveDestination(record: EducationPublicationRecord) {
        val source = File(record.outputPath); pendingSave = source
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = mime(record.format); putExtra(Intent.EXTRA_TITLE, source.name)
        }, REQUEST_SAVE_OUTPUT)
    }

    @Deprecated("Activity result retained for API 23 compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_SAVE_OUTPUT || resultCode != RESULT_OK) return
        val source = pendingSave; val destination = data?.data
        if (source == null || destination == null) return
        runCatching { contentResolver.openOutputStream(destination, "w")!!.use { output -> source.inputStream().use { it.copyTo(output) } } }
            .onSuccess { showMessage("保存完成", "文件已写入你选择的位置。") }.onFailure { showMessage("保存失败", it.message ?: "无法写入目标位置") }
        pendingSave = null
    }

    private fun showRecentOutputs() {
        val records = repository.list(student.id)
        if (records.isEmpty()) { showMessage("暂无输出记录", "生成报告或卡片后，可从这里再次打开、保存、分享或删除。") ; return }
        val labels = records.map { record ->
            val changed = if (recordSourceChanged(record)) " · 原报告已变化" else ""
            "${record.sourceTitle.ifBlank { "学情报告" }} · ${record.templateName} · ${formatLabel(record.format)} · ${record.generatedAt.take(16).replace('T', ' ')}$changed"
        }.toTypedArray()
        AlertDialog.Builder(this).setTitle("${student.name} · 最近输出").setItems(labels) { _, index -> showRecordActions(records[index]) }.setNegativeButton("关闭", null).show()
    }

    private fun showRecordActions(record: EducationPublicationRecord) {
        val sourceState = if (recordSourceChanged(record)) "原报告已变化或不可用，建议重新生成" else "与当前原报告一致"
        AlertDialog.Builder(this).setTitle("${record.sourceTitle.ifBlank { "学情报告" }} · ${record.templateName}").setMessage("格式：${formatLabel(record.format)}\n来源状态：$sourceState\n生成方式：${generationMethodLabel(record.generationMethod)}\n时间：${record.generatedAt.take(16).replace('T', ' ')}")
            .setNegativeButton("删除") { _, _ -> confirmDelete(record) }.setNeutralButton("分享") { _, _ -> share(record) }
            .setPositiveButton("打开/保存") { _, _ -> openOrSave(record) }.show()
    }

    private fun openOrSave(record: EducationPublicationRecord) {
        val file = File(record.outputPath)
        if (!file.exists()) { showMessage("文件不存在", "缓存可能已被系统清理，请重新生成。") ; return }
        val uri = outputUri(file)
        runCatching { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime(record.format)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
            .onFailure { chooseSaveDestination(record) }
    }

    private fun share(record: EducationPublicationRecord) {
        val file = File(record.outputPath)
        if (!file.exists()) { showMessage("文件不存在", "缓存可能已被系统清理，请重新生成。") ; return }
        val uri = outputUri(file)
        runCatching { startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = mime(record.format); putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }, "分享学情报告")) }
            .onFailure { showMessage("无法分享", it.message ?: "当前设备没有可接收该文件的应用。") }
    }

    private fun confirmDelete(record: EducationPublicationRecord) {
        AlertDialog.Builder(this).setTitle("删除这份输出？").setMessage("只删除生成的报告/卡片文件和输出记录，不会删除正式学情报告。")
            .setNegativeButton("取消", null).setPositiveButton("删除") { _, _ -> runCatching { repository.delete(student.id, record.id) }
                .onSuccess { showMessage("已删除", "正式学情报告未受影响。") }.onFailure { showMessage("删除失败", it.message ?: "未知错误") } }.show()
    }

    private fun outputUri(file: File): Uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
    private fun recordSourceChanged(record: EducationPublicationRecord): Boolean = runCatching {
        val report = GrowthModelService.REPORTS.single { it.id == record.sourceId }
        val content = GrowthModelService(this).readPublishedReport(student.id, report.id)
        EducationPublicationPolicy.validatePublishedReport(student.id, report.title, content).sourceHash != record.sourceHash
    }.getOrDefault(true)
    private fun colorMode() = if (monochromeSwitch.isChecked) "monochrome" else "color"
    private fun formatLabel(value: String) = when (value) { "pdf" -> "PDF"; "png" -> "PNG 卡片"; "markdown" -> "Markdown"; else -> value }
    private fun generationMethodLabel(value: String) = when (value) { "agent" -> "Agent 精选原文"; "user_edited" -> "用户编辑副本"; else -> "系统按原报告生成" }
    private fun mime(value: String) = when (value) { "pdf" -> "application/pdf"; "png" -> "image/png"; else -> "text/markdown" }
    private fun humanSize(bytes: Long) = if (bytes >= 1024 * 1024) "%.1f MB".format(bytes / 1024.0 / 1024.0) else "${(bytes / 1024).coerceAtLeast(1)} KB"
    private fun showMessage(title: String, message: String) = AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("知道了", null).show()
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun wrapWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    override fun onDestroy() { if (::webView.isInitialized) { webView.stopLoading(); webView.loadUrl("about:blank"); webView.destroy() }; super.onDestroy() }

    companion object {
        const val EXTRA_STUDENT_ID = "student_id"
        const val EXTRA_REPORT_ID = "report_id"
        private const val REQUEST_SAVE_OUTPUT = 7514
        private const val MAX_PNG_HEIGHT = 12_000
    }
}

private class SimpleItemSelectedListener(private val selected: (Int) -> Unit) : android.widget.AdapterView.OnItemSelectedListener {
    override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) = selected(position)
    override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
}
