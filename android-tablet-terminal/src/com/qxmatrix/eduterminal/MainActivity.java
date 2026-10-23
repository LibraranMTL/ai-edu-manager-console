package com.qxmatrix.eduterminal;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.SslErrorHandler;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.net.http.SslError;

import org.json.JSONArray;
import org.json.JSONObject;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.DecodeHintType;
import com.google.zxing.LuminanceSource;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.GlobalHistogramBinarizer;
import com.google.zxing.common.HybridBinarizer;
import com.qxmatrix.projectmaterials.ProjectMaterialsDialog;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Hashtable;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.security.MessageDigest;

public class MainActivity extends Activity implements View.OnClickListener, AdapterView.OnItemSelectedListener {
    static final int HOST_DISCOVERY_PORT = 18778;
    static final String HOST_DISCOVERY_REQUEST_V1 = "AI_EDU_MANAGER_DISCOVER_V1";
    static final String HOST_DISCOVERY_REQUEST_V2 = "AI_EDU_MANAGER_DISCOVER";
    static final int PAIR_PROTOCOL_VERSION = 2;
    static final int REQUEST_PICK_MATERIAL = 8101;
    static final int REQUEST_PICK_IMAGE = 8102;
    static final int REQUEST_TAKE_PHOTO = 8103;
    static final int REQUEST_SCAN_PAIR = 8104;
    static final int REQUEST_CAPTURE_PAIR_QR = 8105;
    static final int REQUEST_SCREEN_CAPTURE = 8106;
    static final int REQUEST_NOTIFICATION_PERMISSION = 8107;
    static final int REQUEST_EXPORT_CONNECTION_BACKUP = 8108;
    static final int REQUEST_IMPORT_CONNECTION_BACKUP = 8109;
    static final int REQUEST_CAPTURE_STUDENT_QR = 8110;
    static final int REQUEST_AUTO_DELIVERY_FOLDER = 8111;
    static final int REQUEST_DIRECT_UPLOAD = 8112;
    static final int REQUEST_DIRECT_IMAGE_UPLOAD = 8113;
    static final int REQUEST_IMPORT_CONVERSATION_FILE = 8114;
    static final String VERSION_NAME = "0.6.24";
    static final int VERSION_CODE = 94;
    static final String CONNECTION_BACKUP_KIND = "ai-edu-manager-tablet-connection-backup";
    static final int CONNECTION_BACKUP_VERSION = 1;
    static final String UPDATE_MANIFEST_URL = "https://www.greatbg.com/download/edu-manager-version.json";
    static final String TAILSCALE_APK_URL = "https://www.greatbg.com/download/tailscalev1.88.1_nbwe_7273.com.apk";
    static final String USER_AGREEMENT_URL = "https://www.greatbg.com/download/agreement.html";
    static final String PRIVACY_POLICY_URL = "https://www.greatbg.com/download/privacy.html";
    static final String STANDALONE_DOWNLOAD_URL = "https://www.greatbg.com/download.html";
    static final String STANDALONE_PACKAGE = "com.qxmatrix.edumanager.standalone";
    static final String STANDALONE_MIGRATION_ACTION = "com.qxmatrix.edumanager.standalone.IMPORT_STUDENT_MIGRATION";
    static final String APK_PROVIDER_AUTHORITY = "com.qxmatrix.eduterminal.apkprovider";
    private static final String[] MATERIAL_MIME_TYPES = new String[] {
        "image/*",
        "application/pdf",
        "text/plain",
        "text/markdown",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    };

    private static final String PREFS = "edu_terminal_prefs";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String PREF_API_TOKEN = "api_token";
    private static final String PREF_STUDENT_SESSION_TOKEN = "student_session_token";
    private static final String PREF_STUDENT_SESSION_ID = "student_session_student_id";
    private static final String PREF_TERMINAL_MODE = "terminal_mode";
    private static final String PREF_REMOTE_URL = "remote_url";
    private static final String PREF_ENDPOINT_CANDIDATES = "endpoint_candidates";
    private static final String PREF_LAST_SUCCESSFUL_URL = "last_successful_url";
    private static final String PREF_CONNECTION_MODE = "connection_mode";
    private static final String PREF_LAYOUT_MODE = "layout_mode";
    private static final String PREF_SKIN = "skin";
    private static final String PREF_DEVICE_ID = "device_id";
    private static final String PREF_LAST_CONNECTED_AT = "last_connected_at";
    private static final String PREF_HOST_DEVICE_ID = "host_device_id";
    private static final String PREF_HOST_MACHINE_CODE = "host_machine_code";
    private static final String PREF_HOST_DISPLAY_NAME = "host_display_name";
    private static final String PREF_HOST_DATA_GENERATION = "host_data_generation";
    private static final String PREF_PENDING_CONVERSATION_TEXT = "pending_conversation_text";
    private static final String PREF_PENDING_CONVERSATION_SOURCE = "pending_conversation_source";
    private static final String PREF_PENDING_CONVERSATION_REFERENCE = "pending_conversation_reference";
    private static final String PREF_CAPTURE_AUTO_DELIVERY_DEFAULT = "capture_auto_delivery_default";
    private static final int MAX_CONVERSATION_CHARS = 60000;
    private static final String CACHE_ARCHIVE_FILES_PREFIX = "archive_files_";
    private static final String CACHE_MARKDOWN_PREFIX = "markdown_";
    private static final String CACHE_MARKDOWN_TITLE_PREFIX = "markdown_title_";
    private static final String CACHE_TIME_PREFIX = "cache_time_";

    EditText serverInput;
    EditText tokenInput;
    EditText remoteInput;
    Spinner connectionModeSpinner;
    TextView statusText;
    TextView connectionSummaryText;
    TextView connectionHintText;
    TextView machineCodeText;
    TextView uploadResultText;
    TextView uploadQueueText;
    TextView digestStatusText;
    TextView studentProgressText;
    LinearLayout dailyReminderPanel;
    TextView dailyReminderText;
    TextView archiveTitle;
    TextView markdownView;
    WebView markdownWebView;
    ScrollView rootScroll;
    FrameLayout screenRoot;
    ImageView skinBackground;
    LinearLayout contentRoot;
    TextView navigationStudentText;
    TextView cockpitStatusText;
    TextView collectionInboxStatusText;
    LinearLayout homePage;
    LinearLayout collectionPage;
    LinearLayout connectionPage;
    LinearLayout archivePage;
    LinearLayout learningActionPage;
    LinearLayout morePage;
    String activeWorkspace = "home";
    final Map<String, LinearLayout> panelBodies = new Hashtable<String, LinearLayout>();
    final Map<String, Button> panelToggles = new Hashtable<String, Button>();
    final Map<String, View> panelShells = new Hashtable<String, View>();
    EditText archiveSearchInput;
    Spinner studentSpinner;
    EditText studentLoginInput;
    Spinner archiveSourceSpinner;
    Spinner archiveCategorySpinner;
    Spinner archiveSpinner;
    Spinner layoutModeSpinner;
    Spinner skinSpinner;
    Button saveButton;
    Button testButton;
    Button pasteButton;
    Button refreshHostAddressButton;
    Button scanPairButton;
    Button nearbyHostButton;
    Button waitHostButton;
    Button filterHostButton;
    Button exportConnectionBackupButton;
    Button importConnectionBackupButton;
    Button checkUpdateButton;
    Button copyDiagnosticsButton;
    Button downloadTailscaleButton;
    Button tailscaleButton;
    Button upgradeStandaloneButton;
    Button settingsToggleButton;
    Button quickUploadButton;
    Button quickReportButton;
    Button quickArchiveButton;
    Button quickProjectKnowledgeButton;
    Button quickContactButton;
    Button connectionSettingsButton;
    Button uploadButton;
    Button sharedUploadButton;
    Button retryFailedUploadButton;
    Button reloadStudentsButton;
    Button conversationImportButton;
    Button personalTerminalButton;
    Button sharedTerminalButton;
    Button studentLoginButton;
    Button studentScanButton;
    Button studentLogoutButton;
    Button captureStartButton;
    Button capturePauseButton;
    Button captureUploadButton;
    Button captureManageButton;
    Button autoDeliveryFolderButton;
    Button autoDeliveryTargetButton;
    Button autoDeliveryToggleButton;
    Button autoDeliveryCheckButton;
    Button dailyReminderUploadButton;
    Button dailyReminderLaterButton;
    Button refreshArchiveButton;
    Button copyButton;
    Button searchArchiveButton;
    Button markdownModeButton;
    Button topButton;
    Button fontSmallButton;
    Button fontLargeButton;
    Button openObsidianButton;
    Button reportProfileButton;
    Button reportDailyButton;
    Button reportChangesButton;
    Button reportStageButton;
    String selectedReportId = "profile";
    int authorizationPollsRemaining = 0;
    Button refreshReportsButton;
    Button refreshGrowthButton;
    Button openWeComButton;
    Button openQQButton;
    Button openAgentButton;
    Button openMarvisButton;
    Button copyConsultPromptButton;
    Button copyDigestPromptButton;
    TextView agreementLink;
    TextView privacyLink;
    TextView settingsStatusText;
    TextView contactText;
    LinearLayout connectionConfigCard;
    LinearLayout terminalModeCard;
    LinearLayout settingsCard;
    LinearLayout studentCard;
    LinearLayout uploadCard;
    LinearLayout conversationImportCard;
    LinearLayout captureCard;
    LinearLayout courseCard;
    LinearLayout courseListContainer;
    TextView courseStatusText;
    FrameLayout courseOverlay;
    WebView courseWebView;
    Button courseBackButton;
    Button courseCaptureButton;
    LinearLayout studentLoginPanel;
    TextView studentSessionText;
    LinearLayout contactCard;
    LinearLayout reportCard;
    LinearLayout growthCard;
    LinearLayout archiveCard;
    TextView growthSummaryText;
    LinearLayout autoDeliveryPanel;
    TextView autoDeliveryStatusText;
    boolean connectionSettingsVisible = false;
    boolean settingsVisible = false;

    final List<Student> students = new ArrayList<Student>();
    final List<LearningProject> projects = new ArrayList<LearningProject>();
    final List<LearningProject> archiveSourceProjects = new ArrayList<LearningProject>();
    final List<ArchiveFile> allArchiveFiles = new ArrayList<ArchiveFile>();
    final List<ArchiveFile> archiveFiles = new ArrayList<ArchiveFile>();
    final List<Uri> pendingSharedUris = new ArrayList<Uri>();
    final List<Uri> failedUploadUris = new ArrayList<Uri>();
    final List<Course> courses = new ArrayList<Course>();
    final Set<String> activeCourseAllowedHosts = new HashSet<String>();
    Uri pendingCameraUri = null;
    Uri pendingPairQrUri = null;
    boolean pendingCameraDirectUpload = false;
    ArrayAdapter<String> studentAdapter;
    ArrayAdapter<String> connectionModeAdapter;
    ArrayAdapter<String> archiveSourceAdapter;
    ArrayAdapter<String> archiveCategoryAdapter;
    ArrayAdapter<String> archiveAdapter;
    ArrayAdapter<String> layoutModeAdapter;
    ArrayAdapter<String> skinAdapter;
    Student selectedStudent;
    Course activeCourse;
    long activeCourseStartedAt = 0L;
    String terminalMode = "shared";
    boolean personalRequiresBinding = false;
    String boundStudentId = "";
    volatile String studentSessionToken = "";
    final Object studentSessionRefreshLock = new Object();
    String currentMarkdown = "";
    String selectedKnowledgeProjectId = "";
    String selectedKnowledgeProjectName = "";
    boolean showingProjectKnowledge = false;
    long archiveRequestGeneration = 0L;
    boolean updatingArchiveSources = false;
    boolean markdownRendered = true;
    int selectedArchiveCategory = 1;
    int markdownFontSize = 16;
    int layoutMode = 0;
    int skinIndex = 0;
    boolean suppressPreferenceCallbacks = false;
    TextView captureStatusText;
    String pendingCaptureMode = "smart";
    int pendingCaptureDurationMinutes = 30;
    boolean pendingCaptureAutoDelivery = false;
    String pendingCaptureProjectId = "";
    String pendingCaptureProjectName = "";
    boolean uploadInProgress = false;
    ProjectMaterialUploadQueue projectMaterialUploadQueue;
    StudentCollectionInbox studentCollectionInbox;
    boolean conversationSubmitInProgress = false;
    String pendingConversationText = "";
    String pendingConversationSource = "手动粘贴";
    String pendingConversationReference = "manual-paste";
    String conversationLastResult = "";
    TextView conversationImportStatusText;
    String captureUploadVisualState = "idle";
    UploadTarget lastFailedUploadTarget = null;
    final List<Uri> captureUploadUrisInFlight = new ArrayList<Uri>();
    final List<NearbyHost> lastNearbyHosts = new ArrayList<NearbyHost>();
    volatile boolean waitingForHostInvite = false;
    DatagramSocket tabletDiscoverySocket = null;
    WifiManager.MulticastLock tabletDiscoveryMulticastLock = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        loadVisualPrefsOnly();
        applyRequestedOrientation();
        setTitle("AI教育管家平板终端");
        buildUi();
        loadPrefs();
        initializeProjectMaterialUploadQueue();
        initializeCollectionInbox();
        refreshCollectionInboxUi();
        handleIncomingShare(getIntent());
        maybeStartCaptureFromIntent(getIntent());
        if (normalizedBaseUrl().length() > 0 && apiToken().length() > 0) {
            connectAndLoadStudents();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingShare(intent);
        maybeStartCaptureFromIntent(intent);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        loadVisualPrefsOnly();
        disposeUiWebViews();
        buildUi();
        loadPrefs();
        initializeCollectionInbox();
        showWorkspace(activeWorkspace);
        refreshCollectionInboxUi();
    }

    private void disposeUiWebViews() {
        if (courseWebView != null) {
            courseWebView.stopLoading();
            courseWebView.loadUrl("about:blank");
            courseWebView.destroy();
            courseWebView = null;
        }
        if (markdownWebView != null) {
            markdownWebView.stopLoading();
            markdownWebView.loadUrl("about:blank");
            markdownWebView.destroy();
            markdownWebView = null;
        }
    }

    @Override
    protected void onStop() {
        stopWaitingForHostInvite();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        stopWaitingForHostInvite();
        disposeUiWebViews();
        super.onDestroy();
    }

    private void buildUi() {
        panelBodies.clear();
        panelToggles.clear();
        panelShells.clear();
        FrameLayout screen = new FrameLayout(this);
        screenRoot = screen;
        screen.setBackgroundColor(pageBackgroundColor());

        skinBackground = new ImageView(this);
        skinBackground.setScaleType(ImageView.ScaleType.CENTER_CROP);
        skinBackground.setAlpha(isPhoneLayout() ? 0.18f : 0.22f);
        skinBackground.setImageResource(skinBackgroundResource());
        screen.addView(skinBackground, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        View veil = new View(this);
        veil.setBackgroundColor(Color.argb(isPhoneLayout() ? 210 : 198, 248, 252, 251));
        screen.addView(veil, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        LinearLayout appShell = new LinearLayout(this);
        appShell.setOrientation(isWideLandscape() ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        screen.addView(appShell, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        if (isWideLandscape()) {
            appShell.addView(buildNavigationRail(), new LinearLayout.LayoutParams(dp(224), LinearLayout.LayoutParams.MATCH_PARENT));
        }

        ScrollView scroll = new ScrollView(this);
        rootScroll = scroll;
        LinearLayout root = new LinearLayout(this);
        contentRoot = root;
        root.setOrientation(LinearLayout.VERTICAL);
        int sidePadding = isPhoneLayout() ? dp(12) : dp(18);
        root.setPadding(sidePadding, dp(16), sidePadding, dp(22));
        root.setBackgroundColor(Color.TRANSPARENT);
        scroll.addView(root);
        appShell.addView(scroll, isWideLandscape()
            ? new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
            : new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout brandRow = new LinearLayout(this);
        brandRow.setOrientation(LinearLayout.HORIZONTAL);
        brandRow.setGravity(Gravity.CENTER_VERTICAL);
        brandRow.setPadding(dp(16), dp(14), dp(16), dp(12));
        brandRow.setBackground(heroBackground());
        brandRow.setElevation(dp(3));
        LinearLayout.LayoutParams brandParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        brandParams.setMargins(0, 0, 0, dp(14));
        brandRow.setLayoutParams(brandParams);
        brandRow.setClickable(true);
        brandRow.setContentDescription("返回四项核心操作首页");
        brandRow.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("home"); }
        });
        root.addView(brandRow);

        ImageView brandLogo = new ImageView(this);
        brandLogo.setImageResource(R.drawable.brand_logo_hands);
        brandLogo.setScaleType(ImageView.ScaleType.CENTER_CROP);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(70), dp(70));
        logoParams.setMargins(0, 0, dp(12), 0);
        brandRow.addView(brandLogo, logoParams);

        LinearLayout brandCopy = new LinearLayout(this);
        brandCopy.setOrientation(LinearLayout.VERTICAL);
        brandRow.addView(brandCopy, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView title = new TextView(this);
        title.setText("AI教育管家");
        title.setTextSize(isPhoneLayout() ? 25 : 30);
        title.setTextColor(Color.rgb(15, 32, 31));
        title.setGravity(Gravity.START);
        title.setTypeface(null, 1);
        brandCopy.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("我的学习空间 · 资料、课程和成长记录都在这里  v" + VERSION_NAME);
        subtitle.setTextSize(isPhoneLayout() ? 13 : 15);
        subtitle.setTextColor(Color.rgb(87, 107, 103));
        subtitle.setPadding(0, dp(4), 0, dp(2));
        brandCopy.addView(subtitle);

        TextView copyright = new TextView(this);
        copyright.setText("嘉玛蓝（北京）科技有限公司版权所有");
        copyright.setTextSize(12);
        copyright.setTextColor(Color.rgb(104, 121, 117));
        copyright.setPadding(0, 0, 0, dp(3));
        brandCopy.addView(copyright);

        LinearLayout legalRow = new LinearLayout(this);
        legalRow.setOrientation(LinearLayout.HORIZONTAL);
        legalRow.setGravity(Gravity.CENTER_VERTICAL);
        legalRow.setPadding(0, 0, 0, dp(14));
        agreementLink = new TextView(this);
        agreementLink.setText("用户协议");
        agreementLink.setTextSize(13);
        agreementLink.setTextColor(accentColor());
        agreementLink.setPadding(0, 0, dp(16), 0);
        agreementLink.setOnClickListener(this);
        legalRow.addView(agreementLink);

        privacyLink = new TextView(this);
        privacyLink.setText("隐私政策");
        privacyLink.setTextSize(13);
        privacyLink.setTextColor(accentColor());
        privacyLink.setPadding(0, 0, 0, 0);
        privacyLink.setOnClickListener(this);
        legalRow.addView(privacyLink);
        brandCopy.addView(legalRow);

        Button moreButton = button("更多", false);
        moreButton.setContentDescription("打开更多功能");
        moreButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("more"); }
        });
        brandRow.addView(moreButton, new LinearLayout.LayoutParams(dp(88), dp(48)));

        root.addView(buildCockpitStatusRibbon());
        homePage = buildStudentDashboard();

        connectionConfigCard = card();
        connectionConfigCard.addView(label("主机服务地址"));
        serverInput = input("例如：http://192.168.1.10:18777");
        connectionConfigCard.addView(serverInput);
        connectionConfigCard.addView(label("API Token"));
        tokenInput = input("从 Windows 控制台复制平板连接信息后粘贴");
        connectionConfigCard.addView(tokenInput);
        connectionConfigCard.addView(label("连接模式"));
        connectionModeSpinner = new Spinner(this);
        connectionModeAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        connectionModeAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        connectionModeAdapter.add("仅局域网");
        connectionModeAdapter.add("局域网 + Tailscale");
        connectionModeAdapter.add("手动输入远程主机地址");
        connectionModeSpinner.setAdapter(connectionModeAdapter);
        connectionModeSpinner.setSelection(1);
        connectionConfigCard.addView(connectionModeSpinner);
        connectionConfigCard.addView(label("远程主机地址"));
        remoteInput = input("例如：http://100.x.x.x:18777，手动模式时使用");
        connectionConfigCard.addView(remoteInput);

        LinearLayout connectRow = row();
        saveButton = button("保存连接", false);
        testButton = button("连接主机", true);
        pasteButton = button("粘贴连接信息", false);
        refreshHostAddressButton = button("刷新主机地址", false);
        connectRow.addView(saveButton);
        connectRow.addView(testButton);
        connectRow.addView(pasteButton);
        connectRow.addView(refreshHostAddressButton);
        connectionConfigCard.addView(connectRow);

        LinearLayout pairRow = row();
        nearbyHostButton = button("查找局域网主机", true);
        scanPairButton = button("扫码绑定主机", true);
        waitHostButton = button("等待主机连接", false);
        filterHostButton = button("按主机码筛选", false);
        pairRow.addView(nearbyHostButton);
        pairRow.addView(waitHostButton);
        pairRow.addView(filterHostButton);
        pairRow.addView(scanPairButton);
        connectionConfigCard.addView(pairRow);
        nearbyHostButton.setOnClickListener(this);
        waitHostButton.setOnClickListener(this);
        filterHostButton.setOnClickListener(this);
        machineCodeText = label(connectedIdentityText());
        machineCodeText.setTextSize(12);
        connectionConfigCard.addView(machineCodeText);

        LinearLayout backupRow = row();
        exportConnectionBackupButton = button("导出连接备份", false);
        importConnectionBackupButton = button("导入并连接", false);
        backupRow.addView(exportConnectionBackupButton);
        backupRow.addView(importConnectionBackupButton);
        connectionConfigCard.addView(backupRow);
        TextView backupHint = label("连接备份包含设备授权凭据，仅用于本平板重装恢复，请妥善保管。导入成功后会自动测试连接。");
        backupHint.setTextSize(12);
        connectionConfigCard.addView(backupHint);

        statusText = new TextView(this);
        statusText.setText("尚未连接主机服务。");
        statusText.setTextColor(Color.rgb(87, 107, 103));
        statusText.setPadding(0, dp(10), 0, 0);
        connectionConfigCard.addView(statusText);

        connectionSummaryText = new TextView(this);
        connectionSummaryText.setText("连接状态：未连接。\n建议：确认 Windows 主机已选择“主机-终端模式”并启动主机服务。");
        connectionSummaryText.setTextSize(13);
        connectionSummaryText.setTextColor(Color.rgb(87, 107, 103));
        connectionSummaryText.setPadding(dp(10), dp(10), dp(10), dp(10));
        connectionSummaryText.setBackgroundColor(Color.rgb(238, 247, 244));
        connectionConfigCard.addView(connectionSummaryText);

        connectionHintText = new TextView(this);
        connectionHintText.setText("连接排查：先确认 Windows 首页选择“主机-终端模式”并启动主机服务；平板与电脑连接同一 Wi-Fi；如果仍失败，请重新扫码绑定。");
        connectionHintText.setTextSize(12);
        connectionHintText.setTextColor(Color.rgb(104, 121, 117));
        connectionHintText.setPadding(dp(10), dp(8), dp(10), 0);
        connectionConfigCard.addView(connectionHintText);
        saveButton.setOnClickListener(this);
        testButton.setOnClickListener(this);
        pasteButton.setOnClickListener(this);
        refreshHostAddressButton.setOnClickListener(this);
        scanPairButton.setOnClickListener(this);
        exportConnectionBackupButton.setOnClickListener(this);
        importConnectionBackupButton.setOnClickListener(this);

        terminalModeCard = card();
        terminalModeCard.addView(label("\u4f7f\u7528\u6a21\u5f0f"));
        LinearLayout terminalModeRow = row();
        personalTerminalButton = button("\u4e2a\u4eba\u7ec8\u7aef", false);
        sharedTerminalButton = button("\u5171\u4eab\u7ec8\u7aef", false);
        terminalModeRow.addView(personalTerminalButton);
        terminalModeRow.addView(sharedTerminalButton);
        terminalModeCard.addView(terminalModeRow);
        personalTerminalButton.setOnClickListener(this);
        sharedTerminalButton.setOnClickListener(this);

        settingsCard = card();
        settingsCard.addView(label("系统设置"));
        settingsCard.addView(label("页面布局"));
        layoutModeSpinner = new Spinner(this);
        layoutModeAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        layoutModeAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        layoutModeAdapter.add("自适应");
        layoutModeAdapter.add("平板横屏");
        layoutModeAdapter.add("手机竖屏");
        layoutModeSpinner.setAdapter(layoutModeAdapter);
        layoutModeSpinner.setSelection(layoutMode);
        layoutModeSpinner.setOnItemSelectedListener(this);
        settingsCard.addView(layoutModeSpinner);

        settingsCard.addView(label("界面皮肤"));
        skinSpinner = new Spinner(this);
        skinAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        skinAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        skinAdapter.add("蓝色系");
        skinAdapter.add("粉色系");
        skinAdapter.add("绿色系");
        skinAdapter.add("紫色系");
        skinAdapter.add("橙色系");
        skinSpinner.setAdapter(skinAdapter);
        skinSpinner.setSelection(skinIndex);
        skinSpinner.setOnItemSelectedListener(this);
        settingsCard.addView(skinSpinner);

        LinearLayout maintenanceRow = row();
        checkUpdateButton = button("检查更新", false);
        copyDiagnosticsButton = button("复制诊断信息", false);
        downloadTailscaleButton = button("下载 Tailscale", false);
        tailscaleButton = button("打开 Tailscale", false);
        upgradeStandaloneButton = button("从 Windows 主机升级到单机版（少量资料）", true);
        maintenanceRow.addView(checkUpdateButton);
        maintenanceRow.addView(copyDiagnosticsButton);
        maintenanceRow.addView(downloadTailscaleButton);
        maintenanceRow.addView(tailscaleButton);
        settingsCard.addView(maintenanceRow);
        settingsCard.addView(upgradeStandaloneButton);
        checkUpdateButton.setOnClickListener(this);
        copyDiagnosticsButton.setOnClickListener(this);
        downloadTailscaleButton.setOnClickListener(this);
        tailscaleButton.setOnClickListener(this);
        upgradeStandaloneButton.setOnClickListener(this);

        settingsStatusText = new TextView(this);
        settingsStatusText.setText("系统设置已收起。需要更改布局、皮肤或检查更新时点击上方“系统设置”。");
        settingsStatusText.setTextSize(12);
        settingsStatusText.setTextColor(Color.rgb(87, 107, 103));
        settingsStatusText.setPadding(dp(10), dp(8), dp(10), 0);
        settingsCard.addView(settingsStatusText);
        studentCard = card();
        studentCard.addView(label("\u5b66\u751f\u7a7a\u95f4"));
        studentLoginPanel = new LinearLayout(this);
        studentLoginPanel.setOrientation(LinearLayout.VERTICAL);
        studentLoginPanel.setPadding(0, dp(6), 0, dp(10));
        studentSessionText = new TextView(this);
        studentSessionText.setText("\u5171\u4eab\u7ec8\u7aef\uff1a\u8bf7\u626b\u7801\u6216\u8f93\u5165\u4e2a\u4eba ID\u3002");
        studentSessionText.setTextSize(14);
        studentSessionText.setTextColor(Color.rgb(50, 76, 70));
        studentLoginPanel.addView(studentSessionText);
        studentLoginInput = input("\u8f93\u5165\u5b66\u751f ID\uff0c\u4f8b\u5982 S-ABCD-X");
        studentLoginInput.setAllCaps(true);
        studentLoginPanel.addView(studentLoginInput);
        LinearLayout studentLoginRow = row();
        studentLoginButton = button("\u8fdb\u5165\u6211\u7684\u8d44\u6599", true);
        studentScanButton = button("\u626b\u7801\u8fdb\u5165", false);
        studentLogoutButton = button("\u9000\u51fa\u5f53\u524d\u5b66\u751f", false);
        studentLoginRow.addView(studentLoginButton);
        studentLoginRow.addView(studentScanButton);
        studentLoginRow.addView(studentLogoutButton);
        studentLoginPanel.addView(studentLoginRow);
        studentLoginButton.setOnClickListener(this);
        studentScanButton.setOnClickListener(this);
        studentLogoutButton.setOnClickListener(this);
        studentCard.addView(studentLoginPanel);
        studentCard.addView(label("学生"));
        studentSpinner = new Spinner(this);
        studentAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        studentAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        studentSpinner.setAdapter(studentAdapter);
        studentSpinner.setOnItemSelectedListener(this);
        studentCard.addView(studentSpinner);
        studentSpinner.setVisibility(View.GONE);

        uploadCard = card();
        uploadCard.addView(label("上传状态"));
        uploadCard.addView(label("主动选择的资料会在确认学生档案或关联项目后直接进入持久上传队列；离线暂存只在需要时显示。"));
        LinearLayout actionRow = row();
        sharedUploadButton = button("管理待上传暂存", false);
        retryFailedUploadButton = button("重试失败资料", false);
        actionRow.addView(sharedUploadButton);
        actionRow.addView(retryFailedUploadButton);
        uploadCard.addView(actionRow);
        sharedUploadButton.setEnabled(false);
        retryFailedUploadButton.setEnabled(false);
        sharedUploadButton.setVisibility(View.VISIBLE);
        retryFailedUploadButton.setVisibility(View.GONE);
        sharedUploadButton.setOnClickListener(this);
        retryFailedUploadButton.setOnClickListener(this);

        uploadResultText = new TextView(this);
        uploadResultText.setText("最近上传结果：暂无。");
        uploadResultText.setTextSize(13);
        uploadResultText.setTextColor(Color.rgb(87, 107, 103));
        uploadResultText.setPadding(0, dp(8), 0, 0);
        uploadCard.addView(uploadResultText);

        uploadQueueText = new TextView(this);
        uploadQueueText.setText("上传队列：暂无。");
        uploadQueueText.setTextSize(12);
        uploadQueueText.setTextColor(Color.rgb(104, 121, 117));
        uploadQueueText.setPadding(0, dp(4), 0, 0);
        uploadCard.addView(uploadQueueText);

        digestStatusText = new TextView(this);
        digestStatusText.setText("资料状态：请选择学生。");
        digestStatusText.setTextSize(12);
        digestStatusText.setTextColor(Color.rgb(104, 121, 117));
        digestStatusText.setPadding(0, dp(4), 0, 0);
        uploadCard.addView(digestStatusText);

        conversationImportStatusText = new TextView(this);
        conversationImportStatusText.setTextSize(13);
        conversationImportStatusText.setTextColor(Color.rgb(87, 107, 103));
        conversationImportStatusText.setPadding(0, dp(8), 0, 0);
        uploadCard.addView(conversationImportStatusText);
        updateConversationImportUi();

        uploadCard.addView(label("我的资料进展"));
        studentProgressText = new TextView(this);
        studentProgressText.setText("进入学生空间后，将显示已提交资料、知识化处理、近期新增和提交频率。");
        studentProgressText.setTextSize(14);
        studentProgressText.setTextColor(Color.rgb(50, 76, 70));
        studentProgressText.setPadding(dp(10), dp(10), dp(10), dp(10));
        studentProgressText.setBackgroundColor(Color.rgb(238, 247, 244));
        uploadCard.addView(studentProgressText);

        dailyReminderPanel = new LinearLayout(this);
        dailyReminderPanel.setOrientation(LinearLayout.VERTICAL);
        dailyReminderPanel.setPadding(dp(10), dp(10), dp(10), dp(8));
        dailyReminderPanel.setBackgroundColor(Color.rgb(255, 247, 222));
        dailyReminderText = new TextView(this);
        dailyReminderText.setTextSize(14);
        dailyReminderText.setTextColor(Color.rgb(105, 77, 25));
        dailyReminderPanel.addView(dailyReminderText);
        LinearLayout reminderRow = row();
        dailyReminderUploadButton = button("现在上传", true);
        dailyReminderLaterButton = button("稍后再说", false);
        reminderRow.addView(dailyReminderUploadButton);
        reminderRow.addView(dailyReminderLaterButton);
        dailyReminderPanel.addView(reminderRow);
        uploadCard.addView(dailyReminderPanel);
        dailyReminderUploadButton.setOnClickListener(this);
        dailyReminderLaterButton.setOnClickListener(this);

        autoDeliveryPanel = new LinearLayout(this);
        autoDeliveryPanel.setOrientation(LinearLayout.VERTICAL);
        autoDeliveryPanel.setPadding(0, dp(8), 0, dp(4));
        autoDeliveryPanel.addView(label("自动投递文件夹（个人终端）"));
        autoDeliveryPanel.addView(label("授权文件夹并确认资料归属后，新文件会先形成私有稳定副本，再进入持久上传队列；不会删除原文件。"));
        LinearLayout autoDeliveryRow = row();
        autoDeliveryFolderButton = button("选择文件夹", false);
        autoDeliveryTargetButton = button("选择资料归属", false);
        autoDeliveryToggleButton = button("启用自动投递", true);
        autoDeliveryCheckButton = button("立即检查", false);
        autoDeliveryRow.addView(autoDeliveryFolderButton);
        autoDeliveryRow.addView(autoDeliveryTargetButton);
        autoDeliveryRow.addView(autoDeliveryToggleButton);
        autoDeliveryRow.addView(autoDeliveryCheckButton);
        autoDeliveryPanel.addView(autoDeliveryRow);
        autoDeliveryStatusText = new TextView(this);
        autoDeliveryStatusText.setTextSize(12);
        autoDeliveryStatusText.setTextColor(Color.rgb(87, 107, 103));
        autoDeliveryStatusText.setPadding(0, dp(5), 0, dp(6));
        autoDeliveryPanel.addView(autoDeliveryStatusText);
        autoDeliveryFolderButton.setOnClickListener(this);
        autoDeliveryTargetButton.setOnClickListener(this);
        autoDeliveryToggleButton.setOnClickListener(this);
        autoDeliveryCheckButton.setOnClickListener(this);

        captureCard = card();
        captureCard.addView(label("屏幕资料采集"));
        captureCard.addView(label("授权后可按智能混合、内容变化或固定间隔模式连续采集；结束后确认目标并进入持久上传队列。"));
        LinearLayout captureRow = row();
        captureStartButton = button("开始屏幕采集", true);
        capturePauseButton = button("暂停/继续", false);
        captureUploadButton = button("上传采集资料", false);
        captureRow.addView(captureStartButton);
        captureRow.addView(capturePauseButton);
        captureRow.addView(captureUploadButton);
        captureCard.addView(captureRow);
        captureManageButton = button("查看与清理采集资料", false);
        LinearLayout captureManageRow = row();
        captureManageRow.addView(captureManageButton);
        captureCard.addView(captureManageRow);
        captureStartButton.setOnClickListener(this);
        capturePauseButton.setOnClickListener(this);
        captureUploadButton.setOnClickListener(this);
        captureManageButton.setOnClickListener(this);
        captureStatusText = new TextView(this);
        captureStatusText.setTextSize(12);
        captureStatusText.setTextColor(Color.rgb(87, 107, 103));
        captureStatusText.setPadding(0, dp(6), 0, 0);
        captureCard.addView(captureStatusText);
        refreshCaptureUi();

        courseCard = card();
        courseCard.addView(label("精选课程"));
        courseCard.addView(label("仅显示机构已启用并分配给当前学生的课程。课程在受限浏览器中打开；屏幕资料采集始终待开始，必须由学生确认系统授权后才会启动。"));
        courseStatusText = new TextView(this);
        courseStatusText.setText("进入学生空间后读取课程。");
        courseStatusText.setTextSize(13);
        courseStatusText.setTextColor(Color.rgb(87, 107, 103));
        courseStatusText.setPadding(0, dp(8), 0, dp(8));
        courseCard.addView(courseStatusText);
        courseListContainer = stack();
        courseCard.addView(courseListContainer);

        contactCard = card();
        contactCard.addView(label("联系教育管家"));
        contactText = new TextView(this);
        contactText.setText("选择学生后，可查看该学生绑定的企业微信或 QQ 联系入口。");
        contactText.setTextSize(15);
        contactText.setTextColor(Color.rgb(87, 107, 103));
        contactText.setPadding(0, dp(4), 0, dp(8));
        contactCard.addView(contactText);

        LinearLayout contactRow = row();
        openWeComButton = button("打开企业微信", true);
        openQQButton = button("打开 QQ", true);
        contactRow.addView(openWeComButton);
        contactRow.addView(openQQButton);
        contactCard.addView(contactRow);

        LinearLayout agentDialogCard = card();
        agentDialogCard.addView(label("本机 Agent"));
        openAgentButton = button("选择 Agent", false);
        openMarvisButton = button("打开 Mavis", false);
        LinearLayout agentDialogRow = row();
        agentDialogRow.addView(openAgentButton);
        agentDialogRow.addView(openMarvisButton);
        agentDialogCard.addView(agentDialogRow);

        LinearLayout promptDialogCard = card();
        promptDialogCard.addView(label("对话提示"));
        copyConsultPromptButton = button("复制咨询提示", false);
        copyDigestPromptButton = button("复制消化提示", false);
        LinearLayout promptDialogRow = row();
        promptDialogRow.addView(copyConsultPromptButton);
        promptDialogRow.addView(copyDigestPromptButton);
        promptDialogCard.addView(promptDialogRow);
        openWeComButton.setOnClickListener(this);
        openQQButton.setOnClickListener(this);
        openAgentButton.setOnClickListener(this);
        openMarvisButton.setOnClickListener(this);
        copyConsultPromptButton.setOnClickListener(this);
        copyDigestPromptButton.setOnClickListener(this);
        openWeComButton.setEnabled(false);
        openQQButton.setEnabled(false);
        openAgentButton.setEnabled(true);
        openMarvisButton.setEnabled(true);
        copyConsultPromptButton.setEnabled(false);
        copyDigestPromptButton.setEnabled(false);

        reportCard = card();
        reportCard.addView(label("学情报告"));
        reportCard.addView(label("四份核心报告会从 Windows 主机读取，并支持离线缓存。"));
        LinearLayout reportRow = row();
        refreshReportsButton = button("刷新报告", false);
        reportProfileButton = button("整体画像", true);
        reportDailyButton = button("每日行动建议", false);
        reportChangesButton = button("历史变化", false);
        reportStageButton = button("阶段总结", false);
        reportRow.addView(refreshReportsButton);
        reportRow.addView(reportProfileButton);
        reportRow.addView(reportDailyButton);
        reportRow.addView(reportChangesButton);
        reportRow.addView(reportStageButton);
        reportCard.addView(reportRow);
        refreshReportsButton.setOnClickListener(this);
        reportProfileButton.setOnClickListener(this);
        reportDailyButton.setOnClickListener(this);
        reportChangesButton.setOnClickListener(this);
        reportStageButton.setOnClickListener(this);
        updateReportButtonSelection();

        growthCard = card();
        growthCard.addView(label("我的成长模型"));
        growthCard.addView(label("只读显示当前学生的能力画像、项目贡献和已确认或观察中的近期成长证据。"));
        refreshGrowthButton = button("查看成长模型", false);
        refreshGrowthButton.setOnClickListener(this);
        growthCard.addView(refreshGrowthButton);
        growthSummaryText = new TextView(this);
        growthSummaryText.setText("进入学生空间后，可从 Windows 主机读取自己的成长模型。");
        growthSummaryText.setTextSize(14);
        growthSummaryText.setTextColor(Color.rgb(50, 76, 70));
        growthSummaryText.setPadding(dp(10), dp(10), dp(10), dp(10));
        growthSummaryText.setBackgroundColor(Color.rgb(238, 247, 244));
        growthCard.addView(growthSummaryText);

        archiveCard = card();
        archiveCard.addView(label("学情档案与关联项目知识"));
        archiveCard.addView(label("只显示当前学生自己的档案，以及本人关联项目中的公开 Markdown 知识。"));
        archiveCard.addView(label("查看内容"));
        archiveSourceSpinner = new Spinner(this);
        archiveSourceAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        archiveSourceAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        archiveSourceSpinner.setAdapter(archiveSourceAdapter);
        archiveCard.addView(archiveSourceSpinner);
        archiveCard.addView(label("档案分类"));
        archiveCategorySpinner = new Spinner(this);
        archiveCategoryAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        archiveCategoryAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        archiveCategoryAdapter.add("资料摘要");
        archiveCategoryAdapter.add("综合汇总");
        archiveCategoryAdapter.add("问答精华");
        archiveCategoryAdapter.add("其他");
        archiveCategoryAdapter.add("所有文档");
        archiveCategorySpinner.setAdapter(archiveCategoryAdapter);
        archiveCategorySpinner.setSelection(selectedArchiveCategory);
        archiveCategorySpinner.setOnItemSelectedListener(this);
        archiveCard.addView(archiveCategorySpinner);

        LinearLayout archiveSearchRow = row();
        archiveSearchInput = input("搜索 Markdown 文件名");
        searchArchiveButton = button("搜索", false);
        archiveSearchRow.addView(archiveSearchInput, isPhoneLayout()
            ? new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            : new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        archiveSearchRow.addView(searchArchiveButton);
        archiveCard.addView(archiveSearchRow);
        searchArchiveButton.setOnClickListener(this);

        archiveSpinner = new Spinner(this);
        archiveAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        archiveAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        archiveSpinner.setAdapter(archiveAdapter);
        archiveSpinner.setOnItemSelectedListener(this);
        archiveCard.addView(archiveSpinner);

        LinearLayout archiveRow = row();
        refreshArchiveButton = button("刷新档案", false);
        copyButton = button("复制正文", false);
        markdownModeButton = button("查看原文", false);
        fontSmallButton = button("A-", false);
        fontLargeButton = button("A+", false);
        openObsidianButton = button("打开 Obsidian", false);
        topButton = button("回到顶部", false);
        archiveRow.addView(refreshArchiveButton);
        archiveRow.addView(copyButton);
        archiveRow.addView(markdownModeButton);
        archiveRow.addView(fontSmallButton);
        archiveRow.addView(fontLargeButton);
        archiveRow.addView(openObsidianButton);
        archiveCard.addView(archiveRow);
        refreshArchiveButton.setOnClickListener(this);
        copyButton.setOnClickListener(this);
        markdownModeButton.setOnClickListener(this);
        fontSmallButton.setOnClickListener(this);
        fontLargeButton.setOnClickListener(this);
        openObsidianButton.setOnClickListener(this);
        topButton.setOnClickListener(this);

        archiveTitle = new TextView(this);
        archiveTitle.setText("请选择学生和档案。");
        archiveTitle.setTextSize(18);
        archiveTitle.setTypeface(null, 1);
        archiveTitle.setTextColor(Color.rgb(15, 118, 110));
        archiveTitle.setPadding(0, dp(12), 0, dp(6));
        archiveCard.addView(archiveTitle);

        markdownWebView = new WebView(this);
        WebSettings markdownSettings = markdownWebView.getSettings();
        markdownSettings.setJavaScriptEnabled(false);
        markdownSettings.setBuiltInZoomControls(false);
        markdownSettings.setDisplayZoomControls(false);
        markdownSettings.setDefaultTextEncodingName("UTF-8");
        markdownWebView.setBackgroundColor(Color.WHITE);
        markdownWebView.setVerticalScrollBarEnabled(true);
        markdownWebView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        markdownWebView.setOnTouchListener(new NestedScrollTouchGuard(rootScroll));
        archiveCard.addView(markdownWebView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            isPhoneLayout() ? dp(420) : dp(520)
        ));

        markdownView = new TextView(this);
        markdownView.setText("连接主机服务后，可在这里查看 Windows 主机中的 Markdown 学情档案。");
        markdownView.setTextSize(markdownFontSize);
        markdownView.setLineSpacing(0, 1.25f);
        markdownView.setTextColor(Color.rgb(33, 49, 47));
        markdownView.setPadding(dp(12), dp(12), dp(12), dp(12));
        markdownView.setBackgroundColor(Color.WHITE);
        markdownView.setVisibility(View.GONE);
        archiveCard.addView(markdownView);
        updateMarkdownDisplay("连接主机服务后，可在这里查看 Windows 主机中的 Markdown 学情档案。");
        archiveSourceSpinner.setOnItemSelectedListener(this);
        refreshArchiveSources();

        LinearLayout archiveEntryCard = card();
        quickArchiveButton = button("打开学情档案", true);
        LinearLayout archiveEntryRow = row();
        archiveEntryRow.addView(quickArchiveButton);
        archiveEntryCard.addView(archiveEntryRow);
        quickArchiveButton.setOnClickListener(this);

        LinearLayout projectKnowledgeEntryCard = card();
        quickProjectKnowledgeButton = button("项目资料与知识", true);
        LinearLayout projectKnowledgeEntryRow = row();
        projectKnowledgeEntryRow.addView(quickProjectKnowledgeButton);
        projectKnowledgeEntryCard.addView(projectKnowledgeEntryRow);
        quickProjectKnowledgeButton.setOnClickListener(this);

        collectionPage = workspacePage("搜集上传", "选择资料、确认当前学生与目标后直接进入持久上传队列；离线和失败资料由本机安全保留。");
        collectionInboxStatusText = new TextView(this);
        collectionInboxStatusText.setTextSize(14);
        collectionInboxStatusText.setTextColor(Color.rgb(35, 74, 70));
        collectionInboxStatusText.setPadding(dp(12), dp(12), dp(12), dp(12));
        collectionInboxStatusText.setBackground(roundedSolid(Color.rgb(232, 246, 243), dp(16), Color.rgb(184, 218, 211)));
        collectionPage.addView(collectionInboxStatusText);

        LinearLayout collectionActions = card();
        collectionActions.addView(label("上传资料"));
        collectionActions.addView(label("主动选择后只需确认一次上传目标。文件与图片均支持多选。"));
        LinearLayout collectRow = row();
        Button collectFile = button("选择文件", true);
        Button collectImage = button("选择图片", false);
        Button collectCamera = button("拍照上传", false);
        collectRow.addView(collectFile); collectRow.addView(collectImage); collectRow.addView(collectCamera);
        collectionActions.addView(collectRow);
        LinearLayout collectMoreRow = row();
        Button collectScreen = button("屏幕采集", false);
        conversationImportButton = button("导入对话", false);
        Button collectFolder = button("自动投递文件夹", false);
        collectMoreRow.addView(collectScreen); collectMoreRow.addView(conversationImportButton); collectMoreRow.addView(collectFolder);
        collectionActions.addView(collectMoreRow);
        collectFile.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View view) { startDirectUploadPicker(); } });
        collectImage.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View view) { startDirectImageUploadPicker(); } });
        collectCamera.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View view) { startTakePhotoForUpload(); } });
        collectScreen.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View view) { handleCapturePrimary(); } });
        conversationImportButton.setOnClickListener(this);
        collectFolder.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View view) { chooseAutoDeliveryFolder(); } });
        collectionPage.addView(collectionActions);
        collectionPage.addView(uploadCard);
        collectionPage.addView(captureCard);
        collectionPage.addView(autoDeliveryPanel);

        connectionPage = workspacePage("主机连接", "优先发现同一局域网内的 Windows 主机，也可扫码绑定；LAN → Tailscale 自动回退逻辑保持不变。");
        LinearLayout quickConnectCard = card();
        quickConnectCard.addView(label("连接状态与快速操作"));
        LinearLayout quickConnectRow = row();
        Button quickNearby = button("局域网发现", true);
        Button quickScan = button("扫码绑定", true);
        quickConnectRow.addView(quickNearby); quickConnectRow.addView(quickScan);
        quickConnectCard.addView(quickConnectRow);
        quickNearby.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View view) { discoverNearbyHosts(); } });
        quickScan.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View view) { startPairScan(); } });
        connectionPage.addView(quickConnectCard);
        connectionPage.addView(collapsiblePanel("高级连接设置", "粘贴连接信息、手动地址、Tailscale 与连接备份。", connectionConfigCard));
        LinearLayout terminalAndStudent = stack();
        terminalAndStudent.addView(studentCard);
        terminalAndStudent.addView(terminalModeCard);
        connectionPage.addView(collapsiblePanel("终端与学生空间", "连接主机后在这里选择个人/共享终端模式并进入当前学生空间。", terminalAndStudent));

        LinearLayout growthRecommendations = row();
        Button topicRecommendations = button("推荐选题", false);
        Button competitionRecommendations = button("推荐比赛", false);
        growthRecommendations.addView(topicRecommendations);
        growthRecommendations.addView(competitionRecommendations);
        growthCard.addView(growthRecommendations);
        topicRecommendations.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { openTerminalLearningAction("topics"); }
        });
        competitionRecommendations.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { openTerminalLearningAction("competitions"); }
        });

        LinearLayout planningCard = card();
        planningCard.addView(label("规划指导"));
        planningCard.addView(label("读取主机已核验的规划版本；建议仅供选择与复核，不代表录取或职业结果。"));
        LinearLayout planningRow = row();
        Button pathwayButton = button("升学路径", true);
        Button majorButton = button("专业探索", false);
        Button careerButton = button("职业发展", false);
        planningRow.addView(pathwayButton); planningRow.addView(majorButton); planningRow.addView(careerButton);
        planningCard.addView(planningRow);
        pathwayButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { openTerminalLearningAction("guidance:pathways"); }
        });
        majorButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { openTerminalLearningAction("guidance:majors"); }
        });
        careerButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { openTerminalLearningAction("guidance:careers"); }
        });

        archivePage = workspacePage("教育档案", "学情报告、成长模型、学情档案、项目资料和规划指导均为当前学生只读内容。断网时优先显示已缓存内容。 ");
        archivePage.addView(collapsiblePanel("学情报告", "整体画像、行动建议、历史变化和阶段总结。", reportCard));
        archivePage.addView(collapsiblePanel("成长模型", "成长概览、推荐选题和推荐比赛。", growthCard));
        archivePage.addView(collapsiblePanel("学情档案", "打开当前学生自己的学情档案。", archiveEntryCard));
        archivePage.addView(collapsiblePanel("项目资料", "查看当前学生已经关联的项目资料与公开知识。", projectKnowledgeEntryCard));
        archivePage.addView(collapsiblePanel("规划指导", "升学路径、专业探索和职业发展。", planningCard));
        archiveCard.setVisibility(View.GONE);
        archivePage.addView(archiveCard);

        learningActionPage = workspacePage("学习行动", "从已分配课程、学习卡片和知识点证据出发，安排当前学生的下一步学习。 ");
        learningActionPage.addView(collapsiblePanel("精选课程", "仅显示机构启用并分配给当前学生的课程。", courseCard));
        LinearLayout practiceEntry = card();
        practiceEntry.addView(label("学习卡片"));
        practiceEntry.addView(label("完成已投递的练习卡片；离线作答会按原提交编号保留并重试。"));
        Button practiceButton = button("打开学习卡片", true);
        practiceEntry.addView(practiceButton);
        practiceButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { openTerminalLearningAction("practice"); }
        });
        learningActionPage.addView(collapsiblePanel("学习卡片", "练习、作答、反馈与离线恢复。", practiceEntry));
        LinearLayout trajectoryEntry = card();
        trajectoryEntry.addView(label("知识点跟踪"));
        trajectoryEntry.addView(label("按学科查看证据数量、近期表现、复习优先级和建议复习时间；状态不是确定性掌握结论。"));
        Button trajectoryButton = button("查看知识点跟踪", true);
        trajectoryEntry.addView(trajectoryButton);
        trajectoryButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { openTerminalLearningAction("trajectory"); }
        });
        learningActionPage.addView(collapsiblePanel("知识点跟踪", "只读查看当前学生的学习证据投影。", trajectoryEntry));

        morePage = workspacePage("更多", "外观、更新、诊断和其他辅助设置。 ");
        morePage.addView(collapsiblePanel("外观、更新与诊断", "页面布局、皮肤、更新检查与诊断工具。", settingsCard));

        root.addView(homePage);
        root.addView(collectionPage);
        root.addView(connectionPage);
        root.addView(archivePage);
        root.addView(learningActionPage);
        root.addView(morePage);
        showWorkspace(activeWorkspace);

        if (!isWideLandscape()) appShell.addView(buildBottomNavigation(), new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(68)));

        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(dp(132), dp(48), Gravity.BOTTOM | Gravity.RIGHT);
        topParams.setMargins(0, 0, dp(20), dp(isWideLandscape() ? 20 : 88));
        topButton.setLayoutParams(topParams);
        topButton.setVisibility(View.GONE);
        screen.addView(topButton);
        scroll.setOnScrollChangeListener(new View.OnScrollChangeListener() {
            @Override public void onScrollChange(View view, int scrollX, int scrollY, int oldScrollX, int oldScrollY) {
                if (topButton != null) topButton.setVisibility(scrollY > dp(420) ? View.VISIBLE : View.GONE);
            }
        });

        buildCourseOverlay(screen);
        setContentView(screen);
    }

    private void buildCourseOverlay(FrameLayout screen) {
        courseOverlay = new FrameLayout(this);
        courseOverlay.setBackgroundColor(Color.WHITE);
        courseOverlay.setVisibility(View.GONE);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = row();
        toolbar.setPadding(dp(12), dp(10), dp(12), dp(10));
        courseBackButton = button("返回课程目录", false);
        courseCaptureButton = button("待开始：采集课程资料", true);
        toolbar.addView(courseBackButton);
        toolbar.addView(courseCaptureButton);
        layout.addView(toolbar);

        courseWebView = new WebView(this);
        configureCourseWebView();
        layout.addView(courseWebView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));
        courseOverlay.addView(layout, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        courseBackButton.setOnClickListener(this);
        courseCaptureButton.setOnClickListener(this);
        screen.addView(courseOverlay, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
    }

    private void configureCourseWebView() {
        WebSettings settings = courseWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(courseWebView, false);
        }
        if (Build.VERSION.SDK_INT >= 26) {
            settings.setSafeBrowsingEnabled(true);
        }
        courseWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return blockDisallowedCourseUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return blockDisallowedCourseUrl(request == null || request.getUrl() == null ? "" : request.getUrl().toString());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (activeCourse != null && isAllowedCourseUrl(url)) activeCourse.currentUrl = url;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                if (handler != null) handler.cancel();
                toast("课程页面证书校验失败，已停止访问。");
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    courseStatusText.setText("课程页面加载失败，请检查网络后重试。");
                }
            }
        });
        courseWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (request != null) request.deny();
            }

            @Override
            public boolean onShowFileChooser(WebView webView, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams fileChooserParams) {
                if (callback != null) callback.onReceiveValue(null);
                return true;
            }
        });
        courseWebView.setDownloadListener(new android.webkit.DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                toast("课程浏览器不允许直接下载文件。");
            }
        });
    }

    boolean blockDisallowedCourseUrl(String url) {
        boolean blocked = !isAllowedCourseUrl(url);
        if (blocked) toast("已阻止课程白名单之外的链接。");
        return blocked;
    }

    boolean isAllowedCourseUrl(String url) {
        try {
            Uri uri = Uri.parse(url == null ? "" : url.trim());
            String host = uri.getHost();
            return ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                && host != null
                && uri.getUserInfo() == null
                && activeCourseAllowedHosts.contains(host.toLowerCase(Locale.US));
        } catch (Exception ignored) {
            return false;
        }
    }

    void openCourseBrowser(Course course) {
        if (course == null || !course.isSafe()) {
            toast("课程链接或白名单无效，已停止打开。");
            return;
        }
        activeCourse = course;
        activeCourse.currentUrl = course.url;
        activeCourseStartedAt = System.currentTimeMillis();
        activeCourseAllowedHosts.clear();
        activeCourseAllowedHosts.addAll(course.allowedHosts);
        courseStatusText.setText("正在打开 " + course.name + "。资料采集尚未开始。");
        courseOverlay.setVisibility(View.VISIBLE);
        refreshCaptureUi();
        courseWebView.loadUrl(course.url);
    }

    void closeCourseBrowser() {
        if (courseWebView != null) {
            courseWebView.stopLoading();
            courseWebView.loadUrl("about:blank");
            courseWebView.clearHistory();
            courseWebView.clearFormData();
            CookieManager.getInstance().removeSessionCookies(null);
        }
        if (courseOverlay != null) courseOverlay.setVisibility(View.GONE);
        activeCourse = null;
        activeCourseStartedAt = 0L;
        activeCourseAllowedHosts.clear();
    }

    @Override
    public void onBackPressed() {
        if (courseOverlay != null && courseOverlay.getVisibility() == View.VISIBLE) {
            closeCourseBrowser();
            return;
        }
        if (!"home".equals(activeWorkspace)) {
            showWorkspace("home");
            return;
        }
        super.onBackPressed();
    }

    @Override
    public void onClick(View view) {
        if (view == saveButton) {
            savePrefs();
            toast("已保存连接信息。");
        } else if (view == testButton) {
            savePrefs();
            connectAndLoadStudents();
        } else if (view == pasteButton) {
            pasteConnectionInfo();
        } else if (view == refreshHostAddressButton) {
            refreshHostAddress();
        } else if (view == scanPairButton) {
            startPairScan();
        } else if (view == nearbyHostButton) {
            discoverNearbyHosts();
        } else if (view == waitHostButton) {
            toggleWaitForHostInvite();
        } else if (view == filterHostButton) {
            filterNearbyHostsByCode();
        } else if (view == exportConnectionBackupButton) {
            startExportConnectionBackup();
        } else if (view == importConnectionBackupButton) {
            startImportConnectionBackup();
        } else if (view == checkUpdateButton) {
            checkForUpdate();
        } else if (view == copyDiagnosticsButton) {
            copyDiagnostics();
        } else if (view == downloadTailscaleButton) {
            openTailscaleDownload();
        } else if (view == tailscaleButton) {
            openTailscaleApp();
        } else if (view == upgradeStandaloneButton) {
            startStandaloneUpgrade();
        } else if (view == quickUploadButton) {
            showWorkspace("collection");
        } else if (view == quickReportButton) {
            openPanelPath("教育档案", "学情报告");
            loadLearningReport("profile");
            scrollToView(reportCard);
            status("正在读取学情报告。");
        } else if (view == quickArchiveButton) {
            selectStudentArchiveSource();
            archiveCard.setVisibility(View.VISIBLE);
            loadArchiveFiles();
            scrollToView(archiveCard);
            status("已打开当前学生的学情档案。");
        } else if (view == quickProjectKnowledgeButton) {
            openProjectMaterialsCenter();
        } else if (view == quickContactButton) {
            openPanelPath("教育管家对话", "QQ / 企业微信");
            updateContactCard();
            scrollToView(contactCard);
            status("请在“联系教育管家”区域打开企业微信或 QQ，并复制咨询提示。");
        } else if (view == connectionSettingsButton) {
            toggleConnectionSettings();
        } else if (view == settingsToggleButton) {
            toggleSettings();
        } else if (view == personalTerminalButton) {
            changeTerminalMode("personal");
        } else if (view == sharedTerminalButton) {
            changeTerminalMode("shared");
        } else if (view == studentLoginButton) {
            loginStudent(studentLoginInput == null ? "" : studentLoginInput.getText().toString());
        } else if (view == studentScanButton) {
            startStudentLoginScan();
        } else if (view == studentLogoutButton) {
            logoutStudent();
        } else if (view == agreementLink) {
            openUserAgreement();
        } else if (view == privacyLink) {
            openPrivacyPolicy();
        } else if (view == sharedUploadButton) {
            showCollectionManager();
        } else if (view == retryFailedUploadButton) {
            retryFailedUploads();
        } else if (view == conversationImportButton) {
            openConversationImport();
        } else if (view == captureStartButton) {
            handleCapturePrimary();
        } else if (view == capturePauseButton) {
            toggleCapturePause();
        } else if (view == captureUploadButton) {
            uploadCapturedScreenshots();
        } else if (view == captureManageButton) {
            showCaptureManager();
        } else if (view == courseBackButton) {
            closeCourseBrowser();
        } else if (view == courseCaptureButton) {
            handleCapturePrimary();
        } else if (view == autoDeliveryFolderButton) {
            chooseAutoDeliveryFolder();
        } else if (view == autoDeliveryTargetButton) {
            chooseAutoDeliveryTarget();
        } else if (view == autoDeliveryToggleButton) {
            toggleAutoDelivery();
        } else if (view == autoDeliveryCheckButton) {
            runAutoDeliveryNow();
        } else if (view == dailyReminderUploadButton) {
            startDirectUploadPicker();
        } else if (view == dailyReminderLaterButton) {
            dismissDailyReminder();
        } else if (view == refreshArchiveButton) {
            loadArchiveFiles();
        } else if (view == refreshReportsButton) {
            loadLearningReports();
        } else if (view == refreshGrowthButton) {
            loadGrowthSummary();
        } else if (view == reportProfileButton) {
            loadLearningReport("profile");
        } else if (view == reportDailyButton) {
            loadLearningReport("daily");
        } else if (view == reportChangesButton) {
            loadLearningReport("changes");
        } else if (view == reportStageButton) {
            loadLearningReport("stage");
        } else if (view == copyButton) {
            copyMarkdown();
        } else if (view == markdownModeButton) {
            markdownRendered = !markdownRendered;
            markdownModeButton.setText(markdownRendered ? "查看原文" : "阅读模式");
            updateMarkdownDisplay(currentMarkdown.length() == 0 ? "选择一个 Markdown 文件后，可在这里查看阅读版或原文。" : currentMarkdown);
        } else if (view == searchArchiveButton) {
            applyArchiveCategoryFilter();
        } else if (view == topButton) {
            if (rootScroll != null) rootScroll.smoothScrollTo(0, 0);
        } else if (view == fontSmallButton) {
            markdownFontSize = Math.max(13, markdownFontSize - 1);
            markdownView.setTextSize(markdownFontSize);
            updateMarkdownDisplay(currentMarkdown);
            toast("字号：" + markdownFontSize);
        } else if (view == fontLargeButton) {
            markdownFontSize = Math.min(24, markdownFontSize + 1);
            markdownView.setTextSize(markdownFontSize);
            updateMarkdownDisplay(currentMarkdown);
            toast("字号：" + markdownFontSize);
        } else if (view == openWeComButton) {
            openWeCom();
        } else if (view == openQQButton) {
            openQQ();
        } else if (view == openAgentButton) {
            chooseAgentApp();
        } else if (view == openMarvisButton) {
            openMarvis();
        } else if (view == openObsidianButton) {
            openObsidian();
        } else if (view == copyConsultPromptButton) {
            copyConsultPrompt();
        } else if (view == copyDigestPromptButton) {
            copyDigestPrompt();
        }
    }

    void startStandaloneUpgrade() {
        final String migrationToken = "personal".equals(terminalMode) ? apiToken() : dataToken();
        if (selectedStudent == null || migrationToken.length() == 0 || normalizedBaseUrl().length() == 0) {
            new AlertDialog.Builder(this)
                .setTitle("请先进入学生空间")
                .setMessage("学生端升级入口只迁移当前学生，适合少量资料。请先连接 Windows 主机，并进入要升级的学生空间。")
                .setPositiveButton("知道了", null).show();
            return;
        }
        final Student student = selectedStudent;
        if (!student.fileStatsReady) {
            new AlertDialog.Builder(this)
                .setTitle("正在统计学生资料")
                .setMessage("Windows 主机正在后台统计该学生的文件数量和容量。请保持连接，稍后刷新学生空间再试；统计完成前不会启动可能长时间卡住的网络迁移。")
                .setPositiveButton("知道了", null)
                .show();
            return;
        }
        final boolean largeMigration = student.rawFileCount >= 1000 || student.rawTotalBytes >= 3L * 1024L * 1024L * 1024L;
        if (largeMigration) {
            new AlertDialog.Builder(this)
                .setTitle("资料较多，建议使用 U 盘迁移")
                .setMessage("当前学生约有 " + student.rawFileCount + " 份资料（" + formatCaptureBytes(student.rawTotalBytes) + "）。为避免网络快照长时间等待或大型 ZIP 失败，请在 Windows 主机端打开该学生的“教育档案”，点击“导出到 Android 单机版（U盘）”；然后在单机版选择“从 U 盘迁移并接管”。\n\n该方式会逐文件校验、支持中断后继续，并同时带入关联学习项目及有效的平台/机构课程。")
                .setNegativeButton("取消", null)
                .setPositiveButton("知道了", null)
                .show();
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("升级为 Android 单机版")
            .setMessage("将从 Windows 主机固定快照并迁移：\n\n" + student.name + "\n学生 ID：" + student.id + "\n教育档案、资料、学情报告、成长记录和关联学习项目。\n\n这是一次性迁移，不建立后续同步。")
            .setNegativeButton("取消", null)
            .setPositiveButton("开始升级", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    status("正在请求 Windows 主机固定迁移快照…");
                    new Thread(new StandaloneUpgradeTask(MainActivity.this, normalizedBaseUrl(), migrationToken, student.id)).start();
                }
            }).show();
    }

    void openStandaloneMigration(JSONObject session) {
        Intent launch = new Intent(STANDALONE_MIGRATION_ACTION);
        launch.setPackage(STANDALONE_PACKAGE);
        launch.putExtra("baseUrl", normalizedBaseUrl());
        launch.putExtra("bearerToken", session.optString("bearerToken", dataToken()));
        launch.putExtra("studentId", session.optString("studentId"));
        launch.putExtra("sessionId", session.optString("sessionId"));
        launch.putExtra("downloadUrl", session.optString("downloadUrl"));
        launch.putExtra("sha256", session.optString("sha256"));
        launch.putExtra("bytes", session.optLong("bytes", 0L));
        if (launch.resolveActivity(getPackageManager()) != null) {
            startActivity(launch);
            status("迁移快照已就绪，已打开 Android 单机版。");
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("请先安装 Android 单机版")
            .setMessage("本平板未检测到最新 Android 单机版。安装后返回学生端，再点一次“从 Windows 主机升级到单机版（少量资料）”。")
            .setNegativeButton("取消", null)
            .setPositiveButton("打开下载页", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(STANDALONE_DOWNLOAD_URL))); }
                    catch (Exception error) { copyPlainText("android-standalone-download", STANDALONE_DOWNLOAD_URL); toast("已复制 Android 单机版下载页地址。"); }
                }
            }).show();
    }

    void toggleConnectionSettings() {
        connectionSettingsVisible = !connectionSettingsVisible;
        if (connectionConfigCard != null) {
            connectionConfigCard.setVisibility(connectionSettingsVisible ? View.VISIBLE : View.GONE);
        }
        if (connectionSettingsButton != null) {
            connectionSettingsButton.setText(connectionSettingsVisible ? "收起连接设置" : "连接设置");
        }
        if (connectionSettingsVisible) {
            scrollToView(connectionConfigCard);
        }
    }

    void toggleSettings() {
        settingsVisible = !settingsVisible;
        if (settingsCard != null) {
            settingsCard.setVisibility(settingsVisible ? View.VISIBLE : View.GONE);
        }
        if (settingsToggleButton != null) {
            settingsToggleButton.setText(settingsVisible ? "收起系统设置" : "系统设置");
        }
        if (settingsVisible) {
            scrollToView(settingsCard);
        }
    }

    void scrollToView(final View target) {
        if (rootScroll == null || target == null) return;
        rootScroll.post(new Runnable() {
            @Override public void run() {
                android.graphics.Rect bounds = new android.graphics.Rect();
                target.getDrawingRect(bounds);
                rootScroll.offsetDescendantRectToMyCoords(target, bounds);
                rootScroll.smoothScrollTo(0, Math.max(0, bounds.top - dp(10)));
            }
        });
    }

    @Override
    public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
        if (parent == layoutModeSpinner) {
            if (!suppressPreferenceCallbacks && layoutMode != position) {
                layoutMode = position;
                saveVisualPrefs();
                recreate();
            }
        } else if (parent == skinSpinner) {
            if (!suppressPreferenceCallbacks && skinIndex != position) {
                skinIndex = position;
                saveVisualPrefs();
                recreate();
            }
        } else if (parent == studentSpinner) {
            selectedStudent = position >= 0 && position < students.size() ? students.get(position) : null;
            pendingSharedUris.clear();
            failedUploadUris.clear();
            captureUploadUrisInFlight.clear();
            updateSharedUploadButton();
            updateConversationImportUi();
            updateDigestStatusCard();
            refreshCaptureUi();
            updateContactCard();
            refreshArchiveSources();
            loadCourses();
            loadArchiveFiles();
            resumeProjectMaterialUploadQueue();
            refreshCollectionInboxUi();
        } else if (parent == archiveSourceSpinner && !updatingArchiveSources) {
            if (position <= 0 || position - 1 >= archiveSourceProjects.size()) {
                showingProjectKnowledge = false;
                selectedKnowledgeProjectId = "";
                selectedKnowledgeProjectName = "";
                loadArchiveFiles();
            } else {
                LearningProject project = archiveSourceProjects.get(position - 1);
                loadProjectKnowledgeFiles(project);
            }
        } else if (parent == archiveCategorySpinner) {
            selectedArchiveCategory = position;
            applyArchiveCategoryFilter();
        } else if (parent == archiveSpinner && position >= 0 && position < archiveFiles.size()) {
            loadArchiveFile(archiveFiles.get(position));
        }
    }

    @Override
    public void onNothingSelected(AdapterView<?> parent) {
        if (parent == studentSpinner) {
            selectedStudent = null;
            updateConversationImportUi();
            closeCourseBrowser();
            loadCourses();
            refreshCaptureUi();
            refreshCollectionInboxUi();
        }
    }

    void connectAndLoadStudents() {
        List<String> candidates = connectionCandidates();
        if (candidates.size() == 0) {
            status("请先填写主机服务地址。");
            return;
        }
        status(candidates.size() > 1 ? "正在自动尝试局域网和 Tailscale 主机地址..." : "正在连接主机服务...");
        new Thread(new ConnectTask(this, candidates)).start();
    }

    void loadStudents() {
        String base = normalizedBaseUrl();
        String token = apiToken();
        if (base.length() == 0 || token.length() == 0) {
            status("请填写主机服务地址和 API Token。");
            return;
        }
        status("正在读取学生列表...");
        new Thread(new BootstrapStudentSessionTask(this, base, token, studentSessionToken)).start();
    }

    void beginAuthorizationPolling() {
        loadStudents();
    }

    String dataToken() {
        return studentSessionToken == null ? "" : studentSessionToken.trim();
    }

    void loginStudent(String loginIdOrQr) {
        String value = loginIdOrQr == null ? "" : loginIdOrQr.trim();
        if (value.length() == 0) {
            toast("\u8bf7\u8f93\u5165\u5b66\u751f ID \u6216\u626b\u7801\u3002");
            return;
        }
        if (normalizedBaseUrl().length() == 0 || apiToken().length() == 0) {
            toast("\u8bf7\u5148\u8fde\u63a5 Windows \u4e3b\u673a\u3002");
            return;
        }
        status("\u6b63\u5728\u8fdb\u5165\u5b66\u751f\u7a7a\u95f4...");
        new Thread(new StudentLoginTask(this, normalizedBaseUrl(), apiToken(), value)).start();
    }

    void logoutStudent() {
        String captureState = captureStatus();
        if ("capturing".equals(captureState) || "paused".equals(captureState)) {
            toast("\u8bf7\u5148\u7ed3\u675f\u5f53\u524d\u5c4f\u5e55\u91c7\u96c6\uff0c\u518d\u9000\u51fa\u5b66\u751f\u3002");
            return;
        }
        if (dataToken().length() == 0) {
            clearStudentSession("\u5df2\u7ecf\u9000\u51fa\u5b66\u751f\u7a7a\u95f4\u3002");
            return;
        }
        new Thread(new StudentLogoutTask(this, normalizedBaseUrl(), dataToken())).start();
    }

    void changeTerminalMode(String mode) {
        terminalMode = "personal".equals(mode) ? "personal" : "shared";
        if ("personal".equals(terminalMode)) personalRequiresBinding = boundStudentId.length() == 0;
        else personalRequiresBinding = false;
        if ("shared".equals(terminalMode)) {
            getSharedPreferences(AutoDeliveryJobService.PREFS, MODE_PRIVATE).edit()
                .putBoolean(AutoDeliveryJobService.KEY_ENABLED, false)
                .putString(AutoDeliveryJobService.KEY_LAST_RESULT, "已切换为共享终端，自动投递已关闭。")
                .apply();
            AutoDeliveryJobService.schedule(this);
        }
        updateStudentSessionUi();
        if (normalizedBaseUrl().length() == 0 || apiToken().length() == 0) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_TERMINAL_MODE, terminalMode).apply();
            return;
        }
        new Thread(new SetTerminalModeTask(this, normalizedBaseUrl(), apiToken(), terminalMode)).start();
    }

    void applyStudentSession(JSONObject payload, String error) {
        if (error != null) {
            clearStudentSession(error);
            status(error);
            return;
        }
        terminalMode = payload.optString("terminalMode", terminalMode);
        String token = payload.optString("token", studentSessionToken);
        if (token.length() > 0) studentSessionToken = token;
        JSONObject studentJson = payload.optJSONObject("student");
        if (studentJson != null && "personal".equals(terminalMode)) {
            boundStudentId = studentJson.optString("id", boundStudentId);
            personalRequiresBinding = false;
        }
        List<Student> result = new ArrayList<Student>();
        if (studentJson != null) result.add(new Student(studentJson));
        List<LearningProject> projectResult = new ArrayList<LearningProject>();
        JSONArray projectArray = payload.optJSONArray("projects");
        if (projectArray != null) {
            for (int i = 0; i < projectArray.length(); i++) {
                JSONObject item = projectArray.optJSONObject(i);
                if (item != null) projectResult.add(new LearningProject(item));
            }
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_TERMINAL_MODE, terminalMode)
            .putString(PREF_STUDENT_SESSION_TOKEN, studentSessionToken)
            .putString(PREF_STUDENT_SESSION_ID, studentJson == null ? "" : studentJson.optString("id", ""))
            .apply();
        applyStudents(result, projectResult, null, false);
        updateStudentSessionUi();
        if (studentLoginInput != null) studentLoginInput.setText("");
        resumeProjectMaterialUploadQueue();
    }

    void clearStudentSession(String message) {
        studentSessionToken = "";
        selectedStudent = null;
        students.clear();
        projects.clear();
        allArchiveFiles.clear();
        archiveFiles.clear();
        pendingSharedUris.clear();
        failedUploadUris.clear();
        captureUploadUrisInFlight.clear();
        closeCourseBrowser();
        courses.clear();
        renderCourses();
        if (courseStatusText != null) courseStatusText.setText("请先进入学生空间。");
        if (studentAdapter != null) { studentAdapter.clear(); studentAdapter.notifyDataSetChanged(); }
        if (archiveAdapter != null) { archiveAdapter.clear(); archiveAdapter.notifyDataSetChanged(); }
        currentMarkdown = "";
        updateMarkdownDisplay("\u8bf7\u5148\u626b\u7801\u6216\u8f93\u5165\u5b66\u751f ID\u3002");
        if (growthSummaryText != null) growthSummaryText.setText("进入学生空间后，可从 Windows 主机读取自己的成长模型。");
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .remove(PREF_STUDENT_SESSION_TOKEN)
            .remove(PREF_STUDENT_SESSION_ID)
            .apply();
        updateStudentSessionUi();
        updateSharedUploadButton();
        refreshCaptureUi();
        updateStudentProgressCard();
        if (message != null && message.length() > 0 && studentSessionText != null) studentSessionText.setText(message);
    }

    void updateStudentSessionUi() {
        boolean active = selectedStudent != null && dataToken().length() > 0;
        boolean canEnterStudent = !active && ("shared".equals(terminalMode) || personalRequiresBinding);
        styleSelectableButton(personalTerminalButton, "personal".equals(terminalMode));
        styleSelectableButton(sharedTerminalButton, "shared".equals(terminalMode));
        if (studentLoginInput != null) studentLoginInput.setVisibility(canEnterStudent ? View.VISIBLE : View.GONE);
        if (studentLoginButton != null) studentLoginButton.setVisibility(canEnterStudent ? View.VISIBLE : View.GONE);
        if (studentScanButton != null) studentScanButton.setVisibility(canEnterStudent ? View.VISIBLE : View.GONE);
        if (studentLogoutButton != null) studentLogoutButton.setVisibility(active ? View.VISIBLE : View.GONE);
        if (studentSessionText != null) {
            if (active) studentSessionText.setText(("personal".equals(terminalMode) ? "\u4e2a\u4eba\u7ec8\u7aef" : "\u5171\u4eab\u7ec8\u7aef") + " \u00b7 \u5f53\u524d\u5b66\u751f\uff1a" + selectedStudent.name);
            else if ("personal".equals(terminalMode) && personalRequiresBinding) studentSessionText.setText("个人终端：请输入本人学生 ID 或扫码完成首次绑定。");
            else if ("personal".equals(terminalMode)) studentSessionText.setText("\u4e2a\u4eba\u7ec8\u7aef\uff1a\u6b63\u5728\u4ece\u4e3b\u673a\u8bfb\u53d6\u7ed1\u5b9a\u5b66\u751f\u3002");
            else studentSessionText.setText("\u5171\u4eab\u7ec8\u7aef\uff1a\u8bf7\u626b\u7801\u6216\u8f93\u5165\u4e2a\u4eba ID\u3002");
        }
        if (navigationStudentText != null) {
            navigationStudentText.setText(active
                ? "当前学生\n" + selectedStudent.name
                : ("personal".equals(terminalMode) ? (personalRequiresBinding ? "等待首次绑定学生" : "正在读取绑定学生…") : "尚未进入学生空间"));
        }
        if (uploadButton != null) uploadButton.setEnabled(active && collectionReadyCount() > 0);
        if (quickUploadButton != null) quickUploadButton.setEnabled(true);
        if (quickReportButton != null) quickReportButton.setEnabled(active);
        if (quickArchiveButton != null) quickArchiveButton.setEnabled(active);
        if (refreshGrowthButton != null) refreshGrowthButton.setEnabled(active);
        updateAutoDeliveryUi();
        updateStudentProgressCard();
        refreshCollectionInboxUi();
        updateConversationImportUi();
    }

    void chooseAutoDeliveryFolder() {
        if (!"personal".equals(terminalMode)) {
            toast("共享终端不启用文件夹自动投递，请先在主机连接页切换为个人终端。");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(intent, REQUEST_AUTO_DELIVERY_FOLDER);
    }

    void chooseAutoDeliveryTarget() {
        if (!"personal".equals(terminalMode) || selectedStudent == null) {
            toast("请先使用个人终端进入已绑定学生。");
            return;
        }
        final ArrayList<UploadTarget> targets = new ArrayList<UploadTarget>();
        targets.add(new UploadTarget("student", selectedStudent.id, selectedStudent.name + "原始资料库", selectedStudent.id));
        for (LearningProject project : projectsForSelectedStudent()) {
            targets.add(new UploadTarget("project", project.id, project.name + "项目原始资料库", selectedStudent.id));
        }
        SharedPreferences prefs = getSharedPreferences(AutoDeliveryJobService.PREFS, MODE_PRIVATE);
        String selectedType = prefs.getString(AutoDeliveryJobService.KEY_TARGET_TYPE, "student");
        String selectedId = prefs.getString(AutoDeliveryJobService.KEY_TARGET_ID, selectedStudent.id);
        int checked = 0;
        final String[] labels = new String[targets.size()];
        for (int i = 0; i < targets.size(); i++) {
            labels[i] = targets.get(i).name;
            if (targets.get(i).type.equals(selectedType) && targets.get(i).id.equals(selectedId)) checked = i;
        }
        final int initial = checked;
        new AlertDialog.Builder(this)
            .setTitle("选择自动投递位置")
            .setSingleChoiceItems(labels, initial, null)
            .setPositiveButton("保存", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    int position = ((AlertDialog) dialog).getListView().getCheckedItemPosition();
                    if (position < 0 || position >= targets.size()) position = initial;
                    UploadTarget target = targets.get(position);
                    getSharedPreferences(AutoDeliveryJobService.PREFS, MODE_PRIVATE).edit()
                        .putString(AutoDeliveryJobService.KEY_STUDENT_ID, selectedStudent.id)
                        .putString(AutoDeliveryJobService.KEY_STUDENT_NAME, selectedStudent.name)
                        .putString(AutoDeliveryJobService.KEY_TARGET_TYPE, target.type)
                        .putString(AutoDeliveryJobService.KEY_TARGET_ID, target.id)
                        .putString(AutoDeliveryJobService.KEY_TARGET_NAME, target.name)
                        .apply();
                    updateAutoDeliveryUi();
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void toggleAutoDelivery() {
        if (!"personal".equals(terminalMode) || selectedStudent == null || dataToken().length() == 0) {
            toast("自动投递只适用于已连接学生的个人终端。");
            return;
        }
        SharedPreferences prefs = getSharedPreferences(AutoDeliveryJobService.PREFS, MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(AutoDeliveryJobService.KEY_ENABLED, false);
        if (!enabled && prefs.getString(AutoDeliveryJobService.KEY_TREE_URI, "").length() == 0) {
            toast("请先选择并授权自动投递文件夹。");
            return;
        }
        SharedPreferences.Editor editor = prefs.edit().putBoolean(AutoDeliveryJobService.KEY_ENABLED, !enabled);
        if (!enabled) {
            String configuredStudent = prefs.getString(AutoDeliveryJobService.KEY_STUDENT_ID, "");
            if (!selectedStudent.id.equals(configuredStudent)) {
                editor.putString(AutoDeliveryJobService.KEY_STUDENT_ID, selectedStudent.id)
                    .putString(AutoDeliveryJobService.KEY_STUDENT_NAME, selectedStudent.name)
                    .putString(AutoDeliveryJobService.KEY_TARGET_TYPE, "student")
                    .putString(AutoDeliveryJobService.KEY_TARGET_ID, selectedStudent.id)
                    .putString(AutoDeliveryJobService.KEY_TARGET_NAME, selectedStudent.name + "原始资料库");
            }
            editor.putString(AutoDeliveryJobService.KEY_LAST_RESULT, "自动投递已启用，正在检查文件夹。不会删除本地文件。");
        } else {
            editor.putString(AutoDeliveryJobService.KEY_LAST_RESULT, "自动投递已关闭。");
        }
        editor.apply();
        AutoDeliveryJobService.schedule(this);
        if (!enabled) AutoDeliveryJobService.runNow(this, true);
        updateAutoDeliveryUi();
    }

    void runAutoDeliveryNow() {
        SharedPreferences prefs = getSharedPreferences(AutoDeliveryJobService.PREFS, MODE_PRIVATE);
        if (!"personal".equals(terminalMode) || !prefs.getBoolean(AutoDeliveryJobService.KEY_ENABLED, false)) {
            toast("请先在个人终端中启用自动投递。");
            return;
        }
        prefs.edit().putString(AutoDeliveryJobService.KEY_LAST_RESULT, "正在检查文件夹…").apply();
        updateAutoDeliveryUi();
        AutoDeliveryJobService.runNow(this, true);
        autoDeliveryStatusText.postDelayed(new Runnable() {
            @Override public void run() { updateAutoDeliveryUi(); }
        }, 1800L);
        autoDeliveryStatusText.postDelayed(new Runnable() {
            @Override public void run() { updateAutoDeliveryUi(); }
        }, 6000L);
    }

    void updateAutoDeliveryUi() {
        if (autoDeliveryStatusText == null) return;
        SharedPreferences prefs = getSharedPreferences(AutoDeliveryJobService.PREFS, MODE_PRIVATE);
        boolean personal = "personal".equals(terminalMode);
        boolean enabled = prefs.getBoolean(AutoDeliveryJobService.KEY_ENABLED, false);
        String folder = prefs.getString(AutoDeliveryJobService.KEY_TREE_NAME, "尚未选择文件夹");
        String target = prefs.getString(AutoDeliveryJobService.KEY_TARGET_NAME, selectedStudent == null ? "尚未选择投递位置" : selectedStudent.name + "原始资料库");
        String result = prefs.getString(AutoDeliveryJobService.KEY_LAST_RESULT, "尚未执行检查。");
        long checkedAt = prefs.getLong(AutoDeliveryJobService.KEY_LAST_CHECKED_AT, 0L);
        String checked = checkedAt > 0L ? android.text.format.DateFormat.format("yyyy-MM-dd HH:mm", new java.util.Date(checkedAt)).toString() : "尚未检查";
        if (!personal) {
            autoDeliveryStatusText.setText("共享终端不启用文件夹自动投递，避免下一位学生沿用上一人的资料归属。仍可手动选择资料上传。");
        } else {
            autoDeliveryStatusText.setText("文件夹：" + folder + "\n投递到：" + target + "\n状态：" + (enabled ? "已启用" : "已关闭") + " · 最近检查：" + checked + "\n" + result);
        }
        autoDeliveryFolderButton.setEnabled(personal);
        autoDeliveryTargetButton.setEnabled(personal && selectedStudent != null);
        autoDeliveryToggleButton.setEnabled(personal && selectedStudent != null);
        autoDeliveryCheckButton.setEnabled(personal && enabled);
        autoDeliveryToggleButton.setText(enabled ? "关闭自动投递" : "启用自动投递");
    }

    void scheduleAuthorizationPolling() {
        if (authorizationPollsRemaining <= 0 || nearbyHostButton == null) return;
        authorizationPollsRemaining -= 1;
        nearbyHostButton.postDelayed(new Runnable() {
            @Override public void run() {
                if (authorizationPollsRemaining >= 0) loadStudents();
            }
        }, 5000);
    }

    void loadArchiveFiles() {
        final long requestGeneration = ++archiveRequestGeneration;
        showingProjectKnowledge = false;
        selectedKnowledgeProjectId = "";
        selectedKnowledgeProjectName = "";
        if (selectedStudent == null) {
            allArchiveFiles.clear();
            archiveFiles.clear();
            renderArchiveFileList();
            archiveTitle.setText("请选择学生。");
            currentMarkdown = "";
            updateMarkdownDisplay("选择学生后可查看该学生的学情档案。");
            return;
        }
        String base = normalizedBaseUrl();
        String token = dataToken();
        if (base.length() == 0 || token.length() == 0) return;
        new Thread(new LoadArchiveFilesTask(this, base, token, selectedStudent.id, requestGeneration)).start();
    }

    void refreshArchiveSources() {
        if (archiveSourceAdapter == null) return;
        updatingArchiveSources = true;
        archiveSourceProjects.clear();
        archiveSourceAdapter.clear();
        archiveSourceAdapter.add("我的学情档案");
        if (selectedStudent != null) {
            for (LearningProject project : projects) {
                if (!project.studentIds.contains(selectedStudent.id)) continue;
                archiveSourceProjects.add(project);
                archiveSourceAdapter.add("项目知识：" + project.name + ("sealed".equals(project.status) ? "（已封存）" : ""));
            }
        }
        archiveSourceAdapter.notifyDataSetChanged();
        int selected = 0;
        if (showingProjectKnowledge && selectedKnowledgeProjectId.length() > 0) {
            for (int i = 0; i < archiveSourceProjects.size(); i++) {
                if (selectedKnowledgeProjectId.equals(archiveSourceProjects.get(i).id)) selected = i + 1;
            }
        }
        archiveSourceSpinner.setSelection(selected, false);
        updatingArchiveSources = false;
    }

    void openProjectMaterialsCenter() {
        refreshArchiveSources();
        if (archiveSourceProjects.isEmpty()) {
            status("当前学生还没有关联项目资料。");
            return;
        }
        final List<LearningProject> available = new ArrayList<LearningProject>(archiveSourceProjects);
        if (available.size() == 1) {
            openProjectMaterialsProject(available.get(0));
            return;
        }
        String[] labels = new String[available.size()];
        for (int i = 0; i < available.size(); i++) {
            LearningProject item = available.get(i);
            labels[i] = item.name + (item.supportsMaterialViews() ? " · 四视图" : " · 旧版知识库")
                + item.migrationLabel();
        }
        new AlertDialog.Builder(this).setTitle("选择项目")
            .setItems(labels, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    if (which >= 0 && which < available.size()) openProjectMaterialsProject(available.get(which));
                }
            }).setNegativeButton("取消", null).show();
    }

    void openProjectMaterialsProject(final LearningProject project) {
        if (project == null) return;
        if (!project.supportsMaterialViews()) {
            archiveCard.setVisibility(View.VISIBLE);
            int index = archiveSourceProjects.indexOf(project);
            if (index >= 0) archiveSourceSpinner.setSelection(index + 1);
            scrollToView(archiveCard);
            status("running".equals(project.materialMigrationState)
                ? "Windows主机正在迁移历史资料；本端只读等待。"
                : "该项目仍使用旧版知识库视图；请在Windows主机预览并执行受控迁移。");
            return;
        }
        ProjectMaterialsDialog.open(new ProjectMaterialsDialog.Bridge() {
            @Override public Activity activity() { return MainActivity.this; }
            @Override public String baseUrl() { return normalizedBaseUrl(); }
            @Override public String token() { return dataToken(); }
            @Override public String hostId() { return connectedHostId(); }
            @Override public String dataGeneration() { return connectedHostDataGeneration(); }
            @Override public String principalScope() {
                return selectedStudent == null ? "student:unknown" : "student:" + selectedStudent.id;
            }
            @Override public JSONObject getJson(String url) throws Exception {
                return MainActivity.this.getJson(url, dataToken());
            }
            @Override public JSONObject postJson(String url, JSONObject body) throws Exception {
                return MainActivity.this.postJson(url, body, dataToken());
            }
            @Override public void status(String message) { MainActivity.this.status(message); }
        }, project.asMaterialProject());
    }

    void selectStudentArchiveSource() {
        showingProjectKnowledge = false;
        selectedKnowledgeProjectId = "";
        selectedKnowledgeProjectName = "";
        if (archiveSourceSpinner != null) archiveSourceSpinner.setSelection(0, false);
    }

    void loadProjectKnowledgeFiles(LearningProject project) {
        if (selectedStudent == null || project == null || !project.studentIds.contains(selectedStudent.id)) {
            status("当前学生没有关联该项目。");
            return;
        }
        String base = normalizedBaseUrl();
        String token = dataToken();
        if (base.length() == 0 || token.length() == 0) {
            status("请先进入学生空间。");
            return;
        }
        showingProjectKnowledge = true;
        final long requestGeneration = ++archiveRequestGeneration;
        selectedKnowledgeProjectId = project.id;
        selectedKnowledgeProjectName = project.name;
        archiveTitle.setText("正在读取“" + project.name + "”项目知识...");
        new Thread(new LoadProjectKnowledgeFilesTask(this, base, token, selectedStudent.id, project, requestGeneration)).start();
    }

    void refreshProjectKnowledgeAfterConflict(String projectId) {
        if (!showingProjectKnowledge || !projectId.equals(selectedKnowledgeProjectId)) return;
        for (LearningProject project : projects) {
            if (project.id.equals(projectId)) {
                status("项目知识已变化，正在刷新列表，请重新选择。");
                loadProjectKnowledgeFiles(project);
                return;
            }
        }
    }

    void loadArchiveFile(ArchiveFile file) {
        if (selectedStudent == null) return;
        String base = normalizedBaseUrl();
        String token = dataToken();
        if (base.length() == 0 || token.length() == 0) return;
        if ("project".equals(file.sourceType) && file.projectId.length() > 0) {
            String projectName = selectedKnowledgeProjectName;
            for (LearningProject item : projects) if (item.id.equals(file.projectId)) projectName = item.name;
            new Thread(new LoadProjectKnowledgeFileTask(this, base, token, selectedStudent.id, file.projectId, projectName, file)).start();
        } else {
            String scopedStudentId = file.studentId.length() > 0 ? file.studentId : selectedStudent.id;
            new Thread(new LoadArchiveFileTask(this, base, token, scopedStudentId, file)).start();
        }
    }

    void loadLearningReports() {
        if (selectedStudent == null) {
            status("请先选择学生。");
            return;
        }
        String base = normalizedBaseUrl();
        String token = dataToken();
        if (base.length() == 0 || token.length() == 0) {
            status("请先进入学生空间。");
            return;
        }
        status("正在同步学情报告...");
        new Thread(new LoadLearningReportsTask(this, base, token, selectedStudent.id)).start();
    }

    void loadGrowthSummary() {
        if (selectedStudent == null) {
            status("请先进入学生空间。");
            return;
        }
        String base = normalizedBaseUrl();
        String token = dataToken();
        if (base.length() == 0 || token.length() == 0) {
            status("请先进入学生空间。");
            return;
        }
        status("正在读取成长模型...");
        new Thread(new LoadGrowthSummaryTask(this, base, token, selectedStudent.id)).start();
    }

    void applyGrowthSummary(JSONObject payload, String error) {
        if (growthSummaryText == null) return;
        if (error != null) {
            growthSummaryText.setText("成长模型读取失败：" + error);
            status("成长模型读取失败：" + error);
            return;
        }
        String fallbackMarkdown = payload == null ? "" : payload.optString("fallbackMarkdown", "");
        if (fallbackMarkdown.length() > 0) {
            String readable = readableGrowthMarkdown(fallbackMarkdown);
            growthSummaryText.setText("成长模型已同步 · 点击“查看成长模型”阅读详情");
            showReadOnlyDetailDialog("成长模型", "主机兼容模式", readable);
            status("成长模型已更新（兼容模式）。");
            return;
        }
        JSONObject summary = payload == null ? null : payload.optJSONObject("summary");
        JSONArray abilities = payload == null ? null : payload.optJSONArray("abilities");
        JSONArray projectItems = payload == null ? null : payload.optJSONArray("projects");
        JSONArray evidence = payload == null ? null : payload.optJSONArray("recentEvidence");
        StringBuilder text = new StringBuilder();
        text.append("成长证据 ").append(summary == null ? 0 : summary.optInt("evidenceCount", 0))
            .append(" 条 · 已确认 ").append(summary == null ? 0 : summary.optInt("confirmedCount", 0))
            .append(" 条 · 观察中 ").append(summary == null ? 0 : summary.optInt("watchingCount", 0)).append(" 条\n");
        text.append("能力维度 ").append(summary == null ? 0 : summary.optInt("abilityCount", 0))
            .append(" 个 · 关联项目 ").append(summary == null ? 0 : summary.optInt("projectCount", 0)).append(" 个\n\n");
        text.append("能力画像\n");
        if (abilities == null || abilities.length() == 0) {
            text.append("• 暂无已形成的能力画像。\n");
        } else {
            for (int i = 0; i < abilities.length() && i < 8; i++) {
                JSONObject item = abilities.optJSONObject(i);
                if (item == null) continue;
                text.append("• ").append(item.optString("name", "待标注"))
                    .append("：").append(item.optString("maturityLabel", "证据不足"))
                    .append("，").append(item.optString("trendLabel", "尚不足以判断"))
                    .append("；证据 ").append(item.optInt("evidenceCount", 0)).append(" 条\n");
            }
        }
        text.append("\n项目贡献\n");
        if (projectItems == null || projectItems.length() == 0) {
            text.append("• 暂无项目贡献记录。\n");
        } else {
            for (int i = 0; i < projectItems.length() && i < 6; i++) {
                JSONObject item = projectItems.optJSONObject(i);
                if (item == null) continue;
                text.append("• ").append(item.optString("projectName", "未命名项目"))
                    .append("：").append(item.optString("reviewStatusLabel", "积累中"))
                    .append("；已确认 ").append(item.optInt("confirmedEvidenceCount", 0))
                    .append("/").append(item.optInt("evidenceCount", 0)).append(" 条\n");
            }
        }
        text.append("\n近期成长证据\n");
        if (evidence == null || evidence.length() == 0) {
            text.append("• 暂无已确认或观察中的成长证据。");
        } else {
            for (int i = 0; i < evidence.length() && i < 6; i++) {
                JSONObject item = evidence.optJSONObject(i);
                if (item == null) continue;
                text.append("• ").append(item.optString("title", "成长证据"))
                    .append("（").append(item.optString("statusLabel", "观察中"));
                String ability = item.optString("ability", "");
                if (ability.length() > 0) text.append(" · ").append(ability);
                text.append("）");
                if (i + 1 < evidence.length() && i < 5) text.append("\n");
            }
        }
        String summaryLine = "成长证据 " + (summary == null ? 0 : summary.optInt("evidenceCount", 0))
            + " 条 · 能力维度 " + (summary == null ? 0 : summary.optInt("abilityCount", 0))
            + " 个 · 关联项目 " + (summary == null ? 0 : summary.optInt("projectCount", 0)) + " 个";
        growthSummaryText.setText(summaryLine + "\n点击“查看成长模型”阅读详情。");
        showReadOnlyDetailDialog("成长模型", summaryLine, text.toString());
        status("成长模型已更新。");
    }

    String readableGrowthMarkdown(String markdown) {
        String updatedAt = "";
        String evidenceCount = "0";
        String confirmedCount = "0";
        String watchingCount = "0";
        String abilityCount = "0";
        String projectCount = "0";
        String section = "";
        int abilityRows = 0;
        int projectRows = 0;
        StringBuilder abilities = new StringBuilder();
        StringBuilder projects = new StringBuilder();
        String[] lines = (markdown == null ? "" : markdown).replace("\r", "").split("\n");
        for (String sourceLine : lines) {
            String line = sourceLine == null ? "" : sourceLine.trim();
            if (line.length() == 0) continue;
            if (line.startsWith("生成时间：")) {
                updatedAt = line.substring("生成时间：".length()).trim();
                continue;
            }
            if (line.matches("^##\\s+总览.*")) { section = "summary"; continue; }
            if (line.matches("^##\\s+能力画像.*")) { section = "abilities"; continue; }
            if (line.matches("^##\\s+项目贡献.*")) { section = "projects"; continue; }
            if (line.startsWith("## ") || line.startsWith(">")) { section = ""; continue; }
            if (line.matches("^\\|\\s*[-:| ]+\\s*\\|$")) continue;
            String[] cells = growthTableCells(line);
            if (cells.length < 2) continue;
            if ("summary".equals(section) && !"指标".equals(cells[0])) {
                if ("成长证据".equals(cells[0])) evidenceCount = cells[1];
                else if ("已确认".equals(cells[0])) confirmedCount = cells[1];
                else if ("观察中".equals(cells[0])) watchingCount = cells[1];
                else if ("能力维度".equals(cells[0])) abilityCount = cells[1];
                else if ("关联项目".equals(cells[0])) projectCount = cells[1];
            } else if ("abilities".equals(section) && cells.length >= 5 && !"能力".equals(cells[0]) && abilityRows < 8) {
                if (abilities.length() > 0) abilities.append("\n");
                abilities.append("• ").append(cells[0].length() == 0 ? "待标注" : cells[0])
                    .append("：").append(growthMaturityLabel(cells[1]))
                    .append("，").append(growthTrendLabel(cells[2]))
                    .append("；证据 ").append(cells[3]).append(" 条")
                    .append("，已确认 ").append(cells[4]).append(" 条");
                if (cells.length > 5) {
                    String names = safeGrowthNames(cells[5]);
                    if (names.length() > 0) abilities.append("；项目 ").append(names);
                }
                abilityRows++;
            } else if ("projects".equals(section) && cells.length >= 4 && !"项目".equals(cells[0]) && projectRows < 6) {
                if (projects.length() > 0) projects.append("\n");
                projects.append("• ").append(cells[0].length() == 0 ? "未命名项目" : cells[0])
                    .append("：").append(growthProjectStatusLabel(cells[1]))
                    .append("；已确认 ").append(cells[3]).append("/").append(cells[2]).append(" 条");
                projectRows++;
            }
        }
        StringBuilder text = new StringBuilder();
        if (updatedAt.length() > 0) text.append("更新时间：").append(updatedAt).append("\n");
        text.append("成长证据 ").append(evidenceCount).append(" 条 · 已确认 ").append(confirmedCount)
            .append(" 条 · 观察中 ").append(watchingCount).append(" 条\n")
            .append("能力维度 ").append(abilityCount).append(" 个 · 关联项目 ").append(projectCount).append(" 个\n\n")
            .append("能力画像\n").append(abilities.length() == 0 ? "• 暂无已形成的能力画像。" : abilities.toString())
            .append("\n\n项目贡献\n").append(projects.length() == 0 ? "• 暂无项目贡献记录。" : projects.toString());
        return text.toString();
    }

    String[] growthTableCells(String line) {
        String value = line == null ? "" : line.trim();
        if (!value.startsWith("|") || !value.endsWith("|")) return new String[0];
        String[] cells = value.substring(1, value.length() - 1).split("\\|", -1);
        for (int i = 0; i < cells.length; i++) cells[i] = cells[i].trim();
        return cells;
    }

    String growthMaturityLabel(String value) {
        if ("established".equals(value)) return "已形成";
        if ("emerging".equals(value)) return "正在形成";
        if ("observing".equals(value)) return "观察中";
        return "证据不足";
    }

    String growthTrendLabel(String value) {
        if ("improving".equals(value)) return "持续增强";
        if ("stable".equals(value)) return "保持稳定";
        return "尚不足以判断";
    }

    String growthProjectStatusLabel(String value) {
        if ("published".equals(value)) return "已发布";
        if ("not_started".equals(value)) return "尚无成长证据";
        return "积累中";
    }

    String safeGrowthNames(String value) {
        StringBuilder safe = new StringBuilder();
        String[] names = (value == null ? "" : value).split("[、,，]");
        for (String source : names) {
            String name = source == null ? "" : source.trim();
            if (name.length() == 0 || "-".equals(name) || name.matches("^[A-Za-z]:[\\\\/].*") || name.contains(":\\")) continue;
            if (safe.length() > 0) safe.append("、");
            safe.append(name);
            if (safe.length() > 80) break;
        }
        return safe.toString();
    }

    void loadLearningReport(String reportId) {
        if (selectedStudent == null) {
            status("请先选择学生。");
            return;
        }
        String base = normalizedBaseUrl();
        String token = dataToken();
        if (base.length() == 0 || token.length() == 0) {
            status("请先进入学生空间。");
            return;
        }
        selectedReportId = reportId;
        updateReportButtonSelection();
        status("正在读取" + reportTitleForId(reportId) + "...");
        new Thread(new LoadLearningReportTask(this, base, token, selectedStudent.id, reportId)).start();
    }

    void updateReportButtonSelection() {
        styleSelectableButton(reportProfileButton, "profile".equals(selectedReportId));
        styleSelectableButton(reportDailyButton, "daily".equals(selectedReportId));
        styleSelectableButton(reportChangesButton, "changes".equals(selectedReportId));
        styleSelectableButton(reportStageButton, "stage".equals(selectedReportId));
    }

    void styleSelectableButton(Button target, boolean selected) {
        if (target == null) return;
        int normal = selected ? accentColor() : accentLightColor();
        int pressed = selected ? mixColor(normal, Color.BLACK, 0.14f) : mixColor(normal, accentColor(), 0.18f);
        int disabled = Color.rgb(228, 234, 232);
        int[][] states = new int[][] {
            new int[] {-android.R.attr.state_enabled},
            new int[] {android.R.attr.state_pressed},
            new int[] {}
        };
        target.setTextColor(selected ? Color.WHITE : accentColor());
        target.setBackgroundTintList(new ColorStateList(states, new int[] {disabled, pressed, normal}));
        target.setSelected(selected);
        target.refreshDrawableState();
    }

    ArchiveFile reportArchiveFile(String reportId) {
        return new ArchiveFile(reportTitleForId(reportId) + ".md", "学情报告/" + reportFileNameForId(reportId));
    }

    String reportTitleForId(String reportId) {
        if ("changes".equals(reportId)) return "历史变化";
        if ("daily".equals(reportId)) return "每日行动建议";
        if ("stage".equals(reportId)) return "阶段总结";
        return "整体画像";
    }

    String reportFileNameForId(String reportId) {
        if ("changes".equals(reportId)) return "历史变化.md";
        if ("daily".equals(reportId)) return "每日行动建议.md";
        if ("stage".equals(reportId)) return "阶段总结.md";
        return "整体画像.md";
    }

    void pickMaterial() {
        if (selectedStudent == null && students.size() > 0) {
            int position = studentSpinner == null ? 0 : Math.max(0, studentSpinner.getSelectedItemPosition());
            selectedStudent = students.get(Math.min(position, students.size() - 1));
        }
        if (currentStudentScopeId().length() == 0) {
            status("尚未进入学生空间，无法固定资料归属。连接主机并进入学生空间后，可在离线状态继续收集。 ");
            toast("请先进入学生空间。 ");
            return;
        }
        String[] options = new String[] {"选择文件", "选择图片/截图", "拍照收集", "扫描 Downloads 最近文件"};
        new AlertDialog.Builder(this)
            .setTitle("保存资料到当前学生本机")
            .setItems(options, new UploadOptionClickListener(this))
            .show();
    }

    void startPickFiles() {
        Intent openDocument = buildFilePickIntent(Intent.ACTION_OPEN_DOCUMENT);
        if (launchPicker(openDocument, REQUEST_PICK_MATERIAL, "选择要保存在本机的学习资料")) return;

        Intent getContent = buildFilePickIntent(Intent.ACTION_GET_CONTENT);
        if (launchPicker(getContent, REQUEST_PICK_MATERIAL, "选择要保存在本机的学习资料")) return;

        status("当前平板的系统文件选择器不可用。可改用“选择图片/截图”“拍照上传”“扫描 Downloads 最近文件”，或从文件管理器分享文件到教育管家。");
        toast("系统文件选择器不可用，请改用其他上传方式。");
    }

    void startDirectUploadPicker() {
        if (selectedStudent == null) {
            toast("请先在主机连接页进入学生空间。 ");
            openPanelPath("主机连接", "终端与学生空间");
            return;
        }
        Intent openDocument = buildFilePickIntent(Intent.ACTION_OPEN_DOCUMENT);
        if (launchPicker(openDocument, REQUEST_DIRECT_UPLOAD, "选择要上传的学习资料")) return;
        Intent getContent = buildFilePickIntent(Intent.ACTION_GET_CONTENT);
        if (launchPicker(getContent, REQUEST_DIRECT_UPLOAD, "选择要上传的学习资料")) return;
        status("当前平板的系统文件选择器不可用。可从文件管理器分享资料到教育管家，或先在资料收集页保存到本机。");
        toast("系统文件选择器不可用。 ");
    }

    void startDirectImageUploadPicker() {
        if (selectedStudent == null) {
            toast("请先在主机连接页进入学生空间。 ");
            openPanelPath("主机连接", "终端与学生空间");
            return;
        }
        Intent openDocument = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        openDocument.addCategory(Intent.CATEGORY_OPENABLE);
        openDocument.setType("image/*");
        openDocument.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (launchPicker(openDocument, REQUEST_DIRECT_IMAGE_UPLOAD, "选择一张或多张图片")) return;
        Intent getContent = new Intent(Intent.ACTION_GET_CONTENT);
        getContent.addCategory(Intent.CATEGORY_OPENABLE);
        getContent.setType("image/*");
        getContent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (!launchPicker(getContent, REQUEST_DIRECT_IMAGE_UPLOAD, "选择一张或多张图片")) {
            toast("无法打开多选图片选择器，请尝试拍照或从相册分享图片到教育管家。 ");
        }
    }

    Intent buildFilePickIntent(String action) {
        Intent intent = new Intent(action);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_MIME_TYPES, MATERIAL_MIME_TYPES);
        return intent;
    }

    boolean launchPicker(Intent intent, int requestCode, String title) {
        try {
            startActivityForResult(Intent.createChooser(intent, title), requestCode);
            return true;
        } catch (Exception error) {
            status("打开系统文件选择器失败：" + safeErrorMessage(error));
            return false;
        }
    }

    String safeErrorMessage(Exception error) {
        if (error == null) return "未知错误";
        String message = error.getMessage();
        return message == null || message.trim().length() == 0
            ? error.getClass().getSimpleName()
            : message.trim();
    }

    void discoverNearbyHosts() {
        status("正在查找同一局域网内的 AI 教育管家主机...");
        nearbyHostButton.setEnabled(false);
        new Thread(new NearbyHostDiscoveryTask(this)).start();
    }

    void toggleWaitForHostInvite() {
        if (waitingForHostInvite) {
            stopWaitingForHostInvite();
            status("已停止等待主机连接。");
            return;
        }
        waitingForHostInvite = true;
        acquireTabletDiscoveryMulticastLock();
        waitHostButton.setText("停止等待主机");
        status("正在等待 Windows 主机发现本平板。固定平板码：" + tabletMachineCode());
        new Thread(new Runnable() {
            @Override public void run() { runTabletDiscoveryListener(); }
        }).start();
    }

    void stopWaitingForHostInvite() {
        waitingForHostInvite = false;
        DatagramSocket socket = tabletDiscoverySocket;
        tabletDiscoverySocket = null;
        if (socket != null) socket.close();
        releaseTabletDiscoveryMulticastLock();
        if (waitHostButton != null) runOnUiThread(new Runnable() {
            @Override public void run() { waitHostButton.setText("等待主机连接"); }
        });
    }

    void acquireTabletDiscoveryMulticastLock() {
        if (tabletDiscoveryMulticastLock != null && tabletDiscoveryMulticastLock.isHeld()) return;
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) return;
            tabletDiscoveryMulticastLock = wifi.createMulticastLock("ai-edu-manager-tablet-discovery");
            tabletDiscoveryMulticastLock.setReferenceCounted(false);
            tabletDiscoveryMulticastLock.acquire();
        } catch (Exception error) {
            tabletDiscoveryMulticastLock = null;
        }
    }

    void releaseTabletDiscoveryMulticastLock() {
        WifiManager.MulticastLock lock = tabletDiscoveryMulticastLock;
        tabletDiscoveryMulticastLock = null;
        if (lock == null) return;
        try {
            if (lock.isHeld()) lock.release();
        } catch (Exception ignored) {
        }
    }

    void announceTabletDiscoveryPresence(DatagramSocket socket) {
        if (socket == null || socket.isClosed()) return;
        try {
            byte[] data = tabletDiscoveryPayload().toString().getBytes("UTF-8");
            socket.send(new DatagramPacket(data, data.length, InetAddress.getByName("255.255.255.255"), HOST_DISCOVERY_PORT));
        } catch (Exception ignored) {
        }
    }

    void runTabletDiscoveryListener() {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(HOST_DISCOVERY_PORT));
            socket.setBroadcast(true);
            socket.setSoTimeout(700);
            tabletDiscoverySocket = socket;
            announceTabletDiscoveryPresence(socket);
            long lastPresenceAt = System.currentTimeMillis();
            while (waitingForHostInvite) {
                try {
                    byte[] buffer = new byte[16384];
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    socket.receive(packet);
                    String text = new String(packet.getData(), 0, packet.getLength(), "UTF-8");
                    JSONObject json = new JSONObject(text);
                    String type = json.optString("type", "");
                    if (HOST_DISCOVERY_REQUEST_V2.equals(type)) {
                        String role = json.optString("searchRole", "tablet");
                        if ("tablet".equals(role) || "all".equals(role)) {
                            JSONObject response = tabletDiscoveryPayload();
                            byte[] data = response.toString().getBytes("UTF-8");
                            socket.send(new DatagramPacket(data, data.length, packet.getAddress(), packet.getPort()));
                        }
                    } else if ("AI_EDU_MANAGER_PAIR_INVITE".equals(type)
                        && deviceId().equals(json.optString("targetTabletId", ""))) {
                        final JSONObject invite = json;
                        final String senderAddress = packet.getAddress().getHostAddress();
                        runOnUiThread(new Runnable() {
                            @Override public void run() { showHostPairInvite(invite, senderAddress); }
                        });
                    }
                } catch (SocketTimeoutException ignored) {
                }
                if (System.currentTimeMillis() - lastPresenceAt >= 2000) {
                    announceTabletDiscoveryPresence(socket);
                    lastPresenceAt = System.currentTimeMillis();
                }
            }
        } catch (final Exception error) {
            if (waitingForHostInvite) runOnUiThread(new Runnable() {
                @Override public void run() { status("等待主机连接失败：" + safeErrorMessage(error)); }
            });
        } finally {
            if (socket != null) socket.close();
            if (tabletDiscoverySocket == socket) {
                tabletDiscoverySocket = null;
                waitingForHostInvite = false;
                releaseTabletDiscoveryMulticastLock();
                runOnUiThread(new Runnable() {
                    @Override public void run() { if (waitHostButton != null) waitHostButton.setText("等待主机连接"); }
                });
            }
        }
    }

    JSONObject tabletDiscoveryPayload() throws Exception {
        JSONObject json = new JSONObject();
        json.put("type", "AI_EDU_MANAGER_DISCOVERY");
        json.put("protocolVersion", PAIR_PROTOCOL_VERSION);
        json.put("role", "tablet");
        json.put("deviceId", deviceId());
        json.put("machineCode", tabletMachineCode());
        json.put("displayName", deviceName());
        json.put("appVersion", VERSION_NAME);
        json.put("discoveryPort", HOST_DISCOVERY_PORT);
        JSONArray capabilities = new JSONArray();
        capabilities.put("pair-request-v2");
        capabilities.put("bidirectional-discovery-v2");
        json.put("capabilities", capabilities);
        return json;
    }

    void showHostPairInvite(final JSONObject invite, String senderAddress) {
        if (!waitingForHostInvite) return;
        final String hostName = invite.optString("hostName", "AI教育管家主机");
        final String hostCode = invite.optString("hostMachineCode", "");
        rememberHostIdentity(invite.optString("hostId", ""), hostCode, hostName);
        final int port = invite.optInt("port", 18777);
        final String base = "http://" + senderAddress + ":" + port;
        new AlertDialog.Builder(this)
            .setTitle("主机请求连接")
            .setMessage(hostName + "\n固定主机码：" + hostCode + "\n地址：" + senderAddress + "\n\n确认是您正在操作的主机后再接受。")
            .setPositiveButton("接受", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    status("正在接受 " + hostName + " 的连接邀请...");
                    new Thread(new PairInviteDecisionTask(MainActivity.this, base, invite, true)).start();
                }
            })
            .setNegativeButton("拒绝", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    new Thread(new PairInviteDecisionTask(MainActivity.this, base, invite, false)).start();
                }
            })
            .show();
    }

    void showNearbyHosts(List<NearbyHost> hosts, String error) {
        nearbyHostButton.setEnabled(true);
        if (error != null && error.length() > 0) {
            status("查找附近主机失败：" + error);
            toast("未能完成附近主机搜索。");
            return;
        }
        if (hosts == null || hosts.size() == 0) {
            lastNearbyHosts.clear();
            status("未发现局域网主机。请确认 Windows 主机服务已启动、平板与电脑连接同一 Wi-Fi；当前网络也可能禁止局域网广播。");
            toast("未发现附近主机。");
            return;
        }
        lastNearbyHosts.clear();
        lastNearbyHosts.addAll(hosts);
        final List<NearbyHost> found = hosts;
        String[] labels = new String[found.size()];
        for (int i = 0; i < found.size(); i++) {
            NearbyHost host = found.get(i);
            labels[i] = host.name + " · 在线" + (host.version.length() > 0 ? " · Windows " + host.version : "") + "\n" + host.primaryUrl();
            if (host.protocolVersion >= 2 && host.machineCode.length() > 0) {
                labels[i] = host.name + " · " + host.machineCode + " · 在线" + (host.version.length() > 0 ? " · Windows " + host.version : "") + "\n" + host.primaryUrl();
            }
        }
        status("发现 " + found.size() + " 台附近主机，请选择要连接的电脑。");
        new AlertDialog.Builder(this)
            .setTitle("选择附近主机")
            .setItems(labels, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    startNearbyHostPair(found.get(which));
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void startNearbyHostPair(NearbyHost host) {
        if (host == null) return;
        if (host.protocolVersion >= 2 && host.deviceId.length() > 0 && host.machineCode.startsWith("H-")) {
            rememberHostIdentity(host.deviceId, host.machineCode, host.name);
            serverInput.setText(host.primaryUrl());
            status("已向 " + host.name + " 发送连接请求，请在 Windows 主机端点击接受。");
            new Thread(new PairRequestV2Task(MainActivity.this, host)).start();
        } else {
            promptNearbyHostPairCode(host);
        }
    }

    void filterNearbyHostsByCode() {
        final EditText codeInput = new EditText(this);
        codeInput.setHint("例如 H-ABCD-2345");
        codeInput.setSingleLine(true);
        codeInput.setPadding(dp(16), dp(8), dp(16), dp(8));
        new AlertDialog.Builder(this)
            .setTitle("按固定主机码筛选")
            .setMessage(lastNearbyHosts.size() == 0
                ? "请先点击“查找局域网主机”。如果网络禁止广播，可继续使用二维码或粘贴连接信息。"
                : "输入主机端显示的固定主机码，从本次发现结果中筛选。")
            .setView(codeInput)
            .setPositiveButton("筛选", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    String query = codeInput.getText().toString().trim().toUpperCase();
                    if (query.length() == 0) {
                        toast("请输入固定主机码。");
                        return;
                    }
                    ArrayList<NearbyHost> matches = new ArrayList<NearbyHost>();
                    for (NearbyHost host : lastNearbyHosts) {
                        if (host.protocolVersion >= 2
                            && host.deviceId.length() > 0
                            && host.machineCode.toUpperCase().contains(query)) matches.add(host);
                    }
                    if (matches.size() == 1) {
                        startNearbyHostPair(matches.get(0));
                    } else if (matches.size() > 1) {
                        showNearbyHosts(matches, "");
                    } else {
                        status("本次发现结果中没有主机码 " + query + "。请重新查找或使用其他连接方式。");
                        toast("未找到匹配主机。");
                    }
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void promptNearbyHostPairCode(final NearbyHost host) {
        final EditText codeInput = new EditText(this);
        codeInput.setHint("输入 Windows 端显示的6位配对码");
        codeInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        codeInput.setSingleLine(true);
        codeInput.setPadding(dp(16), dp(8), dp(16), dp(8));
        new AlertDialog.Builder(this)
            .setTitle("连接 " + host.name)
            .setMessage("请在 Windows 主机的“平板配对码”区域查看6位短码。")
            .setView(codeInput)
            .setPositiveButton("连接", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    String code = codeInput.getText().toString().trim();
                    if (!code.matches("\\d{6}")) {
                        toast("请输入6位配对码。");
                        return;
                    }
                    serverInput.setText(host.primaryUrl());
                    status("正在向 " + host.name + " 确认配对...");
                    new Thread(new PairConfirmTask(MainActivity.this, host.urls, code)).start();
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void startPairScan() {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "edu-pair-qr-" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AI教育管家");
            }
            pendingPairQrUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (pendingPairQrUri == null) {
                toast("无法创建扫码照片文件，请改用粘贴连接信息。");
                return;
            }
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingPairQrUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(intent, REQUEST_CAPTURE_PAIR_QR);
        } catch (Exception error) {
            pendingPairQrUri = null;
            toast("无法打开相机识别二维码，请点击“粘贴连接信息”粘贴 Windows 主机二维码内容。");
            status("二维码拍照识别不可用：请在 Windows 主机端点击“复制扫码内容”，再回到平板点击“粘贴连接信息”。");
        }
    }

    void startStudentLoginScan() {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "edu-student-login-" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AI\u6559\u80b2\u7ba1\u5bb6");
            }
            pendingPairQrUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (pendingPairQrUri == null) {
                toast("\u65e0\u6cd5\u521b\u5efa\u626b\u7801\u7167\u7247\uff0c\u8bf7\u76f4\u63a5\u8f93\u5165\u5b66\u751f ID\u3002");
                return;
            }
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingPairQrUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(intent, REQUEST_CAPTURE_STUDENT_QR);
        } catch (Exception error) {
            pendingPairQrUri = null;
            toast("\u65e0\u6cd5\u6253\u5f00\u76f8\u673a\uff0c\u8bf7\u76f4\u63a5\u8f93\u5165\u5b66\u751f ID\u3002");
        }
    }

    String decodeQrFromUri(Uri uri) throws Exception {
        InputStream boundsInput = openUriInput(uri);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeStream(boundsInput, null, options);
        if (boundsInput != null) boundsInput.close();
        int maxSide = Math.max(options.outWidth, options.outHeight);
        int sampleSize = 1;
        while (maxSide / sampleSize > 1800) sampleSize *= 2;
        options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        InputStream input = openUriInput(uri);
        Bitmap bitmap = BitmapFactory.decodeStream(input, null, options);
        if (input != null) input.close();
        if (bitmap == null) throw new Exception("照片读取失败");
        String decoded = tryDecodeQrBitmap(bitmap);
        if (decoded.length() > 0) return decoded;
        throw new Exception("未识别到二维码，请让二维码尽量占满取景框并保持清晰");
    }

    String tryDecodeQrBitmap(Bitmap bitmap) {
        ArrayList<Bitmap> candidates = new ArrayList<Bitmap>();
        candidates.add(bitmap);
        candidates.add(scaleBitmap(bitmap, Math.min(2400, Math.max(bitmap.getWidth(), bitmap.getHeight()))));
        candidates.add(rotateBitmap(bitmap, 90));
        candidates.add(rotateBitmap(bitmap, 180));
        candidates.add(rotateBitmap(bitmap, 270));

        for (int i = 0; i < candidates.size(); i++) {
            Bitmap candidate = candidates.get(i);
            if (candidate == null) continue;
            String result = decodeBitmapDirect(candidate);
            if (result.length() > 0) return result;
            result = decodeBitmapCrops(candidate);
            if (result.length() > 0) return result;
        }
        return "";
    }

    String decodeBitmapDirect(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        RGBLuminanceSource source = new RGBLuminanceSource(width, height, pixels);
        return decodeLuminanceSource(source);
    }

    String decodeBitmapCrops(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        float[] ratios = new float[] {0.82f, 0.68f, 0.52f};
        for (int i = 0; i < ratios.length; i++) {
            int cropW = Math.max(120, (int) (width * ratios[i]));
            int cropH = Math.max(120, (int) (height * ratios[i]));
            int left = Math.max(0, (width - cropW) / 2);
            int top = Math.max(0, (height - cropH) / 2);
            String result = decodeBitmapDirect(Bitmap.createBitmap(bitmap, left, top, Math.min(cropW, width - left), Math.min(cropH, height - top)));
            if (result.length() > 0) return result;
        }
        int gridW = Math.max(120, width / 2);
        int gridH = Math.max(120, height / 2);
        int[] lefts = new int[] {0, Math.max(0, width / 4), Math.max(0, width - gridW)};
        int[] tops = new int[] {0, Math.max(0, height / 4), Math.max(0, height - gridH)};
        for (int y = 0; y < tops.length; y++) {
            for (int x = 0; x < lefts.length; x++) {
                int left = Math.min(lefts[x], Math.max(0, width - gridW));
                int top = Math.min(tops[y], Math.max(0, height - gridH));
                String result = decodeBitmapDirect(Bitmap.createBitmap(bitmap, left, top, Math.min(gridW, width - left), Math.min(gridH, height - top)));
                if (result.length() > 0) return result;
            }
        }
        return "";
    }

    String decodeLuminanceSource(LuminanceSource source) {
        Map<DecodeHintType, Object> hints = new Hashtable<DecodeHintType, Object>();
        ArrayList<BarcodeFormat> formats = new ArrayList<BarcodeFormat>();
        formats.add(BarcodeFormat.QR_CODE);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        hints.put(DecodeHintType.CHARACTER_SET, "UTF-8");
        String result = decodeBinaryBitmap(new BinaryBitmap(new HybridBinarizer(source)), hints);
        if (result.length() > 0) return result;
        result = decodeBinaryBitmap(new BinaryBitmap(new GlobalHistogramBinarizer(source)), hints);
        if (result.length() > 0) return result;
        try {
            LuminanceSource inverted = source.invert();
            result = decodeBinaryBitmap(new BinaryBitmap(new HybridBinarizer(inverted)), hints);
            if (result.length() > 0) return result;
        } catch (Exception ignored) {
        }
        return "";
    }

    String decodeBinaryBitmap(BinaryBitmap bitmap, Map<DecodeHintType, Object> hints) {
        try {
            Result result = new MultiFormatReader().decode(bitmap, hints);
            return result == null ? "" : result.getText();
        } catch (Exception ignored) {
            return "";
        }
    }

    Bitmap rotateBitmap(Bitmap bitmap, int degrees) {
        try {
            Matrix matrix = new Matrix();
            matrix.postRotate(degrees);
            return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        } catch (Exception ignored) {
            return null;
        }
    }

    Bitmap scaleBitmap(Bitmap bitmap, int targetMaxSide) {
        try {
            int maxSide = Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (maxSide >= targetMaxSide || maxSide <= 0) return bitmap;
            float scale = targetMaxSide / (float) maxSide;
            return Bitmap.createScaledBitmap(bitmap, Math.max(1, (int) (bitmap.getWidth() * scale)), Math.max(1, (int) (bitmap.getHeight() * scale)), true);
        } catch (Exception ignored) {
            return null;
        }
    }

    void startPickImages() {
        Intent openDocument = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        openDocument.addCategory(Intent.CATEGORY_OPENABLE);
        openDocument.setType("image/*");
        openDocument.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (launchPicker(openDocument, REQUEST_PICK_IMAGE, "选择一张或多张图片")) return;
        Intent getContent = new Intent(Intent.ACTION_GET_CONTENT);
        getContent.addCategory(Intent.CATEGORY_OPENABLE);
        getContent.setType("image/*");
        getContent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (!launchPicker(getContent, REQUEST_PICK_IMAGE, "选择一张或多张图片")) {
            toast("无法打开图片选择器，请尝试拍照或从相册分享图片到教育管家。");
        }
    }

    void startTakePhotoForUpload() {
        if (selectedStudent == null) {
            toast("请先在主机连接页进入学生空间。 ");
            openPanelPath("主机连接", "终端与学生空间");
            return;
        }
        pendingCameraDirectUpload = true;
        startTakePhoto();
    }

    void startTakePhoto() {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "edu-photo-" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AI教育管家");
            }
            pendingCameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (pendingCameraUri == null) {
                toast("无法创建拍照文件。");
                return;
            }
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(intent, REQUEST_TAKE_PHOTO);
        } catch (Exception error) {
            pendingCameraUri = null;
            pendingCameraDirectUpload = false;
            toast("无法打开相机：" + error.getMessage() + "。请改用“选择图片/截图”或从相册分享图片。");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (com.qxmatrix.terminallearning.TerminalLearningDialog.handleActivityResult(this, requestCode, resultCode, data)) return;
        if (requestCode == REQUEST_SCREEN_CAPTURE) {
            if (resultCode == RESULT_OK && data != null) {
                Intent serviceIntent = new Intent(this, CaptureProjectionService.class)
                    .setAction(CaptureProjectionService.ACTION_START)
                    .putExtra("result_code", resultCode)
                    .putExtra("result_data", data)
                    .putExtra("mode", pendingCaptureMode)
                    .putExtra("duration_ms", pendingCaptureDurationMinutes * 60L * 1000L)
                    .putExtra("student_id", selectedStudent == null ? "" : selectedStudent.id)
                    .putExtra("student_name", selectedStudent == null ? "" : selectedStudent.name)
                    .putExtra("project_id", pendingCaptureProjectId)
                    .putExtra("project_name", pendingCaptureProjectName)
                    .putExtra("course_id", activeCourse == null ? "" : activeCourse.id)
                    .putExtra("course_provider", activeCourse == null ? "" : activeCourse.provider)
                    .putExtra("course_url", activeCourse == null ? "" : activeCourse.currentUrl)
                    .putExtra("course_started_at", activeCourse == null ? 0L : activeCourseStartedAt)
                    .putExtra("auto_delivery", pendingCaptureAutoDelivery);
                getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE).edit()
                    .putString(CaptureProjectionService.KEY_PROJECT_ID, pendingCaptureProjectId)
                    .putString(CaptureProjectionService.KEY_PROJECT_NAME, pendingCaptureProjectName)
                    .putString(CaptureProjectionService.KEY_COURSE_ID, activeCourse == null ? "" : activeCourse.id)
                    .putString(CaptureProjectionService.KEY_COURSE_PROVIDER, activeCourse == null ? "" : activeCourse.provider)
                    .putString(CaptureProjectionService.KEY_COURSE_URL, activeCourse == null ? "" : activeCourse.currentUrl)
                    .putLong(CaptureProjectionService.KEY_COURSE_STARTED_AT, activeCourse == null ? 0L : activeCourseStartedAt)
                    .putBoolean("auto_delivery_enabled", pendingCaptureAutoDelivery)
                    .putString("capture_student_id", selectedStudent == null ? "" : selectedStudent.id)
                    .apply();
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(serviceIntent);
                else startService(serviceIntent);
                toast("屏幕资料采集已启动，通知栏可暂停、重点截取或结束。");
                captureStatusText.postDelayed(new Runnable() {
                    @Override public void run() { refreshCaptureUi(); }
                }, 800L);
            } else {
                toast("未授权屏幕采集。");
            }
            return;
        }
        if (requestCode == REQUEST_AUTO_DELIVERY_FOLDER) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri treeUri = data.getData();
                int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                try {
                    getContentResolver().takePersistableUriPermission(treeUri, flags | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    String folderName = treeUri.getLastPathSegment();
                    if (folderName == null || folderName.length() == 0) folderName = "已授权文件夹";
                    getSharedPreferences(AutoDeliveryJobService.PREFS, MODE_PRIVATE).edit()
                        .putString(AutoDeliveryJobService.KEY_TREE_URI, treeUri.toString())
                        .putString(AutoDeliveryJobService.KEY_TREE_NAME, Uri.decode(folderName))
                        .apply();
                    toast("自动投递文件夹已授权，请确认投递位置后启用。");
                } catch (Exception error) {
                    toast("无法保留文件夹授权：" + error.getMessage());
                }
            } else {
                toast("已取消文件夹授权。");
            }
            updateAutoDeliveryUi();
            return;
        }
        if (requestCode == REQUEST_EXPORT_CONNECTION_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                writeConnectionBackup(data.getData());
            } else {
                toast("已取消导出连接备份。");
            }
            return;
        }
        if (requestCode == REQUEST_IMPORT_CONNECTION_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                importConnectionBackup(data.getData());
            } else {
                toast("已取消导入连接备份。");
            }
            return;
        }
        if (requestCode == REQUEST_SCAN_PAIR) {
            if (resultCode == RESULT_OK && data != null) {
                String payload = data.getStringExtra("SCAN_RESULT");
                if (payload == null || payload.trim().length() == 0) payload = data.getDataString();
                handlePairPayload(payload);
            } else {
                toast("未完成扫码绑定。");
            }
            return;
        }
        if (requestCode == REQUEST_CAPTURE_PAIR_QR) {
            if (resultCode == RESULT_OK && pendingPairQrUri != null) {
                try {
                    String payload = decodeQrFromUri(pendingPairQrUri);
                    if (!handlePairPayload(payload)) {
                        toast("未识别到主机配对二维码，请靠近二维码并保持画面清晰。");
                    }
                } catch (Exception error) {
                    toast("二维码识别失败：" + error.getMessage() + "。可改用粘贴连接信息。");
                }
            } else {
                toast("未完成扫码绑定。");
            }
            pendingPairQrUri = null;
            return;
        }
        if (requestCode == REQUEST_CAPTURE_STUDENT_QR) {
            if (resultCode == RESULT_OK && pendingPairQrUri != null) {
                try {
                    loginStudent(decodeQrFromUri(pendingPairQrUri));
                } catch (Exception error) {
                    toast("\u672a\u8bc6\u522b\u5230\u5b66\u751f\u767b\u5f55\u4e8c\u7ef4\u7801\uff0c\u8bf7\u91cd\u65b0\u626b\u7801\u6216\u8f93\u5165 ID\u3002");
                }
            } else {
                toast("\u5df2\u53d6\u6d88\u5b66\u751f\u626b\u7801\u3002");
            }
            pendingPairQrUri = null;
            return;
        }
        if (requestCode == REQUEST_IMPORT_CONVERSATION_FILE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) importConversationFile(data.getData());
            else toast("已取消导入对话文件。");
            return;
        }
        if ((requestCode == REQUEST_DIRECT_UPLOAD || requestCode == REQUEST_DIRECT_IMAGE_UPLOAD) && resultCode == RESULT_OK && data != null) {
            List<Uri> uris = extractUris(data);
            if (uris.size() > 0) chooseUploadTarget(uris, true, false);
            return;
        }
        if ((requestCode == REQUEST_PICK_MATERIAL || requestCode == REQUEST_PICK_IMAGE) && resultCode == RESULT_OK && data != null) {
            List<Uri> uris = extractUris(data);
            if (uris.size() > 0) collectMaterials(uris, "android_manual_collection");
            return;
        }
        if (requestCode == REQUEST_TAKE_PHOTO) {
            if (resultCode == RESULT_OK && pendingCameraUri != null) {
                List<Uri> uris = new ArrayList<Uri>();
                uris.add(pendingCameraUri);
                if (pendingCameraDirectUpload) chooseUploadTarget(uris, true, false);
                else collectMaterials(uris, "android_camera_collection");
            } else {
                toast("未拍照上传资料。");
            }
            pendingCameraUri = null;
            pendingCameraDirectUpload = false;
        }
    }

    void showDownloadsDialog() {
        final List<DownloadEntry> entries = scanDownloadEntries();
        if (entries.size() == 0) {
            status("没有在 Downloads 中找到可上传的图片、PDF、Word、Excel、PPT、TXT 或 Markdown 文件。");
            toast("Downloads 中暂无可上传资料。");
            return;
        }
        final boolean[] checked = new boolean[entries.size()];
        String[] labels = new String[entries.size()];
        for (int i = 0; i < entries.size(); i++) {
            DownloadEntry entry = entries.get(i);
            labels[i] = entry.name + "  ·  " + entry.type + "  ·  " + formatSize(entry.size);
        }
        new AlertDialog.Builder(this)
            .setTitle("扫描 Downloads 最近文件")
            .setMultiChoiceItems(labels, checked, new DownloadsChoiceClickListener(checked))
            .setPositiveButton("收集选中", new DownloadsUploadClickListener(this, entries, checked))
            .setNegativeButton("取消", null)
            .show();
    }

    List<DownloadEntry> scanDownloadEntries() {
        ArrayList<DownloadEntry> entries = new ArrayList<DownloadEntry>();
        ArrayList<String> seen = new ArrayList<String>();
        collectMediaStoreDownloads(entries, seen);
        File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        collectDownloadFiles(downloadsDir, entries, seen, 0);
        sortDownloadEntries(entries);
        if (entries.size() <= 50) return entries;
        return new ArrayList<DownloadEntry>(entries.subList(0, 50));
    }

    void collectMediaStoreDownloads(ArrayList<DownloadEntry> entries, ArrayList<String> seen) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        Cursor cursor = null;
        try {
            Uri baseUri = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            String[] projection = new String[] {
                MediaStore.Downloads._ID,
                MediaStore.Downloads.DISPLAY_NAME,
                MediaStore.Downloads.SIZE,
                MediaStore.Downloads.DATE_MODIFIED,
                MediaStore.Downloads.MIME_TYPE
            };
            cursor = getContentResolver().query(baseUri, projection, null, null, MediaStore.Downloads.DATE_MODIFIED + " DESC");
            if (cursor == null) return;
            while (cursor.moveToNext() && entries.size() < 120) {
                long id = cursor.getLong(0);
                String name = cursor.getString(1);
                long size = cursor.isNull(2) ? 0 : cursor.getLong(2);
                long modifiedSeconds = cursor.isNull(3) ? 0 : cursor.getLong(3);
                String mime = cursor.getString(4);
                if (!isSupportedMaterialFile(name, mime)) continue;
                Uri uri = ContentUris.withAppendedId(baseUri, id);
                String key = uri.toString();
                if (seen.contains(key)) continue;
                seen.add(key);
                entries.add(new DownloadEntry(uri, name == null ? "Downloads-" + id : name, size, modifiedSeconds <= 0 ? 0 : modifiedSeconds * 1000, guessMaterialType(name, mime)));
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    void collectDownloadFiles(File dir, ArrayList<DownloadEntry> entries, ArrayList<String> seen, int depth) {
        if (dir == null || !dir.exists() || depth > 2) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (int i = 0; i < children.length; i++) {
            File child = children[i];
            if (child.isDirectory()) {
                collectDownloadFiles(child, entries, seen, depth + 1);
                continue;
            }
            if (!isSupportedMaterialFile(child.getName(), "")) continue;
            try {
                String path = child.getCanonicalPath();
                if (seen.contains(path)) continue;
                seen.add(path);
                entries.add(new DownloadEntry(Uri.fromFile(child), child.getName(), child.length(), child.lastModified(), guessMaterialType(child.getName(), "")));
            } catch (Exception ignored) {
            }
        }
    }

    void sortDownloadEntries(ArrayList<DownloadEntry> entries) {
        for (int i = 0; i < entries.size(); i++) {
            int best = i;
            for (int j = i + 1; j < entries.size(); j++) {
                DownloadEntry current = entries.get(j);
                DownloadEntry selected = entries.get(best);
                if (current.modified > selected.modified
                    || (current.modified == selected.modified && current.name.compareToIgnoreCase(selected.name) < 0)) {
                    best = j;
                }
            }
            if (best != i) {
                DownloadEntry temp = entries.get(i);
                entries.set(i, entries.get(best));
                entries.set(best, temp);
            }
        }
    }

    boolean isSupportedMaterialFile(String name, String mime) {
        String lowerName = name == null ? "" : name.toLowerCase(Locale.ROOT);
        String lowerMime = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        if (lowerMime.startsWith("image/")) return true;
        if (lowerMime.equals("application/pdf") || lowerMime.equals("text/plain") || lowerMime.equals("text/markdown")) return true;
        if (lowerMime.contains("word") || lowerMime.contains("excel") || lowerMime.contains("sheet") || lowerMime.contains("powerpoint") || lowerMime.contains("presentation")) return true;
        return lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".png") || lowerName.endsWith(".webp")
            || lowerName.endsWith(".pdf") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx")
            || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")
            || lowerName.endsWith(".txt") || lowerName.endsWith(".md") || lowerName.endsWith(".markdown");
    }

    String guessMaterialType(String name, String mime) {
        String lowerName = name == null ? "" : name.toLowerCase(Locale.ROOT);
        String lowerMime = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        if (lowerMime.startsWith("image/") || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".png") || lowerName.endsWith(".webp")) return "图片";
        if (lowerMime.equals("application/pdf") || lowerName.endsWith(".pdf")) return "PDF";
        if (lowerMime.contains("word") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "Word";
        if (lowerMime.contains("excel") || lowerMime.contains("sheet") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx")) return "Excel";
        if (lowerMime.contains("powerpoint") || lowerMime.contains("presentation") || lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) return "PPT";
        if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown") || lowerMime.equals("text/markdown")) return "Markdown";
        if (lowerName.endsWith(".txt") || lowerMime.equals("text/plain")) return "TXT";
        return "资料";
    }

    String formatSize(long size) {
        if (size <= 0) return "未知大小";
        if (size < 1024) return size + " B";
        if (size < 1024 * 1024) return String.format(Locale.ROOT, "%.1f KB", size / 1024.0);
        return String.format(Locale.ROOT, "%.1f MB", size / 1024.0 / 1024.0);
    }

    List<Uri> extractUris(Intent intent) {
        List<Uri> result = new ArrayList<Uri>();
        if (intent == null) return result;
        ClipData clipData = intent.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                Uri uri = clipData.getItemAt(i).getUri();
                if (uri != null) result.add(uri);
            }
        }
        Uri data = intent.getData();
        if (data != null && !result.contains(data)) result.add(data);
        Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (stream instanceof Uri && !result.contains((Uri) stream)) result.add((Uri) stream);
        return result;
    }

    void handleIncomingShare(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        List<Uri> uris = extractUris(intent);
        CharSequence sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (uris.size() == 0 && sharedText != null && sharedText.toString().trim().length() > 0) {
            acceptConversationDraft(sharedText.toString());
            return;
        }
        if (uris.size() == 0) {
            toast("未发现可接收的分享文件或对话正文。");
            return;
        }
        collectMaterials(uris, "android_system_share");
    }

    void updateSharedUploadButton() {
        if (sharedUploadButton == null) return;
        int stagedCount = collectionReadyCount();
        sharedUploadButton.setText("管理待上传暂存(" + stagedCount + ")");
        sharedUploadButton.setVisibility(View.VISIBLE);
        sharedUploadButton.setEnabled(currentStudentScopeId().length() > 0 && stagedCount > 0);
        if (retryFailedUploadButton != null) {
            SharedPreferences queuePrefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            int durableCount = queuePrefs.getInt(ProjectMaterialUploadJobService.KEY_PENDING_COUNT, 0)
                + queuePrefs.getInt(ProjectMaterialUploadJobService.KEY_PAUSED_COUNT, 0);
            int actionCount = Math.max(failedUploadUris.size(), durableCount);
            retryFailedUploadButton.setText("核对待处理资料(" + actionCount + ")");
            retryFailedUploadButton.setVisibility(actionCount > 0 ? View.VISIBLE : View.GONE);
            retryFailedUploadButton.setEnabled(selectedStudent != null && actionCount > 0);
        }
    }

    void openConversationImport() {
        if (pendingConversationText.length() > 0) {
            showConversationConfirmDialog();
            return;
        }
        final String[] actions = new String[] { "粘贴对话文字", "导入 .md / .txt / .json 文件", "导入公开 HTTPS 对话链接" };
        new AlertDialog.Builder(this)
            .setTitle("导入对话")
            .setMessage("只读取你主动粘贴、选择或输入的公开内容；不会读取其他应用的私有聊天数据库。")
            .setItems(actions, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    if (which == 0) showConversationPasteDialog();
                    else if (which == 1) startConversationFilePicker();
                    else showConversationLinkDialog();
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void showConversationPasteDialog() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
        CharSequence value = clip == null || clip.getItemCount() == 0 ? null : clip.getItemAt(0).coerceToText(this);
        final EditText input = new EditText(this);
        input.setHint("粘贴当前或明确选中的对话内容");
        input.setMinLines(8);
        input.setMaxLines(16);
        input.setGravity(Gravity.TOP);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        if (value != null && value.toString().trim().length() > 0) input.setText(value.toString());
        final AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("粘贴对话文字")
            .setView(input)
            .setNegativeButton("取消", null)
            .setPositiveButton("预览并选择目标", null)
            .create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override public void onShow(DialogInterface ignored) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View view) {
                        String text = input.getText().toString().trim();
                        if (text.length() == 0) { input.setError("对话文字不能为空"); return; }
                        dialog.dismiss();
                        acceptConversationDraft(text, "粘贴文字", "manual-paste");
                    }
                });
            }
        });
        dialog.show();
    }

    void startConversationFilePicker() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "text/plain", "text/markdown", "application/json" });
        try { startActivityForResult(intent, REQUEST_IMPORT_CONVERSATION_FILE); }
        catch (Exception error) { toast("无法打开对话文件选择器：" + error.getMessage()); }
    }

    void showConversationLinkDialog() {
        final EditText input = new EditText(this);
        input.setHint("https://公开分享链接");
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        final AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("导入公开 HTTPS 对话链接")
            .setMessage("主机只读取公开 HTTPS 文本页面，最多 5 MB；不会登录账号或绕过访问权限。")
            .setView(input)
            .setNegativeButton("取消", null)
            .setPositiveButton("读取并预览", null)
            .create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override public void onShow(DialogInterface ignored) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View view) {
                        final String url = input.getText().toString().trim();
                        if (!url.toLowerCase(Locale.ROOT).startsWith("https://")) { input.setError("请输入公开 HTTPS 链接"); return; }
                        dialog.dismiss();
                        previewConversationLink(url);
                    }
                });
            }
        });
        dialog.show();
    }

    void importConversationFile(final Uri uri) {
        new Thread(new Runnable() { @Override public void run() {
            String content = "", error = null, name = displayName(uri);
            InputStream input = null;
            try {
                String lower = name.toLowerCase(Locale.ROOT);
                String mime = getContentResolver().getType(uri);
                if (!(lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".json")
                    || "text/plain".equals(mime) || "text/markdown".equals(mime) || "application/json".equals(mime))) {
                    throw new IllegalArgumentException("只支持 .md、.txt 或 .json 对话文件");
                }
                input = openUriInput(uri);
                if (input == null) throw new IllegalStateException("无法读取所选文件");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[16384]; int read; int total = 0;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > 5 * 1024 * 1024) throw new IllegalArgumentException("对话文件超过 5 MB");
                    output.write(buffer, 0, read);
                }
                content = new String(output.toByteArray(), "UTF-8");
            } catch (Exception failure) { error = failure.getMessage(); }
            finally { if (input != null) try { input.close(); } catch (Exception ignored) {} }
            final String text = content, failure = error, sourceName = name;
            runOnUiThread(new Runnable() { @Override public void run() {
                if (failure != null) { toast("导入对话文件失败：" + failure); return; }
                acceptConversationDraft(text, "对话文件", sourceName);
            }});
        }}).start();
    }

    void previewConversationLink(final String url) {
        if (selectedStudent == null || dataToken().length() == 0) { toast("请先进入学生空间并连接主机。"); return; }
        conversationLastResult = "正在由主机读取公开对话链接…";
        updateConversationImportUi();
        final String base = normalizedBaseUrl(), token = dataToken(), expectedStudentId = selectedStudent.id;
        new Thread(new Runnable() { @Override public void run() {
            JSONObject result = null; String error = null;
            try { result = postJson(base + "/api/student-session/conversation-link/preview", new JSONObject().put("url", url), token); }
            catch (Exception failure) { error = failure.getMessage(); }
            final JSONObject payload = result; final String failure = error;
            runOnUiThread(new Runnable() { @Override public void run() {
                if (failure != null) { conversationLastResult = "链接读取失败：" + failure; updateConversationImportUi(); toast(conversationLastResult); return; }
                if (selectedStudent == null || !expectedStudentId.equals(selectedStudent.id)) { toast("学生已切换，已丢弃链接预览。"); return; }
                acceptConversationDraft(payload == null ? "" : payload.optString("content", ""), "公开 HTTPS 链接",
                    payload == null ? url : payload.optString("finalUrl", url));
            }});
        }}).start();
    }

    void acceptConversationDraft(String rawText) {
        acceptConversationDraft(rawText, "系统分享", "android-share");
    }

    void acceptConversationDraft(String rawText, String source, String reference) {
        String text = rawText == null ? "" : rawText.trim();
        if (text.length() == 0) {
            toast("对话正文不能为空。");
            return;
        }
        if (text.matches("(?i)^https://\\S+$")) {
            previewConversationLink(text);
            return;
        }
        if (text.length() > MAX_CONVERSATION_CHARS) {
            toast("对话超过 60000 字，请只发送当前对话或选定片段。");
            return;
        }
        pendingConversationText = text;
        pendingConversationSource = source == null || source.length() == 0 ? "导入对话" : source;
        pendingConversationReference = reference == null ? "" : reference;
        conversationLastResult = "";
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_PENDING_CONVERSATION_TEXT, pendingConversationText)
            .putString(PREF_PENDING_CONVERSATION_SOURCE, pendingConversationSource)
            .putString(PREF_PENDING_CONVERSATION_REFERENCE, pendingConversationReference)
            .apply();
        updateConversationImportUi();
        if (selectedStudent == null) {
            status("已收到智能体对话，请先进入当前学生空间。 ");
            return;
        }
        showConversationConfirmDialog();
    }

    void updateConversationImportUi() {
        if (conversationImportStatusText == null) return;
        if (conversationSubmitInProgress) {
            if (conversationImportButton != null) {
                conversationImportButton.setText("正在发送到主机...");
                conversationImportButton.setEnabled(false);
            }
            conversationImportStatusText.setText("正在等待主机保存回执，请稍候。 ");
            return;
        }
        if (pendingConversationText.length() > 0) {
            if (conversationImportButton != null) {
                conversationImportButton.setText("继续导入对话");
                conversationImportButton.setEnabled(selectedStudent != null);
            }
            conversationImportStatusText.setText(selectedStudent == null
                ? "已保留对话草稿；进入学生空间后即可发送。"
                : "已准备“" + pendingConversationSource + "”；默认存入“" + selectedStudent.name + "”的教育档案。 ");
            return;
        }
        if (conversationImportButton != null) {
            conversationImportButton.setText("导入对话");
            conversationImportButton.setEnabled(true);
        }
        conversationImportStatusText.setText(conversationLastResult.length() > 0
            ? conversationLastResult
            : "支持粘贴文字、导入文件、公开 HTTPS 链接或从其他应用分享。 ");
    }

    void showConversationConfirmDialog() {
        if (pendingConversationText.length() == 0) {
            updateConversationImportUi();
            return;
        }
        if (selectedStudent == null) {
            toast("请先进入当前学生空间。 ");
            return;
        }
        final String expectedStudentId = selectedStudent.id;
        final ArrayList<UploadTarget> targets = new ArrayList<UploadTarget>();
        targets.add(new UploadTarget("student", selectedStudent.id, selectedStudent.name + "的教育档案", selectedStudent.id));
        for (LearningProject project : projectsForSelectedStudent()) {
            targets.add(new UploadTarget("project", project.id, "关联项目：" + project.name, selectedStudent.id));
        }
        ArrayList<String> labels = new ArrayList<String>();
        for (UploadTarget target : targets) labels.add(target.name);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(8), dp(20), 0);
        TextView preview = new TextView(this);
        String body = pendingConversationText.length() > 800 ? pendingConversationText.substring(0, 800) + "…" : pendingConversationText;
        preview.setText("来源：" + pendingConversationSource
            + (pendingConversationReference.length() > 0 ? "\n引用：" + pendingConversationReference : "")
            + "\n当前学生：" + selectedStudent.name + "\n\n对话预览\n" + body);
        preview.setTextSize(13);
        preview.setTextColor(Color.rgb(50, 76, 70));
        preview.setMaxLines(8);
        panel.addView(preview);
        TextView targetLabel = label("存入位置");
        targetLabel.setPadding(0, dp(12), 0, dp(4));
        panel.addView(targetLabel);
        final Spinner targetSpinner = new Spinner(this);
        ArrayAdapter<String> targetAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, labels);
        targetAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        targetSpinner.setAdapter(targetAdapter);
        panel.addView(targetSpinner);
        new AlertDialog.Builder(this)
            .setTitle("确认导入对话")
            .setView(panel)
            .setPositiveButton("发送到主机", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    int position = targetSpinner.getSelectedItemPosition();
                    if (position < 0 || position >= targets.size()) position = 0;
                    if (selectedStudent == null || !expectedStudentId.equals(selectedStudent.id)) {
                        toast("学生已切换，请重新确认。 ");
                        return;
                    }
                    submitConversation(targets.get(position));
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void submitConversation(final UploadTarget target) {
        if (conversationSubmitInProgress || pendingConversationText.length() == 0) return;
        if (selectedStudent == null || !selectedStudent.id.equals(target.studentId)) {
            toast("对话目标学生已变化，请重新确认。 ");
            return;
        }
        if ("project".equals(target.type)) {
            boolean linked = false;
            for (LearningProject project : projectsForSelectedStudent()) if (project.id.equals(target.id)) linked = true;
            if (!linked) {
                toast("该项目已不再关联当前学生，请重新选择。 ");
                return;
            }
        }
        final String base = normalizedBaseUrl();
        final String token = dataToken();
        if (base.length() == 0 || token.length() == 0) {
            toast("请先连接 Windows 主机。 ");
            return;
        }
        final String text = pendingConversationText;
        final String digest = sha256Text(text);
        try {
            JSONObject payload = new JSONObject();
            payload.put("schema", "edu-manager.agent-conversation-submission.v1");
            payload.put("sourceAgent", "android-student-import");
            payload.put("sourceNodeId", deviceId());
            payload.put("sessionId", "android-conversation-" + digest.substring(0, 24));
            payload.put("title", conversationTitle(text));
            payload.put("scopeType", target.type);
            payload.put("scopeId", target.id);
            payload.put("studentHint", target.studentId);
            if ("project".equals(target.type)) payload.put("targetProject", target.id);
            JSONArray messages = new JSONArray();
            JSONObject message = new JSONObject();
            message.put("messageId", "android-message-" + digest.substring(0, 24));
            message.put("role", "unknown");
            message.put("content", text);
            messages.put(message);
            payload.put("messages", messages);
            payload.put("submittedAt", isoNow());
            payload.put("sourceReference", pendingConversationReference);
            payload.put("sourceLabel", pendingConversationSource);
            payload.put("idempotencyKey", "android-conversation-" + sha256Text(deviceId() + "|" + digest + "|" + target.type + "|" + target.id).substring(0, 32));
            conversationSubmitInProgress = true;
            updateConversationImportUi();
            status("正在将智能体对话发送到主机...");
            final JSONObject requestBody = payload;
            new Thread(new Runnable() {
                @Override public void run() {
                    JSONObject result = null;
                    String error = null;
                    try {
                        result = postJson(base + "/api/agent/conversation/submit", requestBody, token);
                    } catch (Exception failure) {
                        error = failure.getMessage();
                    }
                    final JSONObject response = result;
                    final String failureMessage = error;
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            applyConversationSubmissionResult(response, failureMessage, target, digest);
                        }
                    });
                }
            }).start();
        } catch (Exception error) {
            conversationSubmitInProgress = false;
            updateConversationImportUi();
            toast("无法准备对话：" + error.getMessage());
        }
    }

    void applyConversationSubmissionResult(JSONObject result, String error, UploadTarget target, String submittedDigest) {
        conversationSubmitInProgress = false;
        if (error != null) {
            conversationImportStatusText.setText("发送失败：" + error + "\n对话草稿已保留，可点击重试。 ");
            conversationImportButton.setText("重试发送对话");
            conversationImportButton.setEnabled(selectedStudent != null);
            status("智能体对话发送失败，草稿已保留。 ");
            return;
        }
        JSONObject receipt = result == null ? null : result.optJSONObject("receipt");
        String receiptStatus = receipt == null ? "" : receipt.optString("status", "");
        String friendly;
        if ((result != null && result.optBoolean("deduplicated", false)) || "deduplicated".equals(receiptStatus)) {
            friendly = "该对话已经存入“" + target.name + "”，无需重复上传。 ";
        } else if ((result != null && result.optBoolean("awaitingAttribution", false)) || "awaiting_attribution".equals(receiptStatus)) {
            friendly = "对话已发送，正在等待主机确认归属。 ";
        } else {
            friendly = "已存入“" + target.name + "”。 ";
        }
        if (sha256Text(pendingConversationText).equals(submittedDigest)) {
            pendingConversationText = "";
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .remove(PREF_PENDING_CONVERSATION_TEXT)
                .remove(PREF_PENDING_CONVERSATION_SOURCE)
                .remove(PREF_PENDING_CONVERSATION_REFERENCE)
                .apply();
            pendingConversationSource = "手动粘贴";
            pendingConversationReference = "manual-paste";
        }
        conversationLastResult = friendly;
        updateConversationImportUi();
        status(friendly);
        toast(friendly);
    }

    String sha256Text(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(String.valueOf(value == null ? "" : value).getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder();
            for (byte item : bytes) hex.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return hex.toString();
        } catch (Exception error) {
            return Integer.toHexString(String.valueOf(value).hashCode()) + "00000000000000000000000000000000";
        }
    }

    String conversationTitle(String text) {
        String first = String.valueOf(text == null ? "" : text).split("\\r?\\n", 2)[0].trim();
        if (first.length() > 48) first = first.substring(0, 48) + "…";
        return first.length() == 0 ? "智能体对话" : "智能体对话 · " + first;
    }

    String isoNow() {
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return format.format(new java.util.Date());
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshCaptureUi();
        updateAutoDeliveryUi();
        refreshProjectMaterialQueueStatus();
        ProjectMaterialUploadJobService.schedule(this);
        ProjectMaterialUploadJobService.runNow(this);
        if ("personal".equals(terminalMode) && getSharedPreferences(AutoDeliveryJobService.PREFS, MODE_PRIVATE).getBoolean(AutoDeliveryJobService.KEY_ENABLED, false)) {
            AutoDeliveryJobService.schedule(this);
            AutoDeliveryJobService.runNow(this, false);
            if (autoDeliveryStatusText != null) autoDeliveryStatusText.postDelayed(new Runnable() {
                @Override public void run() { updateAutoDeliveryUi(); }
            }, 1200L);
        }
    }

    void maybeStartCaptureFromIntent(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("start_screen_capture", false)) return;
        intent.removeExtra("start_screen_capture");
        if (captureStatusText != null) captureStatusText.postDelayed(new Runnable() {
            @Override public void run() { showCaptureSetupDialog(); }
        }, 300L);
    }

    String captureStatus() {
        return getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE)
            .getString(CaptureProjectionService.KEY_STATUS, "idle");
    }

    void refreshCaptureUi() {
        if (captureStatusText == null) return;
        SharedPreferences prefs = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE);
        String state = prefs.getString(CaptureProjectionService.KEY_STATUS, "idle");
        int saved = prefs.getInt(CaptureProjectionService.KEY_SAVED, 0);
        int candidate = prefs.getInt(CaptureProjectionService.KEY_CANDIDATE, 0);
        int dedup = prefs.getInt(CaptureProjectionService.KEY_DEDUP, 0);
        int highlighted = prefs.getInt(CaptureProjectionService.KEY_HIGHLIGHTED, 0);
        String mode = prefs.getString("mode", "smart");
        boolean autoDelivery = prefs.getBoolean("auto_delivery_enabled", false);
        String autoDeliveryStatus = prefs.getString(CaptureAutoDeliveryJobService.KEY_STATUS, "");
        String stateLabel = "capturing".equals(state) ? "正在采集" : "paused".equals(state) ? "已暂停" : "completed".equals(state) ? "待上传" : "尚未启动";
        captureStatusText.setText("采集状态：" + stateLabel + " · 模式 " + captureModeLabel(mode) + " · 检测 " + candidate + " · 保留 " + saved + " · 去重 " + dedup + " · 重点 " + highlighted
            + "\n结束后：" + (autoDelivery ? "自动投递（离线会重试）" : "保留本机，手动上传")
            + (autoDeliveryStatus.length() > 0 ? "\n自动投递：" + autoDeliveryStatus : ""));
        boolean active = "capturing".equals(state) || "paused".equals(state);
        captureStartButton.setText(active ? "结束采集" : "开始屏幕采集");
        capturePauseButton.setEnabled(active);
        capturePauseButton.setText("paused".equals(state) ? "继续采集" : "暂停采集");
        int pending = pendingCapturedFiles().size();
        boolean canUpload = !active && pending > 0 && selectedStudent != null && !uploadInProgress;
        captureUploadButton.setEnabled(canUpload);
        if (uploadInProgress && captureUploadUrisInFlight.size() > 0) {
            captureUploadButton.setText("正在上传 " + captureUploadUrisInFlight.size() + " 张…");
            captureUploadButton.setTextColor(Color.WHITE);
            captureUploadButton.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(119, 91, 190)));
        } else if ("succeeded".equals(captureUploadVisualState)) {
            captureUploadButton.setText("上传完成");
            captureUploadButton.setTextColor(Color.WHITE);
            captureUploadButton.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(36, 153, 104)));
        } else if ("failed".equals(captureUploadVisualState)) {
            captureUploadButton.setText("上传失败，点击重试");
            captureUploadButton.setTextColor(Color.WHITE);
            captureUploadButton.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(210, 118, 43)));
        } else {
            captureUploadButton.setText(pending > 0 ? "上传采集资料(" + pending + ")" : "上传采集资料");
            captureUploadButton.setTextColor(canUpload ? Color.WHITE : Color.rgb(122, 137, 133));
            captureUploadButton.setBackgroundTintList(ColorStateList.valueOf(canUpload ? accentColor() : Color.rgb(224, 231, 229)));
        }
        if (courseCaptureButton != null) {
            courseCaptureButton.setEnabled(selectedStudent != null);
            courseCaptureButton.setText(active
                ? "结束课程资料采集"
                : (pending > 0 ? "待确认上传 · 再次采集" : "待开始：采集课程资料"));
        }
    }

    String captureModeLabel(String mode) {
        if ("interval".equals(mode)) return "固定间隔";
        if ("change".equals(mode)) return "内容变化";
        return "智能混合";
    }

    void handleCapturePrimary() {
        String state = captureStatus();
        if ("capturing".equals(state) || "paused".equals(state)) {
            startService(new Intent(this, CaptureProjectionService.class).setAction(CaptureProjectionService.ACTION_STOP));
            captureStatusText.postDelayed(new Runnable() {
                @Override public void run() { refreshCaptureUi(); }
            }, 600L);
            return;
        }
        showCaptureSetupDialog();
    }

    void showCaptureSetupDialog() {
        if (selectedStudent == null) {
            toast("请先进入学生账号，再开始屏幕采集。");
            return;
        }
        final String[] labels = new String[] { "智能混合（推荐）", "内容变化", "固定间隔" };
        final String[] values = new String[] { "smart", "change", "interval" };
        new AlertDialog.Builder(this)
            .setTitle("选择屏幕采集模式")
            .setSingleChoiceItems(labels, 0, null)
            .setPositiveButton("下一步", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    int checked = ((AlertDialog) dialog).getListView().getCheckedItemPosition();
                    if (checked < 0) checked = 0;
                    pendingCaptureMode = values[checked];
                    showCaptureProjectDialog();
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    List<LearningProject> projectsForSelectedStudent() {
        ArrayList<LearningProject> result = new ArrayList<LearningProject>();
        if (selectedStudent == null) return result;
        for (LearningProject project : projects) {
            if (!"sealed".equals(project.status) && project.studentIds.contains(selectedStudent.id)) result.add(project);
        }
        return result;
    }

    void showCaptureProjectDialog() {
        final List<LearningProject> bound = projectsForSelectedStudent();
        if (bound.size() == 0) {
            pendingCaptureProjectId = "";
            pendingCaptureProjectName = "";
            showCaptureDurationDialog();
            return;
        }
        final String[] labels = new String[bound.size() + 1];
        labels[0] = "不关联项目（上传到学生资料库）";
        int checked = 0;
        for (int i = 0; i < bound.size(); i++) {
            labels[i + 1] = "关联项目：" + bound.get(i).name;
            if (bound.get(i).id.equals(pendingCaptureProjectId)) checked = i + 1;
        }
        new AlertDialog.Builder(this)
            .setTitle("关联学习项目（可选）")
            .setSingleChoiceItems(labels, checked, null)
            .setPositiveButton("下一步", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    int selected = ((AlertDialog) dialog).getListView().getCheckedItemPosition();
                    if (selected > 0) {
                        LearningProject project = bound.get(selected - 1);
                        pendingCaptureProjectId = project.id;
                        pendingCaptureProjectName = project.name;
                    } else {
                        pendingCaptureProjectId = "";
                        pendingCaptureProjectName = "";
                    }
                    showCaptureDurationDialog();
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void showCaptureDurationDialog() {
        final String[] labels = new String[] { "15 分钟", "30 分钟", "45 分钟", "60 分钟", "90 分钟", "120 分钟" };
        final int[] minutes = new int[] { 15, 30, 45, 60, 90, 120 };
        new AlertDialog.Builder(this)
            .setTitle("设置最长采集时间")
            .setSingleChoiceItems(labels, 1, null)
            .setPositiveButton("授权并开始", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    int checked = ((AlertDialog) dialog).getListView().getCheckedItemPosition();
                    if (checked < 0) checked = 1;
                    pendingCaptureDurationMinutes = minutes[checked];
                    showCaptureAutoDeliveryDialog();
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void showCaptureAutoDeliveryDialog() {
        final boolean lastChoice = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_CAPTURE_AUTO_DELIVERY_DEFAULT, false);
        final String target = pendingCaptureProjectName.length() > 0
            ? "关联项目“" + pendingCaptureProjectName + "”"
            : (selectedStudent == null ? "当前学生资料库" : "“" + selectedStudent.name + "”的资料库");
        final String[] choices = new String[] {
            "采集结束后自动收集并保存到" + target + "的本机待上传区（不会自动联网）",
            "保留在本机采集箱，稍后手动上传"
        };
        new AlertDialog.Builder(this)
            .setTitle("采集结束后的投递方式")
            .setSingleChoiceItems(choices, lastChoice ? 0 : 1, null)
            .setPositiveButton("授权并开始", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    int checked = ((AlertDialog) dialog).getListView().getCheckedItemPosition();
                    pendingCaptureAutoDelivery = checked == 0;
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putBoolean(PREF_CAPTURE_AUTO_DELIVERY_DEFAULT, pendingCaptureAutoDelivery)
                        .apply();
                    requestScreenCapturePermission();
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void requestScreenCapturePermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_NOTIFICATION_PERMISSION);
        }
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            toast("当前设备不支持屏幕采集。");
            return;
        }
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_SCREEN_CAPTURE);
    }

    void toggleCapturePause() {
        String state = captureStatus();
        String action = "paused".equals(state) ? CaptureProjectionService.ACTION_RESUME : CaptureProjectionService.ACTION_PAUSE;
        startService(new Intent(this, CaptureProjectionService.class).setAction(action));
        captureStatusText.postDelayed(new Runnable() {
            @Override public void run() { refreshCaptureUi(); }
        }, 400L);
    }

    List<File> pendingCapturedFiles() {
        ArrayList<File> files = new ArrayList<File>();
        SharedPreferences prefs = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE);
        String dirPath = prefs.getString(CaptureProjectionService.KEY_CAPTURE_DIR, "");
        if (dirPath.length() == 0) return files;
        File dir = new File(dirPath);
        if (selectedStudent == null || !CaptureStorage.isInside(dir, CaptureStorage.studentDir(this, selectedStudent.id))) return files;
        File[] children = dir.listFiles();
        Set<String> uploaded = new HashSet<String>(prefs.getStringSet("uploaded_paths", new HashSet<String>()));
        if (children == null) return files;
        for (File child : children) {
            if (CaptureStorage.isImage(child) && !uploaded.contains(child.getAbsolutePath())) {
                files.add(child);
            }
        }
        return files;
    }

    void showCaptureManager() {
        if (selectedStudent == null) {
            toast("请先进入学生账号，再查看采集资料。");
            return;
        }
        final File studentRoot = CaptureStorage.studentDir(this, selectedStudent.id);
        if (!studentRoot.exists()) studentRoot.mkdirs();
        File[] listed = studentRoot.listFiles();
        final ArrayList<File> sessions = new ArrayList<File>();
        if (listed != null) for (File file : listed) if (file.isDirectory() && CaptureStorage.isInside(file, studentRoot)) sessions.add(file);
        File[] sorted = sessions.toArray(new File[sessions.size()]);
        Arrays.sort(sorted, new Comparator<File>() {
            @Override public int compare(File left, File right) {
                return Long.compare(right.lastModified(), left.lastModified());
            }
        });

        int imageTotal = 0;
        for (File session : sorted) imageTotal += CaptureStorage.imageCount(session);
        final AlertDialog[] managerDialog = new AlertDialog[1];
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16), dp(8), dp(16), dp(12));
        TextView summary = label(selectedStudent.name + " · " + sorted.length + " 个会话 · " + imageTotal + " 张图片 · " + formatCaptureBytes(CaptureStorage.sizeOf(studentRoot)));
        content.addView(summary);
        TextView scopeHint = new TextView(this);
        scopeHint.setText("这里只显示当前学生的采集资料。清理已上传图片不会删除尚未上传的资料；删除整个会话需要再次确认。");
        scopeHint.setTextSize(13);
        scopeHint.setTextColor(Color.rgb(87, 107, 103));
        scopeHint.setPadding(0, 0, 0, dp(8));
        content.addView(scopeHint);

        Button cleanupUploaded = button("清理当前学生已上传图片", false);
        content.addView(cleanupUploaded);
        cleanupUploaded.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("清理已上传图片")
                    .setMessage("只删除当前学生中已经上传成功的图片及其说明文件，未上传图片会保留。")
                    .setPositiveButton("确认清理", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface dialog, int which) {
                            int removed = deleteUploadedCaptureFiles(studentRoot);
                            if (managerDialog[0] != null) managerDialog[0].dismiss();
                            toast("已清理 " + removed + " 张已上传图片。");
                            showCaptureManager();
                        }
                    })
                    .setNegativeButton("取消", null)
                    .show();
            }
        });

        if (sorted.length == 0) {
            TextView empty = new TextView(this);
            empty.setText("当前学生还没有屏幕采集会话。");
            empty.setTextSize(14);
            empty.setPadding(0, dp(12), 0, dp(12));
            content.addView(empty);
        }
        for (final File session : sorted) {
            final boolean active = isActiveCaptureSession(session);
            JSONObject metadata = readCaptureMetadata(session);
            String project = metadata.optString("projectName", "");
            String status = active ? "正在采集" : metadata.optString("status", "已结束");
            LinearLayout sessionBlock = card();
            sessionBlock.setBackgroundColor(Color.rgb(246, 250, 249));
            TextView title = label(captureSessionTime(session) + " · " + CaptureStorage.imageCount(session) + " 张 · " + status);
            sessionBlock.addView(title);
            if (project.length() > 0) {
                TextView projectText = new TextView(this);
                projectText.setText("关联项目：" + project);
                projectText.setTextSize(12);
                projectText.setTextColor(Color.rgb(87, 107, 103));
                sessionBlock.addView(projectText);
            }
            HorizontalScrollView strip = new HorizontalScrollView(this);
            LinearLayout thumbnails = new LinearLayout(this);
            thumbnails.setOrientation(LinearLayout.HORIZONTAL);
            File[] sessionFiles = session.listFiles();
            int shown = 0;
            if (sessionFiles != null) {
                Arrays.sort(sessionFiles, new Comparator<File>() {
                    @Override public int compare(File left, File right) { return Long.compare(left.lastModified(), right.lastModified()); }
                });
                for (final File image : sessionFiles) {
                    if (!CaptureStorage.isImage(image) || shown >= 16) continue;
                    ImageView thumbnail = new ImageView(this);
                    thumbnail.setScaleType(ImageView.ScaleType.CENTER_CROP);
                    thumbnail.setImageBitmap(decodeCapturePreview(image, dp(112), dp(84)));
                    LinearLayout.LayoutParams thumbParams = new LinearLayout.LayoutParams(dp(112), dp(84));
                    thumbParams.setMargins(0, dp(8), dp(8), dp(8));
                    thumbnail.setLayoutParams(thumbParams);
                    thumbnail.setContentDescription("查看采集图片 " + image.getName());
                    thumbnail.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View view) { showCaptureImage(image); }
                    });
                    thumbnails.addView(thumbnail);
                    shown += 1;
                }
            }
            strip.addView(thumbnails);
            sessionBlock.addView(strip);
            Button deleteSession = button(active ? "采集中，暂不可删除" : "删除整个会话", false);
            deleteSession.setEnabled(!active);
            sessionBlock.addView(deleteSession);
            deleteSession.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) {
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("删除整个采集会话")
                        .setMessage("将删除本机中的该会话及全部图片。主机端已上传的资料不受影响。")
                        .setPositiveButton("确认删除", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface dialog, int which) {
                                boolean removed = deleteCaptureSession(session, studentRoot);
                                if (managerDialog[0] != null) managerDialog[0].dismiss();
                                toast(removed ? "采集会话已删除。" : "未能删除采集会话，请稍后重试。");
                                showCaptureManager();
                            }
                        })
                        .setNegativeButton("取消", null)
                        .show();
                }
            });
            content.addView(sessionBlock);
        }

        int legacyCount = legacyCaptureSessionCount();
        if (legacyCount > 0) {
            TextView legacy = new TextView(this);
            legacy.setText("检测到 " + legacyCount + " 个升级前未标记学生的旧采集会话。为避免串档，这里不显示其中内容。");
            legacy.setTextSize(12);
            legacy.setTextColor(Color.rgb(126, 98, 45));
            legacy.setPadding(0, dp(8), 0, dp(4));
            content.addView(legacy);
            Button cleanupLegacy = button("仅清理旧版已上传图片", false);
            content.addView(cleanupLegacy);
            cleanupLegacy.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) {
                    int removed = deleteUploadedLegacyCaptureFiles();
                    toast("已清理 " + removed + " 张旧版已上传图片，未上传内容已保留。");
                }
            });
        }

        ScrollView scroll = new ScrollView(this);
        scroll.addView(content);
        managerDialog[0] = new AlertDialog.Builder(this)
            .setTitle("采集资料管理")
            .setView(scroll)
            .setPositiveButton("关闭", null)
            .create();
        managerDialog[0].show();
    }

    JSONObject readCaptureMetadata(File session) {
        try {
            File metadata = new File(session, "session.json");
            if (!metadata.isFile()) return new JSONObject();
            return new JSONObject(readStream(new FileInputStream(metadata)));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    JSONObject readCaptureItemMetadata(Uri uri) {
        try {
            if (uri == null || !"file".equals(uri.getScheme()) || uri.getPath() == null) return new JSONObject();
            File metadata = new File(uri.getPath() + ".json");
            if (!metadata.isFile()) return new JSONObject();
            return new JSONObject(readStream(new FileInputStream(metadata)));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    JSONObject readCaptureSessionMetadata(Uri uri) {
        try {
            if (uri == null || !"file".equals(uri.getScheme()) || uri.getPath() == null) return new JSONObject();
            File image = new File(uri.getPath());
            File parent = image.getParentFile();
            return parent == null ? new JSONObject() : readCaptureMetadata(parent);
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    String captureSessionTime(File session) {
        JSONObject metadata = readCaptureMetadata(session);
        long time = metadata.optLong("startedAt", session.lastModified());
        return android.text.format.DateFormat.format("yyyy-MM-dd HH:mm", new java.util.Date(time)).toString();
    }

    Bitmap decodeCapturePreview(File image, int width, int height) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(image.getAbsolutePath(), bounds);
        int sample = 1;
        while (bounds.outWidth / sample > width * 2 || bounds.outHeight / sample > height * 2) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = Math.max(1, sample);
        return BitmapFactory.decodeFile(image.getAbsolutePath(), options);
    }

    void showCaptureImage(File image) {
        if (selectedStudent == null || !CaptureStorage.isInside(image, CaptureStorage.studentDir(this, selectedStudent.id))) {
            toast("该图片不属于当前学生。");
            return;
        }
        ImageView preview = new ImageView(this);
        preview.setAdjustViewBounds(true);
        preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
        preview.setImageBitmap(decodeCapturePreview(image, dp(900), dp(900)));
        preview.setPadding(dp(8), dp(8), dp(8), dp(8));
        new AlertDialog.Builder(this).setTitle(image.getName()).setView(preview).setPositiveButton("关闭", null).show();
    }

    boolean isActiveCaptureSession(File session) {
        SharedPreferences prefs = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE);
        String status = prefs.getString(CaptureProjectionService.KEY_STATUS, "idle");
        String currentDir = prefs.getString(CaptureProjectionService.KEY_CAPTURE_DIR, "");
        return ("capturing".equals(status) || "paused".equals(status)) && currentDir.length() > 0 && sameCapturePath(session, new File(currentDir));
    }

    boolean sameCapturePath(File left, File right) {
        try { return left.getCanonicalPath().equals(right.getCanonicalPath()); }
        catch (Exception ignored) { return false; }
    }

    int deleteUploadedCaptureFiles(File allowedRoot) {
        SharedPreferences prefs = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE);
        HashSet<String> uploaded = new HashSet<String>(prefs.getStringSet("uploaded_paths", new HashSet<String>()));
        HashSet<String> retained = new HashSet<String>(uploaded);
        int removed = 0;
        for (String path : uploaded) {
            File image = new File(path);
            if (!CaptureStorage.isImage(image) || !CaptureStorage.isInside(image, allowedRoot)) continue;
            if (!image.exists() || image.delete()) removed += image.exists() ? 0 : 1;
            File sidecar = new File(path + ".json");
            if (CaptureStorage.isInside(sidecar, allowedRoot)) sidecar.delete();
            retained.remove(path);
        }
        prefs.edit().putStringSet("uploaded_paths", retained).apply();
        return removed;
    }

    boolean deleteCaptureSession(File session, File studentRoot) {
        if (isActiveCaptureSession(session) || !CaptureStorage.isInside(session, studentRoot)) return false;
        SharedPreferences prefs = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE);
        HashSet<String> uploaded = new HashSet<String>(prefs.getStringSet("uploaded_paths", new HashSet<String>()));
        HashSet<String> retained = new HashSet<String>();
        for (String path : uploaded) if (!CaptureStorage.isInside(new File(path), session)) retained.add(path);
        boolean removed = CaptureStorage.deleteTree(session, studentRoot);
        if (removed) prefs.edit().putStringSet("uploaded_paths", retained).apply();
        return removed;
    }

    int legacyCaptureSessionCount() {
        File root = CaptureStorage.root(this);
        File[] children = root.listFiles();
        int count = 0;
        if (children != null) for (File child : children) if (child.isDirectory() && child.getName().startsWith("android-capture-")) count += 1;
        return count;
    }

    int deleteUploadedLegacyCaptureFiles() {
        File root = CaptureStorage.root(this);
        SharedPreferences prefs = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE);
        HashSet<String> uploaded = new HashSet<String>(prefs.getStringSet("uploaded_paths", new HashSet<String>()));
        HashSet<String> retained = new HashSet<String>(uploaded);
        int removed = 0;
        for (String path : uploaded) {
            File image = new File(path);
            File parent = image.getParentFile();
            boolean legacy = parent != null && parent.getName().startsWith("android-capture-") && parent.getParentFile() != null && sameCapturePath(parent.getParentFile(), root);
            if (!legacy || !CaptureStorage.isImage(image) || !CaptureStorage.isInside(image, root)) continue;
            if (!image.exists() || image.delete()) removed += image.exists() ? 0 : 1;
            File sidecar = new File(path + ".json");
            if (CaptureStorage.isInside(sidecar, root)) sidecar.delete();
            retained.remove(path);
        }
        prefs.edit().putStringSet("uploaded_paths", retained).apply();
        return removed;
    }

    String formatCaptureBytes(long bytes) {
        if (bytes < 1024L) return bytes + " B";
        if (bytes < 1024L * 1024L) return String.format(Locale.ROOT, "%.1f KB", bytes / 1024d);
        if (bytes >= 1024L * 1024L * 1024L) return String.format(Locale.ROOT, "%.2f GB", bytes / (1024d * 1024d * 1024d));
        return String.format(Locale.ROOT, "%.1f MB", bytes / (1024d * 1024d));
    }

    void uploadCapturedScreenshots() {
        if (selectedStudent == null) {
            toast("请先选择截图所属学生。");
            return;
        }
        String captureStudentId = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE).getString("capture_student_id", "");
        if (captureStudentId.length() > 0 && !captureStudentId.equals(selectedStudent.id)) {
            toast("\u8fd9\u6279\u91c7\u96c6\u8d44\u6599\u5c5e\u4e8e\u4e0a\u4e00\u4f4d\u5b66\u751f\uff0c\u4e0d\u80fd\u4e0a\u4f20\u5230\u5f53\u524d\u5b66\u751f\u3002");
            return;
        }
        List<File> files = pendingCapturedFiles();
        if (files.size() == 0) {
            toast("当前采集会话没有待上传截图。");
            return;
        }
        ArrayList<Uri> uris = new ArrayList<Uri>();
        for (File file : files) uris.add(Uri.fromFile(file));
        captureUploadUrisInFlight.clear();
        captureUploadUrisInFlight.addAll(uris);
        chooseUploadTarget(uris, true, false);
    }

    void initializeProjectMaterialUploadQueue() {
        try {
            projectMaterialUploadQueue = new ProjectMaterialUploadQueue(
                new File(getFilesDir(), ProjectMaterialUploadJobService.QUEUE_DIRECTORY));
            projectMaterialUploadQueue.recoverInterrupted();
            refreshProjectMaterialQueueStatus();
            ProjectMaterialUploadJobService.schedule(this);
        } catch (Exception error) {
            projectMaterialUploadQueue = null;
            setUploadQueueText("上传队列不可用：" + safeErrorMessage(error));
        }
    }

    void initializeCollectionInbox() {
        try {
            studentCollectionInbox = new StudentCollectionInbox(new File(getFilesDir(), "student-collection-inbox"));
        } catch (Exception error) {
            studentCollectionInbox = null;
            if (collectionInboxStatusText != null) collectionInboxStatusText.setText("本机待上传暂存不可用：" + safeErrorMessage(error));
        }
    }

    String currentStudentScopeId() {
        if (selectedStudent != null && selectedStudent.id.length() > 0) return selectedStudent.id;
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_STUDENT_SESSION_ID, "").trim();
    }

    int collectionReadyCount() {
        String studentId = currentStudentScopeId();
        if (studentCollectionInbox == null || studentId.length() == 0) return 0;
        try { return studentCollectionInbox.ready(studentId).size(); }
        catch (Exception ignored) { return 0; }
    }

    void refreshCollectionInboxUi() {
        int count = collectionReadyCount();
        if (collectionInboxStatusText != null) {
            if (currentStudentScopeId().length() == 0) collectionInboxStatusText.setText("请先在主机连接页进入学生空间。资料按学生严格隔离。 ");
            else if (count == 0) collectionInboxStatusText.setText("没有待处理的离线暂存资料。新选择的资料会直接进入持久上传队列。 ");
            else collectionInboxStatusText.setText("离线待上传暂存 " + count + " 项。可多选上传或删除；相同内容不会重复暂存。 ");
        }
        if (uploadButton != null) uploadButton.setEnabled(selectedStudent != null);
        if (sharedUploadButton != null) {
            sharedUploadButton.setText("管理待上传暂存(" + count + ")");
            sharedUploadButton.setEnabled(currentStudentScopeId().length() > 0 && count > 0);
        }
        refreshCockpitStatus();
    }

    void collectMaterials(final List<Uri> uris, final String fallbackSourceType) {
        final String studentId = currentStudentScopeId();
        if (studentId.length() == 0) {
            toast("请先进入学生空间，资料才能固定归属。 ");
            showWorkspace("connection");
            return;
        }
        if (uris == null || uris.size() == 0) return;
        if (studentCollectionInbox == null) initializeCollectionInbox();
        status("正在将 " + uris.size() + " 项资料安全保存到当前学生本机…");
        new Thread(new Runnable() {
            @Override public void run() {
                int saved = 0;
                String failure = "";
                for (Uri uri : uris) {
                    InputStream input = null;
                    try {
                        input = openUriInput(uri);
                        if (input == null) throw new IllegalStateException("无法读取资料");
                        String mime = "content".equals(uri.getScheme()) ? getContentResolver().getType(uri) : null;
                        QueuedMaterialDescriptor descriptor = queuedMaterialDescriptor(uri);
                        String sourceType = descriptor.sourceType.length() == 0 ? fallbackSourceType : descriptor.sourceType;
                        studentCollectionInbox.collect(input, new StudentCollectionInbox.Metadata(studentId,
                            sourceType, displayName(uri), mime, uri.toString()));
                        saved += 1;
                    } catch (Exception error) {
                        if (failure.length() == 0) failure = safeErrorMessage(error);
                    } finally { if (input != null) try { input.close(); } catch (Exception ignored) {} }
                }
                final int finalSaved = saved;
                final String finalFailure = failure;
                runOnUiThread(new Runnable() { @Override public void run() {
                    refreshCollectionInboxUi();
                    status(finalSaved > 0 ? "已在本机保存 " + finalSaved + " 项，连接后可直接上传。" : "资料收集失败：" + finalFailure);
                    toast(finalSaved > 0 ? "资料已保存在当前学生本机。" : "未能保存资料。 ");
                }});
            }
        }).start();
    }

    void collectTextMaterial(String text) {
        String value = text == null ? "" : text.trim();
        if (value.length() == 0) { toast("没有可保存的文字资料。 "); return; }
        final String studentId = currentStudentScopeId();
        if (studentId.length() == 0) { toast("请先进入学生空间。 "); showWorkspace("connection"); return; }
        try {
            if (studentCollectionInbox == null) initializeCollectionInbox();
            String name = "文字资料-" + System.currentTimeMillis() + ".txt";
            studentCollectionInbox.collect(new ByteArrayInputStream(value.getBytes("UTF-8")),
                new StudentCollectionInbox.Metadata(studentId, "android_text_collection", name, "text/plain", "clipboard-or-share"));
            pendingConversationText = "";
            refreshCollectionInboxUi();
            toast("文字资料已保存在当前学生本机。 ");
        } catch (Exception error) { toast("保存文字资料失败：" + safeErrorMessage(error)); }
    }

    void showCollectionUploadPicker() {
        if (studentCollectionInbox == null || selectedStudent == null) { toast("请先进入并选择学生空间。 "); return; }
        try {
            final List<StudentCollectionInbox.Entry> entries = studentCollectionInbox.ready(selectedStudent.id);
            if (entries.size() == 0) { toast("当前学生没有待上传的离线暂存资料。 "); return; }
            final boolean[] checked = new boolean[entries.size()];
            String[] labels = new String[entries.size()];
            for (int i = 0; i < entries.size(); i++) labels[i] = entries.get(i).metadata.fileName + " · " + formatSize(entries.get(i).size);
            new AlertDialog.Builder(this).setTitle("选择待上传暂存内容")
                .setMultiChoiceItems(labels, checked, new DownloadsChoiceClickListener(checked))
                .setPositiveButton("下一步：确认目标", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) {
                        ArrayList<Uri> uris = new ArrayList<Uri>();
                        for (int i = 0; i < entries.size(); i++) if (checked[i]) uris.add(Uri.fromFile(entries.get(i).payloadFile()));
                        if (uris.size() == 0) toast("请至少选择一项资料。 "); else chooseUploadTarget(uris, true, false);
                    }
                }).setNegativeButton("取消", null).show();
        } catch (Exception error) { toast("读取待上传暂存失败：" + safeErrorMessage(error)); }
    }

    void showCollectionManager() {
        if (studentCollectionInbox == null || currentStudentScopeId().length() == 0) { toast("请先进入学生空间。 "); return; }
        try {
            final List<StudentCollectionInbox.Entry> entries = studentCollectionInbox.ready(currentStudentScopeId());
            if (entries.size() == 0) { toast("当前学生没有待上传的离线暂存资料。 "); return; }
            final boolean[] checked = new boolean[entries.size()];
            String[] labels = new String[entries.size()];
            for (int i = 0; i < entries.size(); i++) {
                labels[i] = entries.get(i).metadata.fileName + " · " + formatSize(entries.get(i).size);
            }
            new AlertDialog.Builder(this).setTitle("管理待上传暂存")
                .setMultiChoiceItems(labels, checked, new DownloadsChoiceClickListener(checked))
                .setPositiveButton("上传所选", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) {
                        ArrayList<Uri> uris = new ArrayList<Uri>();
                        for (int i = 0; i < entries.size(); i++) if (checked[i]) uris.add(Uri.fromFile(entries.get(i).payloadFile()));
                        if (uris.size() == 0) toast("请至少选择一项资料。 ");
                        else chooseUploadTarget(uris, true, false);
                    }
                })
                .setNeutralButton("删除所选", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) {
                        int removed = 0;
                        try {
                            for (int i = 0; i < entries.size(); i++) {
                                if (checked[i] && studentCollectionInbox.remove(entries.get(i).collectionId, currentStudentScopeId())) removed += 1;
                            }
                            refreshCollectionInboxUi();
                            toast(removed > 0 ? "已删除 " + removed + " 项本机暂存资料。" : "请至少选择一项资料。 ");
                        } catch (Exception error) { toast("删除失败：" + safeErrorMessage(error)); }
                    }
                }).setNegativeButton("取消", null).show();
        } catch (Exception error) { toast("读取待上传暂存失败：" + safeErrorMessage(error)); }
    }

    void resumeProjectMaterialUploadQueue() {
        if (projectMaterialUploadQueue == null || selectedStudent == null || dataToken().length() == 0) {
            refreshProjectMaterialQueueStatus();
            return;
        }
        ProjectMaterialUploadJobService.schedule(this);
        ProjectMaterialUploadJobService.runNow(this);
        if (uploadQueueText != null) uploadQueueText.postDelayed(new Runnable() {
            @Override public void run() {
                refreshProjectMaterialQueueStatus();
                refreshCaptureUi();
            }
        }, 1200L);
    }

    void refreshProjectMaterialQueueStatus() {
        if (uploadQueueText == null) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String message = prefs.getString(ProjectMaterialUploadJobService.KEY_STATUS, "");
        if (message.length() == 0) {
            try {
                int waiting = 0;
                int paused = 0;
                if (projectMaterialUploadQueue != null) {
                    for (ProjectMaterialUploadQueue.Entry entry : projectMaterialUploadQueue.list()) {
                        if (entry.state == ProjectMaterialUploadQueue.State.RECEIVED) continue;
                        if (entry.state == ProjectMaterialUploadQueue.State.PAUSED_PERMISSION
                            || entry.state == ProjectMaterialUploadQueue.State.PAUSED_RECEIPT
                            || entry.state == ProjectMaterialUploadQueue.State.FAILED_PERMANENT) paused += 1;
                        else waiting += 1;
                    }
                }
                message = waiting == 0 && paused == 0 ? "上传队列：暂无待处理资料。"
                    : "上传队列：待处理 " + waiting + " 个，暂停待核对 " + paused + " 个。";
            } catch (Exception error) {
                message = "上传队列状态读取失败：" + safeErrorMessage(error);
            }
        }
        setUploadQueueText(message);
        updateSharedUploadButton();
    }

    void uploadPendingSharedMaterials() {
        if (pendingSharedUris.size() == 0) {
            toast("没有待上传的分享资料。");
            return;
        }
        uploadMaterials(new ArrayList<Uri>(pendingSharedUris), true);
    }

    void retryFailedUploads() {
        if (failedUploadUris.size() > 0) {
            uploadMaterials(new ArrayList<Uri>(failedUploadUris), true);
        } else {
            toast("正在核对持久上传队列；不确定的资料会先查询主机回执。");
            resumeProjectMaterialUploadQueue();
        }
    }

    void uploadMaterial(Uri uri) {
        List<Uri> uris = new ArrayList<Uri>();
        uris.add(uri);
        uploadMaterials(uris, true);
    }

    void uploadMaterials(List<Uri> uris, boolean reloadAfterFinish) {
        chooseUploadTarget(uris, reloadAfterFinish, false);
    }

    void chooseUploadTarget(final List<Uri> uris, final boolean reloadAfterFinish, boolean preferCaptureProject) {
        if (selectedStudent == null) {
            toast("请先选择学生。");
            return;
        }
        if (uris == null || uris.size() == 0) {
            toast("没有可上传的资料。");
            return;
        }
        final ArrayList<UploadTarget> targets = new ArrayList<UploadTarget>();
        targets.add(new UploadTarget("student", selectedStudent.id, selectedStudent.name + "原始资料库", selectedStudent.id));
        List<LearningProject> bound = projectsForSelectedStudent();
        for (LearningProject project : bound) {
            targets.add(new UploadTarget("project", project.id, project.name + "项目原始资料库", selectedStudent.id));
        }
        String captureProjectId = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE).getString("capture_project_id", "");
        int checked = 0;
        if (preferCaptureProject && captureProjectId.length() > 0) {
            for (int i = 0; i < targets.size(); i++) if ("project".equals(targets.get(i).type) && captureProjectId.equals(targets.get(i).id)) checked = i;
        }
        final String[] labels = new String[targets.size()];
        for (int i = 0; i < targets.size(); i++) labels[i] = targets.get(i).name;
        final int initialChecked = checked;
        new AlertDialog.Builder(this)
            .setTitle("选择资料上传位置")
            .setSingleChoiceItems(labels, initialChecked, null)
            .setPositiveButton("确认上传", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    int position = ((AlertDialog) dialog).getListView().getCheckedItemPosition();
                    if (position < 0 || position >= targets.size()) position = initialChecked;
                    uploadMaterialsToTarget(new ArrayList<Uri>(uris), reloadAfterFinish, targets.get(position));
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void uploadMaterialsToTarget(List<Uri> uris, boolean reloadAfterFinish, UploadTarget target) {
        if (uploadInProgress) {
            toast("已有资料正在上传，请稍候。");
            return;
        }
        if (normalizedBaseUrl().length() == 0 || dataToken().length() == 0) {
            toast("请先连接主机服务。");
            return;
        }
        if (connectedHostId().length() == 0 || connectedHostDataGeneration().length() == 0) {
            toast("请先重新连接主机，取得资料队列身份和数据代次。");
            connectAndLoadStudents();
            return;
        }
        if (projectMaterialUploadQueue == null) initializeProjectMaterialUploadQueue();
        if (projectMaterialUploadQueue == null) {
            toast("本机持久上传队列不可用，未读取所选资料。");
            return;
        }
        uploadInProgress = true;
        captureUploadVisualState = "uploading";
        refreshCaptureUi();
        status("正在将 " + uris.size() + " 个资料安全复制到本机持久队列...");
        setUploadQueueText("上传队列：0/" + uris.size() + "，正在建立本机私有稳定副本。");
        new Thread(new EnqueueProjectMaterialsTask(this, target, new ArrayList<Uri>(uris),
            reloadAfterFinish)).start();
    }

    QueuedMaterialDescriptor queuedMaterialDescriptor(Uri uri) throws Exception {
        boolean captureFile = "file".equals(uri.getScheme()) && uri.getPath() != null
            && uri.getPath().contains("screen-captures");
        if (!captureFile) return new QueuedMaterialDescriptor("android_terminal_file", "", uri.toString());
        SharedPreferences capturePrefs = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE);
        JSONObject itemMetadata = readCaptureItemMetadata(uri);
        JSONObject sessionMetadata = readCaptureSessionMetadata(uri);
        String sessionId = itemMetadata.optString("sessionId", sessionMetadata.optString("sessionId",
            capturePrefs.getString(CaptureProjectionService.KEY_SESSION_ID, "")));
        StringBuilder query = new StringBuilder();
        query.append("captureSessionId=").append(encode(sessionId));
        String courseId = itemMetadata.optString("courseId", sessionMetadata.optString("courseId",
            capturePrefs.getString(CaptureProjectionService.KEY_COURSE_ID, "")));
        String courseUrl = itemMetadata.optString("courseUrl", sessionMetadata.optString("courseUrl",
            capturePrefs.getString(CaptureProjectionService.KEY_COURSE_URL, "")));
        long courseStartedAt = itemMetadata.optLong("courseStartedAt", sessionMetadata.optLong("courseStartedAt",
            capturePrefs.getLong(CaptureProjectionService.KEY_COURSE_STARTED_AT, 0L)));
        long courseCompletedAt = sessionMetadata.optLong("courseCompletedAt",
            capturePrefs.getLong(CaptureProjectionService.KEY_COURSE_COMPLETED_AT, 0L));
        if (courseId.length() > 0) {
            query.append("&courseId=").append(encode(courseId))
                .append("&courseUrl=").append(encode(courseUrl))
                .append("&courseStartedAt=").append(encode(String.valueOf(courseStartedAt)))
                .append("&courseCompletedAt=").append(encode(String.valueOf(courseCompletedAt)));
        }
        return new QueuedMaterialDescriptor("android_screenshot", query.toString(), uri.toString());
    }

    void setUploadQueueText(String text) {
        if (uploadQueueText != null) uploadQueueText.setText(text);
    }

    void updateDigestStatusCard() {
        if (digestStatusText == null) return;
        if (selectedStudent == null) {
            digestStatusText.setText("资料状态：请选择学生。");
            updateStudentProgressCard();
            return;
        }
        int waiting = selectedStudent.pendingDigestCount + selectedStudent.submittedDigestCount;
        StringBuilder text = new StringBuilder();
        text.append("资料状态：已上传 ").append(selectedStudent.rawFileCount);
        text.append(" · 待消化 ").append(waiting);
        text.append(" · 已消化 ").append(selectedStudent.processedDigestCount);
        text.append(" · 档案 ").append(selectedStudent.archiveFileCount);
        if (selectedStudent.digestMessage.length() > 0) {
            text.append("\n").append(selectedStudent.digestMessage);
        } else if (selectedStudent.digestStatus.length() > 0) {
            text.append("\n状态：").append(selectedStudent.digestStatus);
        }
        digestStatusText.setText(text.toString());
        updateStudentProgressCard();
    }

    String localDayKey() {
        return android.text.format.DateFormat.format("yyyy-MM-dd", new java.util.Date()).toString();
    }

    void dismissDailyReminder() {
        if (selectedStudent == null) return;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString("daily_reminder_dismissed_" + selectedStudent.id, localDayKey())
            .apply();
        updateStudentProgressCard();
    }

    void updateStudentProgressCard() {
        if (studentProgressText == null || dailyReminderPanel == null) return;
        if (selectedStudent == null) {
            studentProgressText.setText("进入学生空间后，将显示已提交资料、知识化处理、近期新增和提交频率。");
            dailyReminderPanel.setVisibility(View.GONE);
            return;
        }
        int trend = selectedStudent.recentUploadTrend;
        String trendText = trend > 0 ? "比前 7 天多 " + trend : trend < 0 ? "比前 7 天少 " + Math.abs(trend) : "与前 7 天持平";
        studentProgressText.setText(
            "已提交资料 " + selectedStudent.rawFileCount + " 份 · 已完成知识化 " + selectedStudent.knowledgeAssetCount + " 份\n"
                + "近 7 天新增 " + selectedStudent.recentUploadCount7 + " 份（" + trendText + "） · 近 30 天活跃 " + selectedStudent.activeDays30 + " 天\n"
                + "最近一次消化后新增或待整理 " + selectedStudent.newSinceLastDigestCount + " 份"
        );
        String dismissed = getSharedPreferences(PREFS, MODE_PRIVATE).getString("daily_reminder_dismissed_" + selectedStudent.id, "");
        boolean show = selectedStudent.submittedTodayCount == 0 && !localDayKey().equals(dismissed);
        dailyReminderPanel.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) dailyReminderText.setText("今日学习资料提醒\n记得提交本日学习资料。可以选择今天新增的作业、笔记、截图或项目文件。");
    }

    void updateConnectionSummary(String state, int studentCount) {
        String last = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_LAST_CONNECTED_AT, "");
        StringBuilder text = new StringBuilder();
        text.append("连接状态：").append(state).append("\n");
        text.append("主机地址：").append(normalizedBaseUrl().length() > 0 ? normalizedBaseUrl() : "未填写").append("\n");
        text.append("本机设备：").append(deviceName()).append("\n");
        text.append("授权学生：").append(studentCount).append(" 位");
        String lastSuccessfulUrl = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_LAST_SUCCESSFUL_URL, "");
        if (lastSuccessfulUrl != null && lastSuccessfulUrl.length() > 0) {
            text.append("\n最近通道：").append(connectionChannelLabel(lastSuccessfulUrl)).append(" · ").append(lastSuccessfulUrl);
        }
        if (last != null && last.length() > 0) text.append("\n最近连接成功：").append(last);
        connectionSummaryText.setText(text.toString());
        updateConnectionHint(state, studentCount);
        refreshCockpitStatus();
    }

    void updateConnectionHint(String state, int studentCount) {
        if (connectionHintText == null) return;
        String lower = state == null ? "" : state.toLowerCase(Locale.ROOT);
        String hint;
        if (lower.contains("成功") || lower.contains("connected") || lower.contains("已连接")) {
            hint = studentCount <= 0
                ? "连接排查：主机已连通，但当前设备没有可访问学生。请在 Windows 主机服务的设备列表中勾选学生访问范围。"
                : "连接正常：可以上传资料到主机，也可以刷新查看学情档案。";
        } else if (lower.contains("超时") || lower.contains("不可达") || lower.contains("拒绝") || lower.contains("timeout") || lower.contains("refused")) {
            hint = "连接排查：主机地址或端口当前不可达。请确认 Windows 主机服务已启动；若 Tailscale 地址已变化，请复制最新连接信息并点击“刷新主机地址”。";
        } else if (lower.contains("token") || lower.contains("授权失效") || lower.contains("401") || lower.contains("403")) {
            hint = "连接排查：授权可能已失效。请在 Windows 主机端撤销旧设备后，重新扫码绑定。";
        } else {
            hint = "连接排查：先确认 Windows 首页选择“主机-终端模式”并启动主机服务；平板与电脑连接同一 Wi-Fi；如果仍失败，请重新扫码绑定。";
        }
        connectionHintText.setText(hint);
    }

    void markConnectedNow() {
        String time = android.text.format.DateFormat.format("yyyy-MM-dd HH:mm:ss", new java.util.Date()).toString();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_LAST_CONNECTED_AT, time).apply();
    }

    void applyUploadResult(int success, int total, List<Uri> failed, List<String> failureLabels, UploadTarget target) {
        uploadInProgress = false;
        captureUploadVisualState = failed.size() > 0 ? "failed" : "succeeded";
        lastFailedUploadTarget = failed.size() > 0 ? target : null;
        failedUploadUris.clear();
        failedUploadUris.addAll(failed);
        if (captureUploadUrisInFlight.size() > 0) {
            HashSet<String> failedValues = new HashSet<String>();
            for (Uri uri : failed) failedValues.add(uri.toString());
            SharedPreferences capturePrefs = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE);
            HashSet<String> uploadedPaths = new HashSet<String>(capturePrefs.getStringSet("uploaded_paths", new HashSet<String>()));
            for (Uri uri : captureUploadUrisInFlight) {
                if (!failedValues.contains(uri.toString()) && "file".equals(uri.getScheme()) && uri.getPath() != null) {
                    uploadedPaths.add(uri.getPath());
                }
            }
            capturePrefs.edit().putStringSet("uploaded_paths", uploadedPaths).apply();
            captureUploadUrisInFlight.clear();
            refreshCaptureUi();
        }
        StringBuilder text = new StringBuilder();
        String targetName = target == null ? (selectedStudent == null ? "当前学生原始资料库" : selectedStudent.name + "原始资料库") : target.name;
        if (success == total) text.append("最近上传结果：全部成功，").append(success).append(" 个资料已进入主机。");
        else if (success == 0) text.append("最近上传结果：全部失败，共 ").append(total).append(" 个。");
        else text.append("最近上传结果：部分成功，成功 ").append(success).append(" 个，失败 ").append(total - success).append(" 个。");
        if (success > 0) text.append("\n已上传到：").append(targetName).append("。");
        if (failureLabels.size() > 0) {
            text.append("\n失败资料：");
            int limit = Math.min(3, failureLabels.size());
            for (int i = 0; i < limit; i++) text.append("\n").append(i + 1).append(". ").append(failureLabels.get(i));
            if (failureLabels.size() > limit) text.append("\n... 还有 ").append(failureLabels.size() - limit).append(" 个失败资料");
        }
        uploadResultText.setText(text.toString());
        updateSharedUploadButton();
        refreshCaptureUi();
        if (failed.size() == 0 && captureUploadButton != null) {
            captureUploadButton.postDelayed(new Runnable() {
                @Override public void run() {
                    captureUploadVisualState = "idle";
                    refreshCaptureUi();
                }
            }, 1800L);
        }
    }

    private void openTerminalLearning() {
        openTerminalLearningAction("");
    }

    private void openTerminalLearningAction(final String action) {
        final String studentId = selectedStudent == null ? "" : selectedStudent.id;
        final String base = normalizedBaseUrl(), token = dataToken();
        com.qxmatrix.terminallearning.TerminalLearningDialog.openAction(this,
            new com.qxmatrix.terminallearning.TerminalLearningDialog.Transport() {
                @Override public JSONObject get(String route) throws Exception { return getJson(base + route, token); }
                @Override public JSONObject post(String route, JSONObject body) throws Exception { return postJson(base + route, body, token); }
                @Override public String hostId() { return base; }
            }, studentId, false, action);
    }

    JSONObject getJson(String urlText, String token) throws Exception {
        try {
            return getJsonOnce(urlText, token);
        } catch (Exception error) {
            String renewedToken = renewPersonalStudentSessionAfterUnauthorized(urlText, token, error);
            if (renewedToken == null) throw error;
            return getJsonOnce(urlText, renewedToken);
        }
    }

    JSONObject getJsonOnce(String urlText, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json");
        if (token != null && token.length() > 0) {
            connection.setRequestProperty("Authorization", "Bearer " + token);
        }
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        String body = readStream(stream);
        JSONObject json = body.length() > 0 ? new JSONObject(body) : new JSONObject();
        if (code < 200 || code >= 300 || !json.optBoolean("ok", true)) {
            throw new Exception("HTTP " + code + ": " + json.optString("message", "请求失败"));
        }
        return json;
    }

    JSONObject postJson(String urlText, JSONObject body) throws Exception {
        return postJson(urlText, body, "");
    }

    JSONObject postJson(String urlText, JSONObject body, String token) throws Exception {
        try {
            return postJsonOnce(urlText, body, token);
        } catch (Exception error) {
            String renewedToken = renewPersonalStudentSessionAfterUnauthorized(urlText, token, error);
            if (renewedToken == null) throw error;
            return postJsonOnce(urlText, body, renewedToken);
        }
    }

    JSONObject postJsonOnce(String urlText, JSONObject body, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(15000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (token != null && token.length() > 0) {
            connection.setRequestProperty("Authorization", "Bearer " + token);
        }
        byte[] data = body.toString().getBytes("UTF-8");
        OutputStream output = connection.getOutputStream();
        output.write(data);
        output.flush();
        output.close();

        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        String responseBody = readStream(stream);
        JSONObject json = responseBody.length() > 0 ? new JSONObject(responseBody) : new JSONObject();
        if (code < 200 || code >= 300 || !json.optBoolean("ok", true)) {
            throw new Exception("HTTP " + code + ": " + json.optString("message", "请求失败"));
        }
        return json;
    }

    String renewPersonalStudentSessionAfterUnauthorized(String requestUrl, String failedToken, Exception error) throws Exception {
        String message = error == null || error.getMessage() == null ? "" : error.getMessage();
        if (!message.startsWith("HTTP 401:") || failedToken == null || failedToken.length() == 0) return null;

        URL parsed = new URL(requestUrl);
        String path = parsed.getPath() == null ? "" : parsed.getPath();
        boolean studentScopedRoute = path.startsWith("/api/students/")
            || path.startsWith("/api/projects/")
            || (path.startsWith("/api/student-session/")
                && !"/api/student-session/auto".equals(path)
                && !"/api/student-session/login".equals(path))
            || "/api/agent/conversation/submit".equals(path);
        if (!studentScopedRoute) return null;

        synchronized (studentSessionRefreshLock) {
            String latestToken = dataToken();
            if (latestToken.length() > 0 && !latestToken.equals(failedToken)) return latestToken;
            if (!"personal".equals(terminalMode)) return null;

            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String deviceToken = prefs.getString(PREF_API_TOKEN, "").trim();
            if (deviceToken.length() == 0 || deviceToken.equals(failedToken)) return null;

            String base = parsed.getProtocol() + "://" + parsed.getAuthority();
            final JSONObject session;
            try {
                session = postJsonOnce(base + "/api/student-session/auto", new JSONObject(), deviceToken);
            } catch (Exception refreshError) {
                throw new Exception("HTTP 401: 学生会话已失效，自动续期失败：" + refreshError.getMessage());
            }

            String renewedToken = session.optString("token", "").trim();
            JSONObject student = session.optJSONObject("student");
            String renewedStudentId = student == null ? "" : student.optString("id", "").trim();
            String expectedStudentId = prefs.getString(PREF_STUDENT_SESSION_ID, "").trim();
            if (renewedToken.length() == 0 || renewedStudentId.length() == 0) {
                throw new Exception("HTTP 401: 主机未返回可用的个人终端学生会话。");
            }
            if (expectedStudentId.length() > 0 && !expectedStudentId.equals(renewedStudentId)) {
                throw new Exception("HTTP 401: 主机返回的学生与当前学生空间不一致，已停止读取。");
            }

            studentSessionToken = renewedToken;
            boundStudentId = renewedStudentId;
            personalRequiresBinding = false;
            prefs.edit()
                .putString(PREF_STUDENT_SESSION_TOKEN, renewedToken)
                .putString(PREF_STUDENT_SESSION_ID, renewedStudentId)
                .apply();
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    updateStudentSessionUi();
                    refreshCockpitStatus();
                }
            });
            return renewedToken;
        }
    }

    JSONObject postFile(String urlText, String token, Uri uri) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(45000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Content-Type", "application/octet-stream");
        connection.setChunkedStreamingMode(16384);

        InputStream input = openUriInput(uri);
        OutputStream output = connection.getOutputStream();
        byte[] buffer = new byte[16384];
        int read;
        while (input != null && (read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        if (input != null) input.close();
        output.flush();
        output.close();

        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        String body = readStream(stream);
        JSONObject json = body.length() > 0 ? new JSONObject(body) : new JSONObject();
        if (code < 200 || code >= 300 || !json.optBoolean("ok", true)) {
            throw new Exception(json.optString("message", "HTTP " + code));
        }
        return json;
    }

    String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "UTF-8"));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) builder.append(line).append('\n');
        reader.close();
        return builder.toString().trim();
    }

    InputStream openUriInput(Uri uri) throws Exception {
        if (uri != null && "file".equalsIgnoreCase(uri.getScheme())) {
            return new FileInputStream(new File(uri.getPath()));
        }
        return getContentResolver().openInputStream(uri);
    }

    String normalizedBaseUrl() {
        String value = connectionMode() == 2 && remoteInput != null && remoteInput.getText().toString().trim().length() > 0
            ? remoteInput.getText().toString().trim()
            : serverInput.getText().toString().trim();
        return normalizeServerUrlValue(value);
    }

    String normalizeServerUrlValue(String rawValue) {
        String value = rawValue == null ? "" : rawValue.trim();
        if (value.length() == 0) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    String normalizedRemoteUrl() {
        if (remoteInput == null) return "";
        return normalizeServerUrlValue(remoteInput.getText().toString());
    }

    boolean isTailscaleServerUrl(String url) {
        String host = serverHost(url);
        if (host.endsWith(".ts.net")) return true;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int first = Integer.parseInt(parts[0]);
            int second = Integer.parseInt(parts[1]);
            return first == 100 && second >= 64 && second <= 127;
        } catch (Exception ignored) {
            return false;
        }
    }

    boolean isLanServerUrl(String url) {
        String host = serverHost(url);
        if ("127.0.0.1".equals(host) || "localhost".equals(host)) return true;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int first = Integer.parseInt(parts[0]);
            int second = Integer.parseInt(parts[1]);
            return first == 10 || (first == 192 && second == 168) || (first == 172 && second >= 16 && second <= 31);
        } catch (Exception ignored) {
            return false;
        }
    }

    String serverHost(String url) {
        String host = normalizeServerUrlValue(url).replace("http://", "").replace("https://", "");
        int slash = host.indexOf('/');
        if (slash >= 0) host = host.substring(0, slash);
        int colon = host.indexOf(':');
        if (colon >= 0) host = host.substring(0, colon);
        return host.toLowerCase(Locale.ROOT);
    }

    List<String> storedConnectionCandidates() {
        ArrayList<String> values = new ArrayList<String>();
        String raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_ENDPOINT_CANDIDATES, "");
        if (raw == null || raw.trim().length() == 0) return values;
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                String value = normalizeServerUrlValue(array.optString(i, ""));
                if (value.length() > 0 && !values.contains(value)) values.add(value);
            }
        } catch (Exception ignored) {
        }
        return values;
    }

    void rememberConnectionCandidates(List<String> candidates) {
        List<String> ordered = orderedServerUrls(candidates);
        JSONArray array = new JSONArray();
        for (int i = 0; i < ordered.size(); i++) array.put(ordered.get(i));
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_ENDPOINT_CANDIDATES, array.toString()).apply();
    }

    List<String> connectionCandidates() {
        ArrayList<String> candidates = new ArrayList<String>();
        String manual = normalizedRemoteUrl();
        String current = normalizeServerUrlValue(serverInput == null ? "" : serverInput.getText().toString());
        if (connectionMode() == 2) {
            if (manual.length() > 0) candidates.add(manual);
            else if (current.length() > 0) candidates.add(current);
            return orderedServerUrls(candidates);
        }
        if (current.length() > 0) candidates.add(current);
        // Older installations keep the valid Tailscale endpoint in the remote field.
        // The automatic mode must include it as a fallback instead of reserving it for
        // manual mode only.
        if (connectionMode() == 1 && manual.length() > 0 && isTailscaleServerUrl(manual)) {
            candidates.add(manual);
        }
        candidates.addAll(storedConnectionCandidates());
        ArrayList<String> filtered = new ArrayList<String>();
        for (int i = 0; i < candidates.size(); i++) {
            String candidate = normalizeServerUrlValue(candidates.get(i));
            if (candidate.length() == 0) continue;
            if (connectionMode() == 0 && !isLanServerUrl(candidate)) continue;
            if (!filtered.contains(candidate)) filtered.add(candidate);
        }
        return orderedServerUrls(filtered);
    }

    void rememberSuccessfulEndpoint(String base) {
        final String normalized = normalizeServerUrlValue(base);
        if (normalized.length() == 0) return;
        serverInput.setText(normalized);
        ArrayList<String> candidates = new ArrayList<String>();
        candidates.add(normalized);
        candidates.addAll(storedConnectionCandidates());
        rememberConnectionCandidates(candidates);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_SERVER_URL, normalized)
            .putString(PREF_LAST_SUCCESSFUL_URL, normalized)
            .apply();
    }

    int connectionMode() {
        if (connectionModeSpinner == null) return 1;
        int selected = connectionModeSpinner.getSelectedItemPosition();
        return selected < 0 ? 1 : selected;
    }

    String connectionModeLabel() {
        int mode = connectionMode();
        if (mode == 0) return "仅局域网";
        if (mode == 2) return "手动远程地址";
        return "局域网 + Tailscale";
    }

    String apiToken() {
        return tokenInput.getText().toString().trim();
    }

    void loadPrefs() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        serverInput.setText(prefs.getString(PREF_SERVER_URL, ""));
        tokenInput.setText(prefs.getString(PREF_API_TOKEN, ""));
        terminalMode = prefs.getString(PREF_TERMINAL_MODE, "shared");
        studentSessionToken = prefs.getString(PREF_STUDENT_SESSION_TOKEN, "");
        pendingConversationText = prefs.getString(PREF_PENDING_CONVERSATION_TEXT, "");
        pendingConversationSource = prefs.getString(PREF_PENDING_CONVERSATION_SOURCE, "手动粘贴");
        pendingConversationReference = prefs.getString(PREF_PENDING_CONVERSATION_REFERENCE, "manual-paste");
        if (remoteInput != null) remoteInput.setText(prefs.getString(PREF_REMOTE_URL, ""));
        suppressPreferenceCallbacks = true;
        layoutMode = clamp(prefs.getInt(PREF_LAYOUT_MODE, layoutMode), 0, 2);
        skinIndex = clamp(prefs.getInt(PREF_SKIN, skinIndex), 0, 4);
        if (layoutModeSpinner != null) layoutModeSpinner.setSelection(layoutMode);
        if (skinSpinner != null) skinSpinner.setSelection(skinIndex);
        if (connectionModeSpinner != null) connectionModeSpinner.setSelection(prefs.getInt(PREF_CONNECTION_MODE, 1));
        suppressPreferenceCallbacks = false;
        updateStudentSessionUi();
        updateConversationImportUi();
        updateConnectionSummary("未连接", students.size());
    }

    void savePrefs() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_SERVER_URL, serverInput.getText().toString().trim())
            .putString(PREF_API_TOKEN, apiToken())
            .putString(PREF_REMOTE_URL, normalizedRemoteUrl())
            .putInt(PREF_CONNECTION_MODE, connectionMode())
            .putInt(PREF_LAYOUT_MODE, layoutMode)
            .putInt(PREF_SKIN, skinIndex)
            .apply();
    }

    void saveDeviceCredentials(String base, String token) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_SERVER_URL, base)
            .putString(PREF_API_TOKEN, token)
            .remove(PREF_STUDENT_SESSION_TOKEN)
            .commit();
        studentSessionToken = "";
    }

    void rememberHostIdentity(String hostId, String machineCode, String displayName) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_HOST_DEVICE_ID, hostId == null ? "" : hostId)
            .putString(PREF_HOST_MACHINE_CODE, machineCode == null ? "" : machineCode)
            .putString(PREF_HOST_DISPLAY_NAME, displayName == null ? "" : displayName)
            .apply();
        if (machineCodeText != null) machineCodeText.setText(connectedIdentityText());
    }

    void rememberHostProtocolState(JSONObject health) throws Exception {
        String hostId = health == null ? "" : health.optString("hostId", "").trim();
        String generation = health == null ? "" : health.optString("dataGeneration", "").trim();
        if (hostId.length() == 0 || generation.length() == 0) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .remove(PREF_HOST_DEVICE_ID)
                .remove(PREF_HOST_DATA_GENERATION)
                .apply();
            throw new Exception("主机未提供资料队列身份或数据代次，请先升级 Windows 主机。");
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_HOST_DEVICE_ID, hostId)
            .putString(PREF_HOST_DATA_GENERATION, generation)
            .apply();
    }

    String connectedHostId() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_HOST_DEVICE_ID, "").trim();
    }

    String connectedHostDataGeneration() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_HOST_DATA_GENERATION, "").trim();
    }

    String connectedIdentityText() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String hostCode = prefs.getString(PREF_HOST_MACHINE_CODE, "");
        String hostName = prefs.getString(PREF_HOST_DISPLAY_NAME, "");
        String own = "本平板固定机器码：" + tabletMachineCode();
        if (hostCode == null || hostCode.length() == 0) return own + "\n当前尚未保存固定主机码。";
        return own + "\n当前主机：" + (hostName == null || hostName.length() == 0 ? "AI教育管家主机" : hostName) + " · " + hostCode;
    }

    void startExportConnectionBackup() {
        savePrefs();
        if (normalizedBaseUrl().length() == 0 || apiToken().length() == 0) {
            toast("请先保存并成功连接主机，再导出连接备份。");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "AI教育管家-平板连接备份-" + System.currentTimeMillis() + ".json");
        try {
            startActivityForResult(intent, REQUEST_EXPORT_CONNECTION_BACKUP);
        } catch (Exception error) {
            toast("无法打开备份文件保存位置：" + error.getMessage());
        }
    }

    void writeConnectionBackup(Uri uri) {
        OutputStream output = null;
        try {
            JSONObject backup = new JSONObject();
            backup.put("kind", CONNECTION_BACKUP_KIND);
            backup.put("protocolVersion", CONNECTION_BACKUP_VERSION);
            backup.put("appVersion", VERSION_NAME);
            backup.put("exportedAt", System.currentTimeMillis());
            backup.put("deviceId", deviceId());
            backup.put("deviceName", deviceName());
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            backup.put("tabletMachineCode", tabletMachineCode());
            backup.put("hostId", prefs.getString(PREF_HOST_DEVICE_ID, ""));
            backup.put("hostMachineCode", prefs.getString(PREF_HOST_MACHINE_CODE, ""));
            backup.put("hostDisplayName", prefs.getString(PREF_HOST_DISPLAY_NAME, ""));
            backup.put("serverUrl", normalizedBaseUrl());
            backup.put("remoteUrl", normalizedRemoteUrl());
            backup.put("endpointCandidates", new JSONArray(storedConnectionCandidates()));
            backup.put("connectionMode", connectionMode());
            backup.put("apiToken", apiToken());
            output = getContentResolver().openOutputStream(uri, "wt");
            if (output == null) throw new Exception("无法写入所选文件");
            output.write(backup.toString(2).getBytes("UTF-8"));
            output.flush();
            toast("连接备份已导出，请妥善保管。");
            status("已导出当前连接备份。备份包含设备授权凭据，请勿转发给无关人员。");
        } catch (Exception error) {
            toast("导出连接备份失败：" + error.getMessage());
        } finally {
            if (output != null) try { output.close(); } catch (Exception ignored) {}
        }
    }

    void startImportConnectionBackup() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        try {
            startActivityForResult(intent, REQUEST_IMPORT_CONNECTION_BACKUP);
        } catch (Exception error) {
            toast("无法打开连接备份选择器：" + error.getMessage());
        }
    }

    void importConnectionBackup(Uri uri) {
        try {
            String text = readConnectionBackupText(uri);
            final JSONObject backup = new JSONObject(text);
            if (!CONNECTION_BACKUP_KIND.equals(backup.optString("kind", ""))) {
                throw new Exception("不是 AI 教育管家平板连接备份");
            }
            if (backup.optInt("protocolVersion", 0) > CONNECTION_BACKUP_VERSION) {
                throw new Exception("备份版本过新，请先升级平板终端");
            }
            if (backup.optString("serverUrl", "").trim().length() == 0 || backup.optString("apiToken", "").trim().length() == 0) {
                throw new Exception("备份缺少主机地址或授权凭据");
            }
            final String backupDeviceId = backup.optString("deviceId", "").trim();
            if (backupDeviceId.length() > 0 && !backupDeviceId.equals(deviceId())) {
                new AlertDialog.Builder(this)
                    .setTitle("恢复原设备身份？")
                    .setMessage("该备份来自另一安装身份。仅当这是同一台平板重装后的恢复操作时继续；继续后将使用备份中的设备授权。")
                    .setPositiveButton("恢复并连接", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface dialog, int which) {
                            applyConnectionBackup(backup, true);
                        }
                    })
                    .setNegativeButton("取消", null)
                    .show();
                return;
            }
            applyConnectionBackup(backup, false);
        } catch (Exception error) {
            toast("导入连接备份失败：" + error.getMessage());
        }
    }

    String readConnectionBackupText(Uri uri) throws Exception {
        InputStream input = null;
        BufferedReader reader = null;
        try {
            input = openUriInput(uri);
            if (input == null) throw new Exception("无法读取所选文件");
            reader = new BufferedReader(new InputStreamReader(input, "UTF-8"));
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
                if (builder.length() > 512 * 1024) throw new Exception("连接备份文件过大");
            }
            return builder.toString();
        } finally {
            if (reader != null) try { reader.close(); } catch (Exception ignored) {}
            else if (input != null) try { input.close(); } catch (Exception ignored) {}
        }
    }

    void applyConnectionBackup(JSONObject backup, boolean restoreDeviceIdentity) {
        try {
            String serverUrl = backup.optString("serverUrl", "").trim();
            String remoteUrl = backup.optString("remoteUrl", "").trim();
            String token = backup.optString("apiToken", "").trim();
            int mode = clamp(backup.optInt("connectionMode", 1), 0, 2);
            String backupDeviceId = backup.optString("deviceId", "").trim();
            serverInput.setText(serverUrl);
            tokenInput.setText(token);
            if (remoteInput != null) remoteInput.setText(remoteUrl);
            JSONArray endpointCandidates = backup.optJSONArray("endpointCandidates");
            ArrayList<String> restoredCandidates = new ArrayList<String>();
            if (endpointCandidates != null) {
                for (int i = 0; i < endpointCandidates.length(); i++) {
                    String candidate = normalizeServerUrlValue(endpointCandidates.optString(i, ""));
                    if (candidate.length() > 0) restoredCandidates.add(candidate);
                }
            }
            if (serverUrl.length() > 0) restoredCandidates.add(serverUrl);
            if (remoteUrl.length() > 0) restoredCandidates.add(remoteUrl);
            rememberConnectionCandidates(restoredCandidates);
            if (connectionModeSpinner != null) connectionModeSpinner.setSelection(mode);
            SharedPreferences.Editor editor = getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString(PREF_SERVER_URL, serverUrl)
                .putString(PREF_API_TOKEN, token)
                .putString(PREF_REMOTE_URL, remoteUrl)
                .putString(PREF_HOST_DEVICE_ID, backup.optString("hostId", ""))
                .putString(PREF_HOST_MACHINE_CODE, backup.optString("hostMachineCode", ""))
                .putString(PREF_HOST_DISPLAY_NAME, backup.optString("hostDisplayName", ""))
                .putInt(PREF_CONNECTION_MODE, mode);
            if (restoreDeviceIdentity && backupDeviceId.length() > 0) editor.putString(PREF_DEVICE_ID, backupDeviceId);
            if (!editor.commit()) throw new Exception("无法保存连接配置");
            toast("连接备份已导入，正在连接主机。");
            status("连接备份已恢复，正在验证主机和设备授权...");
            connectAndLoadStudents();
        } catch (Exception error) {
            toast("应用连接备份失败：" + error.getMessage());
        }
    }

    void loadVisualPrefsOnly() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        layoutMode = clamp(prefs.getInt(PREF_LAYOUT_MODE, 0), 0, 2);
        skinIndex = clamp(prefs.getInt(PREF_SKIN, 0), 0, 4);
    }

    void saveVisualPrefs() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putInt(PREF_LAYOUT_MODE, layoutMode)
            .putInt(PREF_SKIN, skinIndex)
            .apply();
    }

    void applyRequestedOrientation() {
        if (layoutMode == 1) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } else if (layoutMode == 2) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    String deviceId() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String id = prefs.getString(PREF_DEVICE_ID, "");
        if (id == null || id.length() == 0) {
            id = "tablet-" + java.util.UUID.randomUUID().toString();
            prefs.edit().putString(PREF_DEVICE_ID, id).apply();
        }
        return id;
    }

    String tabletMachineCode() {
        final String alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(("tablet:" + deviceId()).getBytes("UTF-8"));
            StringBuilder body = new StringBuilder();
            for (int i = 0; body.length() < 8; i++) {
                int value = bytes[i % bytes.length] & 0xff;
                body.append(alphabet.charAt(value % alphabet.length()));
            }
            return "T-" + body.substring(0, 4) + "-" + body.substring(4, 8);
        } catch (Exception error) {
            return "T-UNKNOWN";
        }
    }

    String deviceName() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String name = (maker + " " + model).trim();
        return name.length() == 0 ? "Android 平板" : name;
    }

    String cacheKey(String prefix, String studentId, String path) {
        return prefix + studentId + "_" + String.valueOf(path == null ? "" : path).hashCode();
    }

    void cacheArchiveFiles(String studentId, List<ArchiveFile> files) {
        try {
            JSONArray array = new JSONArray();
            for (int i = 0; i < files.size(); i++) {
                JSONObject item = new JSONObject();
                item.put("name", files.get(i).name);
                item.put("path", files.get(i).path);
                array.put(item);
            }
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString(CACHE_ARCHIVE_FILES_PREFIX + studentId, array.toString())
                .putLong(CACHE_TIME_PREFIX + studentId, System.currentTimeMillis())
                .apply();
        } catch (Exception ignored) {
        }
    }

    List<ArchiveFile> readCachedArchiveFiles(String studentId) {
        ArrayList<ArchiveFile> result = new ArrayList<ArchiveFile>();
        String text = getSharedPreferences(PREFS, MODE_PRIVATE).getString(CACHE_ARCHIVE_FILES_PREFIX + studentId, "");
        if (text == null || text.length() == 0) return result;
        try {
            JSONArray array = new JSONArray(text);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item != null) result.add(new ArchiveFile(item));
            }
        } catch (Exception ignored) {
        }
        return result;
    }

    void cacheMarkdown(String studentId, ArchiveFile file, String content) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(cacheKey(CACHE_MARKDOWN_PREFIX, studentId, file.path), content)
            .putString(cacheKey(CACHE_MARKDOWN_TITLE_PREFIX, studentId, file.path), file.name)
            .putLong(cacheKey(CACHE_TIME_PREFIX, studentId, file.path), System.currentTimeMillis())
            .apply();
    }

    String cachedMarkdown(String studentId, String path) {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(cacheKey(CACHE_MARKDOWN_PREFIX, studentId, path), "");
    }

    String cacheTimeText(String studentId, String path) {
        if (studentId == null || studentId.length() == 0 || path == null || path.length() == 0) return "";
        long time = getSharedPreferences(PREFS, MODE_PRIVATE).getLong(cacheKey(CACHE_TIME_PREFIX, studentId, path), 0);
        if (time <= 0) return "";
        return android.text.format.DateFormat.format("MM-dd HH:mm", new java.util.Date(time)).toString();
    }

    String archiveListCacheTimeText(String studentId) {
        if (studentId == null || studentId.length() == 0) return "";
        long time = getSharedPreferences(PREFS, MODE_PRIVATE).getLong(CACHE_TIME_PREFIX + studentId, 0);
        if (time <= 0) return "";
        return android.text.format.DateFormat.format("MM-dd HH:mm", new java.util.Date(time)).toString();
    }

    boolean handlePairPayload(String text) {
        return handlePairPayload(text, false);
    }

    boolean handlePairPayload(String text, boolean refreshAddressOnly) {
        if (text == null) return false;
        String payload = extractPairPayload(text.trim());
        if (payload.length() == 0) return false;
        try {
            JSONObject json = new JSONObject(payload);
            if (!"AI_EDU_MANAGER_PAIR".equals(json.optString("type"))) return false;
            ArrayList<String> lanCandidates = new ArrayList<String>();
            ArrayList<String> tailscaleCandidates = new ArrayList<String>();
            ArrayList<String> urls = new ArrayList<String>();
            if (json.optString("serverUrl", "").length() > 0) lanCandidates.add(json.optString("serverUrl"));
            JSONArray lanUrls = json.optJSONArray("lanUrls");
            if (lanUrls != null) {
                for (int i = 0; i < lanUrls.length(); i++) {
                    String url = lanUrls.optString(i, "");
                    if (url.length() > 0) lanCandidates.add(url);
                }
            }
            if (json.optString("tailscaleUrl", "").length() > 0) tailscaleCandidates.add(json.optString("tailscaleUrl"));
            JSONArray tailscaleUrls = json.optJSONArray("tailscaleUrls");
            if (tailscaleUrls != null) {
                for (int i = 0; i < tailscaleUrls.length(); i++) {
                    String url = tailscaleUrls.optString(i, "");
                    if (url.length() > 0) tailscaleCandidates.add(url);
                }
            }
            if (connectionMode() == 2 && normalizedRemoteUrl().length() > 0) urls.add(normalizedRemoteUrl());
            urls.addAll(lanCandidates);
            if (connectionMode() != 0) urls.addAll(tailscaleCandidates);
            List<String> orderedUrls = orderedServerUrls(urls);
            String base = orderedUrls.size() > 0 ? orderedUrls.get(0) : "";
            String pairCode = json.optString("pairCode", "");
            if (base.length() == 0 || (!refreshAddressOnly && pairCode.length() == 0)) {
                toast("配对内容缺少主机地址或配对码。");
                return true;
            }
            String incomingHostId = json.optString("hostId", "").trim();
            String savedHostId = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_HOST_DEVICE_ID, "").trim();
            if (refreshAddressOnly && incomingHostId.length() > 0 && savedHostId.length() > 0 && !incomingHostId.equals(savedHostId)) {
                status("刷新主机地址已停止：剪贴板信息属于另一台 Windows 主机。");
                toast("主机身份不一致，未修改当前连接。");
                return true;
            }
            rememberConnectionCandidates(orderedUrls);
            if (incomingHostId.length() > 0) {
                rememberHostIdentity(incomingHostId, json.optString("hostMachineCode", ""), json.optString("hostDisplayName", ""));
            }
            serverInput.setText(base);
            if (refreshAddressOnly) {
                savePrefs();
                status("已刷新主机候选地址，正在保留原授权重新连接...");
                toast("主机地址已刷新，无需重新授权。");
                connectAndLoadStudents();
                return true;
            }
            status("正在向主机确认配对...");
            new Thread(new PairConfirmTask(this, orderedUrls, pairCode)).start();
            return true;
        } catch (Exception error) {
            toast("无法识别配对内容：" + error.getMessage());
            return true;
        }
    }

    String extractPairPayload(String text) {
        if (text == null) return "";
        String trimmed = text.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
        String[] lines = trimmed.split("\\r?\\n");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            int index = line.indexOf('=');
            if (index <= 0) continue;
            String key = line.substring(0, index).trim();
            String value = line.substring(index + 1).trim();
            if ("pairPayload".equalsIgnoreCase(key)) return value;
        }
        return "";
    }

    void refreshHostAddress() {
        new AlertDialog.Builder(this)
            .setTitle("刷新主机地址")
            .setMessage("请先在 Windows 主机的“主机连接”中复制最新学生终端连接信息。本操作只更新局域网、MagicDNS 和 Tailscale 地址，保留当前设备授权。")
            .setPositiveButton("从剪贴板刷新", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    pasteConnectionInfo(true);
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    void pasteConnectionInfo() {
        pasteConnectionInfo(false);
    }

    void pasteConnectionInfo(boolean refreshAddressOnly) {
        ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (manager == null || !manager.hasPrimaryClip()) {
            toast("剪贴板里没有连接信息。");
            return;
        }
        ClipData clip = manager.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) {
            toast("剪贴板里没有连接信息。");
            return;
        }
        CharSequence text = clip.getItemAt(0).coerceToText(this);
        if (text == null) {
            toast("无法读取剪贴板内容。");
            return;
        }
        String pasted = text.toString().trim();
        if (handlePairPayload(pasted, refreshAddressOnly)) return;
        if (pasted.startsWith("http://") || pasted.startsWith("https://")) {
            String refreshed = pickPreferredServerUrl(pasted);
            serverInput.setText(refreshed);
            ArrayList<String> directCandidates = new ArrayList<String>();
            directCandidates.add(refreshed);
            directCandidates.addAll(storedConnectionCandidates());
            rememberConnectionCandidates(directCandidates);
            savePrefs();
            toast(refreshAddressOnly ? "主机地址已刷新，无需重新授权。" : "已粘贴连接地址。");
            if (refreshAddressOnly) connectAndLoadStudents();
            return;
        }
        String serverUrl = "";
        List<String> candidateUrls = new ArrayList<String>();
        String[] lines = pasted.split("\\r?\\n");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            int index = line.indexOf('=');
            if (index <= 0) continue;
            String key = line.substring(0, index).trim();
            String value = line.substring(index + 1).trim();
            if ("serverUrl".equalsIgnoreCase(key)) {
                serverUrl = value;
                candidateUrls.add(value);
            }
            if ("lanUrls".equalsIgnoreCase(key)) {
                String[] urls = value.split(",");
                for (int j = 0; j < urls.length; j++) {
                    if (urls[j].trim().length() > 0) candidateUrls.add(urls[j].trim());
                }
            }
            if ("tailscaleUrls".equalsIgnoreCase(key)) {
                String[] urls = value.split(",");
                if (connectionMode() != 0) {
                    for (int j = 0; j < urls.length; j++) {
                        if (urls[j].trim().length() > 0) candidateUrls.add(urls[j].trim());
                    }
                }
            }
            if ("connectionMode".equalsIgnoreCase(key)) {
                if ("lan_only".equalsIgnoreCase(value) && connectionModeSpinner != null) connectionModeSpinner.setSelection(0);
                else if ("manual".equalsIgnoreCase(value) && connectionModeSpinner != null) connectionModeSpinner.setSelection(2);
                else if (connectionModeSpinner != null) connectionModeSpinner.setSelection(1);
            }
            if ("apiToken".equalsIgnoreCase(key) && !refreshAddressOnly) tokenInput.setText(value);
        }
        if (candidateUrls.size() > 0) {
            serverInput.setText(pickPreferredServerUrl(candidateUrls));
            rememberConnectionCandidates(candidateUrls);
        } else if (serverUrl.length() > 0) {
            serverInput.setText(serverUrl);
        }
        savePrefs();
        toast(refreshAddressOnly ? "主机地址已刷新，无需重新授权。" : "已粘贴连接信息。");
        if (refreshAddressOnly) {
            status("已刷新主机候选地址，正在保留原授权重新连接...");
            connectAndLoadStudents();
        }
    }

    String pickPreferredServerUrl(String urlsText) {
        List<String> urls = new ArrayList<String>();
        String[] pieces = urlsText.split("[,\\s]+");
        for (int i = 0; i < pieces.length; i++) {
            if (pieces[i].startsWith("http://") || pieces[i].startsWith("https://")) urls.add(pieces[i]);
        }
        return pickPreferredServerUrl(urls);
    }

    String pickPreferredServerUrl(List<String> urls) {
        List<String> ordered = orderedServerUrls(urls);
        return ordered.size() > 0 ? ordered.get(0) : "";
    }

    List<String> orderedServerUrls(List<String> urls) {
        ArrayList<String> ordered = new ArrayList<String>();
        if (urls == null) return ordered;
        for (int i = 0; i < urls.size(); i++) {
            String url = urls.get(i) == null ? "" : urls.get(i).trim();
            if (url.length() == 0 || ordered.contains(url)) continue;
            ordered.add(url);
        }
        for (int i = 0; i < ordered.size(); i++) {
            int best = i;
            for (int j = i + 1; j < ordered.size(); j++) {
                if (serverUrlScore(ordered.get(j)) < serverUrlScore(ordered.get(best))) best = j;
            }
            if (best != i) {
                String temp = ordered.get(i);
                ordered.set(i, ordered.get(best));
                ordered.set(best, temp);
            }
        }
        return ordered;
    }

    int serverUrlScore(String url) {
        if (connectionMode() == 2 && normalizedRemoteUrl().length() > 0 && normalizedRemoteUrl().equals(url)) return -100;
        String host = url.replace("http://", "").replace("https://", "");
        int slash = host.indexOf('/');
        if (slash >= 0) host = host.substring(0, slash);
        int colon = host.indexOf(':');
        if (colon >= 0) host = host.substring(0, colon);
        String[] parts = host.split("\\.");
        if (host.endsWith(".ts.net")) return 90;
        if (parts.length < 2) return 200;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            if (a == 192 && b == 168) return 10;
            if (a == 10) return 20;
            if (a == 172 && b >= 16 && b <= 31) return 30;
            if (a == 100 && b >= 64 && b <= 127) return 100;
        } catch (Exception ignored) {
            return 200;
        }
        return 80;
    }

    void copyMarkdown() {
        if (currentMarkdown.length() == 0) {
            toast("当前没有可复制的档案正文。");
            return;
        }
        ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (manager != null) {
            manager.setPrimaryClip(ClipData.newPlainText("markdown", currentMarkdown));
            toast("已复制档案正文。");
        }
    }

    void updateContactCard() {
        if (selectedStudent == null) {
            contactText.setText("选择学生后，可查看该学生绑定的企业微信或 QQ 联系入口。");
            openWeComButton.setEnabled(false);
            openQQButton.setEnabled(false);
            copyConsultPromptButton.setEnabled(false);
            copyDigestPromptButton.setEnabled(false);
            return;
        }
        String channel = normalizeRemoteChannel(selectedStudent.remoteChannel);
        boolean hasWeCom = "wecom".equals(channel) || "both".equals(channel);
        boolean hasQQ = "qq".equals(channel) || "both".equals(channel);
        StringBuilder text = new StringBuilder();
        text.append(selectedStudent.name).append("：");
        if (hasWeCom && hasQQ) text.append("已绑定企业微信和 QQ。");
        else if (hasWeCom) text.append("已绑定企业微信。");
        else if (hasQQ) text.append("已绑定 QQ。");
        else text.append("主机端尚未配置联系渠道。");
        text.append("\n").append(contactInstruction(channel));
        text.append("\n绑定状态：").append(remoteStatusLabel(selectedStudent.remoteBindingStatus));
        if (selectedStudent.remoteBoundAt.length() > 0) {
            text.append("（").append(selectedStudent.remoteBoundAt).append("）");
        }
        if (selectedStudent.remoteContact.length() > 0) {
            text.append("\n备注：").append(selectedStudent.remoteContact);
        }
        if (selectedStudent.remoteNote.length() > 0) {
            text.append("\n说明：").append(normalizeRemoteNote(selectedStudent.remoteNote, channel));
        }
        contactText.setText(text.toString());
        openWeComButton.setEnabled(hasWeCom);
        openQQButton.setEnabled(hasQQ);
        copyConsultPromptButton.setEnabled(true);
        copyDigestPromptButton.setEnabled(true);
    }

    String normalizeRemoteChannel(String value) {
        if (value == null) return "none";
        String channel = value.trim().toLowerCase(Locale.ROOT);
        if ("wecom".equals(channel) || "qq".equals(channel) || "both".equals(channel)) return channel;
        return "none";
    }

    String contactInstruction(String channel) {
        if ("qq".equals(channel)) return "请在QQ中联系AI教育管家，复制咨询提示。";
        if ("both".equals(channel)) return "请在企业微信或QQ中联系AI教育管家，复制咨询提示。";
        if ("wecom".equals(channel)) return "请在企业微信中联系AI教育管家，复制咨询提示。";
        return "请先联系服务人员完成教育管家远控绑定。";
    }

    String normalizeRemoteNote(String note, String channel) {
        if (note == null) return "";
        if ("qq".equals(channel)) return note.replace("企业微信", "QQ");
        if ("wecom".equals(channel)) return note.replace("QQ", "企业微信");
        return note;
    }

    String remoteStatusLabel(String value) {
        String status = value == null ? "unbound" : value.trim().toLowerCase(Locale.ROOT);
        if ("bound".equals(status)) return "已绑定";
        if ("pending".equals(status)) return "待确认";
        return "未绑定";
    }

    void openWeCom() {
        openExternalApp(new String[] {"com.tencent.wework", "com.tencent.weworklocal"}, "wxwork://", "企业微信");
    }

    void openQQ() {
        openExternalApp(new String[] {"com.tencent.mobileqq", "com.tencent.minihd.qq", "com.tencent.tim"}, "mqq://", "QQ");
    }

    void chooseAgentApp() {
        Intent query = new Intent(Intent.ACTION_MAIN);
        query.addCategory(Intent.CATEGORY_LAUNCHER);
        final List<android.content.pm.ResolveInfo> apps = new ArrayList<android.content.pm.ResolveInfo>();
        for (android.content.pm.ResolveInfo item : getPackageManager().queryIntentActivities(query, 0)) {
            if (item.activityInfo != null && !getPackageName().equals(item.activityInfo.packageName)) apps.add(item);
        }
        java.util.Collections.sort(apps, new android.content.pm.ResolveInfo.DisplayNameComparator(getPackageManager()));
        if (apps.isEmpty()) { toast("未发现可打开的应用，请先安装需要使用的 Agent。"); return; }
        String[] labels = new String[apps.size()];
        for (int i = 0; i < apps.size(); i++) labels[i] = apps.get(i).loadLabel(getPackageManager()) + " · " + apps.get(i).activityInfo.packageName;
        new AlertDialog.Builder(this).setTitle("选择已安装的 Agent 应用").setItems(labels, new android.content.DialogInterface.OnClickListener() {
          @Override public void onClick(android.content.DialogInterface dialog, int which) {
            android.content.pm.ActivityInfo selected = apps.get(which).activityInfo;
            Intent launch = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            launch.setClassName(selected.packageName, selected.name);
            try { startActivity(launch); } catch (Exception error) { toast("无法打开所选应用：" + error.getMessage()); }
          }
        }).setNegativeButton("取消", null).show();
    }

    void openMarvis() {
        openAgentApp(
            new String[] {"com.tencent.marvis", "com.tencent.marvis.android", "com.tencent.marvisapp", "com.marvis.app", "com.tencent.jarvis", "com.tencent.ai.marvis", "com.tencent.aigc.marvis"},
            "marvis://",
            "https://marvis.qq.com/",
            "Marvis",
            new String[] {"marvis", "马维斯", "瑪維斯", "jarvis", "贾维斯", "騰訊marvis", "腾讯marvis"}
        );
    }

    void openObsidian() {
        openAgentApp(
            new String[] {"md.obsidian"},
            "obsidian://",
            "https://obsidian.md/download",
            "Obsidian",
            new String[] {"obsidian", "黑曜石"}
        );
    }

    boolean isTailscaleInstalled() {
        return getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn") != null;
    }

    void openTailscaleDownload() {
        openUrl(TAILSCALE_APK_URL);
    }

    void openTailscaleApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launch);
            return;
        }
        toast("未检测到本机 Tailscale，正在打开下载地址。");
        openTailscaleDownload();
    }

    void openAgentApp(String[] packageNames, String fallbackUri, String downloadUrl, String appName, String[] labelNeedles) {
        try {
            for (int i = 0; i < packageNames.length; i++) {
                Intent launch = getPackageManager().getLaunchIntentForPackage(packageNames[i]);
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launch);
                    return;
                }
            }
            Intent labelLaunch = findLauncherIntentByLabel(labelNeedles);
            if (labelLaunch != null) {
                labelLaunch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(labelLaunch);
                return;
            }
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUri));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (view.resolveActivity(getPackageManager()) != null) {
                startActivity(view);
                return;
            }
            toast("未检测到本机 " + appName + "，正在打开下载页面。");
            openUrl(downloadUrl);
        } catch (Exception error) {
            toast("无法打开" + appName + "：" + error.getMessage());
        }
    }

    Intent findLauncherIntentByLabel(String[] labelNeedles) {
        if (labelNeedles == null || labelNeedles.length == 0) return null;
        PackageManager packageManager = getPackageManager();
        Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
        mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = packageManager.queryIntentActivities(mainIntent, 0);
        for (int i = 0; i < apps.size(); i++) {
            ResolveInfo info = apps.get(i);
            String label = String.valueOf(info.loadLabel(packageManager)).toLowerCase(Locale.ROOT);
            String packageName = info.activityInfo == null ? "" : String.valueOf(info.activityInfo.packageName).toLowerCase(Locale.ROOT);
            String activityName = info.activityInfo == null ? "" : String.valueOf(info.activityInfo.name).toLowerCase(Locale.ROOT);
            String haystack = label + " " + packageName + " " + activityName;
            for (int n = 0; n < labelNeedles.length; n++) {
                String needle = labelNeedles[n] == null ? "" : labelNeedles[n].toLowerCase(Locale.ROOT);
                if (needle.length() > 0 && haystack.contains(needle)) {
                    Intent launch = packageManager.getLaunchIntentForPackage(info.activityInfo.packageName);
                    if (launch != null) return launch;
                    Intent direct = new Intent(Intent.ACTION_MAIN);
                    direct.addCategory(Intent.CATEGORY_LAUNCHER);
                    direct.setClassName(info.activityInfo.packageName, info.activityInfo.name);
                    return direct;
                }
            }
        }
        return null;
    }

    void openExternalApp(String[] packageNames, String fallbackUri, String appName) {
        try {
            for (int i = 0; i < packageNames.length; i++) {
                Intent launch = getPackageManager().getLaunchIntentForPackage(packageNames[i]);
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launch);
                    return;
                }
            }
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUri));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (view.resolveActivity(getPackageManager()) != null) {
                startActivity(view);
                return;
            }
            toast("当前平板未检测到" + appName + "。请确认已安装并允许从桌面正常打开。");
        } catch (Exception error) {
            toast("无法打开" + appName + "：" + error.getMessage());
        }
    }

    void copyConsultPrompt() {
        if (selectedStudent == null) {
            toast("请先选择学生。");
            return;
        }
        copyPlainText("consult-prompt", "我是" + selectedStudent.name + "的家长，想咨询：");
        toast("已复制咨询提示。");
    }

    void copyDigestPrompt() {
        if (selectedStudent == null) {
            toast("请先选择学生。");
            return;
        }
        copyPlainText("digest-prompt", "/消化" + selectedStudent.name + "原始资料库中的新资料");
        toast("已复制消化提示。");
    }

    void copyPlainText(String label, String text) {
        ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (manager != null) {
            manager.setPrimaryClip(ClipData.newPlainText(label, text));
        }
    }

    void openUserAgreement() {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(USER_AGREEMENT_URL));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception error) {
            copyPlainText("user-agreement", USER_AGREEMENT_URL);
            toast("已复制用户协议链接。");
        }
    }

    void openPrivacyPolicy() {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY_POLICY_URL));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception error) {
            copyPlainText("privacy-policy", PRIVACY_POLICY_URL);
            toast("已复制隐私政策链接。");
        }
    }

    void checkForUpdate() {
        status("正在检查平板终端更新...");
        if (settingsStatusText != null) settingsStatusText.setText("正在检查平板终端更新...");
        toast("正在检查更新...");
        new Thread(new TabletUpdateCheckTask(this)).start();
    }

    void openUrl(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception error) {
            toast("无法打开下载地址：" + error.getMessage());
        }
    }

    File updateApkFile() {
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = getCacheDir();
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "AI-edu-manager-tablet-terminal-update.apk");
    }

    void installDownloadedApk(File apkFile, String fallbackUrl) {
        if (apkFile == null || !apkFile.exists() || apkFile.length() == 0) {
            status("APK 下载文件不存在，正在打开下载页面。");
            openUrl(fallbackUrl);
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                toast("请允许本应用安装未知应用，然后再次点击检查更新。");
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(settings);
                return;
            }
            Uri uri = Uri.parse("content://" + APK_PROVIDER_AUTHORITY + "/" + Uri.encode(apkFile.getName()));
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
            status("APK 已下载完成，请在系统安装界面确认更新。");
        } catch (Exception error) {
            status("调起系统安装失败，正在打开下载页面：" + error.getMessage());
            openUrl(fallbackUrl);
        }
    }

    void copyDiagnostics() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        StringBuilder builder = new StringBuilder();
        builder.append("AI教育管家平板终端诊断\n");
        builder.append("version=").append(VERSION_NAME).append(" code=").append(VERSION_CODE).append("\n");
        builder.append("serverUrl=").append(serverInput.getText().toString().trim()).append("\n");
        builder.append("remoteUrl=").append(remoteInput.getText().toString().trim()).append("\n");
        builder.append("connectionMode=").append(connectionModeSpinner.getSelectedItemPosition()).append("\n");
        builder.append("lastConnectedAt=").append(prefs.getString(PREF_LAST_CONNECTED_AT, "")).append("\n");
        builder.append("student=").append(selectedStudent == null ? "" : selectedStudent.name).append("\n");
        builder.append("cachedStudents=").append(students.size()).append("\n");
        builder.append("failedUploads=").append(failedUploadUris.size()).append("\n");
        builder.append("status=").append(statusText.getText()).append("\n");
        copyPlainText("tablet-diagnostics", builder.toString());
        toast("已复制诊断信息。");
    }

    String displayName(Uri uri) {
        if (uri != null && "file".equalsIgnoreCase(uri.getScheme())) {
            File file = new File(uri.getPath());
            return file.getName().replaceAll("[\\\\/:*?\"<>|]", "_");
        }
        String name = null;
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        if (name == null || name.trim().length() == 0) {
            String path = uri.getLastPathSegment();
            name = path == null ? "tablet-material" : path;
        }
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    String encode(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
    }

    String connectionErrorMessage(String url, String detail) {
        String safeDetail = detail == null ? "未知错误" : detail;
        String state = connectionFailureState(safeDetail);
        String message = state + "：" + safeDetail;
        if ("授权失效".equals(state)) {
            message += "\n主机已经连通，但设备凭据被拒绝。请在 Windows 主机端重新绑定当前设备。";
        } else if ("连接超时".equals(state) || "主机地址不可达".equals(state) || "端口连接被拒绝".equals(state)) {
            message += "\n请确认 Windows 主机服务正在运行，并检查当前主机地址。若 Tailscale 地址已经变化，可复制 Windows 最新连接信息后点击“刷新主机地址”，原有授权会保留。";
        }
        return message;
    }

    String connectionFailureState(String detail) {
        String lower = detail == null ? "" : detail.toLowerCase(Locale.ROOT);
        if (lower.contains("http 401") || lower.contains("http 403") || lower.contains("unauthorized") || lower.contains("forbidden") || lower.contains("token")) return "授权失效";
        if (lower.contains("timed out") || lower.contains("timeout") || lower.contains("after 8000ms")) return "连接超时";
        if (lower.contains("refused") || lower.contains("econnrefused")) return "端口连接被拒绝";
        if (lower.contains("failed to connect") || lower.contains("unreachable") || lower.contains("unknown host") || lower.contains("unable to resolve")) return "主机地址不可达";
        return "连接失败";
    }

    String connectionChannelLabel(String url) {
        if (isTailscaleServerUrl(url)) return serverHost(url).endsWith(".ts.net") ? "Tailscale 智能地址" : "Tailscale";
        if (isLanServerUrl(url)) return "局域网";
        return "远程网络";
    }

    void applyStudents(List<Student> result, List<LearningProject> projectResult, String error, boolean requiresApproval) {
        if (error != null) {
            status("读取学生失败：" + error);
            updateConnectionSummary(connectionFailureState(error), students.size());
            return;
        }
        students.clear();
        students.addAll(result);
        projects.clear();
        if (projectResult != null) projects.addAll(projectResult);
        studentAdapter.clear();
        for (int i = 0; i < students.size(); i++) studentAdapter.add(students.get(i).displayName());
        studentAdapter.notifyDataSetChanged();
        int selectedIndex = studentSpinner.getSelectedItemPosition();
        if (selectedIndex < 0 || selectedIndex >= students.size()) selectedIndex = 0;
        selectedStudent = students.size() > 0 ? students.get(selectedIndex) : null;
        if (uploadButton != null) uploadButton.setEnabled(false);
        updateStudentSessionUi();
        updateSharedUploadButton();
        updateDigestStatusCard();
        updateContactCard();
        refreshArchiveSources();
        loadCourses();
        updateConnectionSummary(requiresApproval ? "已连接，待 Windows 授权" : "已连接", students.size());
        status(requiresApproval
            ? "设备已登记，正在等待 Windows 主机授权学生；授权后会自动载入。"
            : (students.size() > 0 ? "已读取 " + students.size() + " 个学生。" : "主机服务中还没有学生。"));
        if (requiresApproval && students.size() == 0 && authorizationPollsRemaining > 0) {
            scheduleAuthorizationPolling();
        } else {
            authorizationPollsRemaining = 0;
        }
        resumeProjectMaterialUploadQueue();
        refreshCollectionInboxUi();
    }

    void loadCourses() {
        courses.clear();
        renderCourses();
        if (selectedStudent == null) {
            if (courseStatusText != null) courseStatusText.setText("请先进入学生空间。");
            return;
        }
        final String base = normalizedBaseUrl();
        final String studentId = selectedStudent.id;
        final String token = dataToken();
        if (base.length() == 0 || token.length() == 0) {
            if (courseStatusText != null) courseStatusText.setText("连接并授权主机后读取课程。");
            return;
        }
        if (courseStatusText != null) courseStatusText.setText("正在读取当前学生的课程目录…");
        new Thread(new Runnable() {
            @Override public void run() {
                JSONObject payload = null;
                String error = null;
                try {
                    payload = getJson(base + "/api/students/" + encode(studentId) + "/courses", token);
                } catch (Exception failure) {
                    error = failure.getMessage();
                }
                final JSONObject result = payload;
                final String message = error;
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        applyCourses(result, message, studentId);
                    }
                });
            }
        }).start();
    }

    void applyCourses(JSONObject payload, String error, String expectedStudentId) {
        if (selectedStudent == null || !selectedStudent.id.equals(expectedStudentId)) return;
        courses.clear();
        if (error != null) {
            courseStatusText.setText("课程目录读取失败：" + error);
            renderCourses();
            return;
        }
        if (!expectedStudentId.equals(payload == null ? "" : payload.optString("studentId", ""))) {
            courseStatusText.setText("课程目录学生范围不匹配，已停止展示。");
            renderCourses();
            return;
        }
        JSONArray array = payload.optJSONArray("courses");
        if (array != null) {
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item == null) continue;
                Course course = new Course(item);
                if (course.isSafe()) courses.add(course);
            }
        }
        courseStatusText.setText(courses.isEmpty()
            ? "当前学生没有已启用且已分配的课程。"
            : "目录版本 " + payload.optString("catalogVersion", "") + " · " + courses.size() + " 门课程");
        renderCourses();
    }

    void renderCourses() {
        if (courseListContainer == null) return;
        courseListContainer.removeAllViews();
        if (courses.isEmpty()) return;
        for (final Course course : courses) {
            LinearLayout item = card();
            item.setPadding(dp(12), dp(12), dp(12), dp(12));
            boolean phoneLayout = isPhoneLayout();
            LinearLayout body = new LinearLayout(this);
            body.setOrientation(phoneLayout ? LinearLayout.VERTICAL : LinearLayout.HORIZONTAL);
            body.setGravity(Gravity.TOP);
            ImageView cover = new ImageView(this);
            cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
            cover.setAdjustViewBounds(true);
            cover.setBackgroundColor(Color.rgb(235, 242, 240));
            LinearLayout.LayoutParams coverParams = phoneLayout
                ? new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(168))
                : new LinearLayout.LayoutParams(dp(112), dp(74));
            coverParams.setMargins(0, 0, phoneLayout ? 0 : dp(12), phoneLayout ? dp(10) : 0);
            body.addView(cover, coverParams);
            LinearLayout copy = stack();
            TextView title = label(course.name + " · " + course.provider);
            title.setTextSize(16);
            copy.addView(title);
            TextView summary = label(course.summary);
            summary.setTextSize(13);
            copy.addView(summary);
            LinearLayout.LayoutParams copyParams = phoneLayout
                ? new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                : new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            body.addView(copy, copyParams);
            item.addView(body);
            TextView boundary = label(course.accountRequirement + "\n" + course.legalNotice);
            boundary.setTextSize(12);
            boundary.setTextColor(Color.rgb(87, 107, 103));
            boundary.setPadding(0, dp(8), 0, dp(8));
            item.addView(boundary);
            Button open = button("安全打开课程", true);
            open.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) {
                    openCourseBrowser(course);
                }
            });
            LinearLayout action = row();
            action.addView(open);
            item.addView(action);
            courseListContainer.addView(item);
            loadCourseCover(course, cover);
        }
    }

    void loadCourseCover(final Course course, final ImageView cover) {
        if (course.coverUrl.length() == 0) return;
        final String url = normalizedBaseUrl() + course.coverUrl;
        final String token = dataToken();
        new Thread(new Runnable() {
            @Override public void run() {
                Bitmap bitmap = null;
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setConnectTimeout(5000);
                    connection.setReadTimeout(8000);
                    if (token.length() > 0) connection.setRequestProperty("Authorization", "Bearer " + token);
                    bitmap = BitmapFactory.decodeStream(connection.getInputStream());
                } catch (Exception ignored) {
                } finally {
                    if (connection != null) connection.disconnect();
                }
                final Bitmap loaded = bitmap;
                if (loaded != null) runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (courses.contains(course)) cover.setImageBitmap(loaded);
                    }
                });
            }
        }).start();
    }

    void applyArchiveFiles(String studentId, long requestGeneration, List<ArchiveFile> result, String error) {
        if (requestGeneration != archiveRequestGeneration || showingProjectKnowledge
            || selectedStudent == null || !selectedStudent.id.equals(studentId)) return;
        if (error != null) {
            if (selectedStudent != null) {
                List<ArchiveFile> cached = readCachedArchiveFiles(selectedStudent.id);
                if (cached.size() > 0) {
                    allArchiveFiles.clear();
                    allArchiveFiles.addAll(cached);
                    applyArchiveCategoryFilter();
                    archiveTitle.setText("已显示离线缓存档案");
                    status("档案刷新失败，已显示最近缓存：" + error);
                    return;
                }
            }
            archiveTitle.setText("档案读取失败");
            currentMarkdown = "";
            updateMarkdownDisplay(error);
            allArchiveFiles.clear();
            archiveFiles.clear();
            renderArchiveFileList();
            return;
        }
        allArchiveFiles.clear();
        allArchiveFiles.addAll(result);
        if (selectedStudent != null) cacheArchiveFiles(selectedStudent.id, result);
        applyArchiveCategoryFilter();
        if (selectedStudent != null) status("档案已同步：" + archiveListCacheTimeText(selectedStudent.id));
    }

    void applyProjectKnowledgeFiles(String studentId, String projectId, String projectName, long requestGeneration, List<ArchiveFile> result, String error) {
        if (requestGeneration != archiveRequestGeneration || !showingProjectKnowledge || !projectId.equals(selectedKnowledgeProjectId)
            || selectedStudent == null || !selectedStudent.id.equals(studentId)) return;
        if (error != null) {
            archiveTitle.setText("项目知识读取失败");
            currentMarkdown = "";
            updateMarkdownDisplay("读取“" + projectName + "”项目知识失败：" + error);
            allArchiveFiles.clear();
            archiveFiles.clear();
            renderArchiveFileList();
            return;
        }
        allArchiveFiles.clear();
        allArchiveFiles.addAll(result);
        applyArchiveCategoryFilter();
        archiveTitle.setText(result.size() > 0 ? "请选择“" + projectName + "”中的知识文件。" : "“" + projectName + "”暂无可查看的知识文件。");
        status("已读取“" + projectName + "”项目知识：" + result.size() + " 份。");
    }

    void applyArchiveCategoryFilter() {
        archiveFiles.clear();
        String keyword = archiveSearchInput == null ? "" : archiveSearchInput.getText().toString().trim().toLowerCase(Locale.ROOT);
        for (int i = 0; i < allArchiveFiles.size(); i++) {
            ArchiveFile file = allArchiveFiles.get(i);
            String haystack = ((file.path == null ? "" : file.path) + "/" + (file.name == null ? "" : file.name)).toLowerCase(Locale.ROOT);
            if ((selectedArchiveCategory == 4 || selectedArchiveCategory == classifyArchiveFile(file)) && (keyword.length() == 0 || haystack.contains(keyword))) {
                archiveFiles.add(file);
            }
        }
        renderArchiveFileList();
        archiveTitle.setText(archiveFiles.size() > 0
            ? (showingProjectKnowledge ? "请选择“" + selectedKnowledgeProjectName + "”中的知识文件。" : "请选择档案。")
            : (showingProjectKnowledge ? "当前项目暂无匹配的知识文件。" : "暂无 Markdown 档案。"));
        if (archiveFiles.size() == 0) {
            String emptyMessage = allArchiveFiles.size() == 0
                ? (showingProjectKnowledge ? "当前关联项目还没有可查看的 Markdown 知识。" : "Windows 主机中还没有该学生的学情分析 Markdown。")
                : "该分类下暂无 Markdown 文档。";
            updateMarkdownDisplay(emptyMessage);
            currentMarkdown = "";
        }
    }

    void renderArchiveFileList() {
        if (archiveAdapter == null) return;
        archiveAdapter.clear();
        if (archiveFiles.size() == 0) {
            String emptyText = allArchiveFiles.size() == 0
                ? (showingProjectKnowledge ? "暂无项目知识。" : "\u6682\u65e0 Markdown \u6863\u6848\u3002")
                : "\u8be5\u5206\u7c7b\u4e0b\u6682\u65e0 Markdown \u6587\u6863\u3002";
            archiveAdapter.add(emptyText);
            archiveAdapter.notifyDataSetChanged();
            updateMarkdownDisplay(emptyText);
            return;
        }
        for (int i = 0; i < archiveFiles.size(); i++) {
            archiveAdapter.add(fileListLabel(archiveFiles.get(i)));
        }
        archiveAdapter.notifyDataSetChanged();
    }

    String fileListLabel(ArchiveFile file) {
        String name = file.name == null || file.name.length() == 0 ? "Markdown" : file.name;
        String path = file.path == null ? "" : file.path;
        StringBuilder builder = new StringBuilder(name);
        if (path.length() > 0 && !path.equals(name)) builder.append("\n").append(path);
        return builder.toString();
    }

    int classifyArchiveFile(ArchiveFile file) {
        String name = file.name == null ? "" : file.name.toLowerCase(Locale.ROOT);
        if ("index.md".equals(name)) return 3;
        String haystack = ((file.path == null ? "" : file.path) + "/" + name).toLowerCase(Locale.ROOT);
        if (haystack.contains("摘要库") || haystack.contains("摘要") || haystack.contains("summary") || haystack.contains("digest")) return 0;
        if (haystack.contains("咨询精华库") || haystack.contains("问答") || haystack.contains("qa") || haystack.contains("q&a") || haystack.contains("对话") || haystack.contains("咨询") || haystack.contains("精华")) return 2;
        if (haystack.contains("综合库") || haystack.contains("综合") || haystack.contains("学情") || haystack.contains("汇总") || haystack.contains("分析") || haystack.contains("report") || haystack.contains("overview") || haystack.contains("总览") || haystack.contains("周报") || haystack.contains("月报") || haystack.contains("阶段")) return 1;
        return 3;
    }

    void applyMarkdown(String title, String content, String error, String studentId, String path) {
        archiveTitle.setText(title);
        if (error != null) {
            String lookupStudentId = studentId == null || studentId.length() == 0 ? (selectedStudent == null ? "" : selectedStudent.id) : studentId;
            String cached = lookupStudentId.length() == 0 || path == null || path.length() == 0 ? "" : cachedMarkdown(lookupStudentId, path);
            if (cached != null && cached.length() > 0) {
                currentMarkdown = cached;
                updateMarkdownDisplay(cached);
                String cacheTime = cacheTimeText(lookupStudentId, path);
                archiveTitle.setText(title + "（离线缓存" + (cacheTime.length() > 0 ? "：" + cacheTime : "") + "）");
                status("正文读取失败，已显示最近缓存：" + error);
            } else {
                markdownView.setText("读取失败：" + error);
                currentMarkdown = "";
                updateMarkdownDisplay("读取失败：" + error);
            }
        } else {
            currentMarkdown = content;
            updateMarkdownDisplay(content.length() == 0 ? "该 Markdown 文件为空。" : content);
            markdownView.setText(content.length() == 0 ? "该 Markdown 文件为空。" : content);
            updateMarkdownDisplay(content.length() == 0 ? "该 Markdown 文件为空。" : content);
            if (studentId != null && path != null) {
                String cacheTime = cacheTimeText(studentId, path);
                if (cacheTime.length() > 0) archiveTitle.setText(title + "（缓存：" + cacheTime + "）");
            }
        }
    }

    void showReadOnlyDetailDialog(String title, String metadata, String content) {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(8), dp(20), dp(16));
        if (metadata != null && metadata.length() > 0) {
            TextView meta = new TextView(this);
            meta.setText(metadata);
            meta.setTextSize(12);
            meta.setTextColor(Color.rgb(87, 107, 103));
            meta.setPadding(0, 0, 0, dp(10));
            panel.addView(meta);
        }
        TextView body = new TextView(this);
        body.setText(content == null || content.length() == 0 ? "暂无内容。" : content);
        body.setTextSize(16);
        body.setTextColor(Color.rgb(35, 61, 58));
        body.setTextIsSelectable(true);
        panel.addView(body);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(panel);
        new AlertDialog.Builder(this).setTitle(title).setView(scroll).setPositiveButton("关闭", null).show();
    }

    void applyLearningReport(String title, String content, String error, String studentId, String path, String statusValue, String updatedAt) {
        String body = content == null ? "" : content;
        boolean cached = false;
        if (error != null) {
            body = cachedMarkdown(studentId, path);
            cached = body != null && body.length() > 0;
            if (!cached) { showReadOnlyDetailDialog(title, "读取失败", "读取失败：" + error); status("学情报告读取失败：" + error); return; }
        } else {
            cacheMarkdown(studentId, new ArchiveFile(title, path, "student", studentId, ""), body);
        }
        String statusLabel = "published".equals(statusValue) ? "已发布" : (statusValue == null || statusValue.length() == 0 ? "状态未标注" : statusValue);
        String metadata = (cached ? "离线缓存" : statusLabel) + (updatedAt == null || updatedAt.length() == 0 ? "" : " · 更新 " + updatedAt);
        showReadOnlyDetailDialog(title, metadata, body);
        status(cached ? "正文读取失败，已显示最近离线缓存。" : title + "已打开。");
    }

    void updateMarkdownDisplay(String markdown) {
        String value = markdown == null ? "" : markdown;
        if (markdownView != null) {
            markdownView.setText(value);
            markdownView.setTextSize(markdownFontSize);
            markdownView.setVisibility(markdownRendered ? View.GONE : View.VISIBLE);
        }
        if (markdownWebView != null) {
            markdownWebView.setVisibility(markdownRendered ? View.VISIBLE : View.GONE);
            if (markdownRendered) {
                markdownWebView.loadDataWithBaseURL(
                    "https://local.edu-manager/",
                    markdownHtml(value),
                    "text/html",
                    "UTF-8",
                    null
                );
            }
        }
        if (markdownModeButton != null) markdownModeButton.setText(markdownRendered ? "查看原文" : "阅读模式");
    }

    String markdownHtml(String markdown) {
        StringBuilder body = new StringBuilder();
        String[] lines = markdown.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
        boolean inCode = false;
        boolean inList = false;
        boolean inTable = false;
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.trim();
            if (trimmed.startsWith("```")) {
                if (inTable) {
                    body.append("</tbody></table></div>");
                    inTable = false;
                }
                if (inList) {
                    body.append("</ul>");
                    inList = false;
                }
                if (inCode) body.append("</code></pre>");
                else body.append("<pre><code>");
                inCode = !inCode;
                continue;
            }
            if (inCode) {
                body.append(escapeHtml(line)).append('\n');
                continue;
            }
            if (trimmed.length() == 0) {
                if (inTable) {
                    body.append("</tbody></table></div>");
                    inTable = false;
                }
                if (inList) {
                    body.append("</ul>");
                    inList = false;
                }
                body.append("<div class=\"space\"></div>");
                continue;
            }
            if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
                if (inList) {
                    body.append("</ul>");
                    inList = false;
                }
                if (!inTable) {
                    body.append("<div class=\"table-wrap\"><table><tbody>");
                    inTable = true;
                }
                String[] cells = trimmed.substring(1, trimmed.length() - 1).split("\\|", -1);
                boolean separator = true;
                for (int c = 0; c < cells.length; c++) {
                    if (!cells[c].trim().matches(":?-{3,}:?")) separator = false;
                }
                if (!separator) {
                    body.append("<tr>");
                    for (int c = 0; c < cells.length; c++) {
                        String tag = i > 0 && lines[i - 1].trim().startsWith("|") && lines[i - 1].trim().endsWith("|") ? "td" : "th";
                        body.append('<').append(tag).append('>').append(inlineMarkdown(cells[c].trim())).append("</").append(tag).append('>');
                    }
                    body.append("</tr>");
                }
                continue;
            }
            if (inTable) {
                body.append("</tbody></table></div>");
                inTable = false;
            }
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) {
                if (!inList) {
                    body.append("<ul>");
                    inList = true;
                }
                body.append("<li>").append(inlineMarkdown(trimmed.substring(2))).append("</li>");
                continue;
            }
            if (inList) {
                body.append("</ul>");
                inList = false;
            }
            if (trimmed.startsWith("### ")) body.append("<h3>").append(inlineMarkdown(trimmed.substring(4))).append("</h3>");
            else if (trimmed.startsWith("## ")) body.append("<h2>").append(inlineMarkdown(trimmed.substring(3))).append("</h2>");
            else if (trimmed.startsWith("# ")) body.append("<h1>").append(inlineMarkdown(trimmed.substring(2))).append("</h1>");
            else if (trimmed.startsWith("> ")) body.append("<blockquote>").append(inlineMarkdown(trimmed.substring(2))).append("</blockquote>");
            else if (trimmed.matches("-{3,}|\\*{3,}|_{3,}")) body.append("<hr>");
            else body.append("<p>").append(inlineMarkdown(line)).append("</p>");
        }
        if (inCode) body.append("</code></pre>");
        if (inList) body.append("</ul>");
        if (inTable) body.append("</tbody></table></div>");
        return "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
            + "body{margin:0;padding:14px 14px 34px;background:#fff;color:#21312f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:" + markdownFontSize + "px;line-height:1.78;}"
            + "h1,h2,h3{color:#0f766e;margin:16px 0 8px;line-height:1.32;}h1{font-size:1.7em;}h2{font-size:1.35em;}h3{font-size:1.13em;}p{margin:0 0 10px;}a{color:#0f766e;font-weight:700;}strong{font-weight:800;}em{color:#3c5652;}"
            + "blockquote{margin:10px 0;padding:10px 12px;border-left:4px solid #7dd3c7;border-radius:10px;background:#eefaf7;color:#49605c;}ul{margin:0 0 12px;padding-left:24px;}li{margin:5px 0;}"
            + "code{padding:2px 5px;border-radius:6px;background:#e9f4f0;color:#0f5f54;font-family:monospace;}pre{overflow-x:auto;margin:10px 0;padding:12px;border-radius:12px;background:#10201f;color:#e8fff8;}pre code{padding:0;background:transparent;color:inherit;white-space:pre;}"
            + ".table-wrap{overflow-x:auto;margin:12px 0;}table{min-width:560px;width:100%;border-collapse:collapse;font-size:.92em;}th,td{border:1px solid #d7e7e2;padding:8px;text-align:left;vertical-align:top;}th{background:#edf8f4;color:#0f766e;}hr{border:0;border-top:1px solid #d7e7e2;margin:14px 0;}.space{height:8px;}"
            + "</style></head><body>" + body.toString() + "</body></html>";
    }

    String inlineMarkdown(String text) {
        String value = escapeHtml(text);
        value = value.replaceAll("`([^`]+)`", "<code>$1</code>");
        value = value.replaceAll("\\*\\*([^*]+)\\*\\*", "<strong>$1</strong>");
        value = value.replaceAll("\\*([^*]+)\\*", "<em>$1</em>");
        value = value.replaceAll("\\[([^\\]]+)\\]\\((https?://[^)\\s]+)\\)", "<a href=\"$2\">$1</a>");
        return value;
    }

    String escapeHtml(String value) {
        if (value == null) return "";
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    }

    void status(String message) {
        statusText.setText(message);
        if (settingsStatusText != null && (message.contains("更新") || message.contains("版本") || message.contains("下载"))) {
            settingsStatusText.setText(message);
        }
    }

    void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private View buildCockpitStatusRibbon() {
        cockpitStatusText = new TextView(this);
        cockpitStatusText.setTextSize(14);
        cockpitStatusText.setTypeface(null, 1);
        cockpitStatusText.setTextColor(Color.rgb(18, 69, 72));
        cockpitStatusText.setPadding(dp(16), dp(12), dp(16), dp(12));
        cockpitStatusText.setBackground(roundedSolid(Color.rgb(224, 244, 241), dp(18), Color.rgb(167, 211, 204)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(14));
        cockpitStatusText.setLayoutParams(params);
        refreshCockpitStatus();
        return cockpitStatusText;
    }

    private LinearLayout workspacePage(String title, String description) {
        LinearLayout page = stack();
        TextView heading = new TextView(this);
        heading.setText(title);
        heading.setTextSize(isPhoneLayout() ? 24 : 28);
        heading.setTypeface(null, 1);
        heading.setTextColor(Color.rgb(13, 43, 57));
        page.addView(heading);
        TextView summary = label(description);
        summary.setTextSize(14);
        summary.setPadding(0, dp(5), 0, dp(14));
        page.addView(summary);
        return page;
    }

    private LinearLayout buildBottomNavigation() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding(dp(4), dp(5), dp(4), dp(5));
        bar.setBackgroundColor(Color.rgb(8, 48, 67));
        String[] labels = new String[] {"搜集上传", "主机连接", "教育档案", "学习行动"};
        final String[] ids = new String[] {"collection", "connection", "archive", "learning"};
        for (int i = 0; i < labels.length; i++) {
            final int index = i;
            Button item = navigationButton(labels[i], new View.OnClickListener() {
                @Override public void onClick(View view) { showWorkspace(ids[index]); }
            });
            item.setGravity(Gravity.CENTER);
            bar.addView(item, new LinearLayout.LayoutParams(0, dp(56), 1f));
        }
        return bar;
    }

    private void showWorkspace(String workspace) {
        if (workspace == null) workspace = "home";
        activeWorkspace = workspace;
        if (homePage != null) homePage.setVisibility("home".equals(workspace) ? View.VISIBLE : View.GONE);
        if (collectionPage != null) collectionPage.setVisibility("collection".equals(workspace) ? View.VISIBLE : View.GONE);
        if (connectionPage != null) connectionPage.setVisibility("connection".equals(workspace) ? View.VISIBLE : View.GONE);
        if (archivePage != null) archivePage.setVisibility("archive".equals(workspace) ? View.VISIBLE : View.GONE);
        if (learningActionPage != null) learningActionPage.setVisibility("learning".equals(workspace) ? View.VISIBLE : View.GONE);
        if (morePage != null) morePage.setVisibility("more".equals(workspace) ? View.VISIBLE : View.GONE);
        if (rootScroll != null) rootScroll.scrollTo(0, 0);
        if ("collection".equals(workspace)) refreshCollectionInboxUi();
        refreshCockpitStatus();
    }

    private void refreshCockpitStatus() {
        if (cockpitStatusText == null) return;
        String student = selectedStudent == null ? "未进入学生空间" : selectedStudent.name;
        String connection = connectedHostId().length() == 0 ? "主机未连接" : "主机已连接";
        int pending = collectionReadyCount();
        cockpitStatusText.setText("学生  " + student + "    ·    " + connection + "    ·    待上传  " + pending);
        if (navigationStudentText != null) navigationStudentText.setText(student);
    }

    private LinearLayout buildNavigationRail() {
        LinearLayout rail = new LinearLayout(this);
        rail.setOrientation(LinearLayout.VERTICAL);
        rail.setPadding(dp(16), dp(22), dp(16), dp(18));
        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] {Color.rgb(8, 31, 66), Color.rgb(10, 48, 83)}
        );
        rail.setBackground(background);

        TextView brand = new TextView(this);
        brand.setText("AI 教育管家");
        brand.setTextColor(Color.WHITE);
        brand.setTextSize(22);
        brand.setTypeface(null, 1);
        brand.setPadding(dp(8), dp(4), dp(8), dp(4));
        rail.addView(brand);

        TextView edition = new TextView(this);
        edition.setText("安卓学生端  v" + VERSION_NAME);
        edition.setTextColor(Color.rgb(172, 206, 232));
        edition.setTextSize(12);
        edition.setPadding(dp(8), 0, dp(8), dp(18));
        rail.addView(edition);

        navigationStudentText = new TextView(this);
        navigationStudentText.setText("尚未进入学生空间");
        navigationStudentText.setTextColor(Color.WHITE);
        navigationStudentText.setTextSize(13);
        navigationStudentText.setMaxLines(2);
        navigationStudentText.setEllipsize(TextUtils.TruncateAt.END);
        navigationStudentText.setPadding(dp(12), dp(11), dp(12), dp(11));
        navigationStudentText.setBackground(roundedSolid(Color.rgb(25, 67, 108), dp(15), Color.rgb(57, 111, 157)));
        LinearLayout.LayoutParams studentParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        studentParams.setMargins(0, 0, 0, dp(18));
        rail.addView(navigationStudentText, studentParams);

        rail.addView(navigationButton("⌂  首页", new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("home"); }
        }));
        rail.addView(navigationButton("↑  搜集上传", new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("collection"); }
        }));
        rail.addView(navigationButton("⌁  主机连接", new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("connection"); }
        }));
        rail.addView(navigationButton("▤  教育档案", new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("archive"); }
        }));
        rail.addView(navigationButton("✓  学习行动", new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("learning"); }
        }));

        View spacer = new View(this);
        rail.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));
        rail.addView(navigationButton("•••  更多", new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("more"); }
        }));
        return rail;
    }

    private Button navigationButton(String text, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setTypeface(null, 1);
        button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        button.setPadding(dp(14), 0, dp(10), 0);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setBackgroundTintList(null);
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] {android.R.attr.state_pressed}, roundedSolid(Color.rgb(51, 105, 185), dp(14), Color.TRANSPARENT));
        states.addState(new int[] {android.R.attr.state_focused}, roundedSolid(Color.rgb(43, 94, 171), dp(14), Color.WHITE));
        states.addState(new int[] {}, roundedSolid(Color.TRANSPARENT, dp(14), Color.TRANSPARENT));
        button.setBackground(states);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        params.setMargins(0, 0, 0, dp(5));
        button.setLayoutParams(params);
        return button;
    }

    private LinearLayout buildStudentDashboard() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, 0, 0, dp(6));

        TextView eyebrow = new TextView(this);
        eyebrow.setText("今天从这里开始");
        eyebrow.setTextColor(accentColor());
        eyebrow.setTextSize(13);
        eyebrow.setTypeface(null, 1);
        section.addView(eyebrow);

        TextView heading = new TextView(this);
        heading.setText("我的学习空间");
        heading.setTextColor(Color.rgb(15, 32, 47));
        heading.setTextSize(isPhoneLayout() ? 24 : 28);
        heading.setTypeface(null, 1);
        heading.setPadding(0, dp(3), 0, dp(12));
        section.addView(heading);

        final GridLayout grid = new GridLayout(this);
        final int columns = isPhoneLayout() && getResources().getConfiguration().screenWidthDp < 360 ? 1 : 2;
        grid.setColumnCount(columns);
        grid.setAlignmentMode(GridLayout.ALIGN_BOUNDS);
        grid.setUseDefaultMargins(false);

        quickUploadButton = addDashboardAction(grid, 0, columns, "↑", "搜集上传", "文件、图片、拍照、屏幕、粘贴与自动投递", Color.rgb(10, 110, 122), new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("collection"); }
        });
        addDashboardAction(grid, 1, columns, "⌁", "主机连接", "局域网发现、扫码绑定与连接状态", Color.rgb(14, 83, 118), new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("connection"); }
        });
        quickReportButton = addDashboardAction(grid, 2, columns, "▤", "教育档案", "报告、成长、档案、项目资料与规划指导", Color.rgb(25, 72, 108), new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("archive"); }
        });
        addDashboardAction(grid, 3, columns, "✓", "学习行动", "精选课程、学习卡片与知识点跟踪", Color.rgb(15, 119, 104), new View.OnClickListener() {
            @Override public void onClick(View view) { showWorkspace("learning"); }
        });
        section.addView(grid, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return section;
    }

    private Button addDashboardAction(GridLayout grid, int index, int columns, String icon, String title, String description, int color, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(icon + "   " + title + "\n" + description);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(isPhoneLayout() ? 15 : 16);
        button.setTypeface(null, 1);
        button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        button.setPadding(dp(18), dp(12), dp(16), dp(12));
        button.setMaxLines(3);
        button.setLineSpacing(dp(3), 1.05f);
        button.setContentDescription(title + "。" + description);
        button.setBackgroundTintList(null);
        button.setBackground(dashboardButtonBackground(color));
        button.setElevation(dp(4));
        button.setOnClickListener(listener);

        GridLayout.LayoutParams params = new GridLayout.LayoutParams(
            GridLayout.spec(index / columns),
            GridLayout.spec(index % columns, 1, 1f)
        );
        params.width = 0;
        params.height = dp(isPhoneLayout() ? 112 : 132);
        params.setMargins(dp(5), dp(5), dp(5), dp(5));
        grid.addView(button, params);
        return button;
    }

    private StateListDrawable dashboardButtonBackground(int color) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] {-android.R.attr.state_enabled}, roundedSolid(Color.rgb(178, 187, 194), dp(22), Color.TRANSPARENT));
        states.addState(new int[] {android.R.attr.state_pressed}, roundedGradient(mixColor(color, Color.BLACK, 0.10f), mixColor(color, Color.BLACK, 0.25f), Color.TRANSPARENT, false));
        states.addState(new int[] {android.R.attr.state_focused}, roundedSolid(mixColor(color, Color.WHITE, 0.05f), dp(22), Color.WHITE));
        states.addState(new int[] {}, roundedGradient(mixColor(color, Color.WHITE, 0.08f), mixColor(color, Color.BLACK, 0.08f), Color.TRANSPARENT, false));
        return states;
    }

    private GradientDrawable roundedSolid(int color, int radius, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        if (Color.alpha(stroke) > 0) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private void openPanelPath(String... titles) {
        String destination = "more";
        for (String title : titles) {
            if (title.contains("收集") || title.contains("采集") || title.contains("搜集") || title.contains("上传")) destination = "collection";
            else if (title.contains("连接") || title.contains("主机") || title.contains("学生空间") || title.contains("终端")) destination = "connection";
            else if (title.contains("档案") || title.contains("报告") || title.contains("成长模型") || title.contains("项目资料") || title.contains("规划指导")) destination = "archive";
            else if (title.contains("学习行动") || title.contains("精选课程") || title.contains("学习卡片") || title.contains("知识点")) destination = "learning";
        }
        showWorkspace(destination);
        View target = null;
        for (String title : titles) {
            LinearLayout body = panelBodies.get(title);
            Button toggle = panelToggles.get(title);
            if (body == null || toggle == null) continue;
            body.setVisibility(View.VISIBLE);
            toggle.setText(panelButtonText(true, title, panelDescription(toggle)));
            target = panelShells.get(title);
        }
        if (target != null) scrollToView(target);
    }

    private String panelDescription(Button toggle) {
        Object tag = toggle == null ? null : toggle.getTag();
        return tag == null ? "" : String.valueOf(tag);
    }

    private LinearLayout card() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(14), dp(14), dp(14), dp(14));
        layout.setBackground(cardBackground());
        layout.setElevation(dp(2));
        layout.setClipToOutline(true);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, 0, 0, dp(14));
        layout.setLayoutParams(params);
        return layout;
    }

    private LinearLayout stack() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        return layout;
    }

    private LinearLayout collapsiblePanel(String title, String description, View content) {
        LinearLayout shell = card();
        LinearLayout body = stack();
        if (description != null && description.trim().length() > 0) {
            TextView hint = label(description);
            hint.setTypeface(null, 0);
            hint.setTextColor(Color.rgb(87, 107, 103));
            body.addView(hint);
        }
        body.addView(content);
        body.setVisibility(View.GONE);

        Button toggle = button(title, true);
        toggle.setText(panelButtonText(false, title, description));
        toggle.setTextSize(isPhoneLayout() ? 15 : 16);
        toggle.setMaxLines(2);
        toggle.setEllipsize(TextUtils.TruncateAt.END);
        toggle.setLineSpacing(0, 1.08f);
        LinearLayout.LayoutParams toggleParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(isPhoneLayout() ? 78 : 74)
        );
        toggleParams.setMargins(0, 0, 0, dp(6));
        toggle.setLayoutParams(toggleParams);
        toggle.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        toggle.setPadding(dp(18), dp(8), dp(18), dp(8));
        toggle.setContentDescription(title + "。" + description);
        toggle.setTag(description == null ? "" : description);
        toggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                boolean expanding = body.getVisibility() != View.VISIBLE;
                body.setVisibility(expanding ? View.VISIBLE : View.GONE);
                toggle.setText(panelButtonText(expanding, title, description));
            }
        });
        shell.addView(toggle);
        shell.addView(body);
        panelBodies.put(title, body);
        panelToggles.put(title, toggle);
        panelShells.put(title, shell);
        return shell;
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(isPhoneLayout() ? LinearLayout.VERTICAL : LinearLayout.HORIZONTAL);
        layout.setPadding(0, dp(8), 0, 0);
        return layout;
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(14);
        view.setTypeface(null, 1);
        view.setTextColor(Color.rgb(33, 49, 47));
        view.setPadding(0, dp(6), 0, dp(4));
        return view;
    }

    private EditText input(String hint) {
        EditText editText = new EditText(this);
        editText.setSingleLine(true);
        editText.setTextSize(15);
        editText.setHint(hint);
        editText.setPadding(dp(10), 0, dp(10), 0);
        return editText;
    }

    private Button button(String text, boolean primary) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(buttonTextColors(primary));
        button.setTextSize(primary ? 15 : 14);
        button.setTypeface(null, primary ? 1 : 0);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(14), 0, dp(14), 0);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setBackgroundTintList(null);
        button.setBackground(buttonBackground(text, primary));
        button.setElevation(dp(primary ? 3 : 1));
        LinearLayout.LayoutParams params = isPhoneLayout()
            ? new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52))
            : new LinearLayout.LayoutParams(0, dp(54), 1);
        params.setMargins(0, 0, isPhoneLayout() ? 0 : dp(8), isPhoneLayout() ? dp(8) : 0);
        button.setLayoutParams(params);
        return button;
    }

    private String panelButtonText(boolean expanded, String title, String description) {
        String state = expanded ? "⌃" : "›";
        String detail = description == null ? "" : description.trim();
        return featureIcon(title) + "  " + title + "  " + state + (detail.length() == 0 ? "" : "\n    " + detail);
    }

    private String featureIcon(String title) {
        String value = title == null ? "" : title;
        if (value.contains("课程")) return "▶";
        if (value.contains("资料") || value.contains("上传") || value.contains("采集")) return "＋";
        if (value.contains("对话") || value.contains("咨询") || value.contains("Agent")) return "✦";
        if (value.contains("档案") || value.contains("报告") || value.contains("成长") || value.contains("知识")) return "▤";
        if (value.contains("连接") || value.contains("设置") || value.contains("登录") || value.contains("基础")) return "⚙";
        return "◆";
    }

    private StateListDrawable buttonBackground(String text, boolean primary) {
        int base = featureColor(text);
        StateListDrawable states = new StateListDrawable();
        states.addState(
            new int[] {-android.R.attr.state_enabled},
            roundedGradient(Color.rgb(232, 236, 238), Color.rgb(218, 224, 227), Color.rgb(207, 214, 217), false)
        );
        states.addState(
            new int[] {android.R.attr.state_pressed},
            primary
                ? roundedGradient(mixColor(base, Color.BLACK, 0.16f), mixColor(base, Color.BLACK, 0.28f), Color.TRANSPARENT, false)
                : roundedGradient(mixColor(base, Color.WHITE, 0.76f), mixColor(base, Color.WHITE, 0.66f), mixColor(base, Color.BLACK, 0.04f), true)
        );
        states.addState(
            new int[] {android.R.attr.state_focused},
            primary
                ? roundedGradient(mixColor(base, Color.WHITE, 0.08f), mixColor(base, Color.BLACK, 0.10f), Color.WHITE, true)
                : roundedGradient(Color.WHITE, mixColor(base, Color.WHITE, 0.84f), base, true)
        );
        states.addState(
            new int[] {},
            primary
                ? roundedGradient(mixColor(base, Color.WHITE, 0.12f), mixColor(base, Color.BLACK, 0.08f), Color.TRANSPARENT, false)
                : roundedGradient(Color.WHITE, mixColor(base, Color.WHITE, 0.88f), mixColor(base, Color.WHITE, 0.24f), true)
        );
        return states;
    }

    private ColorStateList buttonTextColors(boolean primary) {
        int normal = primary ? Color.WHITE : accentColor();
        return new ColorStateList(
            new int[][] {
                new int[] {-android.R.attr.state_enabled},
                new int[] {android.R.attr.state_pressed},
                new int[] {}
            },
            new int[] {Color.rgb(105, 116, 120), normal, normal}
        );
    }

    private GradientDrawable roundedGradient(int start, int end, int stroke, boolean showStroke) {
        GradientDrawable drawable = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] {start, end});
        drawable.setCornerRadius(dp(18));
        if (showStroke) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private GradientDrawable cardBackground() {
        GradientDrawable drawable = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] {Color.argb(250, 255, 255, 255), Color.argb(242, 248, 252, 255)}
        );
        drawable.setCornerRadius(dp(22));
        drawable.setStroke(dp(1), Color.argb(54, Color.red(accentColor()), Color.green(accentColor()), Color.blue(accentColor())));
        return drawable;
    }

    private GradientDrawable heroBackground() {
        int base = accentColor();
        GradientDrawable drawable = new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            new int[] {mixColor(base, Color.WHITE, 0.82f), Color.argb(246, 255, 255, 255)}
        );
        drawable.setCornerRadius(dp(24));
        drawable.setStroke(dp(1), mixColor(base, Color.WHITE, 0.52f));
        return drawable;
    }

    private int featureColor(String text) {
        String value = text == null ? "" : text;
        if (value.contains("课程") || value.contains("学习")) return Color.rgb(39, 174, 108);
        if (value.contains("资料") || value.contains("上传") || value.contains("采集") || value.contains("文件")) return Color.rgb(18, 151, 196);
        if (value.contains("报告") || value.contains("成长") || value.contains("档案") || value.contains("知识")) return Color.rgb(126, 87, 194);
        if (value.contains("对话") || value.contains("咨询") || value.contains("Agent") || value.contains("QClaw") || value.contains("Mavis")) return Color.rgb(233, 116, 47);
        if (value.contains("连接") || value.contains("扫码") || value.contains("主机") || value.contains("设置")) return Color.rgb(37, 104, 194);
        return accentColor();
    }

    private boolean isPhoneLayout() {
        if (layoutMode == 1) return false;
        if (layoutMode == 2) return true;
        return screenWidthDp() < 720;
    }

    private boolean isWideLandscape() {
        if (layoutMode == 2) return false;
        Configuration configuration = getResources().getConfiguration();
        boolean landscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE;
        if (layoutMode == 1) landscape = true;
        return landscape && screenWidthDp() >= 840;
    }

    private int actionGridColumns() {
        int availableWidth = screenWidthDp() - (isWideLandscape() ? 224 : 0) - (isPhoneLayout() ? 24 : 36);
        if (availableWidth >= 900) return 3;
        if (availableWidth >= 600) return 2;
        return 1;
    }

    private int screenWidthDp() {
        Configuration configuration = getResources().getConfiguration();
        if (configuration.screenWidthDp > 0) return configuration.screenWidthDp;
        return Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
    }

    private int accentColor() {
        switch (skinIndex) {
            case 1: return Color.rgb(215, 52, 132);
            case 2: return Color.rgb(46, 150, 91);
            case 3: return Color.rgb(124, 76, 176);
            case 4: return Color.rgb(220, 116, 43);
            default: return Color.rgb(16, 111, 196);
        }
    }

    private int accentLightColor() {
        switch (skinIndex) {
            case 1: return Color.rgb(255, 232, 243);
            case 2: return Color.rgb(231, 248, 238);
            case 3: return Color.rgb(242, 233, 255);
            case 4: return Color.rgb(255, 240, 224);
            default: return Color.rgb(232, 244, 255);
        }
    }

    private int mixColor(int base, int overlay, float overlayWeight) {
        float weight = Math.max(0f, Math.min(1f, overlayWeight));
        float baseWeight = 1f - weight;
        return Color.rgb(
            Math.round(Color.red(base) * baseWeight + Color.red(overlay) * weight),
            Math.round(Color.green(base) * baseWeight + Color.green(overlay) * weight),
            Math.round(Color.blue(base) * baseWeight + Color.blue(overlay) * weight)
        );
    }

    private int pageBackgroundColor() {
        switch (skinIndex) {
            case 1: return Color.rgb(255, 247, 251);
            case 2: return Color.rgb(246, 252, 248);
            case 3: return Color.rgb(250, 247, 255);
            case 4: return Color.rgb(255, 249, 242);
            default: return Color.rgb(246, 250, 255);
        }
    }

    private int skinBackgroundResource() {
        switch (skinIndex) {
            case 1: return R.drawable.skin_pink;
            case 2: return R.drawable.skin_green;
            case 3: return R.drawable.skin_purple;
            case 4: return R.drawable.skin_orange;
            default: return R.drawable.skin_blue;
        }
    }

    private int clamp(int value, int min, int max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}

class Course {
    final String id;
    final String name;
    final String provider;
    final String url;
    final String coverUrl;
    final String summary;
    final String accountRequirement;
    final String legalNotice;
    final Set<String> allowedHosts = new HashSet<String>();
    String currentUrl;

    Course(JSONObject json) {
        this.id = json.optString("courseId", "");
        this.name = json.optString("name", id);
        this.provider = json.optString("provider", "");
        this.url = json.optString("url", "");
        this.currentUrl = this.url;
        this.coverUrl = json.optString("coverUrl", "");
        this.summary = json.optString("summary", "");
        this.accountRequirement = json.optString("accountRequirement", "账号与收费要求以课程提供方页面为准。");
        this.legalNotice = json.optString("legalNotice", "AI教育管家仅提供访问入口和用户主动发起的资料采集。");
        JSONArray hosts = json.optJSONArray("allowedHosts");
        if (hosts != null) {
            for (int i = 0; i < hosts.length(); i++) {
                String host = hosts.optString(i, "").trim().toLowerCase(Locale.US);
                if (host.length() > 0) allowedHosts.add(host);
            }
        }
    }

    boolean isSafe() {
        try {
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            return id.length() > 0
                && ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                && host != null
                && uri.getUserInfo() == null
                && allowedHosts.contains(host.toLowerCase(Locale.US));
        } catch (Exception ignored) {
            return false;
        }
    }
}

class Student {
    final String id;
    final String name;
    final String grade;
    final String remoteChannel;
    final String remoteContact;
    final String remoteNote;
    final String remoteBindingStatus;
    final String remoteBoundAt;
    final int rawFileCount;
    final long rawTotalBytes;
    final boolean fileStatsReady;
    final int archiveFileCount;
    final int pendingDigestCount;
    final int submittedDigestCount;
    final int processedDigestCount;
    final String lastDigestAt;
    final String digestStatus;
    final String digestMessage;
    final int submittedTodayCount;
    final int recentUploadCount7;
    final int recentUploadTrend;
    final int activeDays30;
    final int knowledgeAssetCount;
    final int newSinceLastDigestCount;

    Student(JSONObject json) {
        this.id = json.optString("id", json.optString("name", ""));
        this.name = json.optString("name", this.id);
        this.grade = json.optString("grade", "");
        this.remoteChannel = json.optString("remoteChannel", "none");
        this.remoteContact = json.optString("remoteContact", "");
        this.remoteNote = json.optString("remoteNote", "");
        this.remoteBindingStatus = json.optString("remoteBindingStatus", "unbound");
        this.remoteBoundAt = json.optString("remoteBoundAt", "");
        this.rawFileCount = json.optInt("rawFileCount", 0);
        this.rawTotalBytes = json.optLong("rawTotalBytes", 0L);
        this.fileStatsReady = json.optBoolean("fileStatsReady", false);
        this.archiveFileCount = json.optInt("archiveFileCount", 0);
        this.pendingDigestCount = json.optInt("pendingDigestCount", 0);
        this.submittedDigestCount = json.optInt("submittedDigestCount", 0);
        this.processedDigestCount = json.optInt("processedDigestCount", 0);
        this.lastDigestAt = json.optString("lastDigestAt", "");
        this.digestStatus = json.optString("digestStatus", "idle");
        this.digestMessage = json.optString("digestMessage", "");
        JSONObject progress = json.optJSONObject("progress");
        this.submittedTodayCount = progress == null ? json.optInt("submittedTodayCount", 0) : progress.optInt("submittedTodayCount", json.optInt("submittedTodayCount", 0));
        this.recentUploadCount7 = progress == null ? json.optInt("recentUploadCount7", 0) : progress.optInt("recentUploadCount7", json.optInt("recentUploadCount7", 0));
        this.recentUploadTrend = progress == null ? json.optInt("recentUploadTrend", 0) : progress.optInt("recentTrend", json.optInt("recentUploadTrend", 0));
        this.activeDays30 = progress == null ? json.optInt("activeDays30", 0) : progress.optInt("activeDays30", json.optInt("activeDays30", 0));
        this.knowledgeAssetCount = progress == null ? json.optInt("knowledgeAssetCount", this.processedDigestCount) : progress.optInt("knowledgeAssetCount", this.processedDigestCount);
        this.newSinceLastDigestCount = progress == null ? json.optInt("newSinceLastDigestCount", 0) : progress.optInt("newSinceLastDigestCount", json.optInt("newSinceLastDigestCount", 0));
    }

    String displayName() {
        if (System.currentTimeMillis() >= 0) {
            String base = grade.length() > 0 ? name + " · " + grade : name;
            int waiting = pendingDigestCount + submittedDigestCount;
            String digest = waiting > 0 ? " · 待整理 " + waiting : (lastDigestAt.length() > 0 ? " · 已整理" : " · 待上传");
            return base + digest + " · 档案 " + archiveFileCount;
        }
        String base = grade.length() > 0 ? name + " · " + grade : name;
        return base + " · 原始资料 " + rawFileCount + " · 档案 " + archiveFileCount;
    }
}

class NestedScrollTouchGuard implements View.OnTouchListener {
    private final ScrollView parent;

    NestedScrollTouchGuard(ScrollView parent) {
        this.parent = parent;
    }

    @Override
    public boolean onTouch(View view, MotionEvent event) {
        if (parent != null) {
            int action = event.getActionMasked();
            parent.requestDisallowInterceptTouchEvent(action != MotionEvent.ACTION_UP && action != MotionEvent.ACTION_CANCEL);
        }
        return false;
    }
}

class LearningProject {
    final String id;
    final String name;
    final String status;
    final String materialStorageMode;
    final String materialMigrationState;
    final JSONObject materialOperations;
    final List<String> studentIds = new ArrayList<String>();

    LearningProject(JSONObject json) {
        this.id = json.optString("id", "");
        this.name = json.optString("name", this.id);
        this.status = json.optString("status", "active");
        this.materialStorageMode = json.optString("materialStorageMode", "legacy");
        this.materialMigrationState = json.optString("materialMigrationState", "not_started");
        JSONObject capabilities = json.optJSONObject("materialCapabilities");
        JSONObject operations = capabilities == null ? null : capabilities.optJSONObject("operations");
        this.materialOperations = operations == null ? new JSONObject() : operations;
        JSONArray array = json.optJSONArray("studentIds");
        if (array != null) for (int i = 0; i < array.length(); i++) studentIds.add(array.optString(i, ""));
    }

    boolean supportsMaterialViews() {
        return "workspace-v1".equals(materialStorageMode) && materialOperations.optBoolean("list", false);
    }

    String migrationLabel() {
        if ("running".equals(materialMigrationState)) return " · 主机迁移中";
        if ("partial".equals(materialMigrationState)) return " · 部分统一";
        if ("attention".equals(materialMigrationState)) return " · 迁移待核对";
        return "";
    }

    ProjectMaterialsDialog.ProjectRef asMaterialProject() {
        return new ProjectMaterialsDialog.ProjectRef(id, name, status, materialStorageMode,
            materialMigrationState, materialOperations);
    }
}

class UploadTarget {
    final String type;
    final String id;
    final String name;
    final String studentId;

    UploadTarget(String type, String id, String name, String studentId) {
        this.type = type;
        this.id = id;
        this.name = name;
        this.studentId = studentId;
    }
}

class QueuedMaterialDescriptor {
    final String sourceType;
    final String attributionQuery;
    final String sourceReference;

    QueuedMaterialDescriptor(String sourceType, String attributionQuery, String sourceReference) {
        this.sourceType = sourceType;
        this.attributionQuery = attributionQuery;
        this.sourceReference = sourceReference;
    }
}

class ArchiveFile {
    final String name;
    final String path;
    final String sourceType;
    final String studentId;
    final String projectId;
    final long modified;

    ArchiveFile(JSONObject json) {
        this(json, json.optString("sourceType", "student"), json.optString("studentId", ""), json.optString("projectId", ""));
    }

    ArchiveFile(JSONObject json, String sourceType, String studentId, String projectId) {
        this.name = json.optString("name", json.optString("path", "Markdown"));
        this.path = json.optString("path", name);
        this.sourceType = sourceType == null ? "student" : sourceType;
        this.studentId = studentId == null ? "" : studentId;
        this.projectId = projectId == null ? "" : projectId;
        this.modified = json.optLong("modified", 0L);
    }

    ArchiveFile(String name, String path) {
        this(name, path, "student", "", "");
    }

    ArchiveFile(String name, String path, String sourceType, String studentId, String projectId) {
        this.name = name;
        this.path = path;
        this.sourceType = sourceType == null ? "student" : sourceType;
        this.studentId = studentId == null ? "" : studentId;
        this.projectId = projectId == null ? "" : projectId;
        this.modified = 0L;
    }
}

class DownloadEntry {
    final Uri uri;
    final String name;
    final long size;
    final long modified;
    final String type;

    DownloadEntry(Uri uri, String name, long size, long modified, String type) {
        this.uri = uri;
        this.name = name;
        this.size = size;
        this.modified = modified;
        this.type = type;
    }
}

class UploadOptionClickListener implements DialogInterface.OnClickListener {
    private final MainActivity activity;

    UploadOptionClickListener(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public void onClick(DialogInterface dialog, int which) {
        if (which == 0) activity.startPickFiles();
        else if (which == 1) activity.startPickImages();
        else if (which == 2) activity.startTakePhoto();
        else if (which == 3) activity.showDownloadsDialog();
        else activity.showCollectionManager();
    }
}

class DownloadsChoiceClickListener implements DialogInterface.OnMultiChoiceClickListener {
    private final boolean[] checked;

    DownloadsChoiceClickListener(boolean[] checked) {
        this.checked = checked;
    }

    @Override
    public void onClick(DialogInterface dialog, int which, boolean isChecked) {
        checked[which] = isChecked;
    }
}

class DownloadsUploadClickListener implements DialogInterface.OnClickListener {
    private final MainActivity activity;
    private final List<DownloadEntry> entries;
    private final boolean[] checked;

    DownloadsUploadClickListener(MainActivity activity, List<DownloadEntry> entries, boolean[] checked) {
        this.activity = activity;
        this.entries = entries;
        this.checked = checked;
    }

    @Override
    public void onClick(DialogInterface dialog, int which) {
        ArrayList<Uri> selected = new ArrayList<Uri>();
        for (int i = 0; i < entries.size(); i++) {
            if (checked[i]) selected.add(entries.get(i).uri);
        }
        if (selected.size() == 0) {
            activity.toast("请先选择要收集的文件。");
            return;
        }
        activity.collectMaterials(selected, "android_downloads_collection");
    }
}

class NearbyHost {
    final String name;
    final String version;
    final List<String> urls;
    final int protocolVersion;
    final String deviceId;
    final String machineCode;
    final String discoveryEndpoint;

    NearbyHost(String name, String version, List<String> urls, int protocolVersion, String deviceId, String machineCode, String discoveryEndpoint) {
        this.name = name == null || name.trim().length() == 0 ? "AI教育管家主机" : name.trim();
        this.version = version == null ? "" : version.trim();
        this.urls = urls == null ? new ArrayList<String>() : urls;
        this.protocolVersion = protocolVersion;
        this.deviceId = deviceId == null ? "" : deviceId.trim();
        this.machineCode = machineCode == null ? "" : machineCode.trim();
        this.discoveryEndpoint = discoveryEndpoint == null ? "" : discoveryEndpoint.trim();
    }

    String primaryUrl() {
        return urls.size() > 0 ? urls.get(0) : "";
    }
}

class NearbyHostDiscoveryTask implements Runnable {
    private final MainActivity activity;

    NearbyHostDiscoveryTask(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public void run() {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(350);
            JSONObject requestJson = new JSONObject();
            requestJson.put("type", MainActivity.HOST_DISCOVERY_REQUEST_V2);
            requestJson.put("protocolVersion", MainActivity.PAIR_PROTOCOL_VERSION);
            requestJson.put("requestId", "discover-" + java.util.UUID.randomUUID().toString());
            requestJson.put("searchRole", "host");
            byte[] requestBytes = requestJson.toString().getBytes("UTF-8");
            DatagramPacket request = new DatagramPacket(requestBytes, requestBytes.length, InetAddress.getByName("255.255.255.255"), MainActivity.HOST_DISCOVERY_PORT);
            socket.send(request);
            byte[] legacyBytes = MainActivity.HOST_DISCOVERY_REQUEST_V1.getBytes("UTF-8");
            socket.send(new DatagramPacket(legacyBytes, legacyBytes.length, InetAddress.getByName("255.255.255.255"), MainActivity.HOST_DISCOVERY_PORT));

            long deadline = System.currentTimeMillis() + 2600;
            ArrayList<NearbyHost> hosts = new ArrayList<NearbyHost>();
            while (System.currentTimeMillis() < deadline) {
                try {
                    byte[] buffer = new byte[8192];
                    DatagramPacket response = new DatagramPacket(buffer, buffer.length);
                    socket.receive(response);
                    String text = new String(response.getData(), 0, response.getLength(), "UTF-8");
                    JSONObject json = new JSONObject(text);
                    if (!"AI_EDU_MANAGER_DISCOVERY".equals(json.optString("type", ""))) continue;
                    int port = json.optInt("port", 18777);
                    ArrayList<String> urls = new ArrayList<String>();
                    urls.add("http://" + response.getAddress().getHostAddress() + ":" + port);
                    String serverUrl = json.optString("serverUrl", "");
                    if (serverUrl.length() > 0) urls.add(serverUrl);
                    JSONArray lanUrls = json.optJSONArray("lanUrls");
                    if (lanUrls != null) {
                        for (int i = 0; i < lanUrls.length(); i++) {
                            String url = lanUrls.optString(i, "");
                            if (url.length() > 0) urls.add(url);
                        }
                    }
                    List<String> ordered = activity.orderedServerUrls(urls);
                    int protocolVersion = json.optInt("protocolVersion", 1);
                    String hostDeviceId = json.optString("deviceId", "");
                    String hostMachineCode = json.optString("machineCode", "");
                    String discoveryEndpoint = response.getAddress().getHostAddress() + ":" + port;
                    NearbyHost incoming = new NearbyHost(
                        json.optString("displayName", json.optString("hostName", "AI教育管家主机")),
                        json.optString("appVersion", ""), ordered, protocolVersion, hostDeviceId, hostMachineCode,
                        discoveryEndpoint
                    );
                    int replaceAt = -1;
                    for (int i = hosts.size() - 1; i >= 0; i--) {
                        NearbyHost existing = hosts.get(i);
                        boolean sameEndpoint = discoveryEndpoint.equals(existing.discoveryEndpoint);
                        boolean sameIdentity = hostDeviceId.length() > 0
                            && existing.deviceId.length() > 0
                            && hostDeviceId.equals(existing.deviceId);
                        if (!sameEndpoint && !sameIdentity) continue;
                        if (replaceAt < 0 || i < replaceAt) replaceAt = i;
                        if (existing.protocolVersion > incoming.protocolVersion) incoming = existing;
                        hosts.remove(i);
                    }
                    if (replaceAt < 0 || replaceAt > hosts.size()) hosts.add(incoming);
                    else hosts.add(replaceAt, incoming);
                } catch (SocketTimeoutException ignored) {
                }
            }
            activity.runOnUiThread(new NearbyHostsResultTask(activity, hosts, null));
        } catch (Exception error) {
            activity.runOnUiThread(new NearbyHostsResultTask(activity, null, error.getMessage()));
        } finally {
            if (socket != null) socket.close();
        }
    }
}

class NearbyHostsResultTask implements Runnable {
    private final MainActivity activity;
    private final List<NearbyHost> hosts;
    private final String error;

    NearbyHostsResultTask(MainActivity activity, List<NearbyHost> hosts, String error) {
        this.activity = activity;
        this.hosts = hosts;
        this.error = error;
    }

    @Override public void run() {
        activity.showNearbyHosts(hosts, error);
    }
}

class ConnectTask implements Runnable {
    private final MainActivity activity;
    private final List<String> bases;

    ConnectTask(MainActivity activity, List<String> bases) {
        this.activity = activity;
        this.bases = bases == null ? new ArrayList<String>() : bases;
    }

    @Override
    public void run() {
        String lastBase = bases.size() > 0 ? bases.get(0) : "";
        String lastError = "没有可用主机地址";
        for (int i = 0; i < bases.size(); i++) {
            String base = bases.get(i);
            lastBase = base;
            final String attemptBase = base;
            final int attemptIndex = i;
            activity.runOnUiThread(new StatusTask(activity,
                "正在尝试" + activity.connectionChannelLabel(attemptBase) + "主机地址（" + (attemptIndex + 1) + "/" + bases.size() + "）..."));
            try {
                JSONObject health = activity.getJson(base + "/api/health", null);
                activity.rememberHostProtocolState(health);
                String token = activity.apiToken();
                if (token.length() == 0) throw new Exception("缺少设备授权信息，请重新粘贴 Windows 连接信息或扫码绑定。");
                JSONObject heartbeat = activity.postJson(base + "/api/device/heartbeat", new JSONObject(), token);
                JSONObject device = heartbeat.optJSONObject("device");
                boolean requiresApproval = false;
                if (device == null) {
                    JSONObject enrollBody = new JSONObject();
                    enrollBody.put("deviceId", activity.deviceId());
                    enrollBody.put("deviceName", activity.deviceName());
                    JSONObject enrollment = activity.postJson(base + "/api/device/enroll", enrollBody, token);
                    String deviceToken = enrollment.optString("token", "");
                    if (deviceToken.length() == 0) throw new Exception("主机未返回独立设备授权信息。");
                    token = deviceToken;
                    requiresApproval = enrollment.optBoolean("requiresApproval", true);
                    activity.saveDeviceCredentials(base, token);
                    activity.runOnUiThread(new ConnectionCredentialsTask(activity, base, token));
                } else {
                    requiresApproval = "pending".equals(device.optString("authorizationStatus", ""));
                }
                activity.markConnectedNow();
                activity.runOnUiThread(new ConnectionEndpointTask(activity, base));
                JSONObject license = health.optJSONObject("license");
                String licenseText = "主机未激活";
                if (license != null) {
                    String status = license.optString("status", "inactive");
                    if ("active".equals(status)) {
                        licenseText = "主机已激活：" + license.optString("planLabel", "已授权");
                    } else if ("expired".equals(status)) {
                        licenseText = "主机授权已过期";
                    }
                }
                String channel = activity.connectionChannelLabel(base);
                activity.runOnUiThread(new StatusTask(activity, requiresApproval
                    ? "已通过 " + channel + " 连接主机，设备已登记并等待 Windows 授权学生。"
                    : "已通过 " + channel + " 连接主机，版本：" + health.optString("version", "未知") + "；" + licenseText));
                activity.runOnUiThread(new ConnectionSummaryTask(activity, requiresApproval ? "已连接，待 Windows 授权" : "已连接", activity.students.size()));
                new BootstrapStudentSessionTask(activity, base, token, activity.studentSessionToken).run();
                return;
            } catch (Exception error) {
                lastError = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                if (i + 1 < bases.size()) {
                    final String nextBase = bases.get(i + 1);
                    activity.runOnUiThread(new StatusTask(activity,
                        activity.connectionChannelLabel(attemptBase) + "连接失败，正在自动尝试"
                            + activity.connectionChannelLabel(nextBase) + "..."));
                }
            }
        }
        activity.runOnUiThread(new StatusTask(activity, activity.connectionErrorMessage(lastBase, lastError)
            + (bases.size() > 1 ? "\n已自动尝试 " + bases.size() + " 个候选地址。" : "")));
        activity.runOnUiThread(new ConnectionSummaryTask(activity, activity.connectionFailureState(lastError), activity.students.size()));
    }
}

class ConnectionEndpointTask implements Runnable {
    private final MainActivity activity;
    private final String base;

    ConnectionEndpointTask(MainActivity activity, String base) {
        this.activity = activity;
        this.base = base;
    }

    @Override public void run() {
        activity.rememberSuccessfulEndpoint(base);
    }
}

class ConnectionCandidatesTask implements Runnable {
    private final MainActivity activity;
    private final List<String> candidates;

    ConnectionCandidatesTask(MainActivity activity, List<String> candidates) {
        this.activity = activity;
        this.candidates = candidates == null ? new ArrayList<String>() : candidates;
    }

    @Override public void run() {
        activity.rememberConnectionCandidates(candidates);
    }
}

class PairRequestV2Task implements Runnable {
    private final MainActivity activity;
    private final NearbyHost host;

    PairRequestV2Task(MainActivity activity, NearbyHost host) {
        this.activity = activity;
        this.host = host;
    }

    @Override public void run() {
        String base = host.primaryUrl();
        try {
            if (base.length() == 0) throw new Exception("没有可用主机地址");
            String requestId = "pair-" + java.util.UUID.randomUUID().toString();
            String requestToken = java.util.UUID.randomUUID().toString().replace("-", "")
                + java.util.UUID.randomUUID().toString().replace("-", "");
            JSONObject body = new JSONObject();
            body.put("requestId", requestId);
            body.put("requestToken", requestToken);
            body.put("hostId", host.deviceId);
            body.put("hostMachineCode", host.machineCode);
            body.put("tabletId", activity.deviceId());
            body.put("tabletMachineCode", activity.tabletMachineCode());
            body.put("tabletName", activity.deviceName());
            activity.postJson(base + "/api/pair/request", body);
            for (int attempt = 0; attempt < 30; attempt++) {
                Thread.sleep(4000);
                String query = base + "/api/pair/status?requestId=" + activity.encode(requestId)
                    + "&requestToken=" + activity.encode(requestToken);
                JSONObject status = activity.getJson(query, null);
                JSONObject request = status.optJSONObject("request");
                String state = request == null ? "" : request.optString("status", "");
                if ("accepted".equals(state)) {
                    String token = status.optString("token", "");
                    if (token.length() == 0) throw new Exception("主机已接受，但未返回设备授权凭据");
                    activity.runOnUiThread(new PairResultTask(activity, base, token, null));
                    return;
                }
                if ("rejected".equals(state) || "cancelled".equals(state) || "expired".equals(state)) {
                    throw new Exception("连接请求已" + ("rejected".equals(state) ? "被主机拒绝" : "结束或过期"));
                }
            }
            JSONObject cancelBody = new JSONObject();
            cancelBody.put("requestId", requestId);
            cancelBody.put("requestToken", requestToken);
            try { activity.postJson(base + "/api/pair/cancel", cancelBody); } catch (Exception ignored) {}
            throw new Exception("等待主机接受超时，请重新发起连接");
        } catch (Exception error) {
            activity.runOnUiThread(new PairResultTask(activity, base, "", error.getMessage()));
        }
    }
}

class PairInviteDecisionTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final JSONObject invite;
    private final boolean accepted;

    PairInviteDecisionTask(MainActivity activity, String base, JSONObject invite, boolean accepted) {
        this.activity = activity;
        this.base = base;
        this.invite = invite;
        this.accepted = accepted;
    }

    @Override public void run() {
        try {
            JSONObject body = new JSONObject();
            body.put("requestId", invite.optString("requestId", ""));
            body.put("requestToken", invite.optString("requestToken", ""));
            body.put("tabletId", activity.deviceId());
            body.put("tabletMachineCode", activity.tabletMachineCode());
            body.put("tabletName", activity.deviceName());
            if (!accepted) {
                activity.postJson(base + "/api/pair/reject", body);
                activity.runOnUiThread(new StatusTask(activity, "已拒绝主机连接邀请。"));
                return;
            }
            JSONObject json = activity.postJson(base + "/api/pair/tablet-accept", body);
            String token = json.optString("token", "");
            if (token.length() == 0) throw new Exception("主机未返回设备授权凭据");
            activity.stopWaitingForHostInvite();
            activity.runOnUiThread(new PairResultTask(activity, base, token, null));
        } catch (Exception error) {
            activity.runOnUiThread(new PairResultTask(activity, base, "", error.getMessage()));
        }
    }
}

class PairConfirmTask implements Runnable {
    private final MainActivity activity;
    private final List<String> bases;
    private final String pairCode;

    PairConfirmTask(MainActivity activity, List<String> bases, String pairCode) {
        this.activity = activity;
        this.bases = bases == null ? new ArrayList<String>() : bases;
        this.pairCode = pairCode;
    }

    @Override
    public void run() {
        try {
            if (bases.size() == 0) throw new Exception("没有可用主机地址");
            activity.runOnUiThread(new ConnectionCandidatesTask(activity, bases));
            if (bases.size() > 1) {
                String lastError = "";
                for (int i = 0; i < bases.size(); i++) {
                    String candidateBase = bases.get(i);
                    try {
                        JSONObject body = new JSONObject();
                        body.put("pairCode", pairCode);
                        body.put("deviceId", activity.deviceId());
                        body.put("deviceName", activity.deviceName());
                        JSONObject json = activity.postJson(candidateBase + "/api/pair/confirm", body);
                        String token = json.optString("token", "");
                        if (token.length() == 0) throw new Exception("涓绘満鏈繑鍥炶澶?token");
                        activity.runOnUiThread(new PairResultTask(activity, candidateBase, token, null));
                        return;
                    } catch (Exception error) {
                        lastError = candidateBase + " -> " + error.getMessage();
                    }
                }
                activity.runOnUiThread(new PairResultTask(activity, bases.get(0), "", lastError.length() > 0 ? lastError : "所有主机地址均连接失败"));
                return;
            }
            String base = bases.get(0);
            JSONObject body = new JSONObject();
            body.put("pairCode", pairCode);
            body.put("deviceId", activity.deviceId());
            body.put("deviceName", activity.deviceName());
            JSONObject json = activity.postJson(base + "/api/pair/confirm", body);
            String token = json.optString("token", "");
            if (token.length() == 0) throw new Exception("主机未返回设备 token");
            activity.runOnUiThread(new PairResultTask(activity, base, token, null));
        } catch (Exception error) {
            String fallback = bases.size() > 0 ? bases.get(0) : "";
            activity.runOnUiThread(new PairResultTask(activity, fallback, "", error.getMessage()));
        }
    }
}

class PairResultTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String error;

    PairResultTask(MainActivity activity, String base, String token, String error) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.error = error;
    }

    @Override
    public void run() {
        if (error != null) {
            activity.status("绑定主机失败：" + error);
            activity.toast("绑定主机失败。");
            return;
        }
        activity.serverInput.setText(base);
        activity.tokenInput.setText(token);
        activity.rememberSuccessfulEndpoint(base);
        activity.savePrefs();
        activity.markConnectedNow();
        activity.status("设备已连接，请在 Windows 主机端授权学生；授权后将自动载入学生。");
        activity.updateConnectionSummary("已连接，等待 Windows 授权", activity.students.size());
        activity.toast("已连接主机，等待授权学生。");
        activity.beginAuthorizationPolling();
    }
}

class StudentSessionApplyTask implements Runnable {
    private final MainActivity activity;
    private final JSONObject payload;
    private final String error;

    StudentSessionApplyTask(MainActivity activity, JSONObject payload, String error) {
        this.activity = activity;
        this.payload = payload;
        this.error = error;
    }

    @Override public void run() {
        activity.applyStudentSession(payload == null ? new JSONObject() : payload, error);
    }
}

class BootstrapStudentSessionTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String deviceToken;
    private final String existingSessionToken;

    BootstrapStudentSessionTask(MainActivity activity, String base, String deviceToken, String existingSessionToken) {
        this.activity = activity;
        this.base = base;
        this.deviceToken = deviceToken;
        this.existingSessionToken = existingSessionToken == null ? "" : existingSessionToken;
    }

    @Override public void run() {
        try {
            JSONObject modeJson = activity.getJson(base + "/api/device/mode", deviceToken);
            JSONObject device = modeJson.optJSONObject("device");
            final String mode = device == null ? "shared" : device.optString("terminalMode", "shared");
            final String boundStudentId = device == null ? "" : device.optString("boundStudentId", "");
            final boolean requiresStudentBinding = device != null
                && device.optBoolean("requiresStudentBinding", "personal".equals(mode) && boundStudentId.length() == 0);
            activity.runOnUiThread(new Runnable() {
                @Override public void run() {
                    activity.terminalMode = mode;
                    activity.boundStudentId = boundStudentId;
                    activity.personalRequiresBinding = requiresStudentBinding;
                    activity.updateStudentSessionUi();
                }
            });
            if (existingSessionToken.length() > 0) {
                try {
                    JSONObject session = activity.getJson(base + "/api/student-session/me", existingSessionToken);
                    session.put("terminalMode", mode);
                    activity.runOnUiThread(new StudentSessionApplyTask(activity, session, null));
                    return;
                } catch (Exception ignored) {
                }
            }
            if ("personal".equals(mode) && !requiresStudentBinding && boundStudentId.length() > 0) {
                JSONObject session = activity.postJson(base + "/api/student-session/auto", new JSONObject(), deviceToken);
                session.put("terminalMode", mode);
                activity.runOnUiThread(new StudentSessionApplyTask(activity, session, null));
                return;
            }
            if ("personal".equals(mode)) {
                activity.runOnUiThread(new Runnable() {
                    @Override public void run() {
                        activity.clearStudentSession("个人终端尚未绑定学生，请输入本人学生 ID 或扫码完成首次绑定。");
                        activity.updateConnectionSummary("已连接，等待首次绑定学生", 0);
                    }
                });
                return;
            }
            activity.runOnUiThread(new Runnable() {
                @Override public void run() {
                    activity.terminalMode = mode;
                    activity.clearStudentSession("\u8bf7\u626b\u7801\u6216\u8f93\u5165\u5b66\u751f ID \u8fdb\u5165\u672c\u4eba\u8d44\u6599\u3002");
                    activity.updateConnectionSummary("\u5df2\u8fde\u63a5\uff0c\u7b49\u5f85\u5b66\u751f\u8fdb\u5165", 0);
                }
            });
        } catch (Exception error) {
            activity.runOnUiThread(new StudentSessionApplyTask(activity, null, error.getMessage()));
        }
    }
}

class StudentLoginTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String deviceToken;
    private final String loginValue;

    StudentLoginTask(MainActivity activity, String base, String deviceToken, String loginValue) {
        this.activity = activity;
        this.base = base;
        this.deviceToken = deviceToken;
        this.loginValue = loginValue;
    }

    @Override public void run() {
        try {
            JSONObject body = new JSONObject();
            body.put(loginValue.trim().startsWith("{") ? "qrPayload" : "loginId", loginValue);
            JSONObject session = activity.postJson(base + "/api/student-session/login", body, deviceToken);
            activity.runOnUiThread(new StudentSessionApplyTask(activity, session, null));
        } catch (Exception error) {
            activity.runOnUiThread(new StudentSessionApplyTask(activity, null, error.getMessage()));
        }
    }
}

class StudentLogoutTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String sessionToken;

    StudentLogoutTask(MainActivity activity, String base, String sessionToken) {
        this.activity = activity;
        this.base = base;
        this.sessionToken = sessionToken;
    }

    @Override public void run() {
        try { activity.postJson(base + "/api/student-session/logout", new JSONObject(), sessionToken); } catch (Exception ignored) {}
        activity.runOnUiThread(new Runnable() {
            @Override public void run() { activity.clearStudentSession("\u5df2\u9000\u51fa\u5f53\u524d\u5b66\u751f\u3002"); }
        });
    }
}

class SetTerminalModeTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String deviceToken;
    private final String mode;

    SetTerminalModeTask(MainActivity activity, String base, String deviceToken, String mode) {
        this.activity = activity;
        this.base = base;
        this.deviceToken = deviceToken;
        this.mode = mode;
    }

    @Override public void run() {
        try {
            JSONObject body = new JSONObject();
            body.put("terminalMode", mode);
            activity.postJson(base + "/api/device/mode", body, deviceToken);
            activity.runOnUiThread(new Runnable() {
                @Override public void run() { activity.clearStudentSession("\u7ec8\u7aef\u6a21\u5f0f\u5df2\u66f4\u65b0\u3002"); }
            });
            new BootstrapStudentSessionTask(activity, base, deviceToken, "").run();
        } catch (Exception error) {
            activity.runOnUiThread(new StudentSessionApplyTask(activity, null, error.getMessage()));
        }
    }
}

class LoadArchiveFilesTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;
    private final long requestGeneration;

    LoadArchiveFilesTask(MainActivity activity, String base, String token, String studentId, long requestGeneration) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
        this.requestGeneration = requestGeneration;
    }

    @Override
    public void run() {
        try {
            JSONObject json = activity.getJson(base + "/api/students/" + activity.encode(studentId) + "/archive/files", token);
            JSONArray array = json.optJSONArray("files");
            List<ArchiveFile> result = new ArrayList<ArchiveFile>();
            if (array != null) {
                for (int i = 0; i < array.length(); i++) {
                    JSONObject item = array.optJSONObject(i);
                    if (item != null) {
                        ArchiveFile file = new ArchiveFile(item, "student", studentId, "");
                        String lower = file.path.toLowerCase();
                        if (lower.endsWith(".md") && !lower.equals("agent.md") && !lower.equals("log.md")) {
                            result.add(file);
                        }
                    }
                }
            }
            activity.runOnUiThread(new ArchiveFilesResultTask(activity, studentId, requestGeneration, result, null));
            for (int i = 0; i < result.size(); i++) {
                ArchiveFile file = result.get(i);
                try {
                    String url = base + "/api/students/" + activity.encode(studentId) + "/archive/file?path=" + activity.encode(file.path);
                    JSONObject fileJson = activity.getJson(url, token);
                    activity.cacheMarkdown(studentId, file, fileJson.optString("content", ""));
                } catch (Exception ignored) {
                }
            }
        } catch (Exception error) {
            activity.runOnUiThread(new ArchiveFilesResultTask(activity, studentId, requestGeneration, null, error.getMessage()));
        }
    }
}

class LoadArchiveFileTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;
    private final ArchiveFile file;

    LoadArchiveFileTask(MainActivity activity, String base, String token, String studentId, ArchiveFile file) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
        this.file = file;
    }

    @Override
    public void run() {
        try {
            String url = base + "/api/students/" + activity.encode(studentId) + "/archive/file?path=" + activity.encode(file.path);
            JSONObject json = activity.getJson(url, token);
            String content = json.optString("content", "");
            activity.cacheMarkdown(studentId, file, content);
            activity.runOnUiThread(new MarkdownResultTask(activity, studentId, file.path, file.name, content, null));
        } catch (Exception error) {
            activity.runOnUiThread(new MarkdownResultTask(activity, studentId, file.path, file.name, "", error.getMessage()));
        }
    }
}

class LoadProjectKnowledgeFilesTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;
    private final LearningProject project;
    private final long requestGeneration;

    LoadProjectKnowledgeFilesTask(MainActivity activity, String base, String token, String studentId, LearningProject project, long requestGeneration) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
        this.project = project;
        this.requestGeneration = requestGeneration;
    }

    @Override
    public void run() {
        try {
            if (!project.studentIds.contains(studentId)) throw new Exception("当前学生没有关联该项目");
            JSONObject json = activity.getJson(base + "/api/projects/" + activity.encode(project.id) + "/archive/files", token);
            JSONArray array = json.optJSONArray("files");
            List<ArchiveFile> result = new ArrayList<ArchiveFile>();
            if (array != null) {
                for (int i = 0; i < array.length(); i++) {
                    JSONObject item = array.optJSONObject(i);
                    if (item == null) continue;
                    ArchiveFile file = new ArchiveFile(item, "project", studentId, project.id);
                    String lower = file.path.toLowerCase(Locale.ROOT);
                    if (lower.endsWith(".md") && !lower.endsWith("/agent.md") && !lower.endsWith("/log.md") && !lower.equals("agent.md") && !lower.equals("log.md")) {
                        result.add(file);
                    }
                }
            }
            activity.runOnUiThread(new ProjectKnowledgeFilesResultTask(activity, studentId, project.id, project.name, requestGeneration, result, null));
        } catch (Exception error) {
            activity.runOnUiThread(new ProjectKnowledgeFilesResultTask(activity, studentId, project.id, project.name, requestGeneration, null, error.getMessage()));
        }
    }
}

class LoadProjectKnowledgeFileTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;
    private final String projectId;
    private final String projectName;
    private final ArchiveFile file;

    LoadProjectKnowledgeFileTask(MainActivity activity, String base, String token, String studentId, String projectId, String projectName, ArchiveFile file) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
        this.projectId = projectId;
        this.projectName = projectName;
        this.file = file;
    }

    @Override
    public void run() {
        String cacheScope = studentId + "-project-" + projectId;
        try {
            String url = base + "/api/projects/" + activity.encode(projectId) + "/archive/file?path=" + activity.encode(file.path)
                + (file.modified > 0 ? "&modified=" + file.modified : "");
            JSONObject json = activity.getJson(url, token);
            String content = json.optString("content", "");
            activity.cacheMarkdown(cacheScope, file, content);
            activity.runOnUiThread(new MarkdownResultTask(activity, cacheScope, file.path, projectName + " · " + file.name, content, null));
        } catch (Exception error) {
            if (String.valueOf(error.getMessage()).contains("HTTP 409")) {
                activity.runOnUiThread(new Runnable() { @Override public void run() { activity.refreshProjectKnowledgeAfterConflict(projectId); } });
                return;
            }
            activity.runOnUiThread(new MarkdownResultTask(activity, cacheScope, file.path, projectName + " · " + file.name, "", error.getMessage()));
        }
    }
}

class LoadLearningReportsTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;

    LoadLearningReportsTask(MainActivity activity, String base, String token, String studentId) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
    }

    @Override
    public void run() {
        try {
            JSONObject json = activity.getJson(base + "/api/students/" + activity.encode(studentId) + "/reports", token);
            JSONArray array = json.optJSONArray("reports");
            int count = 0;
            if (array != null) {
                for (int i = 0; i < array.length(); i++) {
                    JSONObject item = array.optJSONObject(i);
                    if (item == null) continue;
                    String reportId = item.optString("id", "");
                    if (reportId.length() == 0) continue;
                    try {
                        String url = base + "/api/students/" + activity.encode(studentId) + "/reports/" + activity.encode(reportId);
                        JSONObject detail = activity.getJson(url, token);
                        ArchiveFile file = new ArchiveFile(
                            detail.optString("title", activity.reportTitleForId(reportId)),
                            "学情报告/" + detail.optString("fileName", activity.reportFileNameForId(reportId))
                        );
                        activity.cacheMarkdown(studentId, file, detail.optString("content", ""));
                        count++;
                    } catch (Exception ignored) {
                    }
                }
            }
            activity.runOnUiThread(new StatusTask(activity, "学情报告已同步：" + count + " 份。"));
        } catch (Exception error) {
            activity.runOnUiThread(new StatusTask(activity, "学情报告同步失败：" + error.getMessage()));
        }
    }
}

class LoadGrowthSummaryTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;

    LoadGrowthSummaryTask(MainActivity activity, String base, String token, String studentId) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
    }

    @Override
    public void run() {
        try {
            JSONObject json = activity.getJson(base + "/api/students/" + activity.encode(studentId) + "/growth-summary", token);
            activity.runOnUiThread(new GrowthSummaryResultTask(activity, json, null));
        } catch (Exception error) {
            try {
                JSONObject listing = activity.getJson(base + "/api/students/" + activity.encode(studentId) + "/archive/files", token);
                JSONArray files = listing.optJSONArray("files");
                String growthPath = "";
                if (files != null) {
                    for (int i = 0; i < files.length(); i++) {
                        JSONObject item = files.optJSONObject(i);
                        String path = item == null ? "" : item.optString("path", "");
                        String normalized = path.replace("\\", "/").toLowerCase();
                        if (normalized.endsWith("成长模型/growth-index.md") || normalized.endsWith("/growth-index.md")) {
                            growthPath = path;
                            break;
                        }
                    }
                }
                if (growthPath.length() == 0) throw new Exception("主机尚未生成成长模型索引。");
                String url = base + "/api/students/" + activity.encode(studentId) + "/archive/file?path=" + activity.encode(growthPath);
                JSONObject fileJson = activity.getJson(url, token);
                JSONObject fallback = new JSONObject();
                fallback.put("ok", true);
                fallback.put("fallbackMarkdown", fileJson.optString("content", ""));
                activity.runOnUiThread(new GrowthSummaryResultTask(activity, fallback, null));
            } catch (Exception fallbackError) {
                String message = fallbackError.getMessage();
                if (message == null || message.length() == 0) message = error.getMessage();
                activity.runOnUiThread(new GrowthSummaryResultTask(activity, null, message));
            }
        }
    }
}

class LoadLearningReportTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;
    private final String reportId;

    LoadLearningReportTask(MainActivity activity, String base, String token, String studentId, String reportId) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
        this.reportId = reportId;
    }

    @Override
    public void run() {
        ArchiveFile fallback = activity.reportArchiveFile(reportId);
        try {
            String url = base + "/api/students/" + activity.encode(studentId) + "/reports/" + activity.encode(reportId);
            JSONObject json = activity.getJson(url, token);
            ArchiveFile file = new ArchiveFile(
                json.optString("title", activity.reportTitleForId(reportId)),
                "学情报告/" + json.optString("fileName", activity.reportFileNameForId(reportId))
            );
            String content = json.optString("content", "");
            activity.cacheMarkdown(studentId, file, content);
            activity.runOnUiThread(new LearningReportResultTask(activity, studentId, file.path, file.name, content, null,
                json.optString("status", ""), json.optString("updatedAt", "")));
        } catch (Exception error) {
            activity.runOnUiThread(new LearningReportResultTask(activity, studentId, fallback.path, fallback.name, "", error.getMessage(), "", ""));
        }
    }
}

class EnqueueProjectMaterialsTask implements Runnable {
    private final MainActivity activity;
    private final UploadTarget target;
    private final List<Uri> uris;
    private final boolean reloadAfterFinish;
    private final String hostId;
    private final String dataGeneration;
    private final String deviceId;
    private final String studentId;

    EnqueueProjectMaterialsTask(MainActivity activity, UploadTarget target, List<Uri> uris,
                                boolean reloadAfterFinish) {
        this.activity = activity;
        this.target = target;
        this.uris = uris;
        this.reloadAfterFinish = reloadAfterFinish;
        this.hostId = activity.connectedHostId();
        this.dataGeneration = activity.connectedHostDataGeneration();
        this.deviceId = activity.deviceId();
        this.studentId = target.studentId;
    }

    @Override
    public void run() {
        int queued = 0;
        ArrayList<String> failures = new ArrayList<String>();
        ArrayList<String> failureLabels = new ArrayList<String>();
        ArrayList<Uri> failedUris = new ArrayList<Uri>();
        ArrayList<Uri> copiedUris = new ArrayList<Uri>();
        for (int i = 0; i < uris.size(); i++) {
            Uri uri = uris.get(i);
            String fileName = activity.displayName(uri);
            InputStream input = null;
            try {
                activity.runOnUiThread(new StatusTask(activity, "正在安全保存 " + (i + 1) + "/" + uris.size() + "：" + fileName));
                activity.runOnUiThread(new UploadQueueStatusTask(activity, "上传队列：" + (i + 1) + "/" + uris.size() + "，正在建立私有稳定副本：" + fileName));
                QueuedMaterialDescriptor descriptor = activity.queuedMaterialDescriptor(uri);
                input = activity.openUriInput(uri);
                if (input == null) throw new SecurityException("文件读取授权已失效");
                ProjectMaterialUploadQueue.Metadata metadata = new ProjectMaterialUploadQueue.Metadata(
                    hostId, dataGeneration, deviceId, studentId, target.type, target.id, fileName,
                    descriptor.sourceType, descriptor.attributionQuery, descriptor.sourceReference);
                ProjectMaterialUploadQueue.Entry queuedEntry = activity.projectMaterialUploadQueue.enqueue(input, metadata);
                if (activity.studentCollectionInbox != null && "file".equals(uri.getScheme()) && uri.getPath() != null) {
                    activity.studentCollectionInbox.markQueuedByPayloadPath(uri.getPath(), queuedEntry.requestId);
                }
                queued += 1;
                copiedUris.add(uri);
                activity.runOnUiThread(new UploadQueueStatusTask(activity, "上传队列：已安全保存 " + queued + "/" + uris.size() + "，等待主机回执核对。"));
            } catch (Exception error) {
                String detail = error instanceof SecurityException
                    ? "读取权限失效，已暂停；请重新选择该文件"
                    : activity.safeErrorMessage(error);
                failures.add(fileName + "：" + detail);
                failureLabels.add(fileName);
                failedUris.add(uri);
            } finally {
                if (input != null) try { input.close(); } catch (Exception ignored) {}
            }
        }
        activity.pendingSharedUris.removeAll(copiedUris);
        final int queuedCount = queued;
        final ArrayList<Uri> finalFailedUris = failedUris;
        final ArrayList<String> finalFailureLabels = failureLabels;
        final String firstFailure = failures.size() > 0 ? failures.get(0) : "";
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                activity.uploadInProgress = false;
                activity.failedUploadUris.clear();
                activity.failedUploadUris.addAll(finalFailedUris);
                activity.captureUploadUrisInFlight.clear();
                activity.captureUploadVisualState = finalFailedUris.size() > 0 ? "failed" : "idle";
                activity.updateSharedUploadButton();
                activity.refreshCaptureUi();
                activity.refreshCollectionInboxUi();
                if (queuedCount > 0) {
                    activity.status("已将 " + queuedCount + " 个资料安全保存到本机持久队列；主机接收结果将按回执核对。");
                    activity.toast("资料已进入持久上传队列。");
                    ProjectMaterialUploadJobService.schedule(activity);
                    ProjectMaterialUploadJobService.runNow(activity);
                }
                if (finalFailureLabels.size() > 0) {
                    activity.uploadResultText.setText("本机入队失败 " + finalFailureLabels.size()
                        + " 个，未发送到主机。首个失败：" + firstFailure);
                } else {
                    activity.uploadResultText.setText("最近操作：" + queuedCount
                        + " 个资料已建立本机私有稳定副本，正在等待主机确认回执。\n固定目标：" + target.name + "。");
                }
                activity.refreshProjectMaterialQueueStatus();
                if (reloadAfterFinish && queuedCount > 0) {
                    activity.uploadQueueText.postDelayed(new Runnable() {
                        @Override public void run() {
                            activity.refreshProjectMaterialQueueStatus();
                            activity.loadStudents();
                        }
                    }, 1800L);
                }
            }
        });
    }
}

class UploadResultTask implements Runnable {
    private final MainActivity activity;
    private final int success;
    private final int total;
    private final List<Uri> failed;
    private final List<String> failureLabels;
    private final UploadTarget target;

    UploadResultTask(MainActivity activity, int success, int total, List<Uri> failed, List<String> failureLabels, UploadTarget target) {
        this.activity = activity;
        this.success = success;
        this.total = total;
        this.failed = failed;
        this.failureLabels = failureLabels;
        this.target = target;
    }

    @Override
    public void run() {
        activity.applyUploadResult(success, total, failed, failureLabels, target);
    }
}

class ConnectionSummaryTask implements Runnable {
    private final MainActivity activity;
    private final String state;
    private final int studentCount;

    ConnectionSummaryTask(MainActivity activity, String state, int studentCount) {
        this.activity = activity;
        this.state = state;
        this.studentCount = studentCount;
    }

    @Override
    public void run() {
        activity.updateConnectionSummary(state, studentCount);
    }
}

class StartLoadStudentsTask implements Runnable {
    private final MainActivity activity;

    StartLoadStudentsTask(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public void run() {
        activity.loadStudents();
    }
}

class ClearSharedUploadTask implements Runnable {
    private final MainActivity activity;

    ClearSharedUploadTask(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public void run() {
        activity.updateSharedUploadButton();
    }
}

class StatusTask implements Runnable {
    private final MainActivity activity;
    private final String message;

    StatusTask(MainActivity activity, String message) {
        this.activity = activity;
        this.message = message;
    }

    @Override
    public void run() {
        activity.status(message);
    }
}

class UploadQueueStatusTask implements Runnable {
    private final MainActivity activity;
    private final String message;

    UploadQueueStatusTask(MainActivity activity, String message) {
        this.activity = activity;
        this.message = message;
    }

    @Override
    public void run() {
        activity.setUploadQueueText(message);
    }
}

class ToastTask implements Runnable {
    private final MainActivity activity;
    private final String message;

    ToastTask(MainActivity activity, String message) {
        this.activity = activity;
        this.message = message;
    }

    @Override
    public void run() {
        activity.toast(message);
    }
}

class StandaloneUpgradeTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;

    StandaloneUpgradeTask(MainActivity activity, String base, String token, String studentId) {
        this.activity = activity; this.base = base; this.token = token; this.studentId = studentId;
    }

    @Override public void run() {
        try {
            String encoded = URLEncoder.encode(studentId, "UTF-8").replace("+", "%20");
            JSONObject created = activity.postJson(base + "/api/students/" + encoded + "/portable-migrations", new JSONObject(), token);
            String sessionId = created.getString("sessionId");
            String statusUrl = base + "/api/students/" + encoded + "/portable-migrations/" + URLEncoder.encode(sessionId, "UTF-8");
            for (int poll = 0; poll < 1800; poll++) {
                final JSONObject state = activity.getJson(statusUrl, token);
                String status = state.optString("status");
                if ("ready".equals(status)) {
                    state.put("downloadUrl", "/api/students/" + encoded + "/portable-migrations/" + sessionId + "/download");
                    state.put("bearerToken", token);
                    activity.runOnUiThread(new Runnable() { @Override public void run() { activity.openStandaloneMigration(state); } });
                    return;
                }
                if ("failed".equals(status)) throw new Exception(state.optString("message", "生成迁移包失败"));
                final String message = state.optString("message", "正在生成迁移快照…");
                activity.runOnUiThread(new Runnable() { @Override public void run() { activity.status(message); } });
                Thread.sleep(1000L);
            }
            throw new Exception("迁移包生成超时，请重试。");
        } catch (final Exception error) {
            activity.runOnUiThread(new Runnable() { @Override public void run() { activity.status("一键升级失败：" + error.getMessage()); } });
        }
    }
}

class StudentsResultTask implements Runnable {
    private final MainActivity activity;
    private final List<Student> result;
    private final List<LearningProject> projects;
    private final String error;
    private final boolean requiresApproval;

    StudentsResultTask(MainActivity activity, List<Student> result, List<LearningProject> projects, String error, boolean requiresApproval) {
        this.activity = activity;
        this.result = result;
        this.projects = projects;
        this.error = error;
        this.requiresApproval = requiresApproval;
    }

    @Override
    public void run() {
        activity.applyStudents(result, projects, error, requiresApproval);
    }
}

class ConnectionCredentialsTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;

    ConnectionCredentialsTask(MainActivity activity, String base, String token) {
        this.activity = activity;
        this.base = base;
        this.token = token;
    }

    @Override
    public void run() {
        activity.serverInput.setText(base);
        activity.tokenInput.setText(token);
    }
}

class ArchiveFilesResultTask implements Runnable {
    private final MainActivity activity;
    private final String studentId;
    private final long requestGeneration;
    private final List<ArchiveFile> result;
    private final String error;

    ArchiveFilesResultTask(MainActivity activity, String studentId, long requestGeneration, List<ArchiveFile> result, String error) {
        this.activity = activity;
        this.studentId = studentId;
        this.requestGeneration = requestGeneration;
        this.result = result;
        this.error = error;
    }

    @Override
    public void run() {
        activity.applyArchiveFiles(studentId, requestGeneration, result, error);
    }
}

class ProjectKnowledgeFilesResultTask implements Runnable {
    private final MainActivity activity;
    private final String studentId;
    private final String projectId;
    private final String projectName;
    private final List<ArchiveFile> result;
    private final String error;
    private final long requestGeneration;

    ProjectKnowledgeFilesResultTask(MainActivity activity, String studentId, String projectId, String projectName,
                                    long requestGeneration, List<ArchiveFile> result, String error) {
        this.activity = activity;
        this.studentId = studentId;
        this.projectId = projectId;
        this.projectName = projectName;
        this.result = result;
        this.error = error;
        this.requestGeneration = requestGeneration;
    }

    @Override
    public void run() {
        activity.applyProjectKnowledgeFiles(studentId, projectId, projectName, requestGeneration,
            result == null ? new ArrayList<ArchiveFile>() : result, error);
    }
}

class GrowthSummaryResultTask implements Runnable {
    private final MainActivity activity;
    private final JSONObject payload;
    private final String error;

    GrowthSummaryResultTask(MainActivity activity, JSONObject payload, String error) {
        this.activity = activity;
        this.payload = payload;
        this.error = error;
    }

    @Override
    public void run() {
        activity.applyGrowthSummary(payload, error);
    }
}

class LearningReportResultTask implements Runnable {
    private final MainActivity activity;
    private final String studentId, path, title, content, error, status, updatedAt;

    LearningReportResultTask(MainActivity activity, String studentId, String path, String title, String content,
                             String error, String status, String updatedAt) {
        this.activity = activity; this.studentId = studentId; this.path = path; this.title = title;
        this.content = content; this.error = error; this.status = status; this.updatedAt = updatedAt;
    }

    @Override public void run() {
        activity.applyLearningReport(title, content, error, studentId, path, status, updatedAt);
    }
}

class MarkdownResultTask implements Runnable {
    private final MainActivity activity;
    private final String studentId;
    private final String path;
    private final String title;
    private final String content;
    private final String error;

    MarkdownResultTask(MainActivity activity, String studentId, String path, String title, String content, String error) {
        this.activity = activity;
        this.studentId = studentId;
        this.path = path;
        this.title = title;
        this.content = content;
        this.error = error;
    }

    @Override
    public void run() {
        activity.applyMarkdown(title, content, error, studentId, path);
    }
}

class TabletUpdateCheckTask implements Runnable {
    private final MainActivity activity;

    TabletUpdateCheckTask(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public void run() {
        try {
            JSONObject json = activity.getJson(MainActivity.UPDATE_MANIFEST_URL, null);
            int versionCode = json.optInt("tabletTerminalVersionCode",
                json.optInt("tabletVersionCode", json.optInt("androidVersionCode", json.optInt("versionCode", 0))));
            String versionName = json.optString("tabletTerminalVersionName",
                json.optString("tabletVersionName", json.optString("androidVersionName", json.optString("versionName", ""))));
            String url = json.optString("tabletTerminalUrl",
                json.optString("tabletUrl", json.optString("androidUrl", json.optString("apkUrl", ""))));
            String notes = json.optString("tabletTerminalNotes", json.optString("notes", ""));
            if (versionCode > MainActivity.VERSION_CODE && url.length() > 0) {
                activity.runOnUiThread(new StatusTask(activity, "发现平板终端新版 " + (versionName.length() > 0 ? versionName : versionCode) + "，正在应用内下载 APK。" + (notes.length() > 0 ? "\n" + notes : "")));
                new DownloadApkTask(activity, url).run();
            } else {
                activity.runOnUiThread(new StatusTask(activity, "当前平板终端已是最新版本 v" + MainActivity.VERSION_NAME + "。"));
            }
        } catch (Exception error) {
            activity.runOnUiThread(new StatusTask(activity, "检查更新失败：" + error.getMessage()));
        }
    }
}

class DownloadApkTask implements Runnable {
    private final MainActivity activity;
    private final String url;

    DownloadApkTask(MainActivity activity, String url) {
        this.activity = activity;
        this.url = url;
    }

    @Override
    public void run() {
        HttpURLConnection connection = null;
        try {
            File target = activity.updateApkFile();
            URL targetUrl = new URL(url);
            connection = (HttpURLConnection) targetUrl.openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(30000);
            connection.setRequestMethod("GET");
            connection.connect();
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new RuntimeException("HTTP " + code);
            int total = connection.getContentLength();
            InputStream input = connection.getInputStream();
            FileOutputStream output = new FileOutputStream(target);
            byte[] buffer = new byte[32 * 1024];
            long downloaded = 0;
            int lastPercent = -1;
            try {
                while (true) {
                    int read = input.read(buffer);
                    if (read < 0) break;
                    output.write(buffer, 0, read);
                    downloaded += read;
                    if (total > 0) {
                        int percent = (int) Math.min(100, downloaded * 100 / total);
                        if (percent >= lastPercent + 10 || percent == 100) {
                            lastPercent = percent;
                            activity.runOnUiThread(new StatusTask(activity, "正在下载新版 APK：" + percent + "%"));
                        }
                    } else if (downloaded > 0 && downloaded % (1024 * 1024) < buffer.length) {
                        activity.runOnUiThread(new StatusTask(activity, "正在下载新版 APK：" + (downloaded / 1024 / 1024) + " MB"));
                    }
                }
            } finally {
                try { output.close(); } catch (Exception ignored) {}
                try { input.close(); } catch (Exception ignored) {}
            }
            activity.runOnUiThread(new StatusTask(activity, "新版 APK 下载完成，正在打开系统安装界面。"));
            activity.runOnUiThread(new InstallApkTask(activity, target, url));
        } catch (Exception error) {
            activity.runOnUiThread(new StatusTask(activity, "应用内下载失败，正在打开下载页面：" + error.getMessage()));
            activity.runOnUiThread(new OpenUrlTask(activity, url));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}

class InstallApkTask implements Runnable {
    private final MainActivity activity;
    private final File file;
    private final String fallbackUrl;

    InstallApkTask(MainActivity activity, File file, String fallbackUrl) {
        this.activity = activity;
        this.file = file;
        this.fallbackUrl = fallbackUrl;
    }

    @Override
    public void run() {
        activity.installDownloadedApk(file, fallbackUrl);
    }
}

class OpenUrlTask implements Runnable {
    private final MainActivity activity;
    private final String url;

    OpenUrlTask(MainActivity activity, String url) {
        this.activity = activity;
        this.url = url;
    }

    @Override
    public void run() {
        activity.openUrl(url);
    }
}


