package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import android.provider.MediaStore
import android.provider.Settings
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.FileProvider
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.io.File
import java.net.URI

class MainActivity : Activity() {
    private lateinit var rootGrant: SafRootGrant
    private lateinit var workspaceService: StudentWorkspaceService
    private lateinit var fileAssetService: FileAssetService
    private lateinit var projectService: ProjectWorkspaceService
    private lateinit var courseCatalogService: CourseCatalogService
    private lateinit var conversationImportService: ConversationImportService
    private lateinit var uiPreferences: UiPreferences
    private lateinit var licenseManager: LicenseManager
    private var activationInput: EditText? = null
    private var activationStatusText: TextView? = null
    private lateinit var palette: UiPalette
    private lateinit var sectionContent: LinearLayout
    private lateinit var sectionTitle: TextView
    private lateinit var portraitSectionButton: Button
    private val navigationButtons = linkedMapOf<AppSection, Button>()
    private var activeSection = AppSection.HOME
    private lateinit var rootStatus: TextView
    private lateinit var studentList: LinearLayout
    private lateinit var projectList: LinearLayout
    private lateinit var agentStatus: TextView
    private var pendingAdoption: StudentInput? = null
    private var pendingImportStudentId: String? = null
    private var pendingCameraUri: Uri? = null
    private var pendingCameraFile: File? = null
    private var pendingProjectAdoption: ProjectInput? = null
    private var pendingBackupPassword: CharArray? = null
    private var pendingRestorePassword: CharArray? = null
    private var pendingRestorePackage: Uri? = null
    private var pendingConversationStudentId: String? = null
    private var pendingConversationProjectId: String? = null
    private var pendingConversationAgent: String = "其他Agent"
    private var pendingStudentMigration: PendingStudentMigration? = null
    private var pendingUpdateApk: File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        uiPreferences = UiPreferences(this)
        uiPreferences.applyOrientation(this)
        palette = uiPreferences.palette()
        licenseManager = LicenseManager(this)
        if (!licenseManager.status().active) {
            setContentView(buildActivationScreen())
            return
        }
        rootGrant = SafRootGrant(this)
        workspaceService = StudentWorkspaceService(this)
        fileAssetService = FileAssetService(this)
        projectService = ProjectWorkspaceService(this)
        courseCatalogService = CourseCatalogService(this)
        conversationImportService = ConversationImportService(this)

        activeSection = savedInstanceState?.getString(STATE_SECTION)?.let { runCatching { AppSection.valueOf(it) }.getOrNull() } ?: AppSection.HOME
        setContentView(buildAppShell())
        renderSection(activeSection)
        if (savedInstanceState == null) sectionContent.post { handleIncomingIntent(intent) }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent); if (intent != null) { setIntent(intent); handleIncomingIntent(intent) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(STATE_SECTION, activeSection.name)
        super.onSaveInstanceState(outState)
    }

    private fun buildActivationScreen(): View {
        val current = licenseManager.status()
        val input = EditText(this).apply {
            hint = "粘贴 AIE3 激活码"
            minLines = 4
            maxLines = 8
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setTextColor(palette.text)
            setHintTextColor(palette.muted)
            setBackgroundColor(Color.WHITE)
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        val statusText = TextView(this).apply {
            text = current.message
            textSize = 16f
            setTextColor(palette.muted)
            setPadding(0, dp(10), 0, dp(10))
        }
        activationInput = input
        activationStatusText = statusText
        val deviceCode = licenseManager.deviceId()
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(28), dp(28), dp(28))
            setBackgroundColor(withAlpha(palette.page, 246))
            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.drawable.robogala_logo)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                contentDescription = "群星矩阵"
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(96)))
            addView(TextView(this@MainActivity).apply {
                text = "Android 单机版产品激活"
                textSize = 28f
                gravity = Gravity.CENTER
                setTextColor(palette.accentDark)
            }, matchWrap())
            addView(TextView(this@MainActivity).apply {
                text = "本机设备码\n$deviceCode"
                textSize = 18f
                gravity = Gravity.CENTER
                setTextColor(palette.text)
                setPadding(0, dp(20), 0, dp(12))
            }, matchWrap())
            addView(themedButton("复制设备码") {
                val clipboard = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Android 单机版设备码", deviceCode))
                statusText.text = "设备码已复制，请发送给销售或客服生成本机激活码。"
            }, matchWrap())
            addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(16) })
            addView(themedButton("从剪贴板粘贴") {
                val clipboard = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                input.setText(clipboard.primaryClip?.getItemAt(0)?.coerceToText(this@MainActivity)?.toString().orEmpty())
            }, matchWrap())
            addView(themedButton("扫码激活") {
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(this@MainActivity, LicenseQrScannerActivity::class.java), REQUEST_LICENSE_QR_SCAN)
            }, matchWrap())
            addView(themedButton("从相册识别二维码") {
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, REQUEST_LICENSE_QR_IMAGE)
            }, matchWrap())
            addView(themedButton("激活并进入教育管家") {
                runCatching { licenseManager.activate(input.text.toString()) }
                    .onSuccess { recreate() }
                    .onFailure { statusText.text = it.message ?: "激活失败。" }
            }, matchWrap())
            addView(statusText, matchWrap())
            addView(TextView(this@MainActivity).apply {
                text = "激活不需要连接授权服务器。请妥善保管激活码；换机或恢复出厂设置后需要重新签发。"
                textSize = 14f
                setTextColor(palette.muted)
            }, matchWrap())
        }
        return ScrollView(this).apply {
            setBackgroundColor(palette.page)
            addView(card, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
    }

    private fun buildAppShell(): FrameLayout {
        val wide = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE && resources.configuration.smallestScreenWidthDp >= 600
        val frame = FrameLayout(this)
        frame.addView(ImageView(this).apply {
            setImageResource(uiPreferences.skin().backgroundResource()); scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0.22f
            contentDescription = "${uiPreferences.skin().label}界面背景"
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val root = LinearLayout(this).apply { orientation = if (wide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL; setBackgroundColor(Color.TRANSPARENT) }
        if (wide) {
            root.addView(buildNavigation(), LinearLayout.LayoutParams(dp(238), ViewGroup.LayoutParams.MATCH_PARENT))
        } else {
            val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(8)); setBackgroundColor(withAlpha(palette.accentSoft, 244)) }
            portraitSectionButton = themedButton(activeSection.label) { showSectionPicker() }
            top.addView(portraitSectionButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            top.addView(ImageView(this).apply { setImageResource(R.drawable.robogala_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE; contentDescription = "群星矩阵" }, LinearLayout.LayoutParams(dp(145), dp(58)))
            root.addView(top, matchWrap())
        }
        val page = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(22), dp(22), dp(32)); setBackgroundColor(withAlpha(palette.page, 232)) }
        sectionTitle = TextView(this).apply { textSize = 26f; setTextColor(palette.accentDark); setPadding(0, 0, 0, dp(12)) }
        sectionContent = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        page.addView(sectionTitle, matchWrap()); page.addView(sectionContent, matchWrap())
        val scroll = ScrollView(this).apply { addView(page) }
        root.addView(scroll, if (wide) LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f) else LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        frame.addView(root, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return frame
    }

    private fun buildNavigation(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(16), dp(14), dp(18)); setBackgroundColor(withAlpha(palette.accentSoft, 244))
        addView(ImageView(this@MainActivity).apply { setImageResource(R.drawable.robogala_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE; contentDescription = "群星矩阵" }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(88)))
        addView(TextView(this@MainActivity).apply { text = "AI教育管家"; textSize = 20f; gravity = Gravity.CENTER; setTextColor(palette.accentDark); setPadding(dp(8), 0, dp(8), dp(10)) }, matchWrap())
        val menu = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
        AppSection.entries.filterNot { it == AppSection.SETTINGS }.forEach { section ->
            val button = themedButton(section.label) { renderSection(section) }
            navigationButtons[section] = button; menu.addView(button, matchWrap())
        }
        addView(ScrollView(this@MainActivity).apply { isFillViewport = true; addView(menu) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val settings = themedButton(AppSection.SETTINGS.label) { renderSection(AppSection.SETTINGS) }
        navigationButtons[AppSection.SETTINGS] = settings
        addView(settings, matchWrap())
    }

    private fun showSectionPicker() {
        AlertDialog.Builder(this).setTitle("功能目录").setItems(AppSection.entries.map { it.label }.toTypedArray()) { _, index -> renderSection(AppSection.entries[index]) }.show()
    }

    private fun renderSection(section: AppSection) {
        activeSection = section; sectionTitle.text = section.label; sectionContent.removeAllViews()
        if (::portraitSectionButton.isInitialized) portraitSectionButton.text = section.label
        navigationButtons.forEach { (item, button) ->
            button.backgroundTintList = ColorStateList.valueOf(if (item == section) palette.accent else palette.card)
            button.setTextColor(if (item == section) Color.WHITE else palette.text)
        }
        when (section) {
            AppSection.HOME -> renderHome()
            AppSection.ARCHIVES -> renderArchives()
            AppSection.MATERIALS -> renderMaterials()
            AppSection.COURSES -> renderCourses()
            AppSection.ASSISTANT -> renderAssistant()
            AppSection.GROWTH -> renderGrowth()
            AppSection.REPORTS -> renderReports()
            AppSection.PROJECTS -> renderProjects()
            AppSection.SETTINGS -> renderSettings()
        }
    }

    private fun renderHome() {
        val students = workspaceService.listStudents()
        val materials = students.flatMap { runCatching { fileAssetService.materials(it.id) }.getOrDefault(emptyList()) }
        val pending = materials.count { it.optString("status") == MaterialStatus.PENDING_DIGEST.wireValue }
        val needsHelp = materials.count { it.optString("ocrStatus") == "failed" || it.optString("visionStatus") == "unavailable" }
        val completedOcr = materials.count { it.optString("ocrStatus") == "completed" }
        val projects = projectService.listProjects().size
        sectionNote("从收集资料到形成档案，按当前状态进入下一步；所有内容仍写入对应学生或学习项目的独立目录。")
        sectionContent.addView(TextView(this).apply {
            text = "学生档案 ${students.size} · 学习项目 $projects · 待处理 $pending · 已完成 OCR $completedOcr"
            textSize = 16f; setTextColor(palette.text); setPadding(dp(16), dp(14), dp(16), dp(14)); setBackgroundColor(withAlpha(palette.card, 238))
        }, matchWrap())
        sectionHeading("现在可以做什么")
        addHomeGuide("添加资料", "导入文件、拍照或连续采集屏幕") { renderSection(AppSection.MATERIALS) }
        addHomeGuide("处理中", if (pending > 0) "$pending 份资料等待 OCR、消化或整理" else "当前没有待消化资料") { renderSection(AppSection.MATERIALS) }
        addHomeGuide("需要补充", if (needsHelp > 0) "$needsHelp 份资料需要检查视觉模型或重新处理" else "当前没有标记为需要补充的资料") { renderSection(AppSection.MATERIALS) }
        addHomeGuide("知识更新", "查看教育档案和学习项目中的最新沉淀") { renderSection(AppSection.ARCHIVES) }
        addHomeGuide("成长变化", "查看有来源、可审核的成长证据") { renderSection(AppSection.GROWTH) }
        addHomeGuide("报告与档案", "浏览 Markdown 学情报告与教育档案") {
            AlertDialog.Builder(this).setTitle("报告与档案").setItems(arrayOf("教育档案", "学情报告")) { _, which -> renderSection(if (which == 0) AppSection.ARCHIVES else AppSection.REPORTS) }.show()
        }
    }

    private fun addHomeGuide(title: String, detail: String, action: () -> Unit) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(10), dp(14), dp(10)); setBackgroundColor(withAlpha(palette.card, 242)); isClickable = true; isFocusable = true; setOnClickListener { action() }
        }
        card.addView(TextView(this).apply { text = title; textSize = 18f; setTextColor(palette.accentDark) }, matchWrap())
        card.addView(TextView(this).apply { text = detail; textSize = 14f; setTextColor(palette.muted) }, matchWrap())
        sectionContent.addView(card, matchWrap().apply { setMargins(0, 0, 0, dp(9)) })
    }

    private fun renderArchives() {
        sectionNote("新建或接管学生学情档案；每名学生继续使用独立的 Windows/LLM Wiki 目录与精确 ID。")
        rootStatus = statusCard(); sectionContent.addView(rootStatus, matchWrap()); updateRootStatus()
        addAction("设置新建档案保存位置") { startTreePicker(REQUEST_WORKSPACE_ROOT) }
        addAction("新建学情档案") { showStudentInputDialog("新建学生档案库") { input -> createStudent(input) } }
        addAction("接管已有学情档案") { showStudentInputDialog("接管已有学生档案库") { input -> pendingAdoption = input; startTreePicker(REQUEST_ADOPTED_ROOT) } }
        sectionHeading("已有学情档案")
        studentList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; sectionContent.addView(studentList, matchWrap()); refreshStudents()
    }

    private fun renderMaterials() {
        sectionNote("本机导入、连续屏幕采集、OCR/视觉解析与资料消化统一进入文件资产中心。")
        addAction("文件资产中心") { chooseStudentForAssets() }
        addAction("本机导入") { chooseImportStudent() }
        addAction("连续屏幕采集") { startGeneralScreenCapture() }
        addAction("OCR / 视觉解析资料") { chooseMaterialForOcr() }
        addAction("查看 OCR 识别结果") { chooseOcrResult() }
        addAction("消化资料") { chooseStudentForDigest() }
    }

    private fun renderCourses() {
        val catalog = runCatching { courseCatalogService.lastGoodCatalog() }.getOrNull()
        sectionNote(if (catalog == null) "尚未导入平台课程目录。可在系统设置的高级功能中导入 Windows 主机导出的课程包。" else "平台课程目录 ${catalog.optString("catalogVersion")} · ${catalog.optJSONArray("courses")?.length() ?: 0} 门课程")
        addAction("查看和学习平台课程") { chooseStudentForCourses() }
    }

    private fun renderAssistant() {
        sectionNote("教育管家仍负责学生身份、档案和写回；本机助手只作为问答或受控任务能力入口。")
        addAction("打开 PalmClaw") { openPalmClaw() }
        addAction("打开豆包") { openDoubao() }
        addAction("打开 MobileClaw") { openMobileClaw() }
        addAction("打开 ChatGPT / Codex") { openChatGpt() }
        addAction("导入智能体对话历史") { showConversationImportMenu() }
        addAction("管理已保存对话历史") { showSavedConversations() }
    }

    private fun renderGrowth() {
        sectionNote("成长模型只沉淀有来源、可审核的成长证据，不由学情报告反向覆盖。")
        addAction("查看和维护成长模型") { chooseGrowthStudent() }
    }

    private fun renderReports() {
        sectionNote("整体画像、历史变化、每周行动建议和阶段总结继续以成长模型的已确认证据为依据。")
        addAction("查看学情报告") { chooseReportStudent() }
        addAction("生成并审核报告草稿") { chooseStudentForReportDrafts() }
    }

    private fun renderProjects() {
        sectionNote("新建或接管学习项目；项目知识空间继续使用固定 LLM Wiki Schema。")
        addAction("新建学习项目") { showProjectInputDialog(adoptKnowledge = false) }
        addAction("接管已有项目知识库") { showProjectInputDialog(adoptKnowledge = true) }
        sectionHeading("已有学习项目")
        projectList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; sectionContent.addView(projectList, matchWrap()); refreshProjects()
    }

    private fun renderSettings() {
        sectionNote("界面、任务 Agent、目录授权和本机备份设置。密钥继续使用 Android Keystore 加密。")
        val license = licenseManager.status()
        sectionContent.addView(statusCard().apply {
            text = "产品授权：${if (license.active) "已激活" else "未激活"}\n设备码：${licenseManager.deviceId()}\n学生席位：${license.maxActiveStudents}\n到期：${license.expiresAt.ifBlank { "永久" }}"
        }, matchWrap())
        addAction("更换激活码") {
            AlertDialog.Builder(this).setTitle("更换激活码")
                .setMessage("清除当前激活码后将返回产品激活页。已有资料不会删除。确认继续吗？")
                .setNegativeButton("取消", null)
                .setPositiveButton("继续") { _, _ -> licenseManager.clear(); recreate() }
                .show()
        }
        val toolStates = agentToolDefinitions().map { it to installedAgentPackage(it) }
        sectionContent.addView(statusCard().apply {
            text = "Agent 工具：已安装 ${toolStates.count { it.second != null }} / ${toolStates.size}\n" +
                toolStates.joinToString(" · ") { (tool, packageName) -> "${tool.displayName}${if (packageName == null) "未安装" else "已安装"}" }
        }, matchWrap())
        addAction("Agent 工具适配") { showAgentToolAdapter() }
        sectionHeading("任务 Agent 服务")
        agentStatus = statusCard(); sectionContent.addView(agentStatus, matchWrap()); updateAgentStatus()
        addAction("配置或修改本地任务 Agent") { showAgentConfigurationDialog() }
        addAction("测试 Agent 连接") { testAgentConfiguration() }
        addAction("停用本地任务 Agent") { confirmClearAgentConfiguration() }
        addAction("界面皮肤：${uiPreferences.skin().label}") { showSkinDialog() }
        addAction("页面布局：${uiPreferences.layoutMode().label}") { showLayoutDialog() }
        addAction("检查版本更新") { checkForAppUpdate() }
        addAction("存储与目录授权") { startTreePicker(REQUEST_WORKSPACE_ROOT) }
        addAction("加密备份") { promptBackupPassword() }
        addAction("备份恢复") { startRestorePackagePicker() }
        sectionHeading("高级设置")
        addAction("导入离线平台课程包") { startPlatformCourseImport() }
    }

    private fun sectionNote(value: String) { sectionContent.addView(TextView(this).apply { text = value; textSize = 15f; setTextColor(palette.muted); setPadding(0, 0, 0, dp(12)) }, matchWrap()) }
    private fun sectionHeading(value: String) { sectionContent.addView(TextView(this).apply { text = value; textSize = 20f; setTextColor(palette.accentDark); setPadding(0, dp(18), 0, dp(8)) }, matchWrap()) }
    private fun statusCard() = TextView(this).apply { textSize = 14f; setTextColor(palette.text); setPadding(dp(16), dp(14), dp(16), dp(14)); setBackgroundColor(palette.card) }
    private fun addAction(label: String, action: () -> Unit) { sectionContent.addView(themedButton(label, action), matchWrap()) }
    private fun themedButton(label: String, action: () -> Unit) = Button(this).apply { text = label; isAllCaps = false; textSize = 15f; backgroundTintList = ColorStateList.valueOf(palette.card); setTextColor(palette.text); setOnClickListener { action() } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun withAlpha(color: Int, alpha: Int) = Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))

    @Deprecated("Kept for API 23 compatibility without adding a second navigation framework")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_INSTALL_UPDATE_PERMISSION) {
            if (Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls()) pendingUpdateApk?.let(::openApkInstaller)
            else showMessage("尚未允许安装", "请允许本应用安装未知应用，然后再次点击“检查版本更新”。")
            return
        }
        if (requestCode == REQUEST_LICENSE_QR_SCAN) {
            if (resultCode == RESULT_OK) handleRecognizedLicense(data?.getStringExtra(LicenseQrScannerActivity.EXTRA_LICENSE_TOKEN), "摄像头扫码")
            return
        }
        if (requestCode == REQUEST_LICENSE_QR_IMAGE) {
            if (resultCode == RESULT_OK) data?.data?.let(::recognizeLicenseQrImage)
            return
        }
        if (resultCode != RESULT_OK) return
        when (requestCode) {
            REQUEST_WORKSPACE_ROOT -> {
                val result = rootGrant.acceptPickerResult(data ?: return)
                if (::rootStatus.isInitialized) rootStatus.text = result.fold(
                    onSuccess = { "新建档案根目录已授权：$it" }, onFailure = { "目录授权失败：${it.message ?: "未知错误"}" },
                )
            }
            REQUEST_ADOPTED_ROOT -> {
                val input = pendingAdoption ?: return
                pendingAdoption = null
                rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                    onSuccess = { showAdoptionConfirmation(input, it) },
                    onFailure = { showMessage("目录授权失败", it.message ?: "未知错误") },
                )
            }
            REQUEST_IMPORT_FILES -> importSelectedFiles(data ?: return)
            REQUEST_CAPTURE_PHOTO -> importCapturedPhoto()
            REQUEST_CONVERSATION_FILE -> importConversationFile(data?.data ?: return)
            REQUEST_ADOPTED_PROJECT_KNOWLEDGE -> {
                val input = pendingProjectAdoption ?: return
                pendingProjectAdoption = null
                rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                    onSuccess = { confirmProjectKnowledgeAdoption(input, it) },
                    onFailure = { showMessage("目录授权失败", it.message ?: "未知错误") },
                )
            }
            REQUEST_PLATFORM_COURSE_PACKAGE -> importPlatformCoursePackage(data?.data ?: return)
            REQUEST_BACKUP_DESTINATION -> exportBackup(data?.data ?: return)
            REQUEST_RESTORE_PACKAGE -> promptRestorePassword(data?.data ?: return)
            REQUEST_RESTORE_ROOT -> rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                onSuccess = { restoreBackup(it) },
                onFailure = { clearRestoreSecrets(); showMessage("目录授权失败", it.message ?: "未知错误") },
            )
            REQUEST_STUDENT_MIGRATION_ROOT -> rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                onSuccess = { importPendingStudentMigration(it) },
                onFailure = { pendingStudentMigration = null; showMessage("目录授权失败", it.message ?: "未知错误") },
            )
        }
    }

    private fun recognizeLicenseQrImage(uri: Uri) {
        activationStatusText?.text = "正在本机识别二维码图片…"
        val image = runCatching { InputImage.fromFilePath(this, uri) }.getOrElse {
            activationStatusText?.text = "无法读取所选图片：${it.message ?: "未知错误"}"
            return
        }
        val scanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        )
        scanner.process(image)
            .addOnSuccessListener { barcodes ->
                val token = barcodes.asSequence().mapNotNull { LicenseQrPayload.normalize(it.rawValue) }.firstOrNull()
                if (token == null) activationStatusText?.text = "图片中没有识别到有效的 AIE3 License 二维码。"
                else handleRecognizedLicense(token, "相册二维码")
            }
            .addOnFailureListener { activationStatusText?.text = "二维码识别失败：${it.message ?: "未知错误"}" }
            .addOnCompleteListener { scanner.close() }
    }

    private fun handleRecognizedLicense(rawToken: String?, source: String) {
        val token = LicenseQrPayload.normalize(rawToken)
        if (token == null) {
            activationStatusText?.text = "$source 未包含有效的 AIE3 License v3 激活码。"
            return
        }
        activationInput?.setText(token)
        activationStatusText?.text = "$source 已识别，等待确认激活。"
        AlertDialog.Builder(this)
            .setTitle("确认激活 Android 单机版")
            .setMessage("已从${source}识别 License v3。确认后将在本机校验产品、设备码、数字签名和有效期；二维码图片不会上传或保存。")
            .setNegativeButton("取消", null)
            .setPositiveButton("确认激活") { _, _ ->
                runCatching { licenseManager.activate(token) }
                    .onSuccess { recreate() }
                    .onFailure { activationStatusText?.text = it.message ?: "激活失败。" }
            }
            .show()
    }

    private fun checkForAppUpdate() {
        val progress = showProgress("正在检查更新", "正在读取 Android 单机版官方更新清单。")
        @Suppress("DEPRECATION")
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        Thread {
            runCatching { AppUpdateService(this).check(packageInfo.versionCode) }
                .onSuccess { update -> runOnUiThread {
                    progress.dismiss()
                    if (update == null) showMessage("已是最新版本", "当前 Android 单机版为 v${packageInfo.versionName.orEmpty()}。")
                    else AlertDialog.Builder(this)
                        .setTitle("发现新版 ${update.versionName}")
                        .setMessage(update.notes.ifBlank { "可以下载并安装最新版 Android 单机版。" })
                        .setNegativeButton("稍后", null)
                        .setPositiveButton("下载并安装") { _, _ -> downloadAppUpdate(update) }
                        .show()
                } }
                .onFailure { error -> runOnUiThread { progress.dismiss(); showMessage("检查更新失败", error.message ?: "未知错误") } }
        }.start()
    }

    private fun downloadAppUpdate(update: StandaloneUpdateInfo) {
        val progress = showProgress("正在下载 ${update.versionName}", "下载进度 0%")
        Thread {
            runCatching { AppUpdateService(this).download(update) { percent -> runOnUiThread { progress.setMessage("下载进度 $percent%") } } }
                .onSuccess { apk -> runOnUiThread { progress.dismiss(); requestApkInstall(apk) } }
                .onFailure { error -> runOnUiThread { progress.dismiss(); showMessage("下载更新失败", error.message ?: "未知错误") } }
        }.start()
    }

    private fun requestApkInstall(apk: File) {
        pendingUpdateApk = apk
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            @Suppress("DEPRECATION")
            startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")), REQUEST_INSTALL_UPDATE_PERMISSION)
            return
        }
        openApkInstaller(apk)
    }

    private fun openApkInstaller(apk: File) {
        pendingUpdateApk = null
        runCatching {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apk)
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        }.onFailure { showMessage("无法打开系统安装器", it.message ?: "未知错误") }
    }

    private fun handleIncomingIntent(incoming: Intent) {
        if (incoming.action == StudentPortableMigrationService.ACTION) {
            val pending = PendingStudentMigration(
                baseUrl = incoming.getStringExtra("baseUrl").orEmpty(),
                bearerToken = incoming.getStringExtra("bearerToken").orEmpty(),
                studentId = incoming.getStringExtra("studentId").orEmpty(),
                sessionId = incoming.getStringExtra("sessionId").orEmpty(),
                downloadUrl = incoming.getStringExtra("downloadUrl").orEmpty(),
                sha256 = incoming.getStringExtra("sha256").orEmpty(),
                bytes = incoming.getLongExtra("bytes", 0L),
            )
            if (pending.baseUrl.isBlank() || pending.bearerToken.isBlank() || pending.studentId.isBlank() || pending.downloadUrl.isBlank()) {
                showMessage("无法开始升级", "学生端传入的迁移会话不完整，请返回学生端重新发起。")
                return
            }
            pendingStudentMigration = pending
            AlertDialog.Builder(this)
                .setTitle("接管学生档案")
                .setMessage("即将从 Windows 主机下载固定快照。请选择一个空目录保存该学生的完整单机档案；原学生 ID 将继续保留。")
                .setNegativeButton("取消") { _, _ -> pendingStudentMigration = null }
                .setPositiveButton("选择空目录") { _, _ -> startTreePicker(REQUEST_STUDENT_MIGRATION_ROOT) }
                .show()
            return
        }
        handleIncomingConversationShare(incoming)
    }

    private fun importPendingStudentMigration(targetRoot: Uri) {
        val pending = pendingStudentMigration ?: return
        pendingStudentMigration = null
        val progress = showProgress("正在迁移", "正在下载、校验并写入学生档案。资料较多时请保持本应用在前台。")
        Thread {
            runCatching { StudentPortableMigrationService(this).import(pending, targetRoot) }
                .onSuccess { result -> runOnUiThread {
                    progress.dismiss(); renderSection(AppSection.ARCHIVES)
                    showMessage("升级完成", "已接管 ${result.student.name}（ID：${result.student.id}）。\n迁移文件 ${result.files} 个，关联学习项目 ${result.projects} 个。")
                } }
                .onFailure { error -> runOnUiThread { progress.dismiss(); showMessage("升级失败", error.message ?: "未知错误") } }
        }.start()
    }

    private fun createStudent(input: StudentInput) {
        val rootUri = rootGrant.currentRootUri()
        if (rootUri == null) {
            showMessage("尚未选择根目录", "请先选择新建档案的资料根目录。")
            return
        }
        runCatching {
            workspaceService.createStandard(input.name, input.grade, input.school, input.goal, rootUri)
        }.onSuccess {
            refreshStudents()
            showMessage("新建完成", "已为 ${it.name} 建立学生知识库、原始资料库和学情分析汇总。")
        }.onFailure { showMessage("新建失败", it.message ?: "未知错误") }
    }

    private fun showAdoptionConfirmation(input: StudentInput, rootUri: Uri) {
        runCatching { workspaceService.scanAdopted(input.name, rootUri) }
            .onSuccess { scan ->
                val present = listOf(
                    "AGENT.md" to scan.agentMd,
                    "原始资料库" to scan.rawDir,
                    "学情分析汇总" to scan.summaryDir,
                    "输出结果" to scan.outputDir,
                    "index.md" to scan.indexMd,
                    "log.md" to scan.logMd,
                ).joinToString("\n") { (label, exists) -> "${if (exists) "✓" else "将补齐"} $label" }
                AlertDialog.Builder(this)
                    .setTitle("确认接管已有目录")
                    .setMessage("系统只会补齐缺失目录和文件，不覆盖已有 AGENT.md、index.md、log.md。\n\n$present")
                    .setNegativeButton("取消", null)
                    .setPositiveButton("确认接管") { _, _ -> adoptStudent(input, rootUri) }
                    .show()
            }
            .onFailure { showMessage("扫描失败", it.message ?: "未知错误") }
    }

    private fun adoptStudent(input: StudentInput, rootUri: Uri) {
        runCatching {
            workspaceService.adoptExisting(input.name, input.grade, input.school, input.goal, rootUri)
        }.onSuccess { (student, _) ->
            refreshStudents()
            showMessage("接管完成", "已有目录已绑定到学生 ${student.name}；原有文件未被覆盖。")
        }.onFailure { showMessage("接管失败", it.message ?: "未知错误") }
    }

    private fun showStudentInputDialog(title: String, onSubmit: (StudentInput) -> Unit) {
        val fields = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 12, 40, 0)
        }
        fun field(hintText: String) = EditText(this).apply {
            hint = hintText
            fields.addView(this, matchWrap())
        }
        val name = field("学生姓名（必填）")
        val grade = field("年级")
        val school = field("学校")
        val goal = field("学习目标")
        val dialog = AlertDialog.Builder(this)
            .setTitle(title)
            .setView(fields)
            .setNegativeButton("取消", null)
            .setPositiveButton("继续", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (name.text.toString().isBlank()) {
                    name.error = "请填写学生姓名"
                    return@setOnClickListener
                }
                dialog.dismiss()
                onSubmit(StudentInput(name.text.toString(), grade.text.toString(), school.text.toString(), goal.text.toString()))
            }
        }
        dialog.show()
    }

    private fun refreshStudents() {
        if (!::studentList.isInitialized) return
        studentList.removeAllViews()
        val students = workspaceService.listStudents()
        if (students.isEmpty()) {
            studentList.addView(TextView(this).apply { text = "尚未建立学生档案。" }, matchWrap())
            return
        }
        students.forEach { student ->
            val engineState = runCatching { workspaceService.knowledgeEngine(student.id).health() }.getOrNull()
            val counts = engineState?.optJSONObject("counts")
            val materials = runCatching { fileAssetService.materials(student.id) }.getOrDefault(emptyList())
            val assetCount = runCatching { fileAssetService.assets(student.id).size }.getOrDefault(0)
            studentList.addView(TextView(this).apply {
                text = "${student.name} · ${if (student.knowledgeBaseMode == "adopted") "接管目录" else "本机新建"}\n${student.grade.ifBlank { "未填写年级" }}\n资料 ${materials.size} · 文件资产 $assetCount · 待消化 ${materials.count { it.optString("status") == "pending_digest" }}\nKnowledgeEngine：${if (engineState?.optBoolean("ok") == true) "正常" else "待检查"} · 来源 ${counts?.optInt("sources") ?: 0} · 声明 ${counts?.optInt("claims") ?: 0}\nID: ${student.id}"
                textSize = 15f
                setTextColor(palette.text)
                setPadding(24, 20, 24, 20)
                setBackgroundColor(palette.card)
                isClickable = true
                isFocusable = true
                setOnClickListener { openStudentArchive(student) }
            }, matchWrap())
        }
    }

    private fun openStudentArchive(student: StudentRecord) {
        startActivity(Intent(this, MarkdownBrowserActivity::class.java)
            .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_ARCHIVE)
            .putExtra(MarkdownBrowserActivity.EXTRA_STUDENT_ID, student.id)
            .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, "${student.name} · 教育档案"))
    }

    private fun updateRootStatus() {
        if (::rootStatus.isInitialized) rootStatus.text = rootGrant.currentRootUri()?.let { "新建档案根目录已授权：$it" }
            ?: "尚未选择新建档案的资料根目录。应用只访问你明确授权的目录。"
    }

    private fun startTreePicker(requestCode: Int) {
        @Suppress("DEPRECATION")
        startActivityForResult(rootGrant.createPickerIntent(), requestCode)
    }

    private fun chooseImportStudent() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) {
            showMessage("没有学生档案", "请先新建或接管学生档案库。")
            return
        }
        AlertDialog.Builder(this).setTitle("资料归属学生")
            .setItems(students.map { it.name }.toTypedArray()) { _, index ->
                pendingImportStudentId = students[index].id
                showLocalImportSource()
            }.show()
    }

    private fun showLocalImportSource() {
        AlertDialog.Builder(this).setTitle("本机导入方式")
            .setItems(arrayOf("选择本机文件", "拍照导入")) { _, which ->
                if (which == 0) {
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"; putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    @Suppress("DEPRECATION")
                    startActivityForResult(intent, REQUEST_IMPORT_FILES)
                } else startCameraImport()
            }.setNegativeButton("取消") { _, _ -> pendingImportStudentId = null }.show()
    }

    private fun startCameraImport() {
        val folder = File(cacheDir, "camera-import").apply { mkdirs() }
        val target = File(folder, "photo-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", target)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (intent.resolveActivity(packageManager) == null) {
            pendingImportStudentId = null; showMessage("无法拍照", "本机没有可用的相机应用。"); return
        }
        pendingCameraFile = target; pendingCameraUri = uri
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQUEST_CAPTURE_PHOTO)
    }

    private fun importCapturedPhoto() {
        val studentId = pendingImportStudentId; val uri = pendingCameraUri; val file = pendingCameraFile
        pendingImportStudentId = null; pendingCameraUri = null; pendingCameraFile = null
        if (studentId == null || uri == null || file == null || !file.exists() || file.length() == 0L) {
            file?.delete(); showMessage("拍照导入失败", "没有取得有效照片，请重试。"); return
        }
        runCatching { fileAssetService.importToStudent(studentId, uri, "Android 拍照导入") }
            .onSuccess { file.delete(); refreshStudents(); showMessage("拍照导入完成", "照片已保存到所选学生的原始资料库，并进入待消化队列。") }
            .onFailure { file.delete(); showMessage("拍照导入失败", it.message ?: "未知错误") }
    }

    private fun importSelectedFiles(data: Intent) {
        val studentId = pendingImportStudentId ?: return
        pendingImportStudentId = null
        val uris = buildList {
            data.clipData?.let { clip -> for (index in 0 until clip.itemCount) add(clip.getItemAt(index).uri) }
            if (isEmpty()) data.data?.let(::add)
        }.distinct()
        var imported = 0
        val failures = mutableListOf<String>()
        uris.forEach { uri ->
            runCatching { fileAssetService.importToStudent(studentId, uri) }
                .onSuccess { imported += 1 }
                .onFailure { failures += (it.message ?: uri.toString()) }
        }
        refreshStudents()
        showMessage("资料导入结果", "成功导入 $imported 份；失败 ${failures.size} 份。${if (failures.isEmpty()) "" else "\n${failures.take(3).joinToString("\n")}"}")
    }

    private fun chooseStudentForAssets() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先新建或接管学生档案库。") ; return }
        AlertDialog.Builder(this).setTitle("查看文件资产").setItems(students.map { it.name }.toTypedArray()) { _, index -> showStudentAssets(students[index]) }.show()
    }

    private fun showStudentAssets(student: StudentRecord) {
        val materials = fileAssetService.materials(student.id).filter { it.optString("status") != "removed" }
        val indexed = fileAssetService.assets(student.id)
        if (materials.isEmpty()) { showMessage("${student.name} · 文件资产中心", "当前没有已收集资料。可从本机导入或连续屏幕采集。") ; return }
        val labels = materials.map { item ->
            val asset = indexed.firstOrNull { it.optString("sha1") == item.optString("sha1") }
            "${item.optString("fileName")}\n${item.optString("status")} · ${item.optLong("size")} 字节${if (asset == null) " · 待补建资产索引" else " · 已索引"}"
        }
        AlertDialog.Builder(this).setTitle("${student.name} · 文件资产中心（${materials.size}）").setItems(labels.toTypedArray()) { _, which ->
            val item = materials[which]
            val builder = AlertDialog.Builder(this).setTitle(item.optString("fileName"))
                .setMessage("状态：${item.optString("status")}\n路径：${item.optString("absolutePath")}\nSHA-1：${item.optString("sha1")}\n来源：${item.optString("sourceName")}")
                .setNegativeButton("关闭", null)
            if (item.optString("ocrStatus") == "completed" && item.optString("ocrMarkdownPath").isNotBlank()) {
                builder.setPositiveButton("查看 OCR 结果") { _, _ -> openOcrResult(student.id, item.optString("id")) }
            }
            builder.show()
        }.setPositiveButton("完成", null).show()
    }

    private fun startGeneralScreenCapture() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "连续屏幕采集必须绑定一个明确学生。") ; return }
        AlertDialog.Builder(this).setTitle("屏幕资料归属学生").setItems(students.map { it.name }.toTypedArray()) { _, studentIndex ->
            val student = students[studentIndex]
            val projects = projectService.listProjects().filter { student.id in it.studentIds }
            val choices = listOf("不关联学习项目") + projects.map { it.name }
            AlertDialog.Builder(this).setTitle("关联学习项目（可选）").setItems(choices.toTypedArray()) { _, projectIndex ->
                val project = projects.getOrNull(projectIndex - 1)
                startActivity(Intent(this, ScreenCaptureActivity::class.java)
                    .putExtra(ScreenCaptureActivity.EXTRA_STUDENT_ID, student.id)
                    .putExtra(ScreenCaptureActivity.EXTRA_PROJECT_ID, project?.id.orEmpty())
                    .putExtra(ScreenCaptureActivity.EXTRA_PROJECT_NAME, project?.name.orEmpty()))
            }.show()
        }.show()
    }

    private fun showProjectInputDialog(adoptKnowledge: Boolean) {
        val root = rootGrant.currentRootUri()
        if (root == null) {
            showMessage("尚未选择根目录", "请先选择新建档案的资料根目录；学习项目控制目录也会建立在该授权根目录内。")
            return
        }
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 12, 40, 0) }
        fun field(hintText: String) = EditText(this).apply { hint = hintText; fields.addView(this, matchWrap()) }
        val name = field("项目名称（必填）"); val type = field("项目类型（默认：学习项目）")
        val description = field("项目说明"); val objective = field("项目目标")
        val dialog = AlertDialog.Builder(this).setTitle(if (adoptKnowledge) "接管已有项目知识库" else "新建学习项目")
            .setView(fields).setNegativeButton("取消", null).setPositiveButton("选择参与学生", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (name.text.toString().isBlank()) { name.error = "请填写项目名称"; return@setOnClickListener }
                dialog.dismiss()
                chooseProjectStudents(ProjectInput(name.text.toString(), type.text.toString(), description.text.toString(), objective.text.toString(), emptyList()), adoptKnowledge)
            }
        }
        dialog.show()
    }

    private fun chooseProjectStudents(input: ProjectInput, adoptKnowledge: Boolean) {
        val students = workspaceService.listStudents()
        val checked = BooleanArray(students.size)
        AlertDialog.Builder(this).setTitle("绑定参与学生（可多选）")
            .setMultiChoiceItems(students.map { it.name }.toTypedArray(), checked) { _, which, value -> checked[which] = value }
            .setNegativeButton("取消", null)
            .setPositiveButton("继续") { _, _ ->
                val completed = input.copy(studentIds = students.indices.filter { checked[it] }.map { students[it].id })
                if (adoptKnowledge) {
                    pendingProjectAdoption = completed
                    startTreePicker(REQUEST_ADOPTED_PROJECT_KNOWLEDGE)
                } else createManagedProject(completed)
            }.show()
    }

    private fun createManagedProject(input: ProjectInput) {
        val root = requireNotNull(rootGrant.currentRootUri())
        runCatching { projectService.createManaged(input.name, input.type, input.description, input.objective, input.studentIds, root) }
            .onSuccess { refreshProjects(); showMessage("项目已创建", "已建立 ${it.name} 的工作空间、研究暂存层和 LLM Wiki 项目知识空间。") }
            .onFailure { showMessage("项目创建失败", it.message ?: "未知错误") }
    }

    private fun confirmProjectKnowledgeAdoption(input: ProjectInput, knowledgeUri: Uri) {
        runCatching { projectService.scanAdoptedKnowledge(knowledgeUri) }.onSuccess { scan ->
            if (!scan.ok) { showMessage("不能接管", "缺少统一项目知识 Schema：${scan.missing.joinToString()}"); return@onSuccess }
            AlertDialog.Builder(this).setTitle("确认接管项目知识库")
                .setMessage("已识别项目原始资料库、概念库、实体库、摘要库、问答精华库和综合汇总库。\n\n接管只建立路径映射和控制记录，不修改原知识库文件。${if (scan.warnings.isEmpty()) "" else "\n\n提醒：${scan.warnings.joinToString("；")}"}")
                .setNegativeButton("取消", null).setPositiveButton("确认接管") { _, _ -> adoptProject(input, knowledgeUri) }.show()
        }.onFailure { showMessage("扫描失败", it.message ?: "未知错误") }
    }

    private fun adoptProject(input: ProjectInput, knowledgeUri: Uri) {
        val controlRoot = requireNotNull(rootGrant.currentRootUri())
        runCatching { projectService.adoptKnowledge(input.name, input.type, input.description, input.objective, input.studentIds, controlRoot, knowledgeUri) }
            .onSuccess { (project, _) -> refreshProjects(); showMessage("接管完成", "${project.name} 已绑定该项目知识库，原有文件未被修改。") }
            .onFailure { showMessage("接管失败", it.message ?: "未知错误") }
    }

    private fun refreshProjects() {
        if (!::projectList.isInitialized) return
        projectList.removeAllViews()
        val projects = projectService.listProjects()
        if (projects.isEmpty()) { projectList.addView(TextView(this).apply { text = "尚未建立学习项目。" }, matchWrap()); return }
        projects.forEach { project ->
            projectList.addView(TextView(this).apply {
                text = "${project.name} · ${if (project.knowledgeMode == "adopted") "接管知识库" else "本机知识库"}\n参与学生：${project.studentNames.joinToString().ifBlank { "未绑定" }}\n工作空间：${project.workspaceMode} · 状态：${project.status}\nID: ${project.id}"
                textSize = 15f; setTextColor(palette.text); setPadding(24, 20, 24, 20); setBackgroundColor(palette.card)
                isClickable = true; isFocusable = true; setOnClickListener { openProjectKnowledge(project) }
            }, matchWrap())
        }
    }

    private fun openProjectKnowledge(project: ProjectRecord) {
        startActivity(Intent(this, MarkdownBrowserActivity::class.java)
            .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_PROJECT)
            .putExtra(MarkdownBrowserActivity.EXTRA_PROJECT_ID, project.id)
            .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, "${project.name} · 项目知识"))
    }

    private fun showAgentConfigurationDialog() {
        val existing = runCatching { AgentConfigurationStore(this).load() }.getOrNull()
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 12, 40, 0) }
        fun field(hintText: String) = EditText(this).apply { hint = hintText; fields.addView(this, matchWrap()) }
        val endpoint = field("接口基地址或完整 chat/completions 地址").apply { setText(existing?.endpoint.orEmpty()) }
        val model = field("文本模型名称").apply { setText(existing?.model.orEmpty()) }
        val visionModel = field("视觉模型名称（可选；必须支持图片输入）").apply { setText(existing?.visionModel.orEmpty()) }
        val key = field(if (existing == null) "API Key" else "新 API Key（留空保持原密钥）").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        AlertDialog.Builder(this).setTitle("配置教育管家 Agent").setView(fields).setNegativeButton("取消", null)
            .setPositiveButton("安全保存") { _, _ ->
                runCatching { AgentConfigurationStore(this).saveOrUpdate(endpoint.text.toString(), model.text.toString(), key.text.toString(), visionModel.text.toString()) }
                    .onSuccess { key.text?.clear(); updateAgentStatus(); showMessage("配置完成", "凭据已使用 Android Keystore 加密保存。") }
                    .onFailure { key.text?.clear(); showMessage("配置失败", it.message ?: "未知错误") }
            }.show()
    }

    private fun updateAgentStatus() {
        if (::agentStatus.isInitialized) agentStatus.text = runCatching { AgentConfigurationStore(this).summary() }.getOrElse { "Agent 配置需要重新保存" }
    }

    private fun testAgentConfiguration() {
        val config = runCatching { AgentConfigurationStore(this).load() }.getOrNull()
        if (config == null) { showMessage("尚未配置", "请先配置本地任务 Agent。") ; return }
        val progress = showProgress("正在测试 Agent", "只发送最小连接测试，不读取或上传学生资料。")
        Thread {
            val result = runCatching { OpenAiCompatibleAgentAdapter(config).testConnection() }
            runOnUiThread { progress.dismiss(); result.onSuccess { showMessage("连接测试通过", "服务 ${URI(config.endpoint).host} · ${config.model} 已返回响应。") }.onFailure { showMessage("连接测试失败", it.message ?: "未知错误") } }
        }.start()
    }

    private fun confirmClearAgentConfiguration() {
        if (AgentConfigurationStore(this).load() == null) { showMessage("无需停用", "当前没有已保存的 Agent 配置。") ; return }
        AlertDialog.Builder(this).setTitle("停用本地任务 Agent？").setMessage("将删除本机加密保存的 API Key、接口和模型配置；学生档案与任务记录不会删除。")
            .setNegativeButton("取消", null).setPositiveButton("确认停用") { _, _ ->
                runCatching { AgentConfigurationStore(this).clear() }.onSuccess { updateAgentStatus(); showMessage("已停用", "Agent 配置和本机加密密钥已删除。") }
                    .onFailure { showMessage("停用失败", it.message ?: "未知错误") }
            }.show()
    }

    private fun showSkinDialog() {
        val values = UiSkin.entries
        AlertDialog.Builder(this).setTitle("界面皮肤").setSingleChoiceItems(values.map { it.label }.toTypedArray(), values.indexOf(uiPreferences.skin())) { dialog, which ->
            uiPreferences.setSkin(values[which]); dialog.dismiss(); recreate()
        }.setNegativeButton("取消", null).show()
    }

    private fun showLayoutDialog() {
        val values = UiLayoutMode.entries
        AlertDialog.Builder(this).setTitle("页面布局").setSingleChoiceItems(values.map { it.label }.toTypedArray(), values.indexOf(uiPreferences.layoutMode())) { dialog, which ->
            uiPreferences.setLayoutMode(values[which]); dialog.dismiss(); uiPreferences.applyOrientation(this); recreate()
        }.setNegativeButton("取消", null).show()
    }

    private fun openPalmClaw() = openAgentTool("palmclaw")

    private fun openMobileClaw() = openAgentTool("mobileclaw")

    private fun openDoubao() = openAgentTool("doubao")

    private fun openChatGpt() = openAgentTool("chatgpt")

    private fun agentToolDefinitions() = listOf(
        AgentToolDefinition(
            id = "palmclaw",
            displayName = "PalmClaw",
            description = "本机 Agent 运行及受控 OCR、视觉和文件工具能力。",
            packages = listOf("com.palmclaw", "com.modalitydance.palmclaw", "com.palmclaw.app", "ai.palmclaw.android"),
            officialDownloadUrl = "https://github.com/ModalityDance/PalmClaw/releases/latest",
            allowedDownloadHost = "github.com",
        ),
        AgentToolDefinition(
            id = "mobileclaw",
            displayName = "MobileClaw",
            description = "Android 端自主 Agent 工具，可作为独立问答和设备任务入口。",
            packages = listOf("ai.affiora.mobileclaw"),
            officialDownloadUrl = "https://mobileclaw.cc/",
            allowedDownloadHost = "mobileclaw.cc",
        ),
        AgentToolDefinition(
            id = "doubao",
            displayName = "豆包",
            description = "豆包官方客户端，可直接拉起进行问答。",
            packages = listOf("com.larus.nova", "com.bytedance.doubao"),
            officialDownloadUrl = "https://www.doubao.com/download/",
            allowedDownloadHost = "www.doubao.com",
        ),
        AgentToolDefinition(
            id = "chatgpt",
            displayName = "ChatGPT / Codex",
            description = "OpenAI 官方 Android 客户端；Codex 移动能力通过 ChatGPT 提供。",
            packages = listOf("com.openai.chatgpt"),
            officialDownloadUrl = "https://play.google.com/store/apps/details?id=com.openai.chatgpt",
            allowedDownloadHost = "play.google.com",
        ),
    )

    private fun installedAgentPackage(tool: AgentToolDefinition): String? =
        tool.packages.firstOrNull { packageManager.getLaunchIntentForPackage(it) != null }

    private fun showAgentToolAdapter() {
        val tools = agentToolDefinitions()
        val installedCount = tools.count { installedAgentPackage(it) != null }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(8), dp(18), dp(8))
            addView(TextView(this@MainActivity).apply {
                text = "已安装 $installedCount / ${tools.size}。检测只判断本机是否存在可启动的正式应用，不读取账号、聊天记录或其他 App 的私有数据。"
                textSize = 14f
                setTextColor(palette.muted)
                setPadding(0, 0, 0, dp(12))
            }, matchWrap())
        }
        tools.forEach { tool ->
            val installedPackage = installedAgentPackage(tool)
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
                setBackgroundColor(withAlpha(palette.card, 244))
            }
            card.addView(TextView(this).apply {
                text = tool.displayName
                textSize = 18f
                setTextColor(palette.accentDark)
            }, matchWrap())
            card.addView(TextView(this).apply {
                text = if (installedPackage == null) "未安装" else "已安装 · $installedPackage"
                textSize = 14f
                setTextColor(if (installedPackage == null) Color.rgb(178, 78, 50) else Color.rgb(30, 126, 72))
                setPadding(0, dp(3), 0, dp(3))
            }, matchWrap())
            card.addView(TextView(this).apply {
                text = tool.description
                textSize = 13f
                setTextColor(palette.muted)
            }, matchWrap())
            card.addView(themedButton(if (installedPackage == null) "官方下载" else "打开应用") {
                if (installedPackage == null) openOfficialAgentDownload(tool) else launchAgentTool(tool)
            }, matchWrap())
            content.addView(card, matchWrap().apply { setMargins(0, 0, 0, dp(10)) })
        }
        val scroll = ScrollView(this).apply { addView(content) }
        AlertDialog.Builder(this)
            .setTitle("Agent 工具适配")
            .setView(scroll)
            .setNegativeButton("完成", null)
            .setPositiveButton("重新检查") { _, _ -> sectionContent.post { showAgentToolAdapter() } }
            .show()
    }

    private fun openAgentTool(id: String) {
        val tool = agentToolDefinitions().firstOrNull { it.id == id } ?: return
        if (installedAgentPackage(tool) != null) {
            launchAgentTool(tool)
        } else {
            AlertDialog.Builder(this)
                .setTitle("未检测到 ${tool.displayName}")
                .setMessage("本机没有检测到可直接启动的 ${tool.displayName}。可以前往官方入口安装，安装后回到系统设置重新检查。")
                .setNegativeButton("取消", null)
                .setPositiveButton("官方下载") { _, _ -> openOfficialAgentDownload(tool) }
                .show()
        }
    }

    private fun launchAgentTool(tool: AgentToolDefinition) {
        val intent = tool.packages.firstNotNullOfOrNull { packageManager.getLaunchIntentForPackage(it) }
        if (intent == null) {
            showMessage("无法打开 ${tool.displayName}", "应用可能已被卸载或停用，请重新检查安装状态。")
            return
        }
        runCatching { startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { showMessage("无法打开 ${tool.displayName}", it.message ?: "系统没有可用的启动入口") }
    }

    private fun openOfficialAgentDownload(tool: AgentToolDefinition) {
        val uri = Uri.parse(tool.officialDownloadUrl)
        if (uri.scheme != "https" || !uri.host.equals(tool.allowedDownloadHost, ignoreCase = true)) {
            showMessage("下载地址无效", "为安全起见，只允许打开预置的 ${tool.displayName} 官方 HTTPS 地址。")
            return
        }
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            .onFailure { showMessage("无法打开官方下载页", it.message ?: "本机没有可用的浏览器或应用市场") }
    }

    private fun showConversationImportMenu() {
        AlertDialog.Builder(this).setTitle("导入智能体对话历史")
            .setMessage("只保存你主动粘贴、选择或从 Agent 分享的当前对话；不会读取 PalmClaw、豆包的私有聊天数据库。")
            .setItems(arrayOf("粘贴对话文字", "导入 .md / .txt / .json 文件")) { _, which ->
                chooseConversationSourceAgent { agent -> if (which == 0) showConversationPaste(agent) else chooseConversationFileTarget(agent) }
            }.setNegativeButton("取消", null).show()
    }

    private fun chooseConversationSourceAgent(onSelected: (String) -> Unit) {
        val agents = arrayOf("PalmClaw", "豆包", "MobileClaw", "其他Agent")
        AlertDialog.Builder(this).setTitle("对话来源").setItems(agents) { _, which -> onSelected(agents[which]) }.setNegativeButton("取消", null).show()
    }

    private fun showConversationPaste(sourceAgent: String) {
        val input = EditText(this).apply {
            hint = "粘贴当前或明确选中的对话内容"; minLines = 9; maxLines = 18; gravity = Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        }
        val dialog = AlertDialog.Builder(this).setTitle("粘贴 $sourceAgent 对话").setView(input).setNegativeButton("取消", null)
            .setPositiveButton("选择保存位置", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val content = input.text.toString()
                if (content.isBlank()) { input.error = "对话历史不能为空"; return@setOnClickListener }
                dialog.dismiss(); chooseConversationTarget(sourceAgent, content, "manual-paste")
            }
        }
        dialog.show()
    }

    private fun chooseConversationTarget(sourceAgent: String, content: String, sourcePath: String) {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先新建或接管学生档案，再保存对话历史。"); return }
        AlertDialog.Builder(this).setTitle("对话归属学生").setItems(students.map { it.name }.toTypedArray()) { _, studentIndex ->
            val student = students[studentIndex]
            val linked = projectService.listProjects().filter { student.id in it.studentIds && it.status == "active" }
            val targets = listOf("${student.name} · 学生对话历史") + linked.map { "${it.name} · 项目原始资料库" }
            AlertDialog.Builder(this).setTitle("保存到哪里").setItems(targets.toTypedArray()) { _, targetIndex ->
                saveConversation(student.id, linked.getOrNull(targetIndex - 1)?.id.orEmpty(), sourceAgent, content, sourcePath)
            }.setNegativeButton("取消", null).show()
        }.setNegativeButton("取消", null).show()
    }

    private fun saveConversation(studentId: String, projectId: String, sourceAgent: String, content: String, sourcePath: String) {
        val progress = showProgress("正在保存对话", "正在生成不可变原文、内容哈希和归属记录。")
        Thread {
            val result = runCatching { conversationImportService.save(studentId, projectId, sourceAgent, content, sourcePath) }
            runOnUiThread { progress.dismiss(); result.onSuccess { showMessage("对话历史已保存", it.optString("message")) }.onFailure { showMessage("保存失败", it.message ?: "未知错误") } }
        }.start()
    }

    private fun chooseConversationFileTarget(sourceAgent: String) {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先新建或接管学生档案，再导入对话历史。"); return }
        AlertDialog.Builder(this).setTitle("对话归属学生").setItems(students.map { it.name }.toTypedArray()) { _, studentIndex ->
            val student = students[studentIndex]
            val linked = projectService.listProjects().filter { student.id in it.studentIds && it.status == "active" }
            val targets = listOf("${student.name} · 学生对话历史") + linked.map { "${it.name} · 项目原始资料库" }
            AlertDialog.Builder(this).setTitle("保存到哪里").setItems(targets.toTypedArray()) { _, targetIndex ->
                pendingConversationStudentId = student.id; pendingConversationProjectId = linked.getOrNull(targetIndex - 1)?.id.orEmpty(); pendingConversationAgent = sourceAgent
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"; putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/plain", "text/markdown", "application/json")); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, REQUEST_CONVERSATION_FILE)
            }.show()
        }.show()
    }

    private fun importConversationFile(uri: Uri) {
        val studentId = pendingConversationStudentId ?: return
        val projectId = pendingConversationProjectId.orEmpty(); val agent = pendingConversationAgent
        pendingConversationStudentId = null; pendingConversationProjectId = null; pendingConversationAgent = "其他Agent"
        val progress = showProgress("正在读取对话文件", "最多读取 5 MB 的 .md、.txt 或 .json 对话文本。")
        Thread {
            val result = runCatching {
                val bytes = contentResolver.openInputStream(uri)?.use { stream ->
                    val data = stream.readBytes(); require(data.size <= 5 * 1024 * 1024) { "对话文件不能超过 5 MB" }; data
                } ?: error("无法读取所选文件")
                conversationImportService.save(studentId, projectId, agent, bytes.toString(Charsets.UTF_8), uri.toString())
            }
            runOnUiThread { progress.dismiss(); result.onSuccess { showMessage("对话文件已导入", it.optString("message")) }.onFailure { showMessage("导入失败", it.message ?: "未知错误") } }
        }.start()
    }

    @Suppress("DEPRECATION")
    private fun handleIncomingConversationShare(sharedIntent: Intent) {
        if (sharedIntent.action != Intent.ACTION_SEND) return
        sharedIntent.action = Intent.ACTION_MAIN
        val sharedText = sharedIntent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
        if (sharedText.isNotBlank()) {
            chooseConversationSourceAgent { chooseConversationTarget(it, sharedText, "android-share") }
            return
        }
        val stream = sharedIntent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: return
        val progress = showProgress("正在接收共享对话", "只读取你刚刚从 Agent 明确分享的这个文件。")
        Thread {
            val result = runCatching {
                contentResolver.openInputStream(stream)?.use { input -> val bytes = input.readBytes(); require(bytes.size <= 5 * 1024 * 1024) { "共享对话不能超过 5 MB" }; bytes.toString(Charsets.UTF_8) }
                    ?: error("无法读取共享对话")
            }
            runOnUiThread { progress.dismiss(); result.onSuccess { content -> chooseConversationSourceAgent { agent -> chooseConversationTarget(agent, content, stream.toString()) } }.onFailure { showMessage("接收失败", it.message ?: "未知错误") } }
        }.start()
    }

    private fun showSavedConversations() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "当前没有可查看的学生范围。"); return }
        AlertDialog.Builder(this).setTitle("管理学生对话历史").setItems(students.map { it.name }.toTypedArray()) { _, which ->
            val student = students[which]; val records = conversationImportService.list(student.id)
            if (records.isEmpty()) { showMessage("没有对话历史", "${student.name} 当前没有主动保存的 Agent 对话。"); return@setItems }
            AlertDialog.Builder(this).setTitle("${student.name} · 已保存对话（${records.size}）")
                .setItems(records.map { "${it.optString("sourceAgent")} · ${conversationDigestStatusLabel(it.optString("digestStatus"))}\n${it.optString("projectName").ifBlank { "${student.name} · 学生档案" }} · ${it.optInt("messageCount")} 条消息" }.toTypedArray()) { _, index ->
                    showConversationActions(student, records[index])
                }.show()
        }.show()
    }

    private fun showConversationActions(student: StudentRecord, item: org.json.JSONObject) {
        val status = item.optString("digestStatus", "pending")
        val actions = mutableListOf("浏览对话原文")
        actions += when (status) {
            "completed" -> "查看消化结果"
            "running" -> "查看消化状态"
            "failed" -> "重新进入消化流程"
            else -> "进入消化流程"
        }
        actions += if (status in setOf("running", "completed")) "删除说明" else "删除对话"
        val scopeName = item.optString("projectName").ifBlank { "${student.name} · 学生档案" }
        val details = buildString {
            append("来源：${item.optString("sourceAgent")}\n归属：$scopeName\n状态：${conversationDigestStatusLabel(status)}\n")
            append("导入：${item.optString("importedAt")}\n消息定位：${item.optInt("messageCount")} 条\nSHA-256：${item.optString("contentHash")}")
            if (status == "failed" && item.optString("digestError").isNotBlank()) append("\n失败原因：${item.optString("digestError")}")
        }
        AlertDialog.Builder(this).setTitle("对话历史").setMessage(details).setItems(actions.toTypedArray()) { _, which ->
            when (which) {
                0 -> openConversationDocument(item.getString("recordId"), digest = false)
                1 -> when (status) {
                    "completed" -> openConversationDocument(item.getString("recordId"), digest = true)
                    "running" -> showMessage("消化处理中", "当前任务尚未结束，暂时不能重复启动或删除。")
                    else -> confirmConversationDigest(item)
                }
                2 -> if (status in setOf("running", "completed")) {
                    val message = if (status == "running") "对话正在消化，需等待任务结束后再处理。" else "该原文已作为候选知识证据使用。为保证学情结论可追溯，当前版本不允许直接删除已消化原文。"
                    showMessage("不能直接删除", message)
                } else confirmConversationDelete(item)
            }
        }.setNegativeButton("关闭", null).show()
    }

    private fun conversationDigestStatusLabel(status: String): String = when (status) {
        "running" -> "处理中"
        "completed" -> "已消化"
        "failed" -> "处理失败"
        else -> "未消化"
    }

    private fun openConversationDocument(recordId: String, digest: Boolean) {
        startActivity(Intent(this, MarkdownBrowserActivity::class.java)
            .putExtra(MarkdownBrowserActivity.EXTRA_MODE, if (digest) MarkdownBrowserActivity.MODE_CONVERSATION_DIGEST else MarkdownBrowserActivity.MODE_CONVERSATION)
            .putExtra(MarkdownBrowserActivity.EXTRA_CONVERSATION_ID, recordId)
            .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, if (digest) "对话消化结果" else "对话历史原文"))
    }

    private fun confirmConversationDigest(item: org.json.JSONObject) {
        val scope = item.optString("projectName").ifBlank { item.optString("studentName") }
        AlertDialog.Builder(this).setTitle("进入消化流程")
            .setMessage("将按 $scope 的 AGENT.md 处理这份对话。学生档案只生成有原文证据的候选声明；学习项目只写入项目知识库，不直接覆盖学生主档案。")
            .setNegativeButton("取消", null)
            .setPositiveButton("开始消化") { _, _ -> runConversationDigest(item.getString("recordId")) }
            .show()
    }

    private fun runConversationDigest(recordId: String) {
        val progress = showProgress("正在消化对话", "正在读取归属范围的 AGENT.md，并生成可审核的候选知识。")
        Thread {
            val result = runCatching { ConversationDigestService(this).digest(recordId) }
            runOnUiThread {
                progress.dismiss()
                result.onSuccess {
                    AlertDialog.Builder(this).setTitle("对话消化完成")
                        .setMessage("结果已写入对应的学生档案或学习项目，原始对话继续作为不可变证据保留。")
                        .setNegativeButton("关闭", null)
                        .setPositiveButton("查看消化结果") { _, _ -> openConversationDocument(recordId, digest = true) }
                        .show()
                }.onFailure { showMessage("对话消化失败", it.message ?: "未知错误") }
            }
        }.start()
    }

    private fun confirmConversationDelete(item: org.json.JSONObject) {
        AlertDialog.Builder(this).setTitle("删除对话")
            .setMessage("将永久删除对话原文和元数据，无法恢复；系统只保留不含原文的 SHA-256 删除审计。是否继续？")
            .setNegativeButton("取消", null)
            .setPositiveButton("永久删除") { _, _ ->
                runCatching { conversationImportService.delete(item.getString("recordId")) }
                    .onSuccess { showMessage("已删除对话", "原文和元数据已删除，仅保留不含原文的哈希审计记录。") }
                    .onFailure { showMessage("删除失败", it.message ?: "未知错误") }
            }.show()
    }

    private fun chooseStudentForDigest() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先建立学生档案。"); return }
        AlertDialog.Builder(this).setTitle("选择要消化资料的学生").setItems(students.map { it.name }.toTypedArray()) { _, index ->
            val student = students[index]
            val progress = showProgress("任务正在进行", "正在为 ${student.name} 消化待处理的文本资料；完成后会自动校验任务结果。")
            Thread {
                val result = runCatching { StudentDigestOrchestrator(this).digestPending(student.id) }
                runOnUiThread {
                    progress.dismiss()
                    result.onSuccess { refreshStudents(); showMessage("资料消化完成", "已处理 ${it.optInt("processed")} 份资料，知识声明保持候选状态。") }
                        .onFailure { refreshStudents(); showMessage("资料消化失败", it.message ?: "未知错误") }
                }
            }.start()
        }.show()
    }

    private fun chooseMaterialForOcr() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先建立学生档案。"); return }
        AlertDialog.Builder(this).setTitle("选择资料所属学生").setItems(students.map { it.name }.toTypedArray()) { _, studentIndex ->
            val student = students[studentIndex]
            val materials = fileAssetService.materials(student.id).filter { it.optString("status") != "removed" }
            if (materials.isEmpty()) { showMessage("没有可解析资料", "请先导入图片或 PDF。"); return@setItems }
            AlertDialog.Builder(this).setTitle("选择要解析的资料").setItems(materials.map { it.optString("fileName") }.toTypedArray()) { _, materialIndex ->
                val material = materials[materialIndex]
                AlertDialog.Builder(this).setTitle("解析方式").setMessage("OCR 在设备本地运行；视觉理解会把压缩后的预览页发送给已配置的视觉模型。")
                    .setNegativeButton("仅本地 OCR") { _, _ -> runOcr(student, material, false) }
                    .setPositiveButton("OCR + 视觉理解") { _, _ -> runOcr(student, material, true) }.show()
            }.show()
        }.show()
    }

    private fun runOcr(student: StudentRecord, material: org.json.JSONObject, includeVision: Boolean) {
        val progress = showProgress("正在解析资料", "正在处理 ${material.optString("fileName")}。")
        Thread {
            val result = runCatching { OcrVisionService(this).extract(student.id, material.getString("id"), includeVision) }
            runOnUiThread {
                progress.dismiss()
                result.onSuccess {
                    refreshStudents()
                    val parsed = it.getJSONObject("result")
                    val visionUnavailable = parsed.optString("visionStatus") == "unavailable"
                    val title = if (visionUnavailable) "本地 OCR 已完成" else "解析完成"
                    val message = if (visionUnavailable) {
                        "已识别 ${parsed.optInt("pageCount")} 页并保留结果；当前文本模型不接受图片。请在 Agent 配置中另填支持图片输入的视觉模型后重试视觉理解。"
                    } else "已识别 ${parsed.optInt("pageCount")} 页，结果保持候选状态。"
                    AlertDialog.Builder(this).setTitle(title).setMessage(message)
                        .setNegativeButton("稍后查看", null)
                        .setPositiveButton("查看识别结果") { _, _ -> openOcrResult(student.id, material.getString("id")) }
                        .show()
                }
                    .onFailure { refreshStudents(); showMessage("解析失败", it.message ?: "未知错误") }
            }
        }.start()
    }

    private fun chooseOcrResult() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先建立学生档案。"); return }
        AlertDialog.Builder(this).setTitle("选择学生").setItems(students.map { it.name }.toTypedArray()) { _, index ->
            val student = students[index]
            val results = fileAssetService.materials(student.id).filter { it.optString("ocrStatus") == "completed" && it.optString("ocrMarkdownPath").isNotBlank() }
            if (results.isEmpty()) { showMessage("没有 OCR 结果", "${student.name} 当前没有已完成的本地 OCR 结果。"); return@setItems }
            AlertDialog.Builder(this).setTitle("${student.name} · OCR 结果").setItems(results.map { it.optString("fileName") }.toTypedArray()) { _, which ->
                openOcrResult(student.id, results[which].optString("id"))
            }.show()
        }.show()
    }

    private fun openOcrResult(studentId: String, materialId: String) {
        startActivity(Intent(this, MarkdownBrowserActivity::class.java)
            .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_OCR)
            .putExtra(MarkdownBrowserActivity.EXTRA_STUDENT_ID, studentId)
            .putExtra(MarkdownBrowserActivity.EXTRA_MATERIAL_ID, materialId)
            .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, "OCR 识别结果"))
    }

    private fun chooseGrowthStudent() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先建立学生档案。"); return }
        AlertDialog.Builder(this).setTitle("选择学生").setItems(students.map { it.name }.toTypedArray()) { _, index -> showGrowthActions(students[index]) }.show()
    }

    private fun showGrowthActions(student: StudentRecord) {
        val actions = arrayOf("查看成长模型摘要", "添加成长证据候选", "审核成长证据", "重建成长模型索引")
        AlertDialog.Builder(this).setTitle("${student.name} · 成长模型").setItems(actions) { _, which -> when (which) {
            0 -> showGrowthSummary(student)
            1 -> showGrowthCandidateDialog(student)
            2 -> reviewGrowthCandidate(student)
            3 -> runCatching { GrowthModelService(this).rebuildIndex(student.id) }.onSuccess { showMessage("索引已重建", "成长模型结构化索引已更新。") }.onFailure { showMessage("重建失败", it.message ?: "未知错误") }
        } }.show()
    }

    private fun showGrowthSummary(student: StudentRecord) {
        runCatching { GrowthModelService(this).rebuildIndex(student.id).getJSONObject("summary") }
            .onSuccess { summary -> showMessage("${student.name} · 成长模型", "成长证据：${summary.optInt("evidenceCount")}\n已确认：${summary.optInt("confirmedCount")}\n待审核：${summary.optInt("pendingCount")}\n继续观察：${summary.optInt("watchingCount")}\n能力维度：${summary.optInt("abilityCount")}\n关联项目：${summary.optInt("projectCount")}") }
            .onFailure { showMessage("成长模型不可用", it.message ?: "未知错误") }
    }

    private fun chooseReportStudent() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先建立学生档案。") ; return }
        AlertDialog.Builder(this).setTitle("选择学情报告学生").setItems(students.map { it.name }.toTypedArray()) { _, index -> showReports(students[index]) }.show()
    }

    private fun showReports(student: StudentRecord) {
        val definitions = GrowthModelService.REPORTS
        AlertDialog.Builder(this).setTitle("${student.name} · 学情报告").setItems(definitions.map { it.title }.toTypedArray()) { _, index ->
            val definition = definitions[index]
            runCatching { GrowthModelService(this).readPublishedReport(student.id, definition.id) }
                .onSuccess {
                    startActivity(Intent(this, MarkdownBrowserActivity::class.java)
                        .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_REPORT)
                        .putExtra(MarkdownBrowserActivity.EXTRA_STUDENT_ID, student.id)
                        .putExtra(MarkdownBrowserActivity.EXTRA_REPORT_ID, definition.id)
                        .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, definition.title))
                }.onFailure { showMessage("报告读取失败", it.message ?: "未知错误") }
        }.show()
    }

    private fun chooseStudentForReportDrafts() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先建立学生档案。") ; return }
        AlertDialog.Builder(this).setTitle("选择生成报告的学生").setItems(students.map { it.name }.toTypedArray()) { _, index -> generateReportDrafts(students[index]) }.show()
    }

    private fun showGrowthCandidateDialog(student: StudentRecord) {
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 12, 40, 0) }
        fun field(hintText: String) = EditText(this).apply { hint = hintText; fields.addView(this, matchWrap()) }
        val title = field("证据标题（必填）"); val ability = field("支撑能力"); val source = field("来源 URI/文件标识（必填）"); val content = field("观察内容")
        AlertDialog.Builder(this).setTitle("添加成长证据候选").setView(fields).setNegativeButton("取消", null).setPositiveButton("保存为待审核") { _, _ ->
            runCatching { GrowthModelService(this).addCandidate(student.id, title.text.toString(), ability.text.toString(), source.text.toString(), content.text.toString()) }
                .onSuccess { showMessage("候选已保存", "该证据仍为 pending，不会直接进入正式画像或报告。") }.onFailure { showMessage("保存失败", it.message ?: "未知错误") }
        }.show()
    }

    private fun reviewGrowthCandidate(student: StudentRecord) {
        val service = GrowthModelService(this); val candidates = service.candidates(student.id).filter { it.optString("status") in setOf("pending", "watching") }
        if (candidates.isEmpty()) { showMessage("没有待审核候选", "当前没有 pending 或 watching 成长证据。"); return }
        AlertDialog.Builder(this).setTitle("选择成长证据").setItems(candidates.map { "${it.optString("title")} · ${it.optString("status")}" }.toTypedArray()) { _, index ->
            val item = candidates[index]
            AlertDialog.Builder(this).setTitle(item.optString("title")).setMessage("来源：${item.optString("sourceUri")}\n能力：${item.optString("ability")}\n\n${item.optString("content")}")
                .setNegativeButton("驳回") { _, _ -> reviewGrowth(student, item, "rejected") }
                .setNeutralButton("继续观察") { _, _ -> reviewGrowth(student, item, "watching") }
                .setPositiveButton("确认采用") { _, _ -> reviewGrowth(student, item, "confirmed") }.show()
        }.show()
    }

    private fun reviewGrowth(student: StudentRecord, item: org.json.JSONObject, status: String) {
        runCatching { GrowthModelService(this).reviewCandidate(student.id, item.getString("id"), status, "本机用户逐条审核") }
            .onSuccess { showMessage("审核已记录", "证据状态已更新为 $status，并保留 reviewerRole/reviewerId 审计字段。") }.onFailure { showMessage("审核失败", it.message ?: "未知错误") }
    }

    private fun generateReportDrafts(student: StudentRecord) {
        val progress = showProgress("正在生成草稿", "正式报告不会被自动覆盖；草稿完成后会再次请求发布确认。")
        Thread {
            val result = runCatching { GrowthModelService(this).generateReportDrafts(student.id) }
            runOnUiThread {
                progress.dismiss()
                result.onSuccess {
                    AlertDialog.Builder(this).setTitle("四份报告草稿已生成").setMessage("请确认是否将草稿发布为正式的整体画像、历史变化、每周行动建议（文件名保持每日行动建议.md）和阶段总结。")
                        .setNegativeButton("暂不发布", null).setPositiveButton("确认发布") { _, _ ->
                            runCatching { GrowthModelService(this).publishReportDrafts(student.id) }.onSuccess { published -> showMessage("报告已发布", published.getString("message")) }
                                .onFailure { error -> showMessage("发布失败", error.message ?: "未知错误") }
                        }.show()
                }.onFailure { showMessage("草稿生成失败", it.message ?: "未知错误") }
            }
        }.start()
    }

    private fun startPlatformCourseImport() {
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "application/octet-stream"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/zip", "application/octet-stream", "application/x-zip-compressed"))
        }, REQUEST_PLATFORM_COURSE_PACKAGE)
    }

    private fun importPlatformCoursePackage(uri: Uri) {
        val progress = showProgress("正在校验课程包", "只会接受 Windows 平台发布合同中的 course-package v3 和 platform_standard 课程。")
        Thread {
            val result = runCatching { courseCatalogService.importPlatformPackage(uri) }
            runOnUiThread {
                progress.dismiss()
                result.onSuccess { showMessage("课程目录已更新", "版本 ${it.getString("catalogVersion")}，共 ${it.getInt("courseCount")} 门平台课程。最后可用目录已安全保留。") }
                    .onFailure { showMessage("课程包未采用", "${it.message ?: "校验失败"}\n\n原有最后可用课程目录未被替换。") }
            }
        }.start()
    }

    private fun chooseStudentForCourses() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) { showMessage("没有学生档案", "请先建立学生档案。课程学习与采集必须绑定一个明确学生。") ; return }
        val courses = runCatching { courseCatalogService.effectiveCourses() }.getOrElse { showMessage("课程目录不可用", it.message ?: "未知错误"); return }
        if (courses.isEmpty()) { showMessage("没有可学习课程", "请先导入平台发放的 .edu-coursepkg；家庭版不提供课程编辑或机构课程管理。") ; return }
        AlertDialog.Builder(this).setTitle("选择课程学习学生").setItems(students.map { it.name }.toTypedArray()) { _, index -> showPlatformCourses(students[index], courses) }.show()
    }

    private fun showPlatformCourses(student: StudentRecord, courses: List<PlatformCourse>) {
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(16)) }
        courses.forEach { course ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(12), dp(12), dp(12)); setBackgroundColor(palette.card)
                isClickable = true; isFocusable = true; setOnClickListener { showCourseActions(student, course) }
            }
            val coverBox = FrameLayout(this).apply { setBackgroundColor(palette.accentSoft) }
            val cover = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; contentDescription = "${course.name} 课程图片" }
            val bitmap = runCatching { courseCatalogService.coverBytes(course).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()
            if (bitmap != null) cover.setImageBitmap(bitmap)
            coverBox.addView(cover, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            if (bitmap == null) coverBox.addView(TextView(this).apply { text = "封面未载入\n请重新导入课程包"; gravity = Gravity.CENTER; setTextColor(palette.muted); textSize = 13f }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            card.addView(coverBox, LinearLayout.LayoutParams(dp(180), dp(112)))
            val details = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), 0, 0, 0) }
            details.addView(TextView(this).apply { text = course.name; textSize = 19f; setTextColor(palette.accentDark) }, matchWrap())
            details.addView(TextView(this).apply { text = course.summary; textSize = 14f; setTextColor(palette.text); maxLines = 4; setPadding(0, dp(5), 0, dp(5)) }, matchWrap())
            details.addView(TextView(this).apply { text = "${course.provider} · 点击查看学习选项"; textSize = 13f; setTextColor(palette.muted) }, matchWrap())
            card.addView(details, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            list.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, 0, dp(12)) })
        }
        val scroll = ScrollView(this).apply { addView(list) }
        AlertDialog.Builder(this).setTitle("${student.name} · 平台课程（${courses.size}）").setView(scroll).setPositiveButton("关闭", null).show()
    }

    private fun showCourseActions(student: StudentRecord, course: PlatformCourse) {
        AlertDialog.Builder(this).setTitle(course.name).setMessage("${course.summary}\n\n提供方：${course.provider}\n课程学习页不会获得文件、位置、摄像头或麦克风权限。")
            .setNegativeButton("取消", null)
            .setNeutralButton("仅学习") { _, _ -> openCourse(student, course, false) }
            .setPositiveButton("学习并启动采集") { _, _ -> openCourse(student, course, true) }
            .show()
    }

    private fun openCourse(student: StudentRecord, course: PlatformCourse, autoStartCapture: Boolean) {
        startActivity(Intent(this, CourseLearningActivity::class.java)
            .putExtra(CourseLearningActivity.EXTRA_STUDENT_ID, student.id)
            .putExtra(CourseLearningActivity.EXTRA_COURSE_JSON, course.toJson().toString())
            .putExtra(CourseLearningActivity.EXTRA_AUTO_START_CAPTURE, autoStartCapture))
    }

    private fun passwordFields(): Pair<LinearLayout, Pair<EditText, EditText>> {
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 12, 40, 0) }
        val first = EditText(this).apply { hint = "至少 8 个字符"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val second = EditText(this).apply { hint = "再次输入密码"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        layout.addView(first, matchWrap()); layout.addView(second, matchWrap()); return layout to (first to second)
    }

    private fun promptBackupPassword() {
        val (layout, fields) = passwordFields()
        AlertDialog.Builder(this).setTitle("设置迁移备份密码").setMessage("密码不会写入备份、日志或设置。Agent API Key、Android Keystore 密钥和录屏授权不会进入备份。")
            .setView(layout).setNegativeButton("取消", null).setPositiveButton("选择保存位置") { _, _ ->
                val first = fields.first.text.toString(); val second = fields.second.text.toString()
                if (first.length < 8 || first != second) { showMessage("密码不符合要求", "请使用至少 8 个字符，并确保两次输入一致。") ; return@setPositiveButton }
                pendingBackupPassword?.fill('\u0000'); pendingBackupPassword = first.toCharArray()
                AlertDialog.Builder(this).setTitle("请选择独立保存位置")
                    .setMessage("迁移包不能保存在正在备份的资料根目录内。请保存到下载目录、U 盘或其他独立位置。")
                    .setNegativeButton("取消") { _, _ -> pendingBackupPassword?.fill('\u0000'); pendingBackupPassword = null }
                    .setPositiveButton("选择位置") { _, _ ->
                        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "application/zip"; putExtra(Intent.EXTRA_TITLE, "AI教育管家迁移包-${System.currentTimeMillis()}.edu-migration.zip") }, REQUEST_BACKUP_DESTINATION)
                    }.show()
            }.show()
    }

    private fun exportBackup(uri: Uri) {
        val password = pendingBackupPassword ?: return; pendingBackupPassword = null
        val progress = showProgress("备份正在进行", "正在加密并逐文件校验，请保持应用前台，完成前不要修改资料目录。")
        Thread {
            val result = runCatching { BackupRestoreService(this).exportPackage(uri, password) }
            runOnUiThread { progress.dismiss(); result.onSuccess { showMessage("备份完成", "迁移 ID：${it.getString("migrationId")}\n文件：${it.getInt("fileCount")} 个\n原始容量：${it.getLong("totalBytes")} 字节") }.onFailure { showMessage("备份失败", it.message ?: "未知错误") } }
        }.start()
    }

    private fun startRestorePackagePicker() {
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "application/zip"; putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/zip", "application/octet-stream")) }, REQUEST_RESTORE_PACKAGE)
    }

    private fun promptRestorePassword(packageUri: Uri) {
        val field = EditText(this).apply { hint = "备份密码"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        AlertDialog.Builder(this).setTitle("输入迁移备份密码").setMessage("下一步必须选择一个空目录。全部载荷、密码和哈希在写入目标目录前完成验证。")
            .setView(field).setNegativeButton("取消", null).setPositiveButton("选择空目录") { _, _ ->
                val value = field.text.toString(); if (value.length < 8) { showMessage("密码不符合要求", "备份密码至少为 8 个字符。") ; return@setPositiveButton }
                clearRestoreSecrets(); pendingRestorePackage = packageUri; pendingRestorePassword = value.toCharArray(); startTreePicker(REQUEST_RESTORE_ROOT)
            }.show()
    }

    private fun restoreBackup(targetRoot: Uri) {
        val packageUri = pendingRestorePackage ?: return; val password = pendingRestorePassword ?: return
        pendingRestorePackage = null; pendingRestorePassword = null
        val progress = showProgress("正在验证并恢复", "只接受空目标目录；旧设备 URI 将重映射，Agent 密钥需要恢复后重新配置。")
        Thread {
            val result = runCatching { BackupRestoreService(this).restorePackage(packageUri, targetRoot, password) }
            runOnUiThread {
                progress.dismiss()
                result.onSuccess { rootGrant.setDefaultRoot(targetRoot); updateRootStatus(); refreshStudents(); refreshProjects(); updateAgentStatus(); showMessage("恢复完成", "迁移 ID：${it.getString("migrationId")}\n已恢复 ${it.getInt("fileCount")} 个文件。请重新配置 Agent API Key。") }
                    .onFailure { showMessage("恢复失败", "${it.message ?: "未知错误"}\n目标目录未作为默认资料根目录启用。") }
            }
        }.start()
    }

    private fun clearRestoreSecrets() { pendingRestorePassword?.fill('\u0000'); pendingRestorePassword = null; pendingRestorePackage = null }

    private fun showMessage(title: String, message: String) {
        AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("知道了", null).show()
    }

    private fun showProgress(title: String, message: String): AlertDialog =
        AlertDialog.Builder(this).setTitle(title).setMessage(message).setCancelable(false).create().also { it.show() }

    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    private data class StudentInput(val name: String, val grade: String, val school: String, val goal: String)
    private data class ProjectInput(val name: String, val type: String, val description: String, val objective: String, val studentIds: List<String>)
    private data class AgentToolDefinition(
        val id: String,
        val displayName: String,
        val description: String,
        val packages: List<String>,
        val officialDownloadUrl: String,
        val allowedDownloadHost: String,
    )

    private companion object {
        const val STATE_SECTION = "active_section"
        const val REQUEST_WORKSPACE_ROOT = 2101
        const val REQUEST_ADOPTED_ROOT = 2102
        const val REQUEST_IMPORT_FILES = 2103
        const val REQUEST_CAPTURE_PHOTO = 2109
        const val REQUEST_ADOPTED_PROJECT_KNOWLEDGE = 2104
        const val REQUEST_PLATFORM_COURSE_PACKAGE = 2105
        const val REQUEST_BACKUP_DESTINATION = 2106
        const val REQUEST_RESTORE_PACKAGE = 2107
        const val REQUEST_RESTORE_ROOT = 2108
        const val REQUEST_CONVERSATION_FILE = 2110
        const val REQUEST_STUDENT_MIGRATION_ROOT = 2111
        const val REQUEST_INSTALL_UPDATE_PERMISSION = 2112
        const val REQUEST_LICENSE_QR_SCAN = 2113
        const val REQUEST_LICENSE_QR_IMAGE = 2114
    }

    private enum class AppSection(val label: String) {
        HOME("首页"),
        ARCHIVES("教育档案"), MATERIALS("资料收集与处理"), COURSES("课程中心"), ASSISTANT("AI助手问答"),
        GROWTH("成长模型"), REPORTS("学情报告"), PROJECTS("学习项目"), SETTINGS("系统设置")
    }
}
