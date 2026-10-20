package com.qxmatrix.edumanager.standalone

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import android.provider.MediaStore
import android.provider.Settings
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.io.File
import java.net.URI
import org.json.JSONObject

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
    private lateinit var sectionSubtitle: TextView
    private lateinit var headerStatusRow: LinearLayout
    private lateinit var currentStudentButton: Button
    private lateinit var portraitSectionButton: Button
    private val navigationButtons = linkedMapOf<AppSection, Button>()
    private var activeSection = AppSection.HOME
    private var auxiliaryIndexesValidated = false
    private var activeMaterialQueueFilter = MaterialQueueFilter.ALL
    private val legacyCourseReconciliationAttempted = mutableSetOf<String>()
    private lateinit var rootStatus: TextView
    private lateinit var studentList: GridLayout
    private lateinit var projectList: GridLayout
    private var wideLayout = false
    private lateinit var agentStatus: TextView
    private var pendingAdoption: StudentInput? = null
    private var pendingImportStudentId: String? = null
    private var pendingCameraUri: Uri? = null
    private var pendingCameraFile: File? = null
    private var pendingProjectAdoption: ProjectInput? = null
    private var pendingProjectRootMode: Boolean? = null
    private var pendingBackupPassword: CharArray? = null
    private var pendingRestorePassword: CharArray? = null
    private var pendingRestorePackage: Uri? = null
    private var pendingConversationStudentId: String? = null
    private var pendingConversationProjectId: String? = null
    private var pendingConversationAgent: String = "其他Agent"
    private var pendingStudentMigration: PendingStudentMigration? = null
    private var pendingOfflineMigrationSource: Uri? = null
    private var pendingDeviceMigrationSource: Uri? = null
    private var pendingUpdateApk: File? = null
    private var offlineMigrationLiveState: StudentOfflineMigrationState? = null
    private var offlineMigrationCard: LinearLayout? = null
    private var offlineMigrationTitle: TextView? = null
    private var offlineMigrationDetails: TextView? = null
    private var offlineMigrationCurrent: TextView? = null
    private var offlineMigrationProgress: ProgressBar? = null
    private var offlineMigrationContinueButton: Button? = null
    private var offlineMigrationStartButton: Button? = null
    private var offlineMigrationReceiverRegistered = false
    private var offlineMigrationCompletedRefreshId: String? = null
    private val offlineMigrationHandler = Handler(Looper.getMainLooper())
    private val offlineMigrationPoll = object : Runnable {
        override fun run() {
            if (offlineMigrationReceiverRegistered) {
                StudentOfflineMigrationJournal(this@MainActivity).latestProgress()?.let(::applyOfflineMigrationState)
                offlineMigrationHandler.postDelayed(this, OFFLINE_MIGRATION_POLL_MS)
            }
        }
    }
    private val offlineMigrationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val raw = intent?.getStringExtra(StudentOfflineMigrationService.EXTRA_STATE).orEmpty()
            runCatching { StudentOfflineMigrationState.fromJson(JSONObject(raw)) }.getOrNull()?.let(::applyOfflineMigrationState)
        }
    }

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
        val pendingRestore = runCatching { BusinessRestoreRecovery.pending(this) }
        if (pendingRestore.isFailure) {
            setContentView(TextView(this).apply { text = "恢复日志无法读取，已停止自动任务。请保留本机资料后检查。" }); return
        }
        if (pendingRestore.getOrDefault(false)) {
            setContentView(TextView(this).apply { text = "正在核对上次恢复操作，请稍候；不会删除用户原件。" })
            Thread {
                val result = runCatching { BusinessRestoreRecovery.recover(this) }
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    result.onSuccess { palette = uiPreferences.palette(); initializeBusinessShell(savedInstanceState) }
                        .onFailure { setContentView(TextView(this).apply { text = "恢复核对失败，已停止自动任务。${it.message.orEmpty()}" }) }
                }
            }.start()
            return
        }
        initializeBusinessShell(savedInstanceState)
    }

    private fun initializeBusinessShell(savedInstanceState: Bundle?) {
        if (!checkStudentIndex()) return
        if (!auxiliaryIndexesValidated) {
            setContentView(TextView(this).apply { text = "正在后台核对项目和资产索引…"; setPadding(dp(24), dp(24), dp(24), dp(24)) })
            Thread {
                val auxiliary = runCatching { ProjectRepository(this).list(); AssetIndexRepository(this).list() }
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    if (auxiliary.isSuccess) { auxiliaryIndexesValidated = true; initializeBusinessShell(savedInstanceState) }
                    else setContentView(TextView(this).apply { text = "项目或资产索引读取失败，已停止自动任务，不会按空列表覆盖。请保留原文件并从备份恢复。\n${auxiliary.exceptionOrNull()?.message.orEmpty()}"; setPadding(dp(24), dp(24), dp(24), dp(24)) })
                }
            }.start()
            return
        }
        runCatching { CloudReportSync(this).resumePendingWork() }
        runCatching { ProjectDigestQueue(this).resumePending() }
        runCatching { ProjectMaterialMaintenanceWorker.schedule(this) }
        runCatching { StudioAutomation.schedule(this) }
        Thread {
            runCatching { BusinessDatabase.get(this).ledger().recoverInterruptedCalls(BusinessDatabase.processSession) }
            runCatching { CollaborationRepository(this).initialize() }
        }.start()

        activeSection = savedInstanceState?.getString(STATE_SECTION)?.let { runCatching { AppSection.valueOf(it) }.getOrNull() } ?: AppSection.HOME
        setContentView(buildAppShell())
        renderSection(activeSection)
        if (savedInstanceState == null) sectionContent.post { handleIncomingIntent(intent) }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent); if (intent != null && licenseManager.status().active && checkStudentIndex()) { setIntent(intent); handleIncomingIntent(intent) }
    }

    private fun checkStudentIndex(): Boolean {
        return try { StudentIndexRepository(this).list(); true } catch (error: StudentIndexUnavailableException) {
            val content = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(24), dp(24), dp(24)); setBackgroundColor(palette.page)
                addView(TextView(this@MainActivity).apply {
                    text = "档案只读保护\n\n${error.message}\n\n原始资料未删除，损坏索引未被覆盖。请保留应用数据和原有资料目录；不要卸载应用或新建空索引。"
                    textSize = 18f; setTextColor(palette.text)
                }, matchWrap())
                addView(themedButton("重新读取档案") { recreate() }, matchWrap())
                addView(themedButton("预览上次有效索引") {
                    runCatching { StudentIndexRepository(this@MainActivity).recoveryPreview() }.onSuccess { records ->
                        if (records.isNullOrEmpty()) { showMessage("暂无可恢复快照", "保留原始资料和应用数据，等待受控备份恢复；不能用空索引覆盖。") }
                        else AlertDialog.Builder(this@MainActivity).setTitle("恢复前复核")
                            .setMessage("快照包含：${records.joinToString("、") { it.name }}。最近一次新增或修改可能不在快照中；原资料文件不变。确认后先保全损坏索引，再恢复此快照。")
                            .setNegativeButton("取消", null).setPositiveButton("恢复这个索引") { _, _ ->
                                runCatching { StudentIndexRepository(this@MainActivity).restoreCheckpoint() }
                                    .onSuccess { recreate() }.onFailure { showMessage("未恢复", it.message ?: "恢复失败，原数据保留。") }
                            }.show()
                    }.onFailure { showMessage("快照不可用", it.message ?: "快照读取失败，未覆盖档案。") }
                }, matchWrap())
            }
            setContentView(ScrollView(this).apply { addView(content) })
            false
        }
    }

    override fun onStart() {
        super.onStart()
        if (!licenseManager.status().active || !::sectionContent.isInitialized || offlineMigrationReceiverRegistered) return
        ContextCompat.registerReceiver(
            this, offlineMigrationReceiver, IntentFilter(StudentOfflineMigrationService.ACTION_PROGRESS), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        offlineMigrationReceiverRegistered = true
        offlineMigrationHandler.removeCallbacks(offlineMigrationPoll)
        offlineMigrationHandler.post(offlineMigrationPoll)
    }

    override fun onStop() {
        offlineMigrationHandler.removeCallbacks(offlineMigrationPoll)
        if (offlineMigrationReceiverRegistered) {
            unregisterReceiver(offlineMigrationReceiver)
            offlineMigrationReceiverRegistered = false
        }
        super.onStop()
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
            setBackgroundColor(palette.card)
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
                setTextColor(palette.heading)
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
            addView(themedButton("浏览与导出本机已有资料（不调用模型）") {
                val existing = runCatching { StudentIndexRepository(this@MainActivity).list() }
                existing.onFailure { statusText.text = "档案读取失败，原件保留：${it.message}" }.onSuccess { records ->
                    if (records.isEmpty()) { statusText.text = "本机暂无学生档案"; return@onSuccess }
                    AlertDialog.Builder(this@MainActivity).setTitle("选择已有学生").setItems(records.map { it.name }.toTypedArray()) { _, index ->
                        val student = records[index]
                        AlertDialog.Builder(this@MainActivity).setTitle("只读浏览与复制原件").setItems(arrayOf("原始资料", "知识与报告", "输出与导出文件")) { _, choice ->
                            val path = listOf(student.paths.rawPath, student.paths.summaryPath, student.paths.outputPath)[choice]
                            startActivity(Intent(this@MainActivity, RawMaterialBrowserActivity::class.java).putExtra(RawMaterialBrowserActivity.EXTRA_STUDENT_ID, student.id)
                                .putExtra(RawMaterialBrowserActivity.EXTRA_START_PATH, path).putExtra(RawMaterialBrowserActivity.EXTRA_TITLE, "${student.name} · 历史资料（只读）"))
                        }.show()
                    }.show()
                }
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
            addView(themedButton("激活并进入教育管家", YouthButtonRole.PRIMARY) {
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
        wideLayout = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE && resources.configuration.smallestScreenWidthDp >= 600
        val frame = FrameLayout(this).apply { setBackgroundColor(palette.page) }
        frame.addView(ImageView(this).apply {
            setImageResource(uiPreferences.skin().backgroundResource()); scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0.12f
            contentDescription = "${uiPreferences.skin().label}界面背景"
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val root = LinearLayout(this).apply { orientation = if (wideLayout) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL; setBackgroundColor(Color.TRANSPARENT) }
        currentStudentButton = themedButton("当前学生", YouthButtonRole.COMPACT) { showCurrentStudentPicker() }
        if (wideLayout) {
            root.addView(buildNavigation(), LinearLayout.LayoutParams(dp(navigationWidthDp()), ViewGroup.LayoutParams.MATCH_PARENT))
        } else {
            val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(8)); setBackgroundColor(withAlpha(palette.accentSoft, 244)) }
            portraitSectionButton = themedButton(activeSection.displayLabel, YouthButtonRole.COMPACT) { showSectionPicker() }
            top.addView(portraitSectionButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            top.addView(ImageView(this).apply {
                setImageResource(R.drawable.robogala_logo)
                imageTintList = ColorStateList.valueOf(Color.WHITE)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                contentDescription = "群星矩阵"
            }, LinearLayout.LayoutParams(dp(145), dp(58)))
            root.addView(top, matchWrap())
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val horizontal = if (wideLayout) 18 else 14
            setPadding(dp(horizontal), dp(16), dp(horizontal), dp(28))
            setBackgroundColor(withAlpha(palette.page, 236))
        }
        sectionTitle = TextView(this).apply {
            textSize = 28f
            setTextColor(palette.heading)
            typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
        }
        sectionSubtitle = TextView(this).apply {
            textSize = 14f
            setTextColor(palette.muted)
            setPadding(0, dp(4), 0, 0)
        }
        val headerCopy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(sectionTitle, matchWrap())
            addView(sectionSubtitle, matchWrap())
        }
        headerStatusRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        val headerTools = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
            if (!wideLayout) addView(currentStudentButton, matchWrap())
            addView(headerStatusRow, matchWrap().apply { if (!wideLayout) topMargin = dp(8) })
        }
        val pageHeader = LinearLayout(this).apply {
            orientation = if (wideLayout) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            addView(headerCopy, if (wideLayout) LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) else matchWrap())
            addView(headerTools, if (wideLayout) LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(16) } else matchWrap().apply { topMargin = dp(8) })
        }
        sectionContent = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        page.addView(pageHeader, matchWrap().apply { bottomMargin = dp(12) }); page.addView(sectionContent, matchWrap())
        val scroll = ScrollView(this).apply { addView(page) }
        root.addView(scroll, if (wideLayout) LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f) else LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        if (!wideLayout) {
            val core = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(palette.card) }
            listOf(AppSection.HOME to "首页", AppSection.MATERIALS to "资料", AppSection.GROWTH to "学习", AppSection.PROJECTS to "项目").forEach { (section, label) ->
                val button = themedButton(label, YouthButtonRole.COMPACT) { renderSection(section) }.apply { textSize = 14f; minHeight = dp(48) }
                navigationButtons[section] = button
                core.addView(button, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            }
            core.addView(themedButton("全部", YouthButtonRole.COMPACT) { showSectionPicker() }.apply { textSize = 14f; minHeight = dp(48) },
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            root.addView(core, matchWrap())
        }
        frame.addView(root, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return frame
    }

    private fun buildNavigation(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(16), dp(14), dp(18)); setBackgroundColor(withAlpha(palette.accentSoft, 244))
        addView(ImageView(this@MainActivity).apply {
            setImageResource(R.drawable.robogala_logo)
            imageTintList = ColorStateList.valueOf(Color.WHITE)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            contentDescription = "群星矩阵"
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(88)))
        addView(currentStudentButton, matchWrap().apply { bottomMargin = dp(10) })
        val menu = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
        businessSections().filterNot { it == AppSection.SETTINGS }.forEach { section ->
            val button = themedButton(section.displayLabel, YouthButtonRole.NAVIGATION) { renderSection(section) }
            navigationButtons[section] = button; menu.addView(button, matchWrap())
        }
        addView(ScrollView(this@MainActivity).apply { isFillViewport = true; addView(menu) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val settings = themedButton(AppSection.SETTINGS.displayLabel, YouthButtonRole.NAVIGATION) { renderSection(AppSection.SETTINGS) }
        navigationButtons[AppSection.SETTINGS] = settings
        addView(settings, matchWrap())
    }

    private fun showSectionPicker() {
        val sections = businessSections()
        AlertDialog.Builder(this).setTitle("八个业务域").setItems(sections.map { it.label }.toTypedArray()) { _, index -> renderSection(sections[index]) }
            .setPositiveButton("固定常用入口") { _, _ ->
                val choices = listOf(AppSection.PLANNING, AppSection.KNOWLEDGE, AppSection.COURSES, AppSection.SETTINGS)
                val prefs = getSharedPreferences(UI_CONTEXT_PREFS, MODE_PRIVATE)
                val pins = prefs.getStringSet("home_pins", emptySet()).orEmpty().toMutableSet()
                AlertDialog.Builder(this).setTitle("首页常用入口").setMultiChoiceItems(choices.map { it.label }.toTypedArray(), BooleanArray(choices.size) { choices[it].name in pins }) { _, i, checked -> if (checked) pins += choices[i].name else pins -= choices[i].name }
                    .setPositiveButton("保存") { _, _ -> prefs.edit().putStringSet("home_pins", pins).apply(); renderSection(AppSection.HOME) }.setNegativeButton("取消", null).show()
            }.show()
    }
    private fun businessSections() = listOf(AppSection.HOME, AppSection.MATERIALS, AppSection.GROWTH, AppSection.PROJECTS, AppSection.PLANNING, AppSection.KNOWLEDGE, AppSection.COURSES, AppSection.SETTINGS)

    private fun navigationWidthDp(): Int = when {
        resources.configuration.screenWidthDp >= 1280 -> 220
        resources.configuration.screenWidthDp >= 960 -> 200
        else -> 184
    }

    private fun actionGridColumns(preferred: Int = 3): Int {
        if (!wideLayout) return 1
        val available = resources.configuration.screenWidthDp - navigationWidthDp() - 36
        return when {
            preferred >= 3 && available >= 900 -> 3
            available >= 620 -> 2
            else -> 1
        }
    }

    private fun selectedStudent(): StudentRecord? {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) return null
        val preferences = getSharedPreferences(UI_CONTEXT_PREFS, MODE_PRIVATE)
        val selectedId = preferences.getString(KEY_CURRENT_STUDENT_ID, "").orEmpty()
        return students.firstOrNull { it.id == selectedId } ?: students.first().also {
            preferences.edit().putString(KEY_CURRENT_STUDENT_ID, it.id).apply()
        }
    }

    private fun updateCurrentStudentButton() {
        if (!::currentStudentButton.isInitialized) return
        val student = selectedStudent()
        currentStudentButton.text = if (student == null) "🚀  先建立学生档案" else "🚀  ${student.name}的学习舱\n单机本地 · 已激活"
        currentStudentButton.contentDescription = if (student == null) "建立学生档案" else "当前学生是${student.name}，点击切换"
    }

    private fun rememberCurrentStudent(student: StudentRecord) {
        getSharedPreferences(UI_CONTEXT_PREFS, MODE_PRIVATE).edit().putString(KEY_CURRENT_STUDENT_ID, student.id).apply()
        updateCurrentStudentButton()
    }

    private fun showCurrentStudentPicker() {
        val students = workspaceService.listStudents()
        if (students.isEmpty()) {
            AlertDialog.Builder(this).setTitle("还没有学生档案")
                .setMessage("先建立或接管一份学生档案，之后导入、课程、成长模型和报告都会自动使用当前学生。")
                .setNegativeButton("稍后", null)
                .setPositiveButton("去建立档案") { _, _ -> renderSection(AppSection.ARCHIVES) }
                .show()
            return
        }
        val selected = selectedStudent()
        AlertDialog.Builder(this).setTitle("切换当前学生")
            .setSingleChoiceItems(students.map { "${it.name} · ${it.grade.ifBlank { "未填写年级" }}" }.toTypedArray(), students.indexOfFirst { it.id == selected?.id }) { dialog, which ->
                rememberCurrentStudent(students[which])
                dialog.dismiss()
                renderSection(activeSection)
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun withCurrentStudent(emptyMessage: String = "请先建立或接管学生档案。", action: (StudentRecord) -> Unit) {
        val student = selectedStudent()
        if (student == null) showMessage("没有学生档案", emptyMessage) else action(student)
    }

    private fun renderSection(section: AppSection, materialFilter: MaterialQueueFilter? = null) {
        if (!checkStudentIndex()) return
        if (section == AppSection.MATERIALS) activeMaterialQueueFilter = materialFilter ?: MaterialQueueFilter.ALL
        activeSection = section; sectionTitle.text = section.label; sectionContent.removeAllViews(); clearOfflineMigrationViews()
        configureSectionHeader(defaultSectionSubtitle(section))
        if (::portraitSectionButton.isInitialized) portraitSectionButton.text = section.displayLabel
        updateCurrentStudentButton()
        navigationButtons.forEach { (item, button) ->
            YouthUi.applyButton(button, palette, if (item == section) YouthButtonRole.NAVIGATION_ACTIVE else YouthButtonRole.NAVIGATION)
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
            AppSection.PLANNING -> renderPlanning()
            AppSection.KNOWLEDGE -> renderKnowledgeDomain()
            AppSection.SETTINGS -> renderSettings()
        }
    }

    private fun defaultSectionSubtitle(section: AppSection): String = when (section) {
        AppSection.HOME -> "查看今天的资料进度和推荐操作"
        AppSection.ARCHIVES -> "管理当前学生的独立教育档案"
        AppSection.MATERIALS -> "选择一个方块，开始今天的资料整理"
        AppSection.COURSES -> "查看当前学生可以学习的课程"
        AppSection.ASSISTANT -> "打开学习助手并管理已保存对话"
        AppSection.GROWTH -> "查看有来源、可审核的成长证据"
        AppSection.REPORTS -> "阅读画像、变化与行动建议"
        AppSection.PROJECTS -> "管理当前学生参与的学习项目"
        AppSection.PLANNING -> "学习练习、选题和有来源的规划候选；不自动采用或报名"
        AppSection.KNOWLEDGE -> "当前学生的知识档案、对话与显式知识协作"
        AppSection.SETTINGS -> "调整界面、Agent、存储与设备设置"
    }

    private fun configureSectionHeader(subtitle: String, badges: List<String> = emptyList()) {
        sectionSubtitle.text = subtitle
        headerStatusRow.removeAllViews()
        badges.filter { it.isNotBlank() }.forEach { value ->
            headerStatusRow.addView(TextView(this).apply {
                text = value
                textSize = 13f
                setTextColor(palette.text)
                setPadding(dp(12), dp(7), dp(12), dp(7))
                YouthUi.applyBadge(this, palette, false)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
        }
    }

    private fun renderHome() {
        val students = workspaceService.listStudents()
        val current = selectedStudent()
        val queue = if (current == null) emptyList() else materialQueueItems(listOf(current))
        val pending = queue.count(::materialPending)
        val processing = queue.count(::materialProcessing)
        val needsHelp = queue.count(::materialNeedsHelp)
        val completedOcr = queue.count { it.material.optString("ocrStatus") == "completed" }
        val projects = projectService.listProjects().size
        sectionNote("从收集资料到形成档案，按卡片提示完成下一步；资料始终写入当前学生或明确选择的学习项目。")
        sectionContent.addView(TextView(this).apply {
            text = if (current == null) "还没有学生档案，请先建立或接管档案。" else "${current.name} · ${current.grade.ifBlank { "未填写年级" }}　资料 ${queue.size} · 待处理 $pending · 正在处理 $processing · 需补充 $needsHelp · 已完成识别 $completedOcr\n本机共有 ${students.size} 份学生档案 · $projects 个学习项目"
            textSize = 16f; setTextColor(palette.text); setPadding(dp(18), dp(16), dp(18), dp(16)); YouthUi.applyStatusCard(this, palette)
        }, matchWrap())
        sectionHeading("现在可以做什么")
        val pins = getSharedPreferences(UI_CONTEXT_PREFS, MODE_PRIVATE).getStringSet("home_pins", emptySet()).orEmpty()
        businessSections().filter { it.name in pins }.forEach { section -> sectionContent.addView(themedButton("常用 · ${section.label}", YouthButtonRole.COMPACT) { renderSection(section) }, matchWrap()) }
        sectionContent.addView(themedButton("当前学生 · 录音与独立音频转写", YouthButtonRole.COMPACT) {
            withCurrentStudent { startActivity(Intent(this, AudioIntakeActivity::class.java).putExtra("studentId", it.id)) }
        }, matchWrap())
        sectionContent.addView(themedButton("当前学生 · 统一搜索、学习卡片与规划候选", YouthButtonRole.COMPACT) {
            withCurrentStudent { startActivity(Intent(this, LearningStudioActivity::class.java).putExtra(LearningStudioActivity.EXTRA_STUDENT_ID, it.id)) }
        }, matchWrap())
        sectionContent.addView(themedButton("当前学生 · 任务中心", YouthButtonRole.COMPACT) {
            withCurrentStudent { startActivity(Intent(this, TaskCenterActivity::class.java).putExtra(TaskCenterActivity.EXTRA_STUDENT_ID, it.id)) }
        }, matchWrap())
        sectionContent.addView(themedButton("查看当前学生模型任务诊断", YouthButtonRole.COMPACT) {
            withCurrentStudent { showModelCallDiagnostics(it) }
        }, matchWrap())
        val actionable = queue.count(::materialActionRequired)
        addActionGrid(listOf(
            YouthAction("＋", "添加资料", "导入文件、拍照或连续采集屏幕", if (queue.isEmpty()) "从这里开始" else "继续添加") { renderSection(AppSection.MATERIALS) },
            YouthAction("▶", "处理中", if (actionable > 0) "查看正在处理或等待下一步的资料" else "当前没有待处理资料", if (actionable > 0) "$actionable 份" else "已清空") { renderSection(AppSection.MATERIALS, MaterialQueueFilter.ACTION_REQUIRED) },
            YouthAction("!", "需要补充", if (needsHelp > 0) "打开失败项并直接重试" else "当前没有需要补充的资料", if (needsHelp > 0) "$needsHelp 份" else "状态正常") { renderSection(AppSection.MATERIALS, MaterialQueueFilter.NEEDS_HELP) },
            YouthAction("▣", "知识更新", "查看教育档案和学习项目中的最新沉淀") { renderSection(AppSection.ARCHIVES) },
            YouthAction("↗", "成长变化", "查看有来源、可以审核的成长证据") { renderSection(AppSection.GROWTH) },
            YouthAction("☰", "报告与档案", "浏览学情报告、资料摘要与综合汇总") { renderSection(AppSection.REPORTS) },
        ))
    }

    private fun renderArchives() {
        sectionNote("新建或接管学生学情档案；每名学生继续使用独立的 Windows/LLM Wiki 目录与精确 ID。")
        rootStatus = statusCard(); sectionContent.addView(rootStatus, matchWrap()); updateRootStatus()
        val offlineMigration = offlineMigrationLiveState ?: StudentOfflineMigrationJournal(this).latestProgress()
        offlineMigrationLiveState = offlineMigration
        offlineMigration?.let(::addOfflineMigrationCard)
        offlineMigrationStartButton = themedButton(if (StudentOfflineMigrationService.isRunning()) "U盘迁移正在运行" else "从 U 盘迁移并接管", YouthButtonRole.PRIMARY) {
            startTreePicker(REQUEST_OFFLINE_MIGRATION_SOURCE)
        }.also { button ->
            button.isEnabled = !StudentOfflineMigrationService.isRunning()
            sectionContent.addView(button, matchWrap())
        }
        addActionGrid(listOf(
            YouthAction("⌂", "设置资料位置", "选择新建档案和学习项目的本机根目录") { startTreePicker(REQUEST_WORKSPACE_ROOT) },
            YouthAction("＋", "新建学生档案", "为一名学生建立独立的学习资料与知识空间") { showStudentInputDialog("新建学生档案库") { input -> createStudent(input) } },
            YouthAction("⇢", "接管已有档案", "连接已有 Windows/LLM Wiki 学情档案") { showStudentInputDialog("接管已有学生档案库") { input -> pendingAdoption = input; startTreePicker(REQUEST_ADOPTED_ROOT) } },
        ))
        sectionHeading("已有学情档案")
        studentList = GridLayout(this).apply { columnCount = actionGridColumns(3); alignmentMode = GridLayout.ALIGN_BOUNDS }
        sectionContent.addView(studentList, matchWrap().apply { setMargins(dp(-6), 0, dp(-6), 0) }); refreshStudents()
    }

    private fun addOfflineMigrationCard(state: StudentOfflineMigrationState) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setBackgroundColor(palette.card)
        }
        offlineMigrationTitle = TextView(this).apply { textSize = 17f; setTextColor(palette.heading) }
        offlineMigrationProgress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000 }
        offlineMigrationDetails = TextView(this).apply { textSize = 14f; setTextColor(palette.text); setPadding(0, dp(8), 0, 0) }
        offlineMigrationCurrent = TextView(this).apply { textSize = 13f; setTextColor(palette.muted); setPadding(0, dp(5), 0, 0) }
        offlineMigrationContinueButton = themedButton("继续上次 U 盘迁移") {
            offlineMigrationLiveState?.let { startOfflineMigration(Uri.parse(it.sourceUri), Uri.parse(it.targetUri)) }
        }
        card.addView(offlineMigrationTitle, matchWrap())
        card.addView(offlineMigrationProgress, matchWrap().apply { topMargin = dp(10) })
        card.addView(offlineMigrationDetails, matchWrap())
        card.addView(offlineMigrationCurrent, matchWrap())
        card.addView(offlineMigrationContinueButton, matchWrap())
        offlineMigrationCard = card
        sectionContent.addView(card, matchWrap().apply { bottomMargin = dp(10) })
        updateOfflineMigrationCard(state)
    }

    private fun applyOfflineMigrationState(state: StudentOfflineMigrationState) {
        offlineMigrationLiveState = state
        if (activeSection != AppSection.ARCHIVES || !::sectionContent.isInitialized) return
        if (offlineMigrationCard == null) {
            renderSection(AppSection.ARCHIVES)
            return
        }
        updateOfflineMigrationCard(state)
    }

    private fun updateOfflineMigrationCard(state: StudentOfflineMigrationState) {
        val liveBytes = (state.completedBytes + state.currentFileBytes).coerceAtMost(state.totalBytes)
        val progress = when {
            state.totalBytes > 0L -> ((liveBytes * 1000L) / state.totalBytes).toInt()
            state.totalFiles > 0 -> ((state.completedFiles.toLong() * 1000L) / state.totalFiles).toInt()
            else -> 0
        }
        val percent = progress / 10.0
        offlineMigrationTitle?.text = "U盘迁移 · ${offlineMigrationPhaseLabel(state.phase)}"
        offlineMigrationProgress?.isIndeterminate = state.totalFiles <= 0 && state.totalBytes <= 0L && state.phase !in setOf("completed", "failed")
        offlineMigrationProgress?.progress = progress
        val elapsed = if (state.startedAtEpochMs > 0L) formatElapsed(System.currentTimeMillis() - state.startedAtEpochMs) else "—"
        offlineMigrationDetails?.text = if (state.totalFiles > 0) {
            "${state.message}\n文件 ${state.completedFiles}/${state.totalFiles} · 容量 ${formatBytes(liveBytes)}/${formatBytes(state.totalBytes)} · ${"%.1f".format(percent)}% · 已用 $elapsed"
        } else "${state.message}\n正在建立迁移任务 · 已用 $elapsed"
        offlineMigrationCurrent?.text = when {
            state.current.isBlank() -> if (state.phase in setOf("completed", "failed")) "" else "请保持 U 盘连接，迁移可在后台继续运行。"
            state.currentFileTotalBytes > 0L -> "当前：${state.current}\n当前文件 ${formatBytes(state.currentFileBytes)}/${formatBytes(state.currentFileTotalBytes)}"
            else -> "当前：${state.current}"
        }
        val active = state.phase !in setOf("completed", "failed")
        val canResume = state.phase == "failed" || (active && !StudentOfflineMigrationService.isRunning())
        offlineMigrationContinueButton?.visibility = if (canResume) View.VISIBLE else View.GONE
        offlineMigrationStartButton?.apply {
            isEnabled = !StudentOfflineMigrationService.isRunning()
            text = if (StudentOfflineMigrationService.isRunning()) "U盘迁移正在运行" else "从 U 盘迁移并接管"
        }
        if (state.phase == "completed" && offlineMigrationCompletedRefreshId != state.migrationId) {
            offlineMigrationCompletedRefreshId = state.migrationId
            if (::studentList.isInitialized && studentList.parent != null) refreshStudents()
        }
    }

    private fun clearOfflineMigrationViews() {
        offlineMigrationCard = null; offlineMigrationTitle = null; offlineMigrationDetails = null
        offlineMigrationCurrent = null; offlineMigrationProgress = null; offlineMigrationContinueButton = null; offlineMigrationStartButton = null
    }

    private fun offlineMigrationPhaseLabel(phase: String): String = when (phase) {
        "preparing" -> "正在准备"
        "checking-license" -> "检查授权"
        "verifying" -> "检查迁移包"
        "copying" -> "复制并校验资料"
        "importing-student" -> "接管学生档案"
        "importing-projects" -> "接管学习项目"
        "importing-courses" -> "导入课程"
        "completing" -> "完成接管"
        "completed" -> "迁移完成"
        "failed" -> "迁移失败"
        else -> phase.ifBlank { "未知状态" }
    }

    private fun formatElapsed(milliseconds: Long): String {
        val seconds = milliseconds.coerceAtLeast(0L) / 1000L
        val hours = seconds / 3600L; val minutes = (seconds % 3600L) / 60L; val remainingSeconds = seconds % 60L
        return if (hours > 0L) "%d:%02d:%02d".format(hours, minutes, remainingSeconds) else "%02d:%02d".format(minutes, remainingSeconds)
    }

    private fun renderMaterials() {
        val queue = selectedStudent()?.let { materialQueueItems(listOf(it)) }.orEmpty()
        val needsHelp = queue.count(::materialNeedsHelp)
        val pending = queue.count(::materialPending)
        configureSectionHeader("选择一个方块，开始今天的资料整理", listOf("$pending 待处理", "$needsHelp 需补充"))
        addActionGrid(listOf(
            YouthAction("📁", "文件资产中心", "浏览全部原始资料和处理状态", "${queue.size} 份", tone = 0) { chooseStudentForAssets() },
            YouthAction("↑", "本机导入", "从平板、U盘选择学习资料", tone = 1) { chooseFileImport() },
            YouthAction("📷", "拍照采集", "拍摄作业、试卷和课堂笔记", tone = 2) { choosePhotoImport() },
            YouthAction("▣", "连续屏幕采集", "智能混合、画面变化或固定间隔", tone = 3) { startGeneralScreenCapture() },
            YouthAction("◎", "OCR / 视觉解析", "识别文字、图表和页面重点", if (needsHelp > 0) "$needsHelp 份需补充" else "可多选", tone = 4) { chooseMaterialsForOcr() },
            YouthAction("✦", "消化资料", "整理摘要并写入学生知识库", if (pending > 0) "$pending 份待处理" else "暂无待处理", tone = 5) { chooseMaterialsForDigest() },
            YouthAction("💬", "导入智能体对话", "保存 PalmClaw、豆包等对话历史", tone = 1) { showConversationImportMenu() },
            YouthAction("✓", "查看消化记录", "查看处理时间、资料和结果，可追溯每一步", tone = 0, spanColumns = 2) { chooseDigestHistoryStudent() },
        ))
        addActionGrid(listOf(
            YouthAction("⌂", "浏览原始资料", "按目录查看照片、文档和课程截图") { chooseStudentForRawBrowser() },
            YouthAction("▤", "查看识别结果", "浏览已经完成的 OCR 与视觉解析") { chooseOcrResult() },
        ), preferredColumns = 2, colorful = false)
        renderMaterialQueue()
        reconcileLegacyCourseCapturesIfNeeded()
    }

    private fun reconcileLegacyCourseCapturesIfNeeded() {
        val preferences = getSharedPreferences("material_workflow_repairs", MODE_PRIVATE)
        val students = workspaceService.listStudents().filter { student ->
            student.id !in legacyCourseReconciliationAttempted && !preferences.getBoolean("course-captures-v1:${student.id}", false)
        }
        if (students.isEmpty()) return
        legacyCourseReconciliationAttempted += students.map { it.id }
        Thread {
            var registered = 0
            val failures = mutableListOf<String>()
            students.forEach { student ->
                runCatching { fileAssetService.reconcileLegacyCourseCaptures(student.id) }
                    .onSuccess { result ->
                        registered += result.optInt("registered")
                        if (result.optInt("failed") == 0) preferences.edit().putBoolean("course-captures-v1:${student.id}", true).apply()
                        else failures += "${student.name}：${result.optInt("failed")} 份登记失败"
                    }
                    .onFailure { failures += "${student.name}：${it.message ?: "检查失败"}" }
            }
            runOnUiThread {
                if (registered > 0 && activeSection == AppSection.MATERIALS) renderSection(AppSection.MATERIALS, activeMaterialQueueFilter)
                if (registered > 0 || failures.isNotEmpty()) showMessage(
                    "历史课程资料检查完成",
                    "已将 $registered 份旧版课程截图补充登记到原始资料队列。${if (failures.isEmpty()) "" else "\n${failures.joinToString("\n")}"}",
                )
            }
        }.start()
    }

    private fun materialQueueItems(students: List<StudentRecord> = workspaceService.listStudents()): List<MaterialQueueItem> =
        students.flatMap { student ->
            runCatching { fileAssetService.materials(student.id) }.getOrDefault(emptyList())
                .filter { MaterialStatus.normalize(it.optString("status")) != MaterialStatus.REMOVED }
                .map { MaterialQueueItem(student, it) }
        }.sortedByDescending { it.material.optString("uploadedAt") }

    private fun materialPending(item: MaterialQueueItem): Boolean =
        MaterialStatus.normalize(item.material.optString("status")) == MaterialStatus.PENDING_DIGEST

    private fun materialProcessing(item: MaterialQueueItem): Boolean {
        val status = MaterialStatus.normalize(item.material.optString("status"))
        return status in setOf(MaterialStatus.SUBMITTED, MaterialStatus.DIGESTING) ||
            item.material.optString("ocrStatus") == "running" || item.material.optString("visionStatus") == "running"
    }

    private fun materialNeedsHelp(item: MaterialQueueItem): Boolean =
        MaterialStatus.normalize(item.material.optString("status")) == MaterialStatus.FAILED ||
            item.material.optString("ocrStatus") == "failed" ||
            item.material.optString("visionStatus") in setOf("failed", "unavailable")

    private fun materialActionRequired(item: MaterialQueueItem): Boolean =
        materialPending(item) || materialProcessing(item) || materialNeedsHelp(item)

    private fun filteredMaterialQueue(): List<MaterialQueueItem> {
        val items = selectedStudent()?.let { materialQueueItems(listOf(it)) }.orEmpty()
        return when (activeMaterialQueueFilter) {
            MaterialQueueFilter.ALL -> items
            MaterialQueueFilter.ACTION_REQUIRED -> items.filter(::materialActionRequired)
            MaterialQueueFilter.NEEDS_HELP -> items.filter(::materialNeedsHelp)
        }
    }

    private fun materialWorkflowLabel(item: MaterialQueueItem): String {
        val material = item.material
        val status = MaterialStatus.normalize(material.optString("status"))
        val workflow = when {
            materialNeedsHelp(item) -> "需要补充/重试"
            materialProcessing(item) -> "正在处理"
            status == MaterialStatus.PENDING_DIGEST && material.optString("ocrStatus") == "completed" -> "等待消化"
            status == MaterialStatus.PENDING_DIGEST -> "等待 OCR/解析"
            status == MaterialStatus.PROCESSED -> "已消化"
            else -> status.wireValue
        }
        return "$workflow · ${material.optString("fileName")}"
    }

    private fun renderMaterialQueue() {
        val items = filteredMaterialQueue()
        sectionHeading("资料队列 · ${activeMaterialQueueFilter.label}（${items.size}）")
        if (activeMaterialQueueFilter != MaterialQueueFilter.ALL) {
            addAction("查看全部资料") { renderSection(AppSection.MATERIALS, MaterialQueueFilter.ALL) }
        }
        if (items.isEmpty()) {
            sectionContent.addView(statusCard().apply { text = "当前筛选条件下没有资料。" }, matchWrap())
            return
        }
        addAction("批量处理当前列表（${items.size}）") { showBatchMaterialPicker(items) }
        val groups = items.groupBy { item ->
            val session = item.material.optString("captureSessionId").ifBlank { item.material.optString("id") }
            "${item.student.id}::$session"
        }.values.toList()
        val cards = groups.take(MAX_VISIBLE_MATERIAL_GROUPS).map { group ->
            val first = group.first()
            val course = first.material.optString("courseId")
            val source = if (course.isNotBlank()) "课程采集 · ${first.material.optString("courseProvider").ifBlank { course }}" else first.material.optString("sourceName").ifBlank { "本机资料" }
            val help = group.count(::materialNeedsHelp)
            val active = group.count(::materialProcessing)
            val pending = group.count(::materialPending)
            YouthAction(
                if (help > 0) "!" else if (active > 0) "▶" else "▤",
                "${first.student.name} · $source · ${group.size} 份",
                "待处理 $pending · 处理中 $active · 需补充 $help\n${group.take(3).joinToString("\n") { materialWorkflowLabel(it) }}${if (group.size > 3) "\n……" else ""}",
                when { help > 0 -> "$help 份需处理"; active > 0 -> "$active 份处理中"; else -> "查看资料" },
            ) { showMaterialActions(group) }
        }
        addActionGrid(cards, preferredColumns = 2, colorful = false)
        if (groups.size > MAX_VISIBLE_MATERIAL_GROUPS) {
            sectionContent.addView(statusCard().apply { text = "列表较多，当前显示前 $MAX_VISIBLE_MATERIAL_GROUPS 组；批量处理仍包含全部 ${items.size} 份资料。" }, matchWrap())
        }
    }

    private fun renderCourses() {
        val catalog = runCatching { courseCatalogService.lastGoodCatalog() }.getOrNull()
        val assigned = workspaceService.listStudents().count { courseCatalogService.offlineSnapshot(it.id) != null }
        sectionNote(if (catalog == null && assigned == 0) "尚未导入课程。可导入 Windows 平台课程包，或从 Windows 主机通过 U 盘迁入该学生的有效平台/机构课程。" else "全局平台目录 ${catalog?.optString("catalogVersion").orEmpty().ifBlank { "未导入" }} · 已有 $assigned 名学生获得离线课程快照")
        addActionGrid(listOf(
            YouthAction("▶", "查看和学习课程", "显示课程封面和介绍；学习时可同时启动屏幕采集", "当前学生") { chooseStudentForCourses() },
            YouthAction("↓", "导入离线课程包", "导入 Windows 平台发布的课程包") { startPlatformCourseImport() },
        ))
    }

    private fun renderAssistant() {
        sectionNote("教育管家仍负责学生身份、档案和写回；本机助手只作为问答或受控任务能力入口。")
        addActionGrid(listOf(
            YouthAction("P", "打开 PalmClaw", "进入本机已安装的 PalmClaw") { openPalmClaw() },
            YouthAction("豆", "打开豆包", "进入豆包进行问答和学习") { openDoubao() },
            YouthAction("M", "打开 MobileClaw", "进入本机 MobileClaw") { openMobileClaw() },
            YouthAction("AI", "ChatGPT / Codex", "进入已安装应用或官方下载页") { openChatGpt() },
            YouthAction("↓", "保存 AI 对话", "粘贴、导入或接收分享的对话历史") { showConversationImportMenu() },
            YouthAction("☵", "管理对话历史", "查看、整理或移入回收站") { showSavedConversations() },
            YouthAction("✦", "对话知识管理", "将保存的对话转为可审核知识") { openConversationKnowledge() },
        ))
    }

    private fun renderGrowth() {
        sectionNote("成长模型只沉淀有来源、可审核的成长证据，不由学情报告反向覆盖。")
        val student = selectedStudent()
        val pendingCount = student?.let { runCatching { GrowthModelService(this).candidates(it.id).count { item -> item.optString("status") in setOf("pending", "watching") } }.getOrDefault(0) } ?: 0
        addActionGrid(listOf(
            YouthAction("↗", "查看成长摘要", "查看能力维度、已确认和待审核证据") { chooseGrowthStudent() },
            YouthAction("✓", "审核成长证据", "确认、继续观察或补充原始资料", if (pendingCount > 0) "$pendingCount 条待审核" else "暂无待审核") { withCurrentStudent { reviewGrowthCandidate(it) } },
            YouthAction("＋", "高级：补充证据", "仅在自动生成证据不足时手工添加") { withCurrentStudent { showGrowthCandidateDialog(it) } },
        ))
    }

    private fun renderReports() {
        sectionNote("整体画像、历史变化、每周行动建议和阶段总结继续以成长模型的已确认证据为依据。")
        addActionGrid(listOf(
            YouthAction("☰", "查看学情报告", "浏览整体画像、历史变化、行动建议和阶段总结") { chooseReportStudent() },
            YouthAction("✦", "生成并发布报告", "依据已确认成长证据，一键生成四份正式报告", "一键完成") { chooseStudentForReportPublication() },
            YouthAction("⇩", "导出、分享与打印", "输出正式报告、简明报告或成长卡片") { withCurrentStudent { chooseReportForPublication(it) } },
            YouthAction("▣", "查看完整教育档案", "查看资料摘要、综合汇总、问答精华和全部文件") { withCurrentStudent { openStudentArchive(it) } },
        ))
    }

    private fun renderProjects() {
        sectionNote("新建或接管学习项目；项目知识空间继续使用固定 LLM Wiki Schema。")
        addActionGrid(listOf(
            YouthAction("＋", "新建学习项目", "建立项目资料、研究暂存层和知识空间") { showProjectInputDialog(adoptKnowledge = false) },
            YouthAction("⇢", "接管已有项目", "连接已有的 LLM Wiki 项目知识库") { showProjectInputDialog(adoptKnowledge = true) },
            YouthAction("⇩", "导入项目包", "从另一台单机设备显式导入项目；保留资料身份并重映射本机目录") { startProjectPackageImport() },
            YouthAction("⌂", "设置资料根目录", "选择学习项目控制目录的保存位置") { startTreePicker(REQUEST_WORKSPACE_ROOT) },
        ))
        sectionHeading("已有学习项目")
        projectList = GridLayout(this).apply { columnCount = actionGridColumns(3); alignmentMode = GridLayout.ALIGN_BOUNDS }
        sectionContent.addView(projectList, matchWrap().apply { setMargins(dp(-6), 0, dp(-6), 0) }); refreshProjects()
    }

    private fun renderSettings() {
        sectionNote("界面、任务 Agent、目录授权、换机迁移和本机备份设置。密钥继续使用 Android Keystore 加密。")
        val license = licenseManager.status()
        sectionContent.addView(statusCard().apply {
            text = "产品授权：${if (license.active) "已激活" else "未激活"}\n设备码：${licenseManager.deviceId()}\n学生席位：${license.maxActiveStudents}\n到期：${license.expiresAt.ifBlank { "永久" }}"
        }, matchWrap())
        addActionGrid(listOf(YouthAction("◆", "更换激活码", "已有资料不会删除；更换后重新验证产品授权") {
            AlertDialog.Builder(this).setTitle("更换激活码")
                .setMessage("清除当前激活码后将返回产品激活页。已有资料不会删除。确认继续吗？")
                .setNegativeButton("取消", null)
                .setPositiveButton("继续") { _, _ -> licenseManager.clear(); recreate() }
                .show()
        }), preferredColumns = 2, colorful = false)
        val toolStates = agentToolDefinitions().map { it to installedAgentPackage(it) }
        sectionContent.addView(statusCard().apply {
            text = "Agent 工具：已安装 ${toolStates.count { it.second != null }} / ${toolStates.size}\n" +
                toolStates.joinToString(" · ") { (tool, packageName) -> "${tool.displayName}${if (packageName == null) "未安装" else "已安装"}" }
        }, matchWrap())
        addActionGrid(listOf(YouthAction("AI", "Agent 工具适配", "检查 PalmClaw、豆包等工具并提供官方入口", "${toolStates.count { it.second != null }}/${toolStates.size} 已安装") { showAgentToolAdapter() }), preferredColumns = 2, colorful = false)
        sectionHeading("任务 Agent 服务")
        agentStatus = statusCard(); sectionContent.addView(agentStatus, matchWrap()); updateAgentStatus()
        addActionGrid(listOf(
            YouthAction("⚙", "配置任务 Agent", "填写或修改文本与视觉模型服务") { showAgentConfigurationDialog() },
            YouthAction("✓", "测试 Agent", "分别测试文本和视觉模型是否可用") { testAgentConfiguration() },
            YouthAction("⌘", "受控模型网关", "设备登记、学生授权与短时凭据；默认关闭") { showGatewaySettings() },
            YouthAction("■", "停用任务 Agent", "停止使用已保存的任务 Agent 配置") { confirmClearAgentConfiguration() },
            YouthAction("◷", "自动整理资料", "当前：${if (AutoDigestSettingsStore(this).load().enabled) "已开启" else "已关闭"}") { showAutoDigestSettings() },
        ), preferredColumns = 2, colorful = false)
        sectionHeading("界面与本机")
        addActionGrid(listOf(
            YouthAction("◉", "界面皮肤", "当前：${uiPreferences.skin().label}") { showSkinDialog() },
            YouthAction("▭", "页面布局", "当前：${uiPreferences.layoutMode().label}") { showLayoutDialog() },
            YouthAction("↻", "检查版本更新", "检查并下载可覆盖安装的新版本") { checkForAppUpdate() },
            YouthAction("⌂", "存储与目录授权", "设置学生档案和学习项目根目录") { startTreePicker(REQUEST_WORKSPACE_ROOT) },
            YouthAction("⇄", "知识协作", "进入本机知识协作与设备绑定") { startActivity(Intent(this, CollaborationActivity::class.java)) },
        ), preferredColumns = 2, colorful = false)
        sectionHeading("设备迁移与备份")
        val deviceMigration = StandaloneDeviceMigrationJournal(this).latest()
        if (deviceMigration != null) sectionContent.addView(statusCard().apply {
            text = "最近整机迁移：${if (deviceMigration.operation == StandaloneDeviceMigrationService.OPERATION_EXPORT) "导出" else "接管"} · ${deviceMigration.phase}\n" +
                "${deviceMigration.completedFiles}/${deviceMigration.totalFiles} 个文件 · ${formatBytes(deviceMigration.completedBytes)}/${formatBytes(deviceMigration.totalBytes)}\n${deviceMigration.message}"
        }, matchWrap())
        val migrationActions = mutableListOf(
            YouthAction("↑", "导出整机资料", "换新平板时导出完整迁移目录") { confirmDeviceMigrationExport() },
            YouthAction("↓", "在新平板接管", "从迁移目录恢复档案、项目和课程") { startTreePicker(REQUEST_DEVICE_MIGRATION_SOURCE) },
            YouthAction("▣", "加密备份", "生成可用于本机恢复的备份包") { promptBackupPassword() },
            YouthAction("↻", "备份恢复", "选择备份包恢复资料") { startRestorePackagePicker() },
        )
        if (deviceMigration != null && deviceMigration.phase in setOf("copying", "failed")) migrationActions += YouthAction("▶", "继续上次迁移", "从上次中断位置继续") { resumeDeviceMigration(deviceMigration) }
        if (deviceMigration != null) migrationActions += YouthAction("☰", "查看迁移报告", "查看文件数、容量、状态和失败原因") {
            showMessage("最近整机迁移", "迁移 ID：${deviceMigration.migrationId}\n操作：${deviceMigration.operation}\n状态：${deviceMigration.phase}\n文件：${deviceMigration.completedFiles}/${deviceMigration.totalFiles}\n容量：${formatBytes(deviceMigration.completedBytes)}/${formatBytes(deviceMigration.totalBytes)}\n${deviceMigration.message}")
        }
        addActionGrid(migrationActions, preferredColumns = 2, colorful = false)
        sectionHeading("高级设置")
        addActionGrid(listOf(YouthAction("↓", "导入离线课程包", "导入 Windows 平台发布的课程文件") { startPlatformCourseImport() }), preferredColumns = 2, colorful = false)
    }

    private fun sectionNote(value: String) { sectionContent.addView(TextView(this).apply { text = value; textSize = 15f; setTextColor(palette.muted); setPadding(dp(4), dp(10), dp(4), dp(14)) }, matchWrap()) }
    private fun sectionHeading(value: String) { sectionContent.addView(TextView(this).apply { text = value; textSize = 20f; setTextColor(palette.heading); typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL); setPadding(dp(4), dp(22), dp(4), dp(8)) }, matchWrap()) }
    private fun statusCard() = TextView(this).apply { textSize = 14f; setTextColor(palette.text); setPadding(dp(18), dp(16), dp(18), dp(16)); YouthUi.applyStatusCard(this, palette) }
    private fun addActionGrid(actions: List<YouthAction>, preferredColumns: Int = 3, colorful: Boolean = true): GridLayout {
        val columns = actionGridColumns(preferredColumns)
        val grid = GridLayout(this).apply {
            columnCount = columns
            alignmentMode = GridLayout.ALIGN_BOUNDS
            useDefaultMargins = false
        }
        actions.forEachIndexed { index, action ->
            val highContrast = colorful
            val card = FrameLayout(this).apply {
                isClickable = true
                isFocusable = true
                clipChildren = false
                contentDescription = buildString {
                    append(action.title)
                    if (action.detail.isNotBlank()) append("，${action.detail}")
                    if (action.badge.isNotBlank()) append("，${action.badge}")
                }
                setOnClickListener { action.action() }
                if (colorful) YouthUi.applyLearningCard(this, if (action.tone >= 0) action.tone else index) else YouthUi.applySurface(this, palette, 24)
            }
            if (colorful) card.addView(View(this).apply {
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                YouthUi.applyDecorativeOrb(this)
            }, FrameLayout.LayoutParams(dp(88), dp(88), Gravity.END or Gravity.BOTTOM).apply {
                rightMargin = dp(-18)
                bottomMargin = dp(-28)
            })
            val body = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(18), dp(15), dp(18), dp(15))
            }
            val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            top.addView(TextView(this).apply {
                text = action.icon
                textSize = 24f
                setTextColor(if (highContrast) Color.WHITE else palette.heading)
                gravity = Gravity.CENTER
                YouthUi.applyIconTile(this, palette, highContrast)
            }, LinearLayout.LayoutParams(dp(52), dp(52)))
            top.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
            if (action.badge.isNotBlank()) top.addView(TextView(this).apply {
                text = action.badge
                textSize = 12f
                setTextColor(if (highContrast) Color.WHITE else palette.heading)
                setPadding(dp(10), dp(5), dp(10), dp(5))
                YouthUi.applyBadge(this, palette, highContrast)
            })
            body.addView(top, matchWrap())
            body.addView(TextView(this).apply {
                text = action.title
                textSize = 19f
                typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
                setTextColor(if (highContrast) Color.WHITE else palette.text)
                setPadding(0, dp(8), 0, 0)
                maxLines = 2
            }, matchWrap())
            body.addView(TextView(this).apply {
                text = action.detail
                textSize = 14f
                setTextColor(if (highContrast) withAlpha(Color.WHITE, 224) else palette.muted)
                setPadding(0, dp(4), 0, 0)
                maxLines = 3
            }, matchWrap())
            card.addView(body, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            val span = if (columns >= 3) action.spanColumns.coerceIn(1, columns) else 1
            grid.addView(card, GridLayout.LayoutParams().apply {
                width = 0
                height = dp(if (wideLayout) 154 else 118)
                columnSpec = GridLayout.spec(GridLayout.UNDEFINED, span, span.toFloat())
                setMargins(dp(6), dp(6), dp(6), dp(6))
            })
        }
        sectionContent.addView(grid, matchWrap().apply { setMargins(dp(-6), 0, dp(-6), dp(4)) })
        return grid
    }

    private fun addAction(label: String, action: () -> Unit) {
        sectionContent.addView(themedButton(label, YouthButtonRole.SECONDARY, action), matchWrap())
    }
    private fun themedButton(label: String, role: YouthButtonRole = YouthButtonRole.SECONDARY, action: () -> Unit) = Button(this).apply {
        text = label
        YouthUi.applyButton(this, palette, role)
        setOnClickListener { action() }
    }
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
        if (resultCode != RESULT_OK) {
            if (requestCode == REQUEST_WORKSPACE_ROOT) pendingProjectRootMode = null
            return
        }
        when (requestCode) {
            REQUEST_WORKSPACE_ROOT -> {
                val result = rootGrant.acceptPickerResult(data ?: return)
                if (::rootStatus.isInitialized) rootStatus.text = result.fold(
                    onSuccess = { "单机资料根目录已授权：$it" }, onFailure = { "目录授权失败：${it.message ?: "未知错误"}" },
                )
                result.onSuccess { pendingProjectRootMode?.let { mode -> pendingProjectRootMode = null; showProjectInputDialog(mode) } }
                    .onFailure { pendingProjectRootMode = null }
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
            REQUEST_OFFLINE_MIGRATION_SOURCE -> rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                onSuccess = { inspectOfflineMigrationSource(it) },
                onFailure = { showMessage("迁移目录授权失败", it.message ?: "未知错误") },
            )
            REQUEST_OFFLINE_MIGRATION_TARGET -> rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                onSuccess = { target -> pendingOfflineMigrationSource?.let { source -> pendingOfflineMigrationSource = null; startOfflineMigration(source, target) } },
                onFailure = { pendingOfflineMigrationSource = null; showMessage("目标目录授权失败", it.message ?: "未知错误") },
            )
            REQUEST_DEVICE_MIGRATION_EXPORT_TARGET -> rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                onSuccess = { startDeviceMigrationExport(it) },
                onFailure = { showMessage("迁移目录授权失败", it.message ?: "未知错误") },
            )
            REQUEST_DEVICE_MIGRATION_SOURCE -> rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                onSuccess = { inspectDeviceMigrationSource(it) },
                onFailure = { showMessage("迁移目录授权失败", it.message ?: "未知错误") },
            )
            REQUEST_DEVICE_MIGRATION_TARGET -> rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                onSuccess = { target -> pendingDeviceMigrationSource?.let { source -> pendingDeviceMigrationSource = null; startDeviceMigrationImport(source, target) } },
                onFailure = { pendingDeviceMigrationSource = null; showMessage("新资料目录授权失败", it.message ?: "未知错误") },
            )
            REQUEST_PROJECT_PACKAGE_SOURCE -> rootGrant.acceptAdditionalTreeResult(data ?: return).fold(
                onSuccess = { inspectProjectPackage(it) },
                onFailure = { showMessage("项目包授权失败", it.message ?: "未知错误") },
            )
        }
    }

    private fun startProjectPackageImport() {
        if (rootGrant.currentRootUri() == null) {
            showMessage("尚未选择单机资料根目录", "请先设置本机资料根目录，再导入项目包。导入不会复用旧设备的目录授权。")
            return
        }
        AlertDialog.Builder(this).setTitle("导入显式项目包")
            .setMessage("请选择项目包目录。系统会先校验清单和全部文件，再把项目身份、资料ID和版本映射到本机SAF根目录。\n\n同名项目、异字节冲突或损坏包会停止，不覆盖现有文件；这不会建立跨设备实时同步。")
            .setNegativeButton("取消", null).setPositiveButton("选择项目包") { _, _ -> startTreePicker(REQUEST_PROJECT_PACKAGE_SOURCE) }
            .show()
    }

    private fun inspectProjectPackage(source: Uri) {
        val service = StandaloneProjectPackageService(this)
        runCatching { service.inspectPackage(source) }.onSuccess { descriptor ->
            AlertDialog.Builder(this).setTitle("确认导入项目包")
                .setMessage("项目：${descriptor.optString("projectName")}\n项目ID：${descriptor.optString("projectId")}\n文件：${descriptor.optInt("fileCount")} 个\n容量：${formatBytes(descriptor.optLong("totalBytes"))}\n导出时间：${descriptor.optString("createdAt")}\n\n参与学生优先按相同ID映射，其次只接受唯一同名学生；无法确定的学生不会自动绑定。")
                .setNegativeButton("取消", null).setPositiveButton("校验并导入") { _, _ ->
                    val target = rootGrant.currentRootUri() ?: return@setPositiveButton
                    val progress = showProgress("正在导入项目包", "逐项校验原文字节并重映射本机目录；中断后可选择同一包继续。")
                    Thread {
                        val result = runCatching { service.importProject(source, target) }
                        runOnUiThread {
                            progress.dismiss()
                            result.onSuccess {
                                refreshProjects()
                                showMessage("项目导入完成", "${it.project.name} 已导入；${it.files} 个文件、${formatBytes(it.bytes)}。\n已映射学生 ${it.mappedStudents} 名${if (it.unresolvedStudents.isEmpty()) "" else "；未自动绑定：${it.unresolvedStudents.joinToString()}"}。\n项目资料身份和版本保持，旧设备URI未复用。")
                            }.onFailure { showMessage("项目导入未完成", it.message ?: "未知错误") }
                        }
                    }.start()
                }.show()
        }.onFailure { showMessage("项目包不可用", it.message ?: "未知错误") }
    }

    private fun confirmDeviceMigrationExport() {
        AlertDialog.Builder(this).setTitle("导出整机迁移目录")
            .setMessage("适用于更换平板或复制完整单机资料。请选择 U 盘上的空目录；系统会导出全部学生档案、学习项目、课程状态和本机业务索引，并支持中断后继续。\n\n不会导出激活码、设备码、Agent API Key、Android Keystore、目录授权和录屏授权。新平板必须先单独激活。")
            .setNegativeButton("取消", null)
            .setPositiveButton("选择 U 盘空目录") { _, _ -> startTreePicker(REQUEST_DEVICE_MIGRATION_EXPORT_TARGET) }
            .show()
    }

    private fun startDeviceMigrationExport(target: Uri) {
        requestMigrationNotificationPermission()
        ContextCompat.startForegroundService(this, Intent(this, StandaloneDeviceMigrationService::class.java).apply {
            action = StandaloneDeviceMigrationService.ACTION_EXPORT
            putExtra(StandaloneDeviceMigrationService.EXTRA_TARGET_URI, target.toString())
        })
        showMessage("整机导出已开始", "请保持 U 盘连接。迁移在前台服务中运行，可通过持续通知查看进度；中断后可在系统设置中继续。")
    }

    private fun inspectDeviceMigrationSource(source: Uri) {
        val result = runCatching {
            require(workspaceService.listStudents().isEmpty() && projectService.listProjects().isEmpty()) { "本机已经有学生档案或学习项目，不能合并整机资料。请在新安装且业务资料为空的单机版中接管。" }
            val store = SafWorkspaceStore(this, source)
            val descriptor = JSONObject(store.readBytes(StandaloneDeviceMigrationContract.DESCRIPTOR_PATH).toString(Charsets.UTF_8))
            require(descriptor.getString("schema") == StandaloneDeviceMigrationContract.PACKAGE_SCHEMA && descriptor.getString("profile") == StandaloneDeviceMigrationContract.PROFILE) { "所选目录不是 Android 单机版整机迁移目录" }
            require(!descriptor.optBoolean("encrypted", true)) { "该目录不是可续传整机迁移格式" }
            descriptor
        }
        result.onFailure { showMessage("整机迁移预检失败", it.message ?: "未知错误") }.onSuccess { descriptor ->
            pendingDeviceMigrationSource = source
            AlertDialog.Builder(this).setTitle("确认接管整机资料")
                .setMessage("学生：${descriptor.optInt("studentCount")} 名\n学习项目：${descriptor.optInt("projectCount")} 个\n文件：${descriptor.optInt("fileCount")} 个\n容量：${formatBytes(descriptor.optLong("totalBytes"))}\n来源版本：${descriptor.optString("appVersion")}\n\n下一步请选择本平板上的空目录。所有业务 ID 将保留，旧设备 URI 会重映射；Agent API Key 需要重新填写。")
                .setNegativeButton("取消") { _, _ -> pendingDeviceMigrationSource = null }
                .setPositiveButton("选择本机空目录") { _, _ -> startTreePicker(REQUEST_DEVICE_MIGRATION_TARGET) }
                .show()
        }
    }

    private fun startDeviceMigrationImport(source: Uri, target: Uri) {
        requestMigrationNotificationPermission()
        ContextCompat.startForegroundService(this, Intent(this, StandaloneDeviceMigrationService::class.java).apply {
            action = StandaloneDeviceMigrationService.ACTION_IMPORT
            putExtra(StandaloneDeviceMigrationService.EXTRA_SOURCE_URI, source.toString())
            putExtra(StandaloneDeviceMigrationService.EXTRA_TARGET_URI, target.toString())
        })
        showMessage("新平板接管已开始", "请保持 U 盘连接。完成前不要在本机新建学生或项目；可通过持续通知查看进度，中断后可继续。")
    }

    private fun resumeDeviceMigration(state: StandaloneDeviceMigrationState) {
        if (state.operation == StandaloneDeviceMigrationService.OPERATION_EXPORT) startDeviceMigrationExport(Uri.parse(state.targetUri))
        else startDeviceMigrationImport(Uri.parse(state.sourceUri), Uri.parse(state.targetUri))
    }

    private fun requestMigrationNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_DEVICE_MIGRATION_NOTIFICATION)
        }
    }

    private fun inspectOfflineMigrationSource(source: Uri) {
        val result = runCatching {
            val root = requireNotNull(DocumentFile.fromTreeUri(this, source))
            val descriptorFile = requireNotNull(root.findFile("migration.json")) { "所选目录不是 Android 学生迁移目录" }
            val descriptor = contentResolver.openInputStream(descriptorFile.uri)?.use { JSONObject(it.readBytes().toString(Charsets.UTF_8)) }
                ?: error("无法读取迁移说明")
            require(descriptor.getString("schema") == StudentOfflineMigrationService.PACKAGE_SCHEMA) { "迁移目录版本不受支持" }
            descriptor
        }
        result.onFailure { showMessage("迁移目录预检失败", it.message ?: "未知错误") }.onSuccess { descriptor ->
            pendingOfflineMigrationSource = source
            val student = descriptor.optJSONObject("student")
            val courses = descriptor.optJSONObject("courses")
            AlertDialog.Builder(this).setTitle("迁移并接管 ${student?.optString("name").orEmpty()}")
                .setMessage("学生 ID：${student?.optString("id").orEmpty()}\n文件：${descriptor.optInt("fileCount")} 个\n容量：${formatBytes(descriptor.optLong("totalBytes"))}\n学习项目：${descriptor.optJSONArray("projects")?.length() ?: 0} 个\n课程：${courses?.optInt("courseCount") ?: 0} 门（平台 ${courses?.optInt("platformCount") ?: 0}、机构 ${courses?.optInt("tenantCount") ?: 0}）\n\n请选择一个空目录作为该学生的单机档案目录。迁移会在前台通知中显示进度，中断后可继续。")
                .setNegativeButton("取消") { _, _ -> pendingOfflineMigrationSource = null }
                .setPositiveButton("选择空目标目录") { _, _ -> startTreePicker(REQUEST_OFFLINE_MIGRATION_TARGET) }
                .show()
        }
    }

    private fun startOfflineMigration(source: Uri, target: Uri) {
        requestMigrationNotificationPermission()
        val startedAt = System.currentTimeMillis()
        offlineMigrationLiveState = StudentOfflineMigrationState(
            migrationId = "pending-$startedAt", sourceUri = source.toString(), targetUri = target.toString(), phase = "preparing",
            totalFiles = 0, completedFiles = 0, totalBytes = 0L, completedBytes = 0L, current = "",
            message = "正在启动迁移服务", completedKeys = emptySet(), updatedAt = Timestamp.now(), startedAtEpochMs = startedAt,
        )
        if (activeSection == AppSection.ARCHIVES) renderSection(AppSection.ARCHIVES)
        val intent = Intent(this, StudentOfflineMigrationService::class.java).apply {
            action = StudentOfflineMigrationService.ACTION_START
            putExtra(StudentOfflineMigrationService.EXTRA_SOURCE_URI, source.toString())
            putExtra(StudentOfflineMigrationService.EXTRA_TARGET_URI, target.toString())
        }
        ContextCompat.startForegroundService(this, intent)
        showMessage("迁移已开始", "教育档案页面已经显示实时进度。可以继续使用其他页面；请保持 U 盘连接。通知权限被拒绝时，应用内进度仍会继续显示。")
    }

    private fun formatBytes(bytes: Long): String = when {
        bytes >= 1024L * 1024 * 1024 -> "%.2f GB".format(bytes / (1024.0 * 1024 * 1024))
        bytes >= 1024L * 1024 -> "%.1f MB".format(bytes / (1024.0 * 1024))
        bytes >= 1024L -> "%.1f KB".format(bytes / 1024.0)
        else -> "$bytes B"
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
        val draftId = incoming.getStringExtra("studioDraftId")
        if (!draftId.isNullOrBlank()) {
            val studentId = incoming.getStringExtra("studioStudentId").orEmpty()
            incoming.removeExtra("studioDraftId"); incoming.removeExtra("studioStudentId")
            Thread {
                val result = runCatching {
                    require(getSharedPreferences(UI_CONTEXT_PREFS, MODE_PRIVATE).getString(KEY_CURRENT_STUDENT_ID, "") == studentId) { "当前学生已变化" }
                    val row = ScopedContentRepository(this).exact(studentId, draftId)
                    require(row.kind == "draft" && JSONObject(row.payload).getString("studentId") == studentId)
                    val item = JSONObject(row.payload).getJSONObject("candidate")
                    ProjectInput(item.getString("title"), "学习项目", "${item.getString("method")}\n${item.getString("steps")}", item.getString("question"), listOf(studentId))
                }
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    result.onSuccess { input ->
                        if (getSharedPreferences(UI_CONTEXT_PREFS, MODE_PRIVATE).getString(KEY_CURRENT_STUDENT_ID, "") != studentId) { showMessage("学生已变化", "请返回原学生草稿重试。"); return@onSuccess }
                        if (rootGrant.currentRootUri() == null) { showMessage("请先选择资料根目录", "草稿已保留；授权目录后再从草稿打开。"); return@onSuccess }
                        renderSection(AppSection.PROJECTS); showProjectInputDialog(false, input)
                    }.onFailure { showMessage("草稿无法打开", it.message.orEmpty()) }
                }
            }.start()
            return
        }
        if (incoming.getBooleanExtra(EXTRA_OPEN_CONVERSATION_IMPORT, false)) {
            incoming.removeExtra(EXTRA_OPEN_CONVERSATION_IMPORT)
            renderSection(AppSection.ASSISTANT)
            showConversationImportMenu()
            return
        }
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
                    progress.dismiss(); rememberCurrentStudent(result.student); renderSection(AppSection.ARCHIVES)
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
            rememberCurrentStudent(it)
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
            rememberCurrentStudent(student)
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
            studentList.addView(statusCard().apply { text = "尚未建立学生档案。点击上方“新建学生档案”或“接管已有档案”开始。" }, GridLayout.LayoutParams().apply {
                width = 0; columnSpec = GridLayout.spec(0, studentList.columnCount, 1f); setMargins(dp(6), dp(6), dp(6), dp(6))
            })
            updateCurrentStudentButton()
            return
        }
        val selectedId = selectedStudent()?.id
        students.forEach { student ->
            val engineState = runCatching { workspaceService.knowledgeEngine(student.id).health() }.getOrNull()
            val counts = engineState?.optJSONObject("counts")
            val materials = runCatching { fileAssetService.materials(student.id) }.getOrDefault(emptyList())
            val assetCount = runCatching { fileAssetService.assets(student.id).size }.getOrDefault(0)
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(18), dp(16), dp(18), dp(14))
                isClickable = true
                isFocusable = true
                setOnClickListener { openStudentArchive(student) }
                contentDescription = "${student.name}，点击打开教育档案"
                YouthUi.applySurface(this, palette, 24)
            }
            card.addView(TextView(this).apply {
                text = "${if (student.id == selectedId) "● " else ""}${student.name} · ${student.grade.ifBlank { "未填写年级" }}"
                textSize = 19f; setTextColor(palette.heading)
                typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
            }, matchWrap())
            card.addView(TextView(this).apply {
                text = "${if (student.knowledgeBaseMode == "adopted") "已接管原有档案" else "本机建立档案"}\n学习资料 ${materials.size} · 已归档 $assetCount · 待整理 ${materials.count { MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PENDING_DIGEST }}\n知识状态：${if (engineState?.optBoolean("ok") == true) "正常" else "需要检查"} · 来源 ${counts?.optInt("sources") ?: 0}"
                textSize = 14f; setTextColor(palette.muted); setPadding(0, dp(7), 0, dp(10))
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            actions.addView(themedButton("打开档案", YouthButtonRole.COMPACT) { openStudentArchive(student) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            actions.addView(themedButton("更多管理", YouthButtonRole.COMPACT) { showStudentManagement(student) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(6) })
            card.addView(actions, matchWrap())
            studentList.addView(card, GridLayout.LayoutParams().apply {
                width = 0; height = dp(if (wideLayout) 228 else 210); columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f); setMargins(dp(6), dp(6), dp(6), dp(6))
            })
        }
        updateCurrentStudentButton()
    }

    private fun showStudentManagement(student: StudentRecord) {
        val actions = mutableListOf("浏览教育档案", "从本机列表移除")
        actions += "补充规划档案（可选）"
        if (student.knowledgeBaseMode == "standard" && student.paths.rootPath.isNotBlank()) actions += "永久删除本机资料"
        AlertDialog.Builder(this).setTitle("${student.name} · 档案管理").setItems(actions.toTypedArray()) { _, which ->
            when (actions[which]) {
                "浏览教育档案" -> openStudentArchive(student)
                "从本机列表移除" -> confirmRemoveStudent(student, deleteFiles = false)
                "补充规划档案（可选）" -> showPlanningProfileEditor(student)
                else -> confirmRemoveStudent(student, deleteFiles = true)
            }
        }.setNegativeButton("取消", null).show()
    }

    private fun showPlanningProfileEditor(student: StudentRecord) {
        val profile = StudentIndexRepository(this).requireExact(student.id).planningProfile
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(8), dp(18), dp(8)) }
        fun field(label: String, value: String) = EditText(this).apply {
            hint = label; setText(value); setTextColor(palette.text); body.addView(this, matchWrap())
        }
        body.addView(TextView(this).apply { text = "全部可选。生日动态计算年龄；未填写时使用人工年龄段，不按年级推断。列表用逗号分隔。"; setTextColor(palette.muted) }, matchWrap())
        val birth = field("出生日期 yyyy-MM-dd", profile.birthDate)
        val ageBand = field("人工年龄段（无生日时使用）", profile.manualAgeBand)
        val region = field("当前地区", profile.currentRegion)
        val regions = field("意向地区或国家", profile.targetRegions.joinToString("，"))
        val routes = linkedMapOf<String, CheckBox>()
        listOf("domestic" to "国内升学", "hongkong_macau" to "港澳升学", "international" to "国际升学").forEach { (id, label) ->
            routes[id] = CheckBox(this).apply { text = label; isChecked = id in profile.planningRoutes; setTextColor(palette.text); body.addView(this, matchWrap()) }
        }
        val stage = field("目标阶段", profile.targetStage)
        val interests = field("兴趣", profile.interests.joinToString("，"))
        val strengths = field("优势学科", profile.subjectStrengths.joinToString("，"))
        val careers = field("职业方向", profile.careerDirections.joinToString("，"))
        val preferences = field("规划偏好", profile.planningPreferences.joinToString("，"))
        fun list(field: EditText) = field.text.toString().split(Regex("[,，;；\\n]")).map(String::trim).filter(String::isNotBlank).distinct()
        val dialog = AlertDialog.Builder(this).setTitle("${student.name} · 规划档案")
            .setView(ScrollView(this).apply { addView(body) }).setNegativeButton("取消", null).setPositiveButton("保存", null).create()
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            runCatching {
                StudentIndexRepository(this).updateProfile(student.id, StudentPlanningProfile(birth.text.toString().trim(),
                    ageBand.text.toString().trim(), region.text.toString().trim(), list(regions), routes.filterValues { it.isChecked }.keys.toList(), stage.text.toString().trim(),
                    list(preferences), list(interests), list(strengths), list(careers)))
            }.onSuccess { dialog.dismiss(); renderSection(activeSection); showMessage("规划档案已保存", "已保存 Schema V2，并保留修改前的档案快照。") }
                .onFailure { showMessage("未保存", it.message ?: "档案写入失败；原有档案保留。") }
        } }
        dialog.show()
    }

    private fun showModelCallDiagnostics(student: StudentRecord) {
        val progress = showProgress("正在读取任务诊断", "仅查询当前学生的模型回执，不上传资料。")
        Thread {
            val result = runCatching { BusinessDatabase.get(this).ledger().calls(student.id) }
            runOnUiThread {
                progress.dismiss()
                if (selectedStudent()?.id != student.id) return@runOnUiThread
                result.onSuccess { calls ->
                    val text = calls.joinToString("\n\n") { call ->
                        "${call.model} · ${call.state} · ${call.elapsedMs} ms\n输入 ${call.inputTokens?.toString() ?: "未知"} / 输出 ${call.outputTokens?.toString() ?: "未知"} Token\n${call.requestId.ifBlank { "无服务端请求 ID" }}${if (call.errorCode.isBlank()) "" else "\n${call.errorCode}"}"
                    }.ifBlank { "该学生尚无模型调用回执。项目级调用和连接测试不混入学生回执。" }
                    showMessage("${student.name} · 模型任务诊断（最近50条）", text)
                }.onFailure { showMessage("任务诊断不可用", it.message ?: "数据库读取失败") }
            }
        }.start()
    }

    private fun confirmRemoveStudent(student: StudentRecord, deleteFiles: Boolean) {
        val progress = showProgress("正在检查资料处理状态", "仅检查当前学生及关联项目，不删除任何文件。")
        Thread {
            val result = runCatching {
                val projects = ProjectRepository(this).list().filter { student.id in it.studentIds }.map { it.id }
                TaskRepository(this).hasActiveForStudent(student.id, projects) || projects.any {
                    ProjectDigestQueue(this).latest(it)?.optString("status") in setOf("queued", "running")
                }
            }
            runOnUiThread {
                progress.dismiss()
                if (selectedStudent()?.id != student.id || isFinishing || isDestroyed) return@runOnUiThread
                result.onSuccess { confirmRemoveStudentAfterCheck(student, deleteFiles, it) }
                    .onFailure { showMessage("暂不能移除", it.message ?: "任务状态读取失败；保留学生和原始资料。") }
            }
        }.start()
    }

    private fun confirmRemoveStudentAfterCheck(student: StudentRecord, deleteFiles: Boolean, activeTask: Boolean) {
        val capturePrefs = getSharedPreferences(CourseCaptureService.PREFS, MODE_PRIVATE)
        val activeCapture = capturePrefs.getString(CourseCaptureService.KEY_STUDENT_ID, "").orEmpty() == student.id &&
            capturePrefs.getString(CourseCaptureService.KEY_STATUS, "idle").orEmpty() in setOf("capturing", "paused")
        if (activeTask || activeCapture || StudentOfflineMigrationService.isRunning()) {
            showMessage("当前不能移除", "该学生仍有资料处理、屏幕采集或迁移任务。请先结束任务再操作。")
            return
        }
        val stats = if (deleteFiles) runCatching { SafWorkspaceStore(this, Uri.parse(student.storageRootUri)).treeStats(student.paths.rootPath) }.getOrNull() else null
        val message = if (deleteFiles) "将永久删除 ${student.name} 的本机资料目录：${stats?.files ?: "未知"} 个文件、${stats?.directories ?: "未知"} 个目录。此操作不可恢复。" else "只从本机学生列表移除并解除学习项目关联，不删除原始目录和文件；以后仍可重新接管。"
        AlertDialog.Builder(this).setTitle(if (deleteFiles) "永久删除学生资料？" else "移除学生档案？").setMessage(message)
            .setNegativeButton("取消", null).setPositiveButton(if (deleteFiles) "继续确认" else "确认移除") { _, _ ->
                if (deleteFiles) AlertDialog.Builder(this).setTitle("再次确认永久删除")
                    .setMessage("确认永久删除 ${student.name} 的本机资料？")
                    .setNegativeButton("取消", null).setPositiveButton("永久删除") { _, _ -> removeStudent(student, true) }.show()
                else removeStudent(student, false)
            }.show()
    }

    private fun removeStudent(student: StudentRecord, deleteFiles: Boolean) {
        runCatching {
            ProjectRepository(this).detachStudent(student.id)
            StudentIndexRepository(this).remove(student.id)
            if (deleteFiles) SafWorkspaceStore(this, Uri.parse(student.storageRootUri)).deleteDirectoryTree(student.paths.rootPath)
        }.onSuccess {
            refreshStudents()
            showMessage(if (deleteFiles) "学生资料已永久删除" else "学生档案已移除", if (deleteFiles) "${student.name} 的本机资料目录和登记已删除。" else "原目录未删除，可通过“接管已有学情档案”重新接管。")
        }.onFailure { showMessage("操作失败", it.message ?: "未知错误") }
    }

    private fun openStudentArchive(student: StudentRecord) {
        val categories = arrayOf("资料摘要", "综合汇总", "问答精华", "概念库", "实体库", "成长模型", "学情报告", "原始资料", "全部文件")
        AlertDialog.Builder(this).setTitle("${student.name} · 教育档案").setItems(categories) { _, which ->
            if (categories[which] in setOf("原始资料", "全部文件")) {
                val allFiles = categories[which] == "全部文件"
                startActivity(Intent(this, RawMaterialBrowserActivity::class.java)
                    .putExtra(RawMaterialBrowserActivity.EXTRA_STUDENT_ID, student.id)
                    .putExtra(RawMaterialBrowserActivity.EXTRA_START_PATH, if (allFiles) student.paths.rootPath else student.paths.rawPath)
                    .putExtra(RawMaterialBrowserActivity.EXTRA_TITLE, "${student.name} · ${categories[which]}"))
            } else startActivity(Intent(this, MarkdownBrowserActivity::class.java)
                .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_ARCHIVE)
                .putExtra(MarkdownBrowserActivity.EXTRA_ARCHIVE_CATEGORY, categories[which])
                .putExtra(MarkdownBrowserActivity.EXTRA_STUDENT_ID, student.id)
                .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, "${student.name} · ${categories[which]}"))
        }.setNegativeButton("取消", null).show()
    }

    private fun updateRootStatus() {
        if (::rootStatus.isInitialized) rootStatus.text = rootGrant.currentRootUri()?.let { "单机资料根目录已授权：$it" }
            ?: "尚未选择单机资料根目录。应用只访问你明确授权的目录。"
    }

    private fun startTreePicker(requestCode: Int) {
        @Suppress("DEPRECATION")
        startActivityForResult(rootGrant.createPickerIntent(), requestCode)
    }

    private fun chooseImportStudent() {
        withCurrentStudent("请先新建或接管学生档案库。") { student ->
            pendingImportStudentId = student.id
            showLocalImportSource()
        }
    }

    private fun chooseFileImport() {
        withCurrentStudent("请先新建或接管学生档案库。") { student ->
            pendingImportStudentId = student.id
            startLocalFileImport()
        }
    }

    private fun choosePhotoImport() {
        withCurrentStudent("请先新建或接管学生档案库。") { student ->
            pendingImportStudentId = student.id
            startCameraImport()
        }
    }

    private fun startLocalFileImport() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQUEST_IMPORT_FILES)
    }

    private fun showLocalImportSource() {
        AlertDialog.Builder(this).setTitle("本机导入方式")
            .setItems(arrayOf("选择本机文件", "拍照导入")) { _, which ->
                if (which == 0) startLocalFileImport() else startCameraImport()
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
        withCurrentStudent("请先新建或接管学生档案库。") { showStudentAssets(it) }
    }

    private fun chooseStudentForRawBrowser() {
        withCurrentStudent("请先新建或接管学生档案库。") { student ->
            startActivity(Intent(this, RawMaterialBrowserActivity::class.java)
                .putExtra(RawMaterialBrowserActivity.EXTRA_STUDENT_ID, student.id))
        }
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
            if (MaterialStatus.normalize(item.optString("status")) == MaterialStatus.FAILED || item.optString("ocrStatus") == "failed" || item.optString("visionStatus") in setOf("failed", "unavailable")) {
                builder.setNeutralButton("重新加入待处理") { _, _ -> retryFailedMaterials(listOf(MaterialQueueItem(student, item))) }
            }
            builder.show()
        }.setPositiveButton("完成", null).show()
    }

    private fun startGeneralScreenCapture() {
        withCurrentStudent("连续屏幕采集必须绑定一个明确学生。") { student ->
            val projects = projectService.listProjects().filter { student.id in it.studentIds }
            val choices = listOf("不关联学习项目") + projects.map { it.name }
            AlertDialog.Builder(this).setTitle("关联学习项目（可选）").setItems(choices.toTypedArray()) { _, projectIndex ->
                val project = projects.getOrNull(projectIndex - 1)
                startActivity(Intent(this, ScreenCaptureActivity::class.java)
                    .putExtra(ScreenCaptureActivity.EXTRA_STUDENT_ID, student.id)
                    .putExtra(ScreenCaptureActivity.EXTRA_PROJECT_ID, project?.id.orEmpty())
                    .putExtra(ScreenCaptureActivity.EXTRA_PROJECT_NAME, project?.name.orEmpty()))
            }.show()
        }
    }

    private fun showProjectInputDialog(adoptKnowledge: Boolean, prefill: ProjectInput? = null) {
        val root = rootGrant.currentRootUri()
        if (root == null) {
            AlertDialog.Builder(this).setTitle("尚未选择单机资料根目录")
                .setMessage("学习项目控制目录需要建立在你明确授权的单机资料根目录内。")
                .setNegativeButton("取消", null).setPositiveButton("立即选择根目录") { _, _ ->
                    pendingProjectRootMode = adoptKnowledge; startTreePicker(REQUEST_WORKSPACE_ROOT)
                }.show()
            return
        }
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 12, 40, 0) }
        fun field(hintText: String) = EditText(this).apply { hint = hintText; fields.addView(this, matchWrap()) }
        val name = field("项目名称（必填）"); val type = field("项目类型（默认：学习项目）")
        val description = field("项目说明"); val objective = field("项目目标")
        prefill?.let { name.setText(it.name); type.setText(it.type); description.setText(it.description); objective.setText(it.objective) }
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
        if (projects.isEmpty()) {
            projectList.addView(statusCard().apply { text = "尚未建立学习项目。点击上方“新建学习项目”开始。" }, GridLayout.LayoutParams().apply {
                width = 0; columnSpec = GridLayout.spec(0, projectList.columnCount, 1f); setMargins(dp(6), dp(6), dp(6), dp(6))
            })
            return
        }
        projects.forEach { project ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(16), dp(18), dp(16)); isClickable = true; isFocusable = true
                setOnClickListener { openProjectMaterials(project) }; contentDescription = "${project.name}，点击打开项目资料中心"; YouthUi.applySurface(this, palette, 24)
            }
            card.addView(TextView(this).apply {
                text = project.name; textSize = 19f; setTextColor(palette.heading); typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
            }, matchWrap())
            card.addView(TextView(this).apply {
                text = "${if (project.knowledgeMode == "adopted") "已接管原有知识库" else "本机项目知识库"}\n参与学生：${project.studentNames.joinToString().ifBlank { "暂未绑定" }}\n状态：${project.status}"
                textSize = 14f; setTextColor(palette.muted); setPadding(0, dp(7), 0, dp(10))
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            card.addView(themedButton("项目资料与知识", YouthButtonRole.COMPACT) { openProjectMaterials(project) }, matchWrap())
            card.addView(themedButton("仅浏览知识库", YouthButtonRole.COMPACT) { openProjectKnowledge(project) }, matchWrap())
            projectList.addView(card, GridLayout.LayoutParams().apply {
                width = 0; height = dp(if (wideLayout) 250 else 228); columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f); setMargins(dp(6), dp(6), dp(6), dp(6))
            })
        }
    }

    private fun openProjectKnowledge(project: ProjectRecord) {
        startActivity(Intent(this, MarkdownBrowserActivity::class.java)
            .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_PROJECT)
            .putExtra(MarkdownBrowserActivity.EXTRA_PROJECT_ID, project.id)
            .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, "${project.name} · 项目知识"))
    }

    private fun openProjectMaterials(project: ProjectRecord) {
        startActivity(Intent(this, ProjectMaterialsActivity::class.java)
            .putExtra(ProjectMaterialsActivity.EXTRA_PROJECT_ID, project.id))
    }

    private fun showAgentConfigurationDialog() {
        val existing = runCatching { AgentConfigurationStore(this).load() }.getOrNull()
        val publicProfile = AgentConfigurationStore(this).publicProfile()
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 12, 40, 0) }
        fun field(hintText: String) = EditText(this).apply { hint = hintText; fields.addView(this, matchWrap()) }
        val endpoint = field("接口基地址或完整 chat/completions 地址").apply { setText(existing?.endpoint ?: publicProfile?.endpoint.orEmpty()) }
        val model = field("文本模型名称").apply { setText(existing?.model ?: publicProfile?.model.orEmpty()) }
        val visionModel = field("视觉模型名称（可选；必须支持图片输入）").apply { setText(existing?.visionModel ?: publicProfile?.visionModel.orEmpty()) }
        val key = field(if (existing == null) "API Key（换机后必须重新填写）" else "新 API Key（留空保持原密钥）").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        AlertDialog.Builder(this).setTitle("配置教育管家 Agent").setView(fields).setNegativeButton("取消", null)
            .setPositiveButton("安全保存") { _, _ ->
                runCatching { AgentConfigurationStore(this).saveOrUpdate(endpoint.text.toString(), model.text.toString(), key.text.toString(), visionModel.text.toString()) }
                    .onSuccess { GatewaySettings(this).disable(); key.text?.clear(); updateAgentStatus(); showMessage("配置完成", "已切换为个人接口；凭据已使用 Android Keystore 加密保存。") }
                    .onFailure { key.text?.clear(); showMessage("配置失败", it.message ?: "未知错误") }
            }.show()
    }

    private fun updateAgentStatus() {
        if (::agentStatus.isInitialized) agentStatus.text = runCatching { AgentConfigurationStore(this).summary() }.getOrElse { "Agent 配置需要重新保存" }
    }

    private fun testAgentConfiguration() {
        val config = runCatching { AgentConfigurationStore(this).load() }.getOrNull()
        if (config == null) { showMessage("尚未配置", "请先配置本地任务 Agent。") ; return }
        val scope = selectedStudent()?.id.orEmpty()
        val progress = showProgress("正在测试 Agent", "分别检查文本、视觉、结构化输出和公开联网来源；不会读取或上传学生资料。每项可能产生模型费用。")
        Thread {
            val adapter = OpenAiCompatibleAgentAdapter(config, this, scope, "capability-probe:${java.util.UUID.randomUUID()}")
            val textResult = runCatching { adapter.testConnection() }
            val visionResult = if (config.visionModel.isBlank()) null else runCatching { adapter.testVisionConnection() }
            val structured = runCatching {
                val schema = JSONObject().put("type", "object").put("properties", JSONObject().put("ok", JSONObject().put("type", "boolean")))
                    .put("required", org.json.JSONArray().put("ok")).put("additionalProperties", false)
                val response = adapter.executeStructured("只做无个人资料的能力测试。", "返回ok=true。", schema, "capability-v1")
                require(JSONObject(response.text).getBoolean("ok")); Unit
            }
            val research = runCatching { require(adapter.webResearch("查询联合国官网网址，给出实际检索来源。").sources.isNotEmpty()); Unit }
            val diagnostic = JSONObject().put("testedAt", Timestamp.now()).put("endpoint", URI(config.endpoint).host).put("model", config.model)
                .put("text", textResult.isSuccess).put("vision", visionResult?.isSuccess ?: JSONObject.NULL)
                .put("structured", structured.isSuccess).put("research", research.isSuccess)
            BusinessDatabase.get(this).tasks().metadata(BusinessMetadataEntity("model-capability:${ScopedContentPolicy.hash("${config.endpoint}:${config.model}:${config.visionModel}".toByteArray())}", diagnostic.toString()))
            runOnUiThread {
                progress.dismiss()
                val textLine = if (textResult.isSuccess) "文本模型 ${config.model}：通过" else "文本模型 ${config.model}：失败\n${textResult.exceptionOrNull()?.message ?: "未知错误"}"
                val visionLine = when {
                    config.visionModel.isBlank() -> "视觉模型：未配置"
                    visionResult?.isSuccess == true -> "视觉模型 ${config.visionModel}：通过"
                    else -> "视觉模型 ${config.visionModel}：失败\n${visionResult?.exceptionOrNull()?.message ?: "未知错误"}"
                }
                val allPassed = textResult.isSuccess && (visionResult == null || visionResult.isSuccess)
                showMessage(if (allPassed && structured.isSuccess) "Agent 基础测试完成" else "Agent 测试发现问题", "服务 ${URI(config.endpoint).host}\n\n$textLine\n\n$visionLine\n结构化输出：${if (structured.isSuccess) "通过" else "失败"}\n联网来源：${if (research.isSuccess) "通过" else "未通过，联网规划暂不可用"}\n测试时间：${diagnostic.getString("testedAt")}")
            }
        }.start()
    }

    private fun showGatewaySettings() {
        val gateway = GatewaySettings(this); val profile = AgentConfigurationStore(this).publicProfile()
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 12, 24, 12) }
        val info = TextView(this).apply { text = "仅连接已部署的受控网关。需管理员核验许可证，并登记设备公钥、学生和额度。开启后不回退到个人Key；换机后关闭并重新登记。" }; fields.addView(info)
        val endpoint = EditText(this).apply { hint = "网关 HTTPS 基地址"; setText(gateway.endpoint()); fields.addView(this) }
        val model = EditText(this).apply { hint = "服务端允许的文本模型"; setText(profile?.model.orEmpty()); fields.addView(this) }
        val vision = EditText(this).apply { hint = "服务端允许的视觉模型（可选）"; setText(profile?.visionModel.orEmpty()); fields.addView(this) }
        val enabled = CheckBox(this).apply { text = "启用受控网关（保存时清除原个人API凭据）"; isChecked = gateway.enabled(); fields.addView(this) }
        fields.addView(Button(this).apply { text = "显示当前学生设备登记信息（不含私钥或激活码）"; setOnClickListener {
            val student = selectedStudent() ?: return@setOnClickListener
            runCatching { GatewayDeviceProof(this@MainActivity).registration(student.id).toString(2) }
                .onSuccess { showMessage("交给网关管理员登记", it) }.onFailure { showMessage("登记信息未生成", it.message.orEmpty()) }
        } })
        AlertDialog.Builder(this).setTitle("受控模型网关").setView(ScrollView(this).apply { addView(fields) }).setNegativeButton("取消", null)
            .setPositiveButton("保存") { _, _ -> runCatching {
                if (enabled.isChecked) {
                    require(model.text.toString().isNotBlank()); val url = ModelEndpointPolicy.normalize(endpoint.text.toString())
                    AgentConfigurationStore(this).restorePublicProfile(AgentPublicConfiguration(url, model.text.toString().trim(), vision.text.toString().trim()))
                    gateway.save(url, true)
                } else gateway.disable()
            }.onSuccess { updateAgentStatus(); showMessage("已保存", "启用不等于服务器授权或能力通过，请执行能力测试。关闭网关后，个人Key需重新配置。") }
                .onFailure { showMessage("保存失败", it.message.orEmpty()) } }.show()
    }

    private fun confirmClearAgentConfiguration() {
        if (AgentConfigurationStore(this).load() == null) { showMessage("无需停用", "当前没有已保存的 Agent 配置。") ; return }
        AlertDialog.Builder(this).setTitle("停用本地任务 Agent？").setMessage("将删除本机加密保存的 API Key、接口和模型配置；学生档案与任务记录不会删除。")
            .setNegativeButton("取消", null).setPositiveButton("确认停用") { _, _ ->
                runCatching { AgentConfigurationStore(this).clear() }.onSuccess { updateAgentStatus(); showMessage("已停用", "Agent 配置和本机加密密钥已删除。") }
                    .onFailure { showMessage("停用失败", it.message ?: "未知错误") }
            }.show()
    }

    private fun showAutoDigestSettings() {
        val store = AutoDigestSettingsStore(this); val current = store.load()
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(8), dp(24), 0) }
        val enabled = CheckBox(this).apply { text = "开启每日自动消化"; isChecked = current.enabled; fields.addView(this, matchWrap()) }
        val time = EditText(this).apply { hint = "执行时间（HH:mm）"; setText("%02d:%02d".format(current.hour, current.minute)); fields.addView(this, matchWrap()) }
        val wifi = CheckBox(this).apply { text = "仅在 Wi-Fi 下运行"; isChecked = current.wifiOnly; fields.addView(this, matchWrap()) }
        val charging = CheckBox(this).apply { text = "仅在充电时运行"; isChecked = current.chargingOnly; fields.addView(this, matchWrap()) }
        val maximum = EditText(this).apply { hint = "每名学生单次最多处理份数"; inputType = InputType.TYPE_CLASS_NUMBER; setText(current.maximumPerStudent.toString()); fields.addView(this, matchWrap()) }
        fields.addView(TextView(this).apply { text = "只处理已准备好的待消化资料；图片/PDF 必须先完成 OCR。失败资料保留在待处理队列，不会静默删除。\n\n${store.summary()}"; setTextColor(palette.muted); setPadding(0, dp(8), 0, 0) }, matchWrap())
        val dialog = AlertDialog.Builder(this).setTitle("自动消化资料").setView(fields).setNegativeButton("取消", null).setPositiveButton("保存", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val parts = time.text.toString().trim().split(':')
                val hour = parts.getOrNull(0)?.toIntOrNull(); val minute = parts.getOrNull(1)?.toIntOrNull()
                val count = maximum.text.toString().toIntOrNull()
                if (hour !in 0..23 || minute !in 0..59) { time.error = "请输入 00:00 到 23:59"; return@setOnClickListener }
                if (count !in 1..100) { maximum.error = "请输入 1 到 100"; return@setOnClickListener }
                store.save(AutoDigestSettings(enabled.isChecked, requireNotNull(hour), requireNotNull(minute), wifi.isChecked, charging.isChecked, requireNotNull(count)))
                dialog.dismiss(); showMessage("自动消化设置已保存", store.summary())
                if (activeSection == AppSection.SETTINGS) renderSection(AppSection.SETTINGS)
            }
        }
        dialog.show()
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
                setTextColor(palette.heading)
            }, matchWrap())
            card.addView(TextView(this).apply {
                text = if (installedPackage == null) "未安装" else "已安装 · $installedPackage"
                textSize = 14f
                setTextColor(if (installedPackage == null) Color.rgb(253, 186, 116) else Color.rgb(110, 231, 183))
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
        showConversationActionPanel(
            "导入智能体对话历史",
            "只保存你主动粘贴、选择、分享或输入公开 HTTPS 链接的当前对话；不会读取 PalmClaw、豆包的私有聊天数据库。",
            listOf("粘贴对话文字", "导入 .md / .txt / .json 文件", "导入公开 HTTPS 对话链接"),
        ) { which ->
            when (which) {
                0 -> chooseConversationSourceAgent(::showConversationPaste)
                1 -> chooseConversationSourceAgent(::chooseConversationFileTarget)
                2 -> chooseConversationSourceAgent(::showConversationPublicLink)
            }
        }
    }

    private fun showConversationPublicLink(sourceAgent: String) {
        val input = EditText(this).apply { hint = "https://公开分享链接"; setSingleLine(true); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI }
        val dialog = AlertDialog.Builder(this).setTitle("导入公开对话链接").setMessage("仅支持公开 HTTPS 页面或文本链接，最多读取 5 MB；不会登录账号或绕过访问权限。")
            .setView(input).setNegativeButton("取消", null).setPositiveButton("读取并预览", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val url = input.text.toString().trim()
                if (url.isBlank()) { input.error = "请输入 HTTPS 链接"; return@setOnClickListener }
                dialog.dismiss(); importConversationPublicLink(sourceAgent, url)
            }
        }
        dialog.show()
    }

    private fun importConversationPublicLink(sourceAgent: String, url: String) {
        val progress = showProgress("正在读取公开对话", "只读取你明确输入的公开 HTTPS 链接。")
        Thread {
            val result = runCatching { ConversationPublicLinkService.fetch(url) }
            runOnUiThread {
                progress.dismiss()
                result.onSuccess { content -> chooseConversationTarget(sourceAgent, content, url) }
                    .onFailure { showMessage("链接导入失败", it.message ?: "无法读取公开对话链接") }
            }
        }.start()
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
            runOnUiThread {
                progress.dismiss()
                result.onSuccess { saved -> showConversationSavedActions(saved, "对话历史已保存") }
                    .onFailure { showMessage("保存失败", it.message ?: "未知错误") }
            }
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
            runOnUiThread {
                progress.dismiss()
                result.onSuccess { saved -> showConversationSavedActions(saved, "对话文件已导入") }
                    .onFailure { showMessage("导入失败", it.message ?: "未知错误") }
            }
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
        withCurrentStudent("当前没有可查看的学生范围。") { student ->
            val records = conversationImportService.list(student.id)
            if (records.isEmpty()) {
                AlertDialog.Builder(this).setTitle("没有对话历史")
                    .setMessage("${student.name} 当前没有主动保存的 Agent 对话。你可以立即粘贴文字、导入文件，或从 PalmClaw / 豆包使用 Android“分享”发送到教育管家。")
                    .setPositiveButton("立即导入") { _, _ -> showConversationImportMenu() }
                    .setNeutralButton("切换当前学生") { _, _ -> showCurrentStudentPicker() }
                    .setNegativeButton("关闭", null)
                    .show()
                return@withCurrentStudent
            }
            AlertDialog.Builder(this).setTitle("${student.name} · 已保存对话（${records.size}）")
                .setItems(records.map { "${it.optString("sourceAgent")} · ${conversationDigestStatusLabel(it.optString("digestStatus"))}\n${it.optString("projectName").ifBlank { "${student.name} · 学生档案" }} · ${it.optInt("messageCount")} 条消息" }.toTypedArray()) { _, index ->
                    showConversationActions(student, records[index])
                }.show()
        }
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
        actions += if (status in setOf("running", "completed")) "删除说明" else "移入回收站"
        val scopeName = item.optString("projectName").ifBlank { "${student.name} · 学生档案" }
        val details = buildString {
            append("来源：${item.optString("sourceAgent")}\n归属：$scopeName\n状态：${conversationDigestStatusLabel(status)}\n")
            append("导入：${item.optString("importedAt")}\n消息定位：${item.optInt("messageCount")} 条\nSHA-256：${item.optString("contentHash")}")
            if (status == "failed" && item.optString("digestError").isNotBlank()) append("\n失败原因：${item.optString("digestError")}")
        }
        showConversationActionPanel("对话历史", details, actions) { which ->
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
        }
    }

    private fun showConversationSavedActions(saved: JSONObject, title: String) {
        val record = saved.optJSONObject("record")
        val recordId = record?.optString("recordId").orEmpty()
        if (recordId.isBlank()) {
            showMessage(title, saved.optString("message"))
            return
        }
        showConversationActionPanel(
            title,
            saved.optString("message"),
            listOf("浏览已保存原文", "进入消化流程", "打开对话知识管理"),
        ) { which ->
            when (which) {
                0 -> openConversationDocument(recordId, digest = false)
                1 -> confirmConversationDigest(conversationImportService.requireExact(recordId))
                2 -> openConversationKnowledge(record?.optString("studentId").orEmpty(), recordId)
            }
        }
    }

    private fun showConversationActionPanel(title: String, details: String, actions: List<String>, onSelected: (Int) -> Unit) {
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), dp(8))
        }
        body.addView(TextView(this).apply {
            text = details
            textSize = 14f
            setTextColor(palette.text)
            setPadding(0, 0, 0, dp(8))
        }, matchWrap())
        val dialog = AlertDialog.Builder(this).setTitle(title).setView(body).setNegativeButton("关闭", null).create()
        actions.forEachIndexed { index, label ->
            body.addView(themedButton(label) {
                dialog.dismiss()
                onSelected(index)
            }, matchWrap())
        }
        dialog.show()
    }

    private fun openConversationKnowledge(studentId: String = "", recordId: String = "") {
        startActivity(Intent(this, ConversationKnowledgeActivity::class.java)
            .putExtra(ConversationKnowledgeActivity.EXTRA_STUDENT_ID, studentId)
            .putExtra(ConversationKnowledgeActivity.EXTRA_RECORD_ID, recordId))
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
        AlertDialog.Builder(this).setTitle("移入回收站")
            .setMessage("对话原文不会立即删除，可在“智能体对话知识管理—回收站”恢复。是否继续？")
            .setNegativeButton("取消", null)
            .setPositiveButton("移入回收站") { _, _ ->
                runCatching { conversationImportService.trash(item.getString("recordId")) }
                    .onSuccess { showMessage("已移入回收站", "可在智能体对话知识管理中恢复；永久删除前会再次检查证据依赖。") }
                    .onFailure { showMessage("移动失败", it.message ?: "未知错误") }
            }.show()
    }

    private fun chooseMaterialsForDigest() {
        val items = selectedStudent()?.let { materialQueueItems(listOf(it)) }.orEmpty().filter { materialPending(it) && digestEligible(it) }
        if (items.isEmpty()) { showMessage("没有可消化资料", "当前没有已准备好的待消化资料；图片或 PDF 需要先完成 OCR。"); return }
        showBatchMaterialPicker(items, MaterialBatchAction.DIGEST)
    }

    private fun digestEligible(item: MaterialQueueItem): Boolean =
        item.material.optString("fileName").substringAfterLast('.', "").lowercase() in DIGEST_TEXT_EXTENSIONS ||
            item.material.optString("ocrStatus") == "completed"

    private fun chooseDigestHistoryStudent() {
        withCurrentStudent { showDigestHistory(it) }
    }

    private fun showDigestHistory(student: StudentRecord) {
        val records = fileAssetService.materials(student.id)
            .filter { MaterialStatus.normalize(it.optString("status")) == MaterialStatus.PROCESSED || it.optString("digestedAt").isNotBlank() || it.optString("digestAttemptedAt").isNotBlank() }
            .sortedByDescending { it.optString("digestedAt").ifBlank { it.optString("digestAttemptedAt").ifBlank { it.optString("statusUpdatedAt") } } }
        if (records.isEmpty()) { showMessage("暂无消化记录", "${student.name} 还没有已完成的资料消化记录。"); return }
        val labels = records.map {
            val failed = it.optString("digestError").isNotBlank()
            val result = if (failed) "失败：${it.optString("digestError")}" else it.optString("digestResult").ifBlank { "已写入知识候选" }
            "${it.optString("fileName")}\n${it.optString("digestedAt").ifBlank { it.optString("digestAttemptedAt").ifBlank { it.optString("statusUpdatedAt") } }} · ${result.take(120)}"
        }.toTypedArray()
        AlertDialog.Builder(this).setTitle("${student.name} · 资料消化记录（${records.size}）")
            .setItems(labels) { _, which ->
                val record = records[which]; val path = record.optString("digestArtifactPath")
                if (path.isBlank()) showMessage("历史记录", "资料：${record.optString("fileName")}\n时间：${record.optString("digestedAt").ifBlank { record.optString("digestAttemptedAt") }}\n批次：${record.optString("digestBatchId")}\n结果：${record.optString("digestError").ifBlank { record.optString("digestResult").ifBlank { "已完成；旧记录未保存独立产物路径" } }}")
                else startActivity(Intent(this, MarkdownBrowserActivity::class.java)
                    .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_MATERIAL_DIGEST)
                    .putExtra(MarkdownBrowserActivity.EXTRA_STUDENT_ID, student.id)
                    .putExtra(MarkdownBrowserActivity.EXTRA_MATERIAL_ID, record.getString("id"))
                    .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, "${record.optString("fileName")} · 消化结果"))
            }.setNegativeButton("关闭", null).show()
    }

    private fun chooseMaterialsForOcr() {
        val items = selectedStudent()?.let { materialQueueItems(listOf(it)) }.orEmpty().filter(::supportsOcr)
        if (items.isEmpty()) { showMessage("没有可解析资料", "请先导入图片或 PDF。"); return }
        showBatchMaterialPicker(items)
    }

    private fun showBatchMaterialPicker(items: List<MaterialQueueItem>, preset: MaterialBatchAction? = null) {
        val selectable = items.take(MAX_BATCH_SELECTION)
        val checked = BooleanArray(selectable.size) { true }
        val labels = selectable.map { "${it.student.name} · ${materialWorkflowLabel(it)}" }.toTypedArray()
        val title = if (items.size > selectable.size) "选择资料（本批最多 $MAX_BATCH_SELECTION 份）" else "选择资料（可多选）"
        val dialog = AlertDialog.Builder(this).setTitle(title)
            .setMultiChoiceItems(labels, checked) { _, which, value -> checked[which] = value }
            .setNegativeButton("取消", null)
            .setNeutralButton("全不选") { _, _ -> }
            .setPositiveButton("下一步", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                checked.indices.forEach { index -> checked[index] = false; dialog.listView.setItemChecked(index, false) }
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val selected = selectable.indices.filter { checked[it] }.map { selectable[it] }
                if (selected.isEmpty()) { showMessage("尚未选择资料", "请至少选择一份资料。"); return@setOnClickListener }
                dialog.dismiss()
                if (preset == null) showMaterialActions(selected) else runMaterialBatch(selected, preset)
            }
        }
        dialog.show()
    }

    private fun showMaterialActions(items: List<MaterialQueueItem>) {
        val actions = listOf(
            MaterialBatchAction.LOCAL_OCR,
            MaterialBatchAction.OCR_AND_VISION,
            MaterialBatchAction.DIGEST,
            MaterialBatchAction.RETRY,
        )
        AlertDialog.Builder(this).setTitle("处理已选 ${items.size} 份资料")
            .setItems(actions.map { it.label }.toTypedArray()) { _, which -> runMaterialBatch(items, actions[which]) }
            .setNegativeButton("取消", null).show()
    }

    private fun runMaterialBatch(items: List<MaterialQueueItem>, action: MaterialBatchAction) {
        when (action) {
            MaterialBatchAction.LOCAL_OCR -> runBatchOcr(items, false)
            MaterialBatchAction.OCR_AND_VISION -> runBatchOcr(items, true)
            MaterialBatchAction.DIGEST -> runBatchDigest(items)
            MaterialBatchAction.RETRY -> retryFailedMaterials(items)
        }
    }

    private fun supportsOcr(item: MaterialQueueItem): Boolean =
        item.material.optString("fileName").substringAfterLast('.', "").lowercase() in OCR_EXTENSIONS

    private fun runBatchOcr(items: List<MaterialQueueItem>, includeVision: Boolean) {
        val eligible = items.filter(::supportsOcr)
        if (eligible.isEmpty()) { showMessage("没有可解析资料", "所选资料中没有图片或 PDF。"); return }
        val progress = showProgress(if (includeVision) "批量 OCR + 视觉理解" else "批量本地 OCR", "正在准备 ${eligible.size} 份资料……")
        Thread {
            var completed = 0
            val failures = mutableListOf<String>()
            eligible.forEachIndexed { index, item ->
                runOnUiThread { progress.setMessage("${index + 1}/${eligible.size} · ${item.student.name} · ${item.material.optString("fileName")}") }
                runCatching { OcrVisionService(this).extract(item.student.id, item.material.getString("id"), includeVision) }
                    .onSuccess { completed += 1 }
                    .onFailure { failures += "${item.material.optString("fileName")}：${it.message ?: "解析失败"}" }
            }
            runOnUiThread {
                progress.dismiss(); refreshStudents()
                if (activeSection == AppSection.MATERIALS) renderSection(AppSection.MATERIALS, activeMaterialQueueFilter)
                showMessage("批量解析完成", "成功 $completed 份，失败 ${failures.size} 份。${if (failures.isEmpty()) "" else "\n\n${failures.take(5).joinToString("\n")}"}")
            }
        }.start()
    }

    private fun runBatchDigest(items: List<MaterialQueueItem>) {
        val eligible = items.filter {
            materialPending(it) && (it.material.optString("fileName").substringAfterLast('.', "").lowercase() in DIGEST_TEXT_EXTENSIONS || it.material.optString("ocrStatus") == "completed")
        }
        if (eligible.isEmpty()) { showMessage("没有可消化资料", "请先对图片或 PDF 完成本地 OCR；文本、Markdown、CSV 和 JSON 可直接消化。"); return }
        val groups = eligible.groupBy { it.student.id }
        val progress = showProgress("批量消化资料", "正在准备 ${eligible.size} 份资料……")
        Thread {
            var completed = 0
            val failures = mutableListOf<String>()
            groups.values.forEachIndexed { index, group ->
                val student = group.first().student
                runOnUiThread { progress.setMessage("${index + 1}/${groups.size} · ${student.name} · ${group.size} 份资料") }
                runCatching { StudentDigestOrchestrator(this).digestSelected(student.id, group.map { it.material.getString("id") }.toSet()) }
                    .onSuccess { completed += it.optInt("processed") }
                    .onFailure { failures += "${student.name}：${it.message ?: "消化失败"}" }
            }
            runOnUiThread {
                progress.dismiss(); refreshStudents()
                if (activeSection == AppSection.MATERIALS) renderSection(AppSection.MATERIALS, activeMaterialQueueFilter)
                showMessage("批量消化完成", "已处理 $completed 份，失败 ${failures.size} 组；知识声明仍保持候选状态。${if (failures.isEmpty()) "" else "\n\n${failures.take(5).joinToString("\n")}"}")
            }
        }.start()
    }

    private fun retryFailedMaterials(items: List<MaterialQueueItem>) {
        var reset = 0
        val failures = mutableListOf<String>()
        items.forEach { item ->
            runCatching {
                val material = item.material
                if (MaterialStatus.normalize(material.optString("status")) == MaterialStatus.FAILED) {
                    fileAssetService.transitionMaterial(item.student.id, material.getString("id"), MaterialStatus.PENDING_DIGEST)
                }
                val patch = JSONObject()
                if (material.optString("ocrStatus") == "failed") patch.put("ocrStatus", "pending").put("ocrError", "")
                if (material.optString("visionStatus") in setOf("failed", "unavailable")) patch.put("visionStatus", "pending").put("visionError", "")
                if (patch.length() > 0) fileAssetService.patchMaterial(item.student.id, material.getString("id"), patch)
                reset += 1
            }.onFailure { failures += "${item.material.optString("fileName")}：${it.message ?: "重试准备失败"}" }
        }
        if (activeSection == AppSection.MATERIALS) renderSection(AppSection.MATERIALS, activeMaterialQueueFilter)
        showMessage("已重新加入处理队列", "已重置 $reset 份，失败 ${failures.size} 份。现在可再次执行 OCR、视觉理解或资料消化。${if (failures.isEmpty()) "" else "\n\n${failures.take(5).joinToString("\n")}"}")
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
        withCurrentStudent { student ->
            val results = fileAssetService.materials(student.id).filter { it.optString("ocrStatus") == "completed" && it.optString("ocrMarkdownPath").isNotBlank() }
            if (results.isEmpty()) { showMessage("没有识别结果", "${student.name} 当前没有已经完成的图片文字识别结果。"); return@withCurrentStudent }
            AlertDialog.Builder(this).setTitle("${student.name} · OCR 结果").setItems(results.map { it.optString("fileName") }.toTypedArray()) { _, which ->
                openOcrResult(student.id, results[which].optString("id"))
            }.show()
        }
    }

    private fun openOcrResult(studentId: String, materialId: String) {
        startActivity(Intent(this, MarkdownBrowserActivity::class.java)
            .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_OCR)
            .putExtra(MarkdownBrowserActivity.EXTRA_STUDENT_ID, studentId)
            .putExtra(MarkdownBrowserActivity.EXTRA_MATERIAL_ID, materialId)
            .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, "OCR 识别结果"))
    }

    private fun chooseGrowthStudent() {
        withCurrentStudent { showGrowthActions(it) }
    }

    private fun showGrowthActions(student: StudentRecord) {
        val pendingCount = runCatching { GrowthModelService(this).candidates(student.id).count { it.optString("status") in setOf("pending", "watching") } }.getOrDefault(0)
        val actions = arrayOf("查看成长模型摘要", "审核待确认成长证据（$pendingCount）", "高级：手工添加成长证据", "高级：修复成长模型索引")
        AlertDialog.Builder(this).setTitle("${student.name} · 成长模型").setItems(actions) { _, which -> when (which) {
            0 -> showGrowthSummary(student)
            1 -> reviewGrowthCandidate(student)
            2 -> showGrowthCandidateDialog(student)
            3 -> runCatching { GrowthModelService(this).rebuildIndex(student.id) }.onSuccess { showMessage("索引已重建", "成长模型结构化索引已更新。") }.onFailure { showMessage("重建失败", it.message ?: "未知错误") }
        } }.show()
    }

    private fun showGrowthSummary(student: StudentRecord) {
        runCatching { GrowthModelService(this).rebuildIndex(student.id).getJSONObject("summary") }
            .onSuccess { summary -> showMessage("${student.name} · 成长模型", "成长证据：${summary.optInt("evidenceCount")}\n已确认：${summary.optInt("confirmedCount")}\n待审核：${summary.optInt("pendingCount")}\n继续观察：${summary.optInt("watchingCount")}\n能力维度：${summary.optInt("abilityCount")}\n关联项目：${summary.optInt("projectCount")}") }
            .onFailure { showMessage("成长模型不可用", it.message ?: "未知错误") }
    }

    private fun chooseReportStudent() {
        withCurrentStudent { showReports(it) }
    }

    private fun showReports(student: StudentRecord) {
        val service = GrowthModelService(this)
        val reports = GrowthModelService.REPORTS.mapNotNull { definition ->
            runCatching { service.readPublishedReport(student.id, definition.id) }.getOrNull()
                ?.takeIf(EducationPublicationPolicy::hasMeaningfulBody)?.let { definition to it }
        }
        if (reports.isEmpty()) {
            AlertDialog.Builder(this).setTitle("暂无学情报告")
                .setMessage("当前只有空白模板。确认成长证据后，可以直接生成并发布四份正式报告。")
                .setNegativeButton("取消", null)
                .setNeutralButton("云端报告") { _, _ -> showCloudReportActions(student) }
                .setPositiveButton("生成并发布") { _, _ -> generateAndPublishReports(student) }
                .show()
            return
        }
        val labels = reports.map { (definition, source) ->
            val formal = runCatching { EducationPublicationPolicy.validatePublishedReport(student.id, definition.title, source) }.isSuccess
            "${definition.title} · ${if (formal) "正式报告" else "已有内容，仅供查看"}"
        }.toTypedArray()
        AlertDialog.Builder(this).setTitle("${student.name} · 选择报告（${reports.size} 份）").setItems(labels) { _, index ->
            val definition = reports[index].first
            startActivity(Intent(this, MarkdownBrowserActivity::class.java)
                .putExtra(MarkdownBrowserActivity.EXTRA_MODE, MarkdownBrowserActivity.MODE_REPORT)
                .putExtra(MarkdownBrowserActivity.EXTRA_STUDENT_ID, student.id)
                .putExtra(MarkdownBrowserActivity.EXTRA_REPORT_ID, definition.id)
                .putExtra(MarkdownBrowserActivity.EXTRA_TITLE, definition.title))
        }.setNegativeButton("取消", null).setNeutralButton("云端报告") { _, _ -> showCloudReportActions(student) }.show()
    }

    private fun showCloudReportActions(student: StudentRecord) {
        val sync = CloudReportSync(this)
        val status = sync.status(student.id)
        val legacyService = !sync.usesOfficialService()
        val actions = if (legacyService) arrayOf("测试阿里云连接", "打开阿里云云端文档", "切换到阿里云正式服务")
            else if (!status.configured) arrayOf("测试阿里云连接", "打开阿里云云端文档", "开通当前学生自动上传")
            else if (status.enabled) arrayOf("查看同步状态", "测试阿里云连接", "打开阿里云云端文档", "关闭自动上传", "Windows主机下载许可", "重新开通来源许可")
            else arrayOf("查看同步状态", "测试阿里云连接", "打开阿里云云端文档", "重新开启自动上传", "重新开通来源许可")
        AlertDialog.Builder(this).setTitle("${student.name} · 云端文档")
            .setItems(actions) { _, which ->
                when (actions[which]) {
                    "测试阿里云连接" -> Thread {
                        val result = runCatching { sync.checkOfficialConnection() }
                        runOnUiThread { showMessage("云端连接", result.getOrElse { it.message ?: "网络不可用" }) }
                    }.start()
                    "打开阿里云云端文档" -> startActivity(Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse(sync.officialServiceAddress().trimEnd('/') + "/")))
                    "切换到阿里云正式服务" -> confirmOfficialCloudSwitch(sync)
                    "开通当前学生自动上传", "重新开通来源许可" -> showCloudEnrollmentDialog(student)
                    "关闭自动上传" -> { sync.setUpload(student.id, false); showMessage("已关闭自动上传", "本机待上传任务已停止；云端上传开关将在联网后同步关闭，不删除已有报告。") }
                    "重新开启自动上传" -> { sync.setUpload(student.id, true); showMessage("已重新开启", "当前有效的正式报告将在联网后补传，后续更新继续自动上传。") }
                    "Windows主机下载许可" -> showCloudPairingApprovalDialog(student)
                    else -> showMessage("云端同步状态", "服务：${sync.serviceAddress()}\n自动上传：${if (status.enabled) "开启" else "关闭"}\n云端开关待同步：${status.pendingServerState.ifBlank { "无" }}\n最近同步：${if (status.lastSyncAt > 0) java.text.DateFormat.getDateTimeInstance().format(java.util.Date(status.lastSyncAt)) else "尚未完成"}\n${status.lastError.ifBlank { "无失败记录" }}")
                }
            }.setNegativeButton("关闭", null).show()
    }

    private fun confirmOfficialCloudSwitch(sync: CloudReportSync) {
        AlertDialog.Builder(this).setTitle("切换到阿里云正式服务")
            .setMessage("将停止并清除本机保存的旧试点云端许可，然后固定使用：\n${sync.officialServiceAddress()}\n\n本机报告不会删除；旧服务上的数据和许可也不会被远程删除。切换后，需要在阿里云管理页为每名学生重新生成一次性开通码。")
            .setNegativeButton("取消", null).setPositiveButton("确认切换") { _, _ ->
                val count = sync.switchToOfficialService()
                showMessage("已切换到阿里云正式服务", "已停止 $count 名学生的旧云端任务。本机报告保持不变，请使用阿里云管理页生成的新开通码重新开通。")
            }.show()
    }

    private fun showCloudEnrollmentDialog(student: StudentRecord) {
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 12, 40, 0) }
        val sync = CloudReportSync(this)
        fields.addView(TextView(this).apply {
            text = "阿里云正式服务\n${sync.officialServiceAddress()}"
            textSize = 14f; setTextColor(palette.muted); setPadding(0, 0, 0, dp(12)); setTextIsSelectable(true)
        }, matchWrap())
        val code = EditText(this).apply { hint = "当前学生的一次性开通码"; fields.addView(this, matchWrap()) }
        AlertDialog.Builder(this).setTitle("开通 ${student.name} 的云端报告")
            .setView(fields).setNegativeButton("取消", null).setPositiveButton("确认并开启") { _, _ ->
                val value = code.text.toString().trim()
                Thread {
                    val result = runCatching { CloudReportSync(this).enrollOfficial(student.id, value) }
                    runOnUiThread { result.onSuccess { showMessage("已开启自动上传", "当前正式报告及以后更新将由后台自动上传；无需逐份确认。") }
                        .onFailure { showMessage("开通失败", it.message ?: "请检查阿里云服务和开通码") } }
                }.start()
            }.show()
    }

    private fun showCloudPairingApprovalDialog(student: StudentRecord) {
        val code = EditText(this).apply { hint = "接收 Windows 出示的 8 位配对码" }
        AlertDialog.Builder(this).setTitle("为 Windows 开通 ${student.name} 的下载许可")
            .setMessage("确认后，这台 Windows 可持续下载该学生后续的云端报告和许可文档；无需每次下载重新开通。")
            .setView(code).setNegativeButton("取消", null).setPositiveButton("确认开通") { _, _ ->
                val value = code.text.toString().trim()
                Thread {
                    val result = runCatching { CloudReportSync(this).approvePairing(student.id, value) }
                    runOnUiThread { result.onSuccess { showMessage("下载许可已开通", "接收 Windows 刷新许可列表后即可查看该学生云端文档。") }
                        .onFailure { showMessage("开通失败", it.message ?: "请检查配对码") } }
                }.start()
            }.show()
    }

    private fun chooseStudentForReportPublication() {
        withCurrentStudent { student -> confirmReportGeneration(student) }
    }

    private fun chooseReportForPublication(student: StudentRecord) {
        val service = GrowthModelService(this)
        val reports = GrowthModelService.REPORTS.map { definition ->
            definition to runCatching { service.readPublishedReport(student.id, definition.id) }
        }
        val definitions = reports.filter { (definition, source) ->
            source.mapCatching { EducationPublicationPolicy.validatePublishedReport(student.id, definition.title, it) }.isSuccess
        }.map { it.first }
        if (definitions.isEmpty()) {
            val existing = reports.filter { (_, source) -> source.getOrNull()?.let(EducationPublicationPolicy::hasMeaningfulBody) == true }
            if (existing.isNotEmpty()) {
                AlertDialog.Builder(this).setTitle("找到已有报告，未自动覆盖")
                    .setMessage("已找到 ${existing.size} 份包含正文的学情报告，但其发布状态或学生归属未通过输出校验。为保护原报告，本入口不会重新生成或覆盖。请先查看已有报告，确认状态后再处理。")
                    .setNegativeButton("关闭", null)
                    .setPositiveButton("查看已有报告") { _, _ -> showReports(student) }
                    .show()
                return
            }
            AlertDialog.Builder(this).setTitle("暂无可输出的正式报告")
                .setMessage("当前学生还没有包含有效内容的正式报告。可以现在依据已确认的成长证据，一键生成并发布四份报告。")
                .setNegativeButton("取消", null)
                .setPositiveButton("生成并发布") { _, _ -> generateAndPublishReports(student, openPublicationAfter = true) }
                .show()
            return
        }
        // AlertDialog's message and item list share the same content panel on some Android builds.
        // Keeping the count in the title ensures the selectable report rows are actually rendered.
        AlertDialog.Builder(this).setTitle("${student.name} · 选择报告（${definitions.size} 份）")
            .setItems(definitions.map { it.title }.toTypedArray()) { _, index ->
                val definition = definitions[index]
                val result = runCatching {
                    val source = GrowthModelService(this).readPublishedReport(student.id, definition.id)
                    EducationPublicationPolicy.validatePublishedReport(student.id, definition.title, source)
                }
                result.onSuccess {
                    startActivity(Intent(this, EducationPublicationActivity::class.java)
                        .putExtra(EducationPublicationActivity.EXTRA_STUDENT_ID, student.id)
                        .putExtra(EducationPublicationActivity.EXTRA_REPORT_ID, definition.id))
                }.onFailure { showMessage("该报告暂不能输出", it.message ?: "报告尚未正式发布") }
            }.setNegativeButton("取消", null).show()
    }

    private fun confirmReportGeneration(student: StudentRecord) {
        val service = GrowthModelService(this)
        val existing = GrowthModelService.REPORTS.count { definition ->
            runCatching { service.readPublishedReport(student.id, definition.id) }
                .getOrNull()?.let(EducationPublicationPolicy::hasMeaningfulBody) == true
        }
        if (existing == 0) {
            generateAndPublishReports(student)
            return
        }
        AlertDialog.Builder(this).setTitle("更新已有学情报告？")
            .setMessage("当前学生已有 $existing 份包含正文的报告。继续会依据最新的已确认成长证据更新四份正式报告；只有在你明确确认后才会写入。")
            .setNegativeButton("取消", null)
            .setPositiveButton("确认更新并发布") { _, _ -> generateAndPublishReports(student) }
            .show()
    }

    private fun showGrowthCandidateDialog(student: StudentRecord) {
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 12, 40, 0) }
        fun field(hintText: String) = EditText(this).apply { hint = hintText; fields.addView(this, matchWrap()) }
        val title = field("证据标题（必填）"); val ability = field("支撑能力（选填）"); val content = field("观察内容")
        val dialog = AlertDialog.Builder(this).setTitle("添加成长证据候选")
            .setMessage("填写后从已导入的原始资料中选择依据，不需要填写 URI 或文件标识。")
            .setView(fields).setNegativeButton("取消", null).setPositiveButton("下一步：选择资料", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                when {
                    title.text.isBlank() -> { title.error = "请填写证据标题"; title.requestFocus() }
                    content.text.isBlank() -> { content.error = "请填写观察内容"; content.requestFocus() }
                    FileAssetService(this).materials(student.id).isEmpty() ->
                        showMessage("还没有原始资料", "请先在“资料收集与处理”导入文件或拍照，再回来添加成长证据。")
                    else -> {
                        val titleValue = title.text.toString(); val abilityValue = ability.text.toString(); val contentValue = content.text.toString()
                        dialog.dismiss()
                        chooseSourceForNewGrowthCandidate(student, titleValue, abilityValue, contentValue)
                    }
                }
            }
        }
        dialog.show()
    }

    private fun reviewGrowthCandidate(student: StudentRecord) {
        val service = GrowthModelService(this); val candidates = service.candidates(student.id).filter { it.optString("status") in setOf("pending", "watching") }
        if (candidates.isEmpty()) { showMessage("没有待审核候选", "当前没有待审核或继续观察的成长证据。"); return }
        AlertDialog.Builder(this).setTitle("选择成长证据").setItems(candidates.map { "${it.optString("title")} · ${growthStatusLabel(it.optString("status"))}" }.toTypedArray()) { _, index ->
            val item = candidates[index]
            val needsSource = GrowthEvidencePolicy.requiresPrimarySource(item)
            val sourceLabel = if (needsSource) "缺少可核验的原始资料（历史报告不能作为自身证据）"
                else item.optString("sourceName").ifBlank { "已关联原始资料" }
            val builder = AlertDialog.Builder(this).setTitle(item.optString("title")).setMessage("来源：$sourceLabel\n能力：${item.optString("ability")}\n\n${item.optString("content")}")
                .setNegativeButton("驳回") { _, _ -> reviewGrowth(student, item, "rejected") }
                .setNeutralButton("继续观察") { _, _ -> reviewGrowth(student, item, "watching") }
            if (needsSource) builder.setPositiveButton("选择资料并确认") { _, _ -> chooseGrowthCandidateSource(student, item, confirmAfterSelection = true) }
            else builder.setPositiveButton("确认采用") { _, _ -> reviewGrowth(student, item, "confirmed") }
            builder.show()
        }.show()
    }

    private fun chooseSourceForNewGrowthCandidate(student: StudentRecord, title: String, ability: String, content: String) {
        if (title.isBlank()) { showMessage("请填写证据标题", "用一句普通的话说明这条成长证据，例如“能够独立完成实验记录”。"); return }
        if (content.isBlank()) { showMessage("请填写观察内容", "说明你从资料中看到了什么；没有观察内容的候选不会保存。"); return }
        val materials = FileAssetService(this).materials(student.id)
        if (materials.isEmpty()) { showMessage("还没有原始资料", "请先在“资料收集与处理”导入文件或拍照，再回来添加成长证据。"); return }
        val labels = materials.map(::growthSourceLabel).toTypedArray()
        AlertDialog.Builder(this).setTitle("选择这条证据依据的资料").setItems(labels) { _, index ->
            val material = materials[index]
            runCatching {
                val sourceUri = "edu://student/${student.id}/raw/${material.getString("id")}"
                val candidate = GrowthModelService(this).addCandidate(student.id, title, ability, sourceUri, content)
                GrowthModelService(this).attachCandidateSource(student.id, candidate.getString("id"), material.getString("id"), material.optString("fileName"))
            }.onSuccess { showMessage("候选已保存", "资料已自动关联；这条证据仍需在审核列表中确认后才会进入成长模型。") }
                .onFailure { showMessage("保存失败", it.message ?: "未知错误") }
        }.setNegativeButton("取消", null).show()
    }

    private fun chooseGrowthCandidateSource(student: StudentRecord, item: org.json.JSONObject, confirmAfterSelection: Boolean = false) {
        val materials = FileAssetService(this).materials(student.id)
        if (materials.isEmpty()) { showMessage("没有可选原始资料", "请先在“资料收集与处理”导入、拍照或采集原始资料，再返回补充来源。"); return }
        val labels = materials.map(::growthSourceLabel).toTypedArray()
        AlertDialog.Builder(this).setTitle("选择支撑这条证据的原始资料").setItems(labels) { _, index ->
            val material = materials[index]
            runCatching {
                val service = GrowthModelService(this)
                service.attachCandidateSource(student.id, item.getString("id"), material.getString("id"), material.optString("fileName"))
                if (confirmAfterSelection) service.reviewCandidate(student.id, item.getString("id"), "confirmed", "本机用户选择原始资料后确认采用")
            }.onSuccess {
                if (confirmAfterSelection) showMessage("已确认采用", "原始资料已自动关联，证据已进入成长模型。")
                else showMessage("来源已补充", "原始资料已自动关联，该候选现在可以确认采用。")
            }
                .onFailure { showMessage("补充来源失败", it.message ?: "未知错误") }
        }.setNegativeButton("取消", null).show()
    }

    private fun growthSourceLabel(material: org.json.JSONObject): String {
        val source = material.optString("sourceName").ifBlank { material.optString("sourceType") }
        return "${material.optString("fileName")} · ${source.ifBlank { "原始资料" }}"
    }

    private fun reviewGrowth(student: StudentRecord, item: org.json.JSONObject, status: String) {
        runCatching { GrowthModelService(this).reviewCandidate(student.id, item.getString("id"), status, "本机用户逐条审核") }
            .onSuccess {
                val title = when (status) { "confirmed" -> "已确认采用"; "watching" -> "已设为继续观察"; "rejected" -> "已驳回"; else -> "审核已记录" }
                val detail = when (status) { "confirmed" -> "这条证据已进入成长模型。"; "watching" -> "这条证据会保留在待审核列表，方便以后补充资料。"; "rejected" -> "这条证据不会进入成长模型。"; else -> "证据状态已更新。" }
                showMessage(title, detail)
            }.onFailure { showMessage("审核失败", it.message ?: "未知错误") }
    }

    private fun growthStatusLabel(status: String) = when (status) {
        "confirmed" -> "已确认"
        "watching" -> "继续观察"
        "rejected" -> "已驳回"
        else -> "待审核"
    }

    private fun generateAndPublishReports(student: StudentRecord, openPublicationAfter: Boolean = false) {
        val progress = showProgress("正在生成并发布报告", "正在读取已确认成长证据；Agent 异常时会自动使用保守内容。")
        Thread {
            val result = runCatching { GrowthModelService(this).generateAndPublishReports(student.id) }
            runOnUiThread {
                progress.dismiss()
                result.onSuccess { generated ->
                    val warnings = generated.optJSONArray("warnings")
                    val detail = buildString {
                        append(generated.optString("message", "四份正式报告已生成并发布。"))
                        if (warnings != null && warnings.length() > 0) append("\n\n自动保守处理 ${warnings.length()} 项模型漏项或无依据内容。")
                    }
                    AlertDialog.Builder(this).setTitle("报告已生成并发布").setMessage(detail)
                        .setNegativeButton("完成", null)
                        .setNeutralButton("查看报告") { _, _ -> showReports(student) }
                        .setPositiveButton(if (openPublicationAfter) "继续导出打印" else "导出打印") { _, _ -> chooseReportForPublication(student) }
                        .show()
                }.onFailure { showMessage("报告生成失败", it.message ?: "未知错误") }
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
        withCurrentStudent("请先建立学生档案。课程学习与采集必须绑定一个明确学生。") { student ->
            val courses = runCatching { courseCatalogService.effectiveCourses(student.id) }.getOrElse { showMessage("课程目录不可用", it.message ?: "未知错误"); return@withCurrentStudent }
            if (courses.isEmpty()) showMessage("没有可学习课程", "请导入平台发放的 .edu-coursepkg，或从 Windows 主机为该学生导入 U 盘迁移目录。")
            else showPlatformCourses(student, courses)
        }
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
            details.addView(TextView(this).apply { text = course.name; textSize = 19f; setTextColor(palette.heading) }, matchWrap())
            details.addView(TextView(this).apply { text = course.summary; textSize = 14f; setTextColor(palette.text); maxLines = 4; setPadding(0, dp(5), 0, dp(5)) }, matchWrap())
            details.addView(TextView(this).apply { text = "${if (course.type == "tenant_custom") "机构课程" else "平台课程"} · ${course.provider} · 点击查看学习选项"; textSize = 13f; setTextColor(palette.muted) }, matchWrap())
            card.addView(details, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            list.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, 0, dp(12)) })
        }
        val scroll = ScrollView(this).apply { addView(list) }
        AlertDialog.Builder(this).setTitle("${student.name} · 课程（${courses.size}）").setView(scroll).setPositiveButton("关闭", null).show()
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
    private data class MaterialQueueItem(val student: StudentRecord, val material: JSONObject)
    private data class YouthAction(
        val icon: String,
        val title: String,
        val detail: String,
        val badge: String = "",
        val tone: Int = -1,
        val spanColumns: Int = 1,
        val action: () -> Unit,
    )
    private data class AgentToolDefinition(
        val id: String,
        val displayName: String,
        val description: String,
        val packages: List<String>,
        val officialDownloadUrl: String,
        val allowedDownloadHost: String,
    )

    companion object {
        const val STATE_SECTION = "active_section"
        const val EXTRA_OPEN_CONVERSATION_IMPORT = "open_conversation_import"
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
        const val REQUEST_OFFLINE_MIGRATION_SOURCE = 2115
        const val REQUEST_OFFLINE_MIGRATION_TARGET = 2116
        const val REQUEST_DEVICE_MIGRATION_EXPORT_TARGET = 2117
        const val REQUEST_DEVICE_MIGRATION_SOURCE = 2118
        const val REQUEST_DEVICE_MIGRATION_TARGET = 2119
        const val REQUEST_DEVICE_MIGRATION_NOTIFICATION = 2120
        const val REQUEST_PROJECT_PACKAGE_SOURCE = 2121
        const val OFFLINE_MIGRATION_POLL_MS = 1_000L
        const val UI_CONTEXT_PREFS = "standalone_ui_context"
        const val KEY_CURRENT_STUDENT_ID = "current_student_id"
        const val MAX_VISIBLE_MATERIAL_GROUPS = 100
        const val MAX_BATCH_SELECTION = 200
        val OCR_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "bmp", "pdf")
        val DIGEST_TEXT_EXTENSIONS = setOf("txt", "md", "csv", "json")
    }

    private enum class MaterialQueueFilter(val label: String) {
        ALL("全部"), ACTION_REQUIRED("处理中"), NEEDS_HELP("需要补充")
    }

    private enum class MaterialBatchAction(val label: String) {
        LOCAL_OCR("批量本地 OCR"),
        OCR_AND_VISION("批量 OCR + 视觉理解"),
        DIGEST("批量消化"),
        RETRY("将失败项重新加入待处理"),
    }

    private fun renderPlanning() {
        sectionNote("只保存不可变候选版本。联网研究须有真实来源；学生档案中没有的信息不推断。实际采用、项目创建、报名和申请由用户确认。")
        LearningStudioService.moduleLabels.forEach { (module, label) ->
            sectionContent.addView(themedButton(label, YouthButtonRole.COMPACT) { withCurrentStudent { student ->
                startActivity(Intent(this, LearningStudioActivity::class.java).putExtra("studentId", student.id).putExtra("module", module))
            } }, matchWrap())
        }
        sectionContent.addView(themedButton("更新记录与自动练习状态", YouthButtonRole.COMPACT) { withCurrentStudent { startActivity(Intent(this, TaskCenterActivity::class.java).putExtra(TaskCenterActivity.EXTRA_STUDENT_ID, it.id)) } }, matchWrap())
    }
    private fun renderKnowledgeDomain() {
        sectionNote("保留原有教育档案、问答和协作入口。资料分类、知识消化与贡献确认是不同状态。")
        sectionContent.addView(themedButton("当前学生知识档案（原入口）", YouthButtonRole.COMPACT) { renderSection(AppSection.ARCHIVES) }, matchWrap())
        sectionContent.addView(themedButton("助手问答与已保存对话（原入口）", YouthButtonRole.COMPACT) { renderSection(AppSection.ASSISTANT) }, matchWrap())
        sectionContent.addView(themedButton("统一搜索与来源定位", YouthButtonRole.COMPACT) { withCurrentStudent { startActivity(Intent(this, LearningStudioActivity::class.java).putExtra("studentId", it.id)) } }, matchWrap())
        sectionContent.addView(themedButton("知识协作与设备绑定", YouthButtonRole.COMPACT) { startActivity(Intent(this, CollaborationActivity::class.java)) }, matchWrap())
    }
    private enum class AppSection(val label: String, val icon: String) {
        HOME("首页", "⌂"),
        ARCHIVES("教育档案", "▣"), MATERIALS("资料收集与处理", "＋"), COURSES("课程中心", "▶"), ASSISTANT("AI助手问答", "✦"),
        GROWTH("学情与学习", "↗"), REPORTS("学情报告", "☰"), PROJECTS("项目与成果", "◆"),
        PLANNING("规划与指导", "✧"), KNOWLEDGE("知识与协作", "▣"), SETTINGS("系统设置", "⚙");

        val displayLabel: String get() = "$icon  $label"
    }
}
