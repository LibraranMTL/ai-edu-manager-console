package com.qxmatrix.eduterminal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

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

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Hashtable;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity implements View.OnClickListener, AdapterView.OnItemSelectedListener {
    static final int REQUEST_PICK_MATERIAL = 8101;
    static final int REQUEST_PICK_IMAGE = 8102;
    static final int REQUEST_TAKE_PHOTO = 8103;
    static final int REQUEST_SCAN_PAIR = 8104;
    static final int REQUEST_CAPTURE_PAIR_QR = 8105;
    static final String VERSION_NAME = "0.4.3";
    static final int VERSION_CODE = 53;
    static final String UPDATE_MANIFEST_URL = "https://www.greatbg.com/download/edu-manager-version.json";
    static final String USER_AGREEMENT_URL = "https://www.greatbg.com/download/agreement.html";
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
    private static final String PREF_REMOTE_URL = "remote_url";
    private static final String PREF_CONNECTION_MODE = "connection_mode";
    private static final String PREF_DEVICE_ID = "device_id";
    private static final String PREF_LAST_CONNECTED_AT = "last_connected_at";
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
    TextView uploadResultText;
    TextView uploadQueueText;
    TextView archiveTitle;
    TextView markdownView;
    ScrollView rootScroll;
    EditText archiveSearchInput;
    Spinner studentSpinner;
    Spinner archiveCategorySpinner;
    Spinner archiveSpinner;
    Button saveButton;
    Button testButton;
    Button pasteButton;
    Button scanPairButton;
    Button checkUpdateButton;
    Button copyDiagnosticsButton;
    Button quickUploadButton;
    Button quickArchiveButton;
    Button quickContactButton;
    Button connectionSettingsButton;
    Button uploadButton;
    Button sharedUploadButton;
    Button retryFailedUploadButton;
    Button reloadStudentsButton;
    Button refreshArchiveButton;
    Button copyButton;
    Button searchArchiveButton;
    Button topButton;
    Button fontSmallButton;
    Button fontLargeButton;
    Button openWeComButton;
    Button openQQButton;
    Button copyConsultPromptButton;
    Button copyDigestPromptButton;
    TextView agreementLink;
    TextView contactText;
    LinearLayout connectionConfigCard;
    LinearLayout studentCard;
    LinearLayout contactCard;
    LinearLayout archiveCard;
    boolean connectionSettingsVisible = false;

    final List<Student> students = new ArrayList<Student>();
    final List<ArchiveFile> allArchiveFiles = new ArrayList<ArchiveFile>();
    final List<ArchiveFile> archiveFiles = new ArrayList<ArchiveFile>();
    final List<Uri> pendingSharedUris = new ArrayList<Uri>();
    final List<Uri> failedUploadUris = new ArrayList<Uri>();
    Uri pendingCameraUri = null;
    Uri pendingPairQrUri = null;
    ArrayAdapter<String> studentAdapter;
    ArrayAdapter<String> connectionModeAdapter;
    ArrayAdapter<String> archiveCategoryAdapter;
    ArrayAdapter<String> archiveAdapter;
    Student selectedStudent;
    String currentMarkdown = "";
    int selectedArchiveCategory = 1;
    int markdownFontSize = 16;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("AI教育管家平板终端");
        buildUi();
        loadPrefs();
        handleIncomingShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingShare(intent);
    }

    private void buildUi() {
        FrameLayout screen = new FrameLayout(this);
        ScrollView scroll = new ScrollView(this);
        rootScroll = scroll;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(16), dp(18), dp(22));
        root.setBackgroundColor(Color.rgb(246, 250, 249));
        scroll.addView(root);
        screen.addView(scroll, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        LinearLayout brandRow = new LinearLayout(this);
        brandRow.setOrientation(LinearLayout.HORIZONTAL);
        brandRow.setGravity(Gravity.CENTER_VERTICAL);
        brandRow.setPadding(0, 0, 0, dp(8));
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
        title.setText("AI教育管家平板终端");
        title.setTextSize(28);
        title.setTextColor(Color.rgb(15, 32, 31));
        title.setGravity(Gravity.START);
        title.setTypeface(null, 1);
        brandCopy.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("连接 Windows 统一版主机服务，用于上传学习资料和查看学情档案。版本 v" + VERSION_NAME);
        subtitle.setTextSize(14);
        subtitle.setTextColor(Color.rgb(87, 107, 103));
        subtitle.setPadding(0, dp(4), 0, dp(2));
        brandCopy.addView(subtitle);

        TextView copyright = new TextView(this);
        copyright.setText("嘉玛蓝（北京）科技有限公司版权所有");
        copyright.setTextSize(12);
        copyright.setTextColor(Color.rgb(104, 121, 117));
        copyright.setPadding(0, 0, 0, dp(3));
        brandCopy.addView(copyright);

        agreementLink = new TextView(this);
        agreementLink.setText("用户协议");
        agreementLink.setTextSize(13);
        agreementLink.setTextColor(Color.rgb(16, 111, 104));
        agreementLink.setPadding(0, 0, 0, dp(14));
        agreementLink.setOnClickListener(this);
        brandCopy.addView(agreementLink);

        LinearLayout quickCard = card();
        root.addView(quickCard);
        quickCard.addView(label("常用操作"));
        LinearLayout quickRow = row();
        quickUploadButton = button("上传资料到主机", true);
        quickArchiveButton = button("查看学情档案", false);
        quickContactButton = button("联系教育管家", false);
        connectionSettingsButton = button("连接设置", false);
        quickRow.addView(quickUploadButton);
        quickRow.addView(quickArchiveButton);
        quickRow.addView(quickContactButton);
        quickRow.addView(connectionSettingsButton);
        quickCard.addView(quickRow);
        quickUploadButton.setOnClickListener(this);
        quickArchiveButton.setOnClickListener(this);
        quickContactButton.setOnClickListener(this);
        connectionSettingsButton.setOnClickListener(this);

        connectionConfigCard = card();
        root.addView(connectionConfigCard);
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
        connectRow.addView(saveButton);
        connectRow.addView(testButton);
        connectRow.addView(pasteButton);
        connectionConfigCard.addView(connectRow);

        LinearLayout pairRow = row();
        scanPairButton = button("扫码绑定主机", true);
        pairRow.addView(scanPairButton);
        connectionConfigCard.addView(pairRow);

        LinearLayout maintenanceRow = row();
        checkUpdateButton = button("检查更新", false);
        copyDiagnosticsButton = button("复制诊断信息", false);
        maintenanceRow.addView(checkUpdateButton);
        maintenanceRow.addView(copyDiagnosticsButton);
        connectionConfigCard.addView(maintenanceRow);

        statusText = new TextView(this);
        statusText.setText("尚未连接主机服务。");
        statusText.setTextColor(Color.rgb(87, 107, 103));
        statusText.setPadding(0, dp(10), 0, 0);
        connectionConfigCard.addView(statusText);

        connectionSummaryText = new TextView(this);
        connectionSummaryText.setText("连接状态：未连接。\n建议：确认 Windows 主机已选择“主机-平板模式”并启动主机服务。");
        connectionSummaryText.setTextSize(13);
        connectionSummaryText.setTextColor(Color.rgb(87, 107, 103));
        connectionSummaryText.setPadding(dp(10), dp(10), dp(10), dp(10));
        connectionSummaryText.setBackgroundColor(Color.rgb(238, 247, 244));
        connectionConfigCard.addView(connectionSummaryText);

        connectionHintText = new TextView(this);
        connectionHintText.setText("连接排查：先确认 Windows 首页选择“主机-平板模式”并启动主机服务；平板与电脑连接同一 Wi-Fi；如果仍失败，请重新扫码绑定。");
        connectionHintText.setTextSize(12);
        connectionHintText.setTextColor(Color.rgb(104, 121, 117));
        connectionHintText.setPadding(dp(10), dp(8), dp(10), 0);
        connectionConfigCard.addView(connectionHintText);
        connectionConfigCard.setVisibility(View.GONE);

        saveButton.setOnClickListener(this);
        testButton.setOnClickListener(this);
        pasteButton.setOnClickListener(this);
        scanPairButton.setOnClickListener(this);
        checkUpdateButton.setOnClickListener(this);
        copyDiagnosticsButton.setOnClickListener(this);

        studentCard = card();
        root.addView(studentCard);
        studentCard.addView(label("学生"));
        studentSpinner = new Spinner(this);
        studentAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        studentAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        studentSpinner.setAdapter(studentAdapter);
        studentSpinner.setOnItemSelectedListener(this);
        studentCard.addView(studentSpinner);

        LinearLayout actionRow = row();
        uploadButton = button("上传资料到主机", true);
        sharedUploadButton = button("上传分享资料", false);
        retryFailedUploadButton = button("重试失败资料", false);
        reloadStudentsButton = button("刷新学生", false);
        actionRow.addView(uploadButton);
        actionRow.addView(sharedUploadButton);
        actionRow.addView(retryFailedUploadButton);
        actionRow.addView(reloadStudentsButton);
        studentCard.addView(actionRow);
        uploadButton.setEnabled(false);
        sharedUploadButton.setEnabled(false);
        retryFailedUploadButton.setEnabled(false);
        sharedUploadButton.setVisibility(View.GONE);
        retryFailedUploadButton.setVisibility(View.GONE);
        uploadButton.setOnClickListener(this);
        sharedUploadButton.setOnClickListener(this);
        retryFailedUploadButton.setOnClickListener(this);
        reloadStudentsButton.setOnClickListener(this);

        uploadResultText = new TextView(this);
        uploadResultText.setText("最近上传结果：暂无。");
        uploadResultText.setTextSize(13);
        uploadResultText.setTextColor(Color.rgb(87, 107, 103));
        uploadResultText.setPadding(0, dp(8), 0, 0);
        studentCard.addView(uploadResultText);

        uploadQueueText = new TextView(this);
        uploadQueueText.setText("上传队列：暂无。");
        uploadQueueText.setTextSize(12);
        uploadQueueText.setTextColor(Color.rgb(104, 121, 117));
        uploadQueueText.setPadding(0, dp(4), 0, 0);
        studentCard.addView(uploadQueueText);

        contactCard = card();
        root.addView(contactCard);
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
        copyConsultPromptButton = button("复制咨询提示", false);
        copyDigestPromptButton = button("复制消化提示", false);
        contactRow.addView(openWeComButton);
        contactRow.addView(openQQButton);
        contactRow.addView(copyConsultPromptButton);
        contactRow.addView(copyDigestPromptButton);
        contactCard.addView(contactRow);
        openWeComButton.setOnClickListener(this);
        openQQButton.setOnClickListener(this);
        copyConsultPromptButton.setOnClickListener(this);
        copyDigestPromptButton.setOnClickListener(this);
        openWeComButton.setEnabled(false);
        openQQButton.setEnabled(false);
        copyConsultPromptButton.setEnabled(false);
        copyDigestPromptButton.setEnabled(false);

        archiveCard = card();
        root.addView(archiveCard);
        archiveCard.addView(label("学情档案"));
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
        archiveSearchRow.addView(archiveSearchInput, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
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
        fontSmallButton = button("A-", false);
        fontLargeButton = button("A+", false);
        topButton = button("回到顶部", false);
        archiveRow.addView(refreshArchiveButton);
        archiveRow.addView(copyButton);
        archiveRow.addView(fontSmallButton);
        archiveRow.addView(fontLargeButton);
        archiveCard.addView(archiveRow);
        refreshArchiveButton.setOnClickListener(this);
        copyButton.setOnClickListener(this);
        fontSmallButton.setOnClickListener(this);
        fontLargeButton.setOnClickListener(this);
        topButton.setOnClickListener(this);

        archiveTitle = new TextView(this);
        archiveTitle.setText("请选择学生和档案。");
        archiveTitle.setTextSize(18);
        archiveTitle.setTypeface(null, 1);
        archiveTitle.setTextColor(Color.rgb(15, 118, 110));
        archiveTitle.setPadding(0, dp(12), 0, dp(6));
        archiveCard.addView(archiveTitle);

        markdownView = new TextView(this);
        markdownView.setText("连接主机服务后，可在这里查看 Windows 主机中的 Markdown 学情档案。");
        markdownView.setTextSize(markdownFontSize);
        markdownView.setLineSpacing(0, 1.25f);
        markdownView.setTextColor(Color.rgb(33, 49, 47));
        markdownView.setPadding(dp(12), dp(12), dp(12), dp(12));
        markdownView.setBackgroundColor(Color.WHITE);
        archiveCard.addView(markdownView);

        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(dp(132), dp(48), Gravity.BOTTOM | Gravity.RIGHT);
        topParams.setMargins(0, 0, dp(20), dp(20));
        topButton.setLayoutParams(topParams);
        screen.addView(topButton);

        setContentView(screen);
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
        } else if (view == scanPairButton) {
            startPairScan();
        } else if (view == checkUpdateButton) {
            checkForUpdate();
        } else if (view == copyDiagnosticsButton) {
            copyDiagnostics();
        } else if (view == quickUploadButton) {
            pickMaterial();
        } else if (view == quickArchiveButton) {
            loadArchiveFiles();
            scrollToView(archiveCard);
            status("已刷新学情档案，可在下方选择分类和文档。");
        } else if (view == quickContactButton) {
            updateContactCard();
            scrollToView(contactCard);
            status("请在“联系教育管家”区域打开企业微信或 QQ，并复制咨询提示。");
        } else if (view == connectionSettingsButton) {
            toggleConnectionSettings();
        } else if (view == agreementLink) {
            openUserAgreement();
        } else if (view == uploadButton) {
            pickMaterial();
        } else if (view == sharedUploadButton) {
            uploadPendingSharedMaterials();
        } else if (view == retryFailedUploadButton) {
            retryFailedUploads();
        } else if (view == reloadStudentsButton) {
            loadStudents();
        } else if (view == refreshArchiveButton) {
            loadArchiveFiles();
        } else if (view == copyButton) {
            copyMarkdown();
        } else if (view == searchArchiveButton) {
            applyArchiveCategoryFilter();
        } else if (view == topButton) {
            if (rootScroll != null) rootScroll.smoothScrollTo(0, 0);
        } else if (view == fontSmallButton) {
            markdownFontSize = Math.max(13, markdownFontSize - 1);
            markdownView.setTextSize(markdownFontSize);
            toast("字号：" + markdownFontSize);
        } else if (view == fontLargeButton) {
            markdownFontSize = Math.min(24, markdownFontSize + 1);
            markdownView.setTextSize(markdownFontSize);
            toast("字号：" + markdownFontSize);
        } else if (view == openWeComButton) {
            openWeCom();
        } else if (view == openQQButton) {
            openQQ();
        } else if (view == copyConsultPromptButton) {
            copyConsultPrompt();
        } else if (view == copyDigestPromptButton) {
            copyDigestPrompt();
        }
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

    void scrollToView(final View target) {
        if (rootScroll == null || target == null) return;
        rootScroll.smoothScrollTo(0, Math.max(0, target.getTop() - dp(10)));
    }

    @Override
    public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
        if (parent == studentSpinner) {
            selectedStudent = position >= 0 && position < students.size() ? students.get(position) : null;
            updateSharedUploadButton();
            updateContactCard();
            loadArchiveFiles();
        } else if (parent == archiveCategorySpinner) {
            selectedArchiveCategory = position;
            applyArchiveCategoryFilter();
        } else if (parent == archiveSpinner && position >= 0 && position < archiveFiles.size()) {
            loadArchiveFile(archiveFiles.get(position));
        }
    }

    @Override
    public void onNothingSelected(AdapterView<?> parent) {
        if (parent == studentSpinner) selectedStudent = null;
    }

    void connectAndLoadStudents() {
        String base = normalizedBaseUrl();
        if (base.length() == 0) {
            status("请先填写主机服务地址。");
            return;
        }
        status("正在连接主机服务...");
        new Thread(new ConnectTask(this, base)).start();
    }

    void loadStudents() {
        String base = normalizedBaseUrl();
        String token = apiToken();
        if (base.length() == 0 || token.length() == 0) {
            status("请填写主机服务地址和 API Token。");
            return;
        }
        status("正在读取学生列表...");
        new Thread(new LoadStudentsTask(this, base, token)).start();
    }

    void loadArchiveFiles() {
        if (selectedStudent == null) {
            allArchiveFiles.clear();
            archiveFiles.clear();
            archiveAdapter.clear();
            archiveAdapter.notifyDataSetChanged();
            archiveTitle.setText("请选择学生。");
            markdownView.setText("选择学生后可查看该学生的学情档案。");
            currentMarkdown = "";
            return;
        }
        String base = normalizedBaseUrl();
        String token = apiToken();
        if (base.length() == 0 || token.length() == 0) return;
        new Thread(new LoadArchiveFilesTask(this, base, token, selectedStudent.id)).start();
    }

    void loadArchiveFile(ArchiveFile file) {
        if (selectedStudent == null) return;
        String base = normalizedBaseUrl();
        String token = apiToken();
        if (base.length() == 0 || token.length() == 0) return;
        new Thread(new LoadArchiveFileTask(this, base, token, selectedStudent.id, file)).start();
    }

    void pickMaterial() {
        if (selectedStudent == null) {
            toast("请先选择学生。");
            return;
        }
        String[] options = pendingSharedUris.size() > 0
            ? new String[] {"选择文件", "选择图片/截图", "拍照上传", "扫描 Downloads 最近文件", "上传已分享资料(" + pendingSharedUris.size() + ")"}
            : new String[] {"选择文件", "选择图片/截图", "拍照上传", "扫描 Downloads 最近文件"};
        new AlertDialog.Builder(this)
            .setTitle("上传资料到主机")
            .setItems(options, new UploadOptionClickListener(this))
            .show();
    }

    void startPickFiles() {
        Intent openDocument = buildFilePickIntent(Intent.ACTION_OPEN_DOCUMENT);
        if (launchPicker(openDocument, REQUEST_PICK_MATERIAL, "选择要上传到主机的学习资料")) return;

        Intent getContent = buildFilePickIntent(Intent.ACTION_GET_CONTENT);
        if (launchPicker(getContent, REQUEST_PICK_MATERIAL, "选择要上传到主机的学习资料")) return;

        status("当前平板的系统文件选择器不可用。可改用“选择图片/截图”“拍照上传”“扫描 Downloads 最近文件”，或从文件管理器分享文件到教育管家。");
        toast("系统文件选择器不可用，请改用其他上传方式。");
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
            if (intent.resolveActivity(getPackageManager()) == null) return false;
            startActivityForResult(Intent.createChooser(intent, title), requestCode);
            return true;
        } catch (Exception error) {
            return false;
        }
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
        try {
            Intent pick = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
            pick.setType("image/*");
            if (pick.resolveActivity(getPackageManager()) != null) {
                startActivityForResult(pick, REQUEST_PICK_IMAGE);
                return;
            }
        } catch (Exception ignored) {
        }

        Intent getContent = new Intent(Intent.ACTION_GET_CONTENT);
        getContent.addCategory(Intent.CATEGORY_OPENABLE);
        getContent.setType("image/*");
        getContent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (!launchPicker(getContent, REQUEST_PICK_IMAGE, "选择图片或截图")) {
            toast("无法打开图片选择器，请尝试拍照或从相册分享图片到教育管家。");
        }
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
            toast("无法打开相机：" + error.getMessage() + "。请改用“选择图片/截图”或从相册分享图片。");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
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
        if ((requestCode == REQUEST_PICK_MATERIAL || requestCode == REQUEST_PICK_IMAGE) && resultCode == RESULT_OK && data != null) {
            List<Uri> uris = extractUris(data);
            if (uris.size() > 0) uploadMaterials(uris, true);
            return;
        }
        if (requestCode == REQUEST_TAKE_PHOTO) {
            if (resultCode == RESULT_OK && pendingCameraUri != null) {
                List<Uri> uris = new ArrayList<Uri>();
                uris.add(pendingCameraUri);
                uploadMaterials(uris, true);
            } else {
                toast("未拍照上传资料。");
            }
            pendingCameraUri = null;
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
            .setPositiveButton("上传选中", new DownloadsUploadClickListener(this, entries, checked))
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
        if (uris.size() == 0) {
            toast("未发现可接收的分享文件。");
            return;
        }
        pendingSharedUris.clear();
        pendingSharedUris.addAll(uris);
        updateSharedUploadButton();
        status("已接收 " + uris.size() + " 个分享资料，请选择学生后点击“上传分享资料”。");
    }

    void updateSharedUploadButton() {
        if (sharedUploadButton == null) return;
        if (pendingSharedUris.size() > 0) {
            sharedUploadButton.setText("上传分享资料(" + pendingSharedUris.size() + ")");
            sharedUploadButton.setVisibility(View.VISIBLE);
            sharedUploadButton.setEnabled(selectedStudent != null);
        } else {
            sharedUploadButton.setText("上传分享资料");
            sharedUploadButton.setVisibility(View.GONE);
            sharedUploadButton.setEnabled(false);
        }
        if (retryFailedUploadButton != null) {
            retryFailedUploadButton.setText("重试失败资料(" + failedUploadUris.size() + ")");
            retryFailedUploadButton.setVisibility(failedUploadUris.size() > 0 ? View.VISIBLE : View.GONE);
            retryFailedUploadButton.setEnabled(selectedStudent != null && failedUploadUris.size() > 0);
        }
    }

    void uploadPendingSharedMaterials() {
        if (pendingSharedUris.size() == 0) {
            toast("没有待上传的分享资料。");
            return;
        }
        uploadMaterials(new ArrayList<Uri>(pendingSharedUris), true);
    }

    void retryFailedUploads() {
        if (failedUploadUris.size() == 0) {
            toast("没有失败资料需要重试。");
            return;
        }
        uploadMaterials(new ArrayList<Uri>(failedUploadUris), true);
    }

    void uploadMaterial(Uri uri) {
        List<Uri> uris = new ArrayList<Uri>();
        uris.add(uri);
        uploadMaterials(uris, true);
    }

    void uploadMaterials(List<Uri> uris, boolean reloadAfterFinish) {
        if (selectedStudent == null) {
            toast("请先选择学生。");
            return;
        }
        if (uris == null || uris.size() == 0) {
            toast("没有可上传的资料。");
            return;
        }
        String base = normalizedBaseUrl();
        String token = apiToken();
        if (base.length() == 0 || token.length() == 0) {
            toast("请先连接主机服务。");
            return;
        }
        status("准备上传 " + uris.size() + " 个资料...");
        setUploadQueueText("上传队列：0/" + uris.size() + "，准备开始。");
        new Thread(new UploadMaterialsTask(this, base, token, selectedStudent.id, new ArrayList<Uri>(uris), reloadAfterFinish)).start();
    }

    void setUploadQueueText(String text) {
        if (uploadQueueText != null) uploadQueueText.setText(text);
    }

    void updateConnectionSummary(String state, int studentCount) {
        String last = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_LAST_CONNECTED_AT, "");
        StringBuilder text = new StringBuilder();
        text.append("连接状态：").append(state).append("\n");
        text.append("主机地址：").append(normalizedBaseUrl().length() > 0 ? normalizedBaseUrl() : "未填写").append("\n");
        text.append("本机设备：").append(deviceName()).append("\n");
        text.append("授权学生：").append(studentCount).append(" 位");
        if (last != null && last.length() > 0) text.append("\n最近连接成功：").append(last);
        connectionSummaryText.setText(text.toString());
        updateConnectionHint(state, studentCount);
    }

    void updateConnectionHint(String state, int studentCount) {
        if (connectionHintText == null) return;
        String lower = state == null ? "" : state.toLowerCase(Locale.ROOT);
        String hint;
        if (lower.contains("成功") || lower.contains("connected") || lower.contains("已连接")) {
            hint = studentCount <= 0
                ? "连接排查：主机已连通，但当前设备没有可访问学生。请在 Windows 主机服务的设备列表中勾选学生访问范围。"
                : "连接正常：可以上传资料到主机，也可以刷新查看学情档案。";
        } else if (lower.contains("token") || lower.contains("授权") || lower.contains("401") || lower.contains("403")) {
            hint = "连接排查：授权可能已失效。请在 Windows 主机端撤销旧设备后，重新扫码绑定。";
        } else if (lower.contains("失败") || lower.contains("error") || lower.contains("timeout") || lower.contains("refused")) {
            hint = "连接排查：请确认电脑和平板在同一网络，Windows 主机服务已启动，防火墙允许端口 18777 或当前设置端口访问。";
        } else {
            hint = "连接排查：先确认 Windows 首页选择“主机-平板模式”并启动主机服务；平板与电脑连接同一 Wi-Fi；如果仍失败，请重新扫码绑定。";
        }
        connectionHintText.setText(hint);
    }

    void markConnectedNow() {
        String time = android.text.format.DateFormat.format("yyyy-MM-dd HH:mm:ss", new java.util.Date()).toString();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_LAST_CONNECTED_AT, time).apply();
    }

    void applyUploadResult(int success, int total, List<Uri> failed, List<String> failureLabels) {
        failedUploadUris.clear();
        failedUploadUris.addAll(failed);
        StringBuilder text = new StringBuilder();
        String studentName = selectedStudent == null ? "当前学生" : selectedStudent.name;
        if (success == total) text.append("最近上传结果：全部成功，").append(success).append(" 个资料已进入主机。");
        else if (success == 0) text.append("最近上传结果：全部失败，共 ").append(total).append(" 个。");
        else text.append("最近上传结果：部分成功，成功 ").append(success).append(" 个，失败 ").append(total - success).append(" 个。");
        if (success > 0) text.append("\n已上传到：").append(studentName).append(" 的主机原始资料库。");
        if (failureLabels.size() > 0) {
            text.append("\n失败资料：");
            int limit = Math.min(3, failureLabels.size());
            for (int i = 0; i < limit; i++) text.append("\n").append(i + 1).append(". ").append(failureLabels.get(i));
            if (failureLabels.size() > limit) text.append("\n... 还有 ").append(failureLabels.size() - limit).append(" 个失败资料");
        }
        uploadResultText.setText(text.toString());
        updateSharedUploadButton();
    }

    JSONObject getJson(String urlText, String token) throws Exception {
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
            throw new Exception(json.optString("message", "HTTP " + code));
        }
        return json;
    }

    JSONObject postJson(String urlText, JSONObject body) throws Exception {
        return postJson(urlText, body, "");
    }

    JSONObject postJson(String urlText, JSONObject body, String token) throws Exception {
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
            throw new Exception(json.optString("message", "HTTP " + code));
        }
        return json;
    }

    JSONObject postFile(String urlText, String token, Uri uri) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(45000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        String boundary = "----EduTerminal" + System.currentTimeMillis();
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

        InputStream input = openUriInput(uri);
        OutputStream output = connection.getOutputStream();
        String fileName = displayName(uri);
        String head = "--" + boundary + "\r\n"
            + "Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName.replace("\"", "_") + "\"\r\n"
            + "Content-Type: application/octet-stream\r\n\r\n";
        output.write(head.getBytes("UTF-8"));
        byte[] buffer = new byte[16384];
        int read;
        while (input != null && (read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        if (input != null) input.close();
        output.write(("\r\n--" + boundary + "--\r\n").getBytes("UTF-8"));
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
        if (value.length() == 0) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    String normalizedRemoteUrl() {
        if (remoteInput == null) return "";
        String value = remoteInput.getText().toString().trim();
        if (value.length() == 0) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
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
        if (remoteInput != null) remoteInput.setText(prefs.getString(PREF_REMOTE_URL, ""));
        if (connectionModeSpinner != null) connectionModeSpinner.setSelection(prefs.getInt(PREF_CONNECTION_MODE, 1));
        updateConnectionSummary("未连接", students.size());
    }

    void savePrefs() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_SERVER_URL, serverInput.getText().toString().trim())
            .putString(PREF_API_TOKEN, apiToken())
            .putString(PREF_REMOTE_URL, normalizedRemoteUrl())
            .putInt(PREF_CONNECTION_MODE, connectionMode())
            .apply();
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
            if (base.length() == 0 || pairCode.length() == 0) {
                toast("配对内容缺少主机地址或配对码。");
                return true;
            }
            serverInput.setText(base);
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

    void pasteConnectionInfo() {
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
        if (handlePairPayload(pasted)) return;
        if (pasted.startsWith("http://") || pasted.startsWith("https://")) {
            serverInput.setText(pickPreferredServerUrl(pasted));
            savePrefs();
            toast("已粘贴连接地址。");
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
            if ("apiToken".equalsIgnoreCase(key)) tokenInput.setText(value);
        }
        if (candidateUrls.size() > 0) {
            serverInput.setText(pickPreferredServerUrl(candidateUrls));
        } else if (serverUrl.length() > 0) {
            serverInput.setText(serverUrl);
        }
        savePrefs();
        toast("已粘贴连接信息。");
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

    void checkForUpdate() {
        status("正在检查平板终端更新...");
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
        String message = "连接失败：" + detail;
        if (url.indexOf("://100.") >= 0 || detail.toLowerCase().indexOf("failed to connect") >= 0 || detail.toLowerCase().indexOf("timed out") >= 0) {
            message += "\n请确认 Windows 主机服务已启动，并优先使用同一 Wi-Fi 网段地址，例如 http://192.168.x.x:18777。不要优先使用 100.x.x.x 这类虚拟网卡地址，除非平板也已接入同一虚拟网络。";
        }
        return message;
    }

    void applyStudents(List<Student> result, String error) {
        if (error != null) {
            status("读取学生失败：" + error);
            return;
        }
        students.clear();
        students.addAll(result);
        studentAdapter.clear();
        for (int i = 0; i < students.size(); i++) studentAdapter.add(students.get(i).displayName());
        studentAdapter.notifyDataSetChanged();
        int selectedIndex = studentSpinner.getSelectedItemPosition();
        if (selectedIndex < 0 || selectedIndex >= students.size()) selectedIndex = 0;
        selectedStudent = students.size() > 0 ? students.get(selectedIndex) : null;
        uploadButton.setEnabled(students.size() > 0);
        updateSharedUploadButton();
        updateContactCard();
        updateConnectionSummary("已连接", students.size());
        status(students.size() > 0 ? "已读取 " + students.size() + " 个学生。" : "主机服务中还没有学生。");
    }

    void applyArchiveFiles(List<ArchiveFile> result, String error) {
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
            markdownView.setText(error);
            currentMarkdown = "";
            allArchiveFiles.clear();
            archiveFiles.clear();
            archiveAdapter.clear();
            archiveAdapter.notifyDataSetChanged();
            return;
        }
        allArchiveFiles.clear();
        allArchiveFiles.addAll(result);
        if (selectedStudent != null) cacheArchiveFiles(selectedStudent.id, result);
        applyArchiveCategoryFilter();
        if (selectedStudent != null) status("档案已同步：" + archiveListCacheTimeText(selectedStudent.id));
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
        archiveAdapter.clear();
        for (int i = 0; i < archiveFiles.size(); i++) archiveAdapter.add(archiveFiles.get(i).path);
        archiveAdapter.notifyDataSetChanged();
        archiveTitle.setText(archiveFiles.size() > 0 ? "请选择档案。" : "暂无 Markdown 档案。");
        if (archiveFiles.size() == 0) {
            markdownView.setText(allArchiveFiles.size() == 0 ? "Windows 主机中还没有该学生的学情分析 Markdown。" : "该分类下暂无 Markdown 档案。");
            currentMarkdown = "";
        }
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
                markdownView.setText(cached);
                String cacheTime = cacheTimeText(lookupStudentId, path);
                archiveTitle.setText(title + "（离线缓存" + (cacheTime.length() > 0 ? "：" + cacheTime : "") + "）");
                status("正文读取失败，已显示最近缓存：" + error);
            } else {
                markdownView.setText("读取失败：" + error);
                currentMarkdown = "";
            }
        } else {
            currentMarkdown = content;
            markdownView.setText(content.length() == 0 ? "该 Markdown 文件为空。" : content);
            if (studentId != null && path != null) {
                String cacheTime = cacheTimeText(studentId, path);
                if (cacheTime.length() > 0) archiveTitle.setText(title + "（缓存：" + cacheTime + "）");
            }
        }
    }

    void status(String message) {
        statusText.setText(message);
    }

    void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private LinearLayout card() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(14), dp(12), dp(14), dp(12));
        layout.setBackgroundColor(Color.WHITE);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, 0, 0, dp(14));
        layout.setLayoutParams(params);
        return layout;
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
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
        button.setTextColor(primary ? Color.WHITE : Color.rgb(15, 118, 110));
        button.setBackgroundColor(primary ? Color.rgb(15, 118, 110) : Color.rgb(232, 247, 244));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1);
        params.setMargins(0, 0, dp(8), 0);
        button.setLayoutParams(params);
        return button;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
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
    final int archiveFileCount;
    final int pendingDigestCount;
    final int submittedDigestCount;
    final int processedDigestCount;
    final String lastDigestAt;
    final String digestStatus;
    final String digestMessage;

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
        this.archiveFileCount = json.optInt("archiveFileCount", 0);
        this.pendingDigestCount = json.optInt("pendingDigestCount", 0);
        this.submittedDigestCount = json.optInt("submittedDigestCount", 0);
        this.processedDigestCount = json.optInt("processedDigestCount", 0);
        this.lastDigestAt = json.optString("lastDigestAt", "");
        this.digestStatus = json.optString("digestStatus", "idle");
        this.digestMessage = json.optString("digestMessage", "");
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

class ArchiveFile {
    final String name;
    final String path;

    ArchiveFile(JSONObject json) {
        this.name = json.optString("name", json.optString("path", "Markdown"));
        this.path = json.optString("path", name);
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
        else activity.uploadPendingSharedMaterials();
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
            activity.toast("请先选择要上传的文件。");
            return;
        }
        activity.uploadMaterials(selected, true);
    }
}

class ConnectTask implements Runnable {
    private final MainActivity activity;
    private final String base;

    ConnectTask(MainActivity activity, String base) {
        this.activity = activity;
        this.base = base;
    }

    @Override
    public void run() {
        try {
            JSONObject health = activity.getJson(base + "/api/health", null);
            activity.markConnectedNow();
            activity.runOnUiThread(new StatusTask(activity, "主机服务已连接，版本：" + health.optString("version", "未知")));
            activity.runOnUiThread(new ConnectionSummaryTask(activity, "已连接", activity.students.size()));
            activity.runOnUiThread(new StartLoadStudentsTask(activity));
        } catch (Exception error) {
            activity.runOnUiThread(new StatusTask(activity, activity.connectionErrorMessage(base, error.getMessage())));
            activity.runOnUiThread(new ConnectionSummaryTask(activity, "连接失败", activity.students.size()));
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
        activity.savePrefs();
        activity.markConnectedNow();
        activity.status("绑定主机成功，正在读取学生列表...");
        activity.updateConnectionSummary("已绑定", activity.students.size());
        activity.toast("绑定主机成功。");
        activity.loadStudents();
    }
}

class LoadStudentsTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;

    LoadStudentsTask(MainActivity activity, String base, String token) {
        this.activity = activity;
        this.base = base;
        this.token = token;
    }

    @Override
    public void run() {
        try {
            JSONObject json = activity.getJson(base + "/api/students", token);
            try {
                activity.postJson(base + "/api/device/heartbeat", new JSONObject(), token);
            } catch (Exception ignored) {
            }
            JSONArray array = json.optJSONArray("students");
            List<Student> result = new ArrayList<Student>();
            if (array != null) {
                for (int i = 0; i < array.length(); i++) {
                    JSONObject item = array.optJSONObject(i);
                    if (item != null) result.add(new Student(item));
                }
            }
            activity.runOnUiThread(new StudentsResultTask(activity, result, null));
        } catch (Exception error) {
            activity.runOnUiThread(new StudentsResultTask(activity, null, error.getMessage()));
        }
    }
}

class LoadArchiveFilesTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;

    LoadArchiveFilesTask(MainActivity activity, String base, String token, String studentId) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
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
                        ArchiveFile file = new ArchiveFile(item);
                        String lower = file.path.toLowerCase();
                        if (lower.endsWith(".md") && !lower.equals("agent.md") && !lower.equals("log.md")) {
                            result.add(file);
                        }
                    }
                }
            }
            activity.runOnUiThread(new ArchiveFilesResultTask(activity, result, null));
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
            activity.runOnUiThread(new ArchiveFilesResultTask(activity, null, error.getMessage()));
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

class UploadMaterialsTask implements Runnable {
    private final MainActivity activity;
    private final String base;
    private final String token;
    private final String studentId;
    private final List<Uri> uris;
    private final boolean reloadAfterFinish;

    UploadMaterialsTask(MainActivity activity, String base, String token, String studentId, List<Uri> uris, boolean reloadAfterFinish) {
        this.activity = activity;
        this.base = base;
        this.token = token;
        this.studentId = studentId;
        this.uris = uris;
        this.reloadAfterFinish = reloadAfterFinish;
    }

    @Override
    public void run() {
        int success = 0;
        ArrayList<String> failures = new ArrayList<String>();
        ArrayList<String> failureLabels = new ArrayList<String>();
        ArrayList<Uri> failedUris = new ArrayList<Uri>();
        ArrayList<Uri> uploadedUris = new ArrayList<Uri>();
        for (int i = 0; i < uris.size(); i++) {
            Uri uri = uris.get(i);
            String fileName = activity.displayName(uri);
            try {
                activity.runOnUiThread(new StatusTask(activity, "正在上传 " + (i + 1) + "/" + uris.size() + "：" + fileName));
                activity.runOnUiThread(new UploadQueueStatusTask(activity, "上传队列：" + (i + 1) + "/" + uris.size() + "，正在上传：" + fileName));
                String url = base + "/api/students/" + activity.encode(studentId) + "/materials?filename=" + activity.encode(fileName);
                activity.postFile(url, token, uri);
                success += 1;
                uploadedUris.add(uri);
                activity.runOnUiThread(new UploadQueueStatusTask(activity, "上传队列：" + success + "/" + uris.size() + " 已成功，剩余 " + (uris.size() - i - 1) + " 个。"));
            } catch (Exception error) {
                failures.add(fileName + "：" + error.getMessage());
                failureLabels.add(fileName);
                failedUris.add(uri);
            }
        }
        activity.pendingSharedUris.removeAll(uploadedUris);
        if (failures.size() == 0) {
            activity.pendingSharedUris.clear();
            activity.runOnUiThread(new StatusTask(activity, "上传完成：" + success + " 个资料已进入 Windows 主机原始资料库。"));
            activity.runOnUiThread(new ToastTask(activity, "上传完成：" + success + " 个资料。"));
        } else {
            String firstFailure = failures.get(0);
            activity.runOnUiThread(new StatusTask(activity, "上传完成 " + success + "/" + uris.size() + " 个；失败 " + failures.size() + " 个。首个失败：" + firstFailure));
            activity.runOnUiThread(new ToastTask(activity, "部分资料上传失败，请检查主机连接后重试。"));
        }
        activity.runOnUiThread(new UploadResultTask(activity, success, uris.size(), failedUris, failureLabels));
        activity.runOnUiThread(new UploadQueueStatusTask(activity, "上传队列：完成，成功 " + success + " 个，失败 " + failures.size() + " 个。"));
        activity.runOnUiThread(new ClearSharedUploadTask(activity));
        if (reloadAfterFinish) {
            activity.runOnUiThread(new StartLoadStudentsTask(activity));
        }
    }
}

class UploadResultTask implements Runnable {
    private final MainActivity activity;
    private final int success;
    private final int total;
    private final List<Uri> failed;
    private final List<String> failureLabels;

    UploadResultTask(MainActivity activity, int success, int total, List<Uri> failed, List<String> failureLabels) {
        this.activity = activity;
        this.success = success;
        this.total = total;
        this.failed = failed;
        this.failureLabels = failureLabels;
    }

    @Override
    public void run() {
        activity.applyUploadResult(success, total, failed, failureLabels);
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

class StudentsResultTask implements Runnable {
    private final MainActivity activity;
    private final List<Student> result;
    private final String error;

    StudentsResultTask(MainActivity activity, List<Student> result, String error) {
        this.activity = activity;
        this.result = result;
        this.error = error;
    }

    @Override
    public void run() {
        activity.applyStudents(result, error);
    }
}

class ArchiveFilesResultTask implements Runnable {
    private final MainActivity activity;
    private final List<ArchiveFile> result;
    private final String error;

    ArchiveFilesResultTask(MainActivity activity, List<ArchiveFile> result, String error) {
        this.activity = activity;
        this.result = result;
        this.error = error;
    }

    @Override
    public void run() {
        activity.applyArchiveFiles(result, error);
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
                activity.runOnUiThread(new StatusTask(activity, "发现平板终端新版 " + (versionName.length() > 0 ? versionName : versionCode) + "，正在打开下载地址。" + (notes.length() > 0 ? "\n" + notes : "")));
                activity.runOnUiThread(new OpenUrlTask(activity, url));
            } else {
                activity.runOnUiThread(new StatusTask(activity, "当前平板终端已是最新版本 v" + MainActivity.VERSION_NAME + "。"));
            }
        } catch (Exception error) {
            activity.runOnUiThread(new StatusTask(activity, "检查更新失败：" + error.getMessage()));
        }
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


