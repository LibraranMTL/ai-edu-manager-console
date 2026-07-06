package com.qxmatrix.edumanager;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.provider.OpenableColumns;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.net.HttpURLConnection;
import java.net.URL;

import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int REQUEST_IMPORT_FILES = 3001;
    private static final int REQUEST_ARCHIVE_ROOT = 3002;
    private static final int REQUEST_IMPORT_IMAGES = 3003;
    private static final int REQUEST_TAKE_PHOTO = 3004;
    private static final String PREFS_NAME = "edu_manager_prefs";
    private static final String PREF_ARCHIVE_ROOT = "archive_root_uri";
    private static final String[] MATERIAL_MIME_TYPES = new String[]{
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
    private WebView webView;
    private boolean qclawOpened = false;
    private boolean marvisOpened = false;
    private boolean obsidianOpened = false;
    private String pendingImportStudent = "学生";
    private Uri pendingCameraUri = null;
    private final ArrayList<Uri> pendingSharedUris = new ArrayList<Uri>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
        webView.setWebChromeClient(new EduWebChromeClient(this));
        webView.setWebViewClient(new ExternalAppClient(this));

        setContentView(webView);
        handleIncomingShare(getIntent());
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingShare(intent);
    }

    private boolean openExternal(String app) {
        boolean ok = false;
        if ("obsidian".equals(app)) {
            ok = openUri("obsidian://open")
                    || openPackage("com.dynalist.obsidian")
                    || openByLabelOrPackage("obsidian");
            obsidianOpened = ok || obsidianOpened;
        } else if ("qclaw".equals(app)) {
            ok = openUri("qclaw://")
                    || openByLabelOrPackage("qclaw")
                    || openByLabelOrPackage("q-claw");
            qclawOpened = ok || qclawOpened;
        } else if ("marvis".equals(app)) {
            ok = openUri("marvis://")
                    || openByLabelOrPackage("marvis");
            marvisOpened = ok || marvisOpened;
        }

        if (!ok) {
            Toast.makeText(this, "未找到可打开的 " + app, Toast.LENGTH_SHORT).show();
        }
        return ok;
    }

    private boolean openUri(String uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(getPackageManager()) == null) return false;
            startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean openPackage(String packageName) {
        try {
            Intent intent = getPackageManager().getLaunchIntentForPackage(packageName);
            if (intent == null) return false;
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean openByLabelOrPackage(String keyword) {
        try {
            PackageManager pm = getPackageManager();
            List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);
            String needle = keyword.toLowerCase(Locale.ROOT);
            for (ApplicationInfo info : apps) {
                String packageName = info.packageName == null ? "" : info.packageName.toLowerCase(Locale.ROOT);
                CharSequence labelSeq = pm.getApplicationLabel(info);
                String label = labelSeq == null ? "" : labelSeq.toString().toLowerCase(Locale.ROOT);
                if (packageName.contains(needle) || label.contains(needle)) {
                    if (openPackage(info.packageName)) return true;
                }
            }
        } catch (Exception ignored) {
            return false;
        }
        return false;
    }

    private boolean startImportFiles(String studentName) {
        pendingImportStudent = sanitizeName(studentName);
        Intent openDocument = buildFilePickIntent(Intent.ACTION_OPEN_DOCUMENT);
        if (launchFilePickIntent(openDocument)) return true;

        Intent getContent = buildFilePickIntent(Intent.ACTION_GET_CONTENT);
        if (launchFilePickIntent(getContent)) return true;

        String message = "当前平板的系统文件选择器不完整，请改用“扫描 Downloads 最近文件”或从文件管理器中分享文件到教育管家。";
        notifyImportResult(message);
        return false;
    }

    private boolean startTakePhoto(String studentName) {
        pendingImportStudent = sanitizeName(studentName);
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "edu-photo-" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AI教育管家");
            }
            pendingCameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (pendingCameraUri == null) return false;
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (intent.resolveActivity(getPackageManager()) == null) return false;
            startActivityForResult(intent, REQUEST_TAKE_PHOTO);
            return true;
        } catch (Exception e) {
            notifyImportResult("无法打开相机：" + e.getMessage());
            return false;
        }
    }

    private boolean startImportImages(String studentName) {
        pendingImportStudent = sanitizeName(studentName);
        try {
            Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
            intent.setType("image/*");
            if (intent.resolveActivity(getPackageManager()) != null) {
                startActivityForResult(intent, REQUEST_IMPORT_IMAGES);
                return true;
            }
        } catch (Exception ignored) {
        }

        try {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            if (intent.resolveActivity(getPackageManager()) == null) return false;
            startActivityForResult(Intent.createChooser(intent, "选择图片或截图"), REQUEST_IMPORT_IMAGES);
            return true;
        } catch (Exception e) {
            notifyImportResult("无法打开图片选择器：" + e.getMessage());
            return false;
        }
    }

    private Intent buildFilePickIntent(String action) {
        Intent intent = new Intent(action);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, MATERIAL_MIME_TYPES);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        return intent;
    }

    private boolean launchFilePickIntent(Intent intent) {
        try {
            if (intent.resolveActivity(getPackageManager()) == null) return false;
            startActivityForResult(Intent.createChooser(intent, "选择要导入的学习资料"), REQUEST_IMPORT_FILES);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_ARCHIVE_ROOT) {
            handleArchiveRootResult(resultCode, data);
            return;
        }
        if (requestCode == REQUEST_TAKE_PHOTO) {
            if (resultCode != RESULT_OK || pendingCameraUri == null) {
                notifyImportResult("未拍照导入资料。");
                pendingCameraUri = null;
                return;
            }
            try {
                boolean ok = copyImportedUri(pendingCameraUri, "图片");
                notifyImportResult(ok ? "已导入 1 个拍照文件到「" + pendingImportStudent + "原始资料库」。" : "拍照文件导入失败。");
            } catch (Exception e) {
                notifyImportResult("拍照导入失败：" + e.getMessage());
            } finally {
                pendingCameraUri = null;
            }
            return;
        }
        if (requestCode != REQUEST_IMPORT_FILES && requestCode != REQUEST_IMPORT_IMAGES) return;
        if (resultCode != RESULT_OK || data == null) {
            notifyImportResult("未选择资料。");
            return;
        }

        int imported = 0;
        try {
            String category = requestCode == REQUEST_IMPORT_IMAGES ? "图片" : "";
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    Uri uri = data.getClipData().getItemAt(i).getUri();
                    if (copyImportedUri(uri, category)) imported++;
                }
            } else if (data.getData() != null) {
                if (copyImportedUri(data.getData(), category)) imported++;
            }
            notifyImportResult("已导入 " + imported + " 个文件到「" + pendingImportStudent + "原始资料库」。");
        } catch (Exception e) {
            notifyImportResult("导入失败：" + e.getMessage());
        }
    }

    private boolean copyImportedUri(Uri sourceUri) throws Exception {
        return copyImportedUri(sourceUri, "");
    }

    private boolean copyImportedUri(Uri sourceUri, String category) throws Exception {
        String displayName = getDisplayName(sourceUri);
        if (displayName == null || displayName.trim().isEmpty()) {
            displayName = "资料-" + System.currentTimeMillis();
        }
        displayName = displayName.replaceAll("[\\\\/:*?\"<>|]", "_");
        File dir = getRawDir(pendingImportStudent);
        if (category != null && category.length() > 0) {
            dir = new File(dir, category);
        }
        if (!dir.exists()) dir.mkdirs();

        InputStream input = getContentResolver().openInputStream(sourceUri);
        if (input == null) return false;

        OutputStream output = null;
        try {
            output = new FileOutputStream(uniqueFile(dir, displayName));
            if (output == null) throw new Exception("无法写入目标文件");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            mirrorUriToPublicWorkspace(sourceUri, displayName, category);
            return true;
        } finally {
            try {
                input.close();
            } catch (Exception ignored) {
            }
            if (output != null) {
                try {
                    output.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private String getDisplayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        String last = uri.getLastPathSegment();
        return last == null ? null : last;
    }

    private void notifyImportResult(final String message) {
        if (webView == null) return;
        runOnUiThread(new ImportResultTask(this, message));
    }

    private String sanitizeName(String value) {
        if (value == null) return "学生";
        String cleaned = value.trim().replaceAll("[\\\\/:*?\"<>|]", "");
        return cleaned.isEmpty() ? "学生" : cleaned;
    }

    private File getStudentRootDir(String studentName) {
        return new File(new File(getFilesDir(), "学生资料"), sanitizeName(studentName) + "知识库");
    }

    private File getRawDir(String studentName) {
        return new File(getStudentRootDir(studentName), sanitizeName(studentName) + "原始资料库");
    }

    private File getSummaryDir(String studentName) {
        return new File(getStudentRootDir(studentName), sanitizeName(studentName) + "学情分析汇总");
    }

    private String getPublicWorkspaceRelativeDir(String studentName) {
        return Environment.DIRECTORY_DOWNLOADS + "/AI教育管家/学生资料/" + sanitizeName(studentName) + "知识库";
    }

    private String getPublicRawRelativeDir(String studentName, String category) {
        String base = getPublicWorkspaceRelativeDir(studentName) + "/" + sanitizeName(studentName) + "原始资料库";
        return category == null || category.length() == 0 ? base : base + "/" + category;
    }

    private String getPublicSummaryRelativeDir(String studentName) {
        return getPublicWorkspaceRelativeDir(studentName) + "/" + sanitizeName(studentName) + "学情分析汇总";
    }

    private File uniqueFile(File dir, String displayName) {
        File out = new File(dir, displayName);
        if (!out.exists()) return out;
        int dot = displayName.lastIndexOf('.');
        String base = dot > 0 ? displayName.substring(0, dot) : displayName;
        String ext = dot > 0 ? displayName.substring(dot) : "";
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    private String initStudentWorkspace(String studentName, String agentMd, String indexMd, String logMd) {
        try {
            String cleanName = sanitizeName(studentName);
            File root = getStudentRootDir(cleanName);
            File raw = getRawDir(cleanName);
            File summary = getSummaryDir(cleanName);
            new File(root, "输出结果").mkdirs();
            raw.mkdirs();
            new File(raw, "图片").mkdirs();
            summary.mkdirs();
            new File(summary, "摘要库").mkdirs();
            new File(summary, "概念库").mkdirs();
            new File(summary, "实体库").mkdirs();
            new File(summary, "综合库").mkdirs();
            new File(summary, "咨询精华库").mkdirs();
            writeTextIfNeeded(new File(root, "AGENT.md"), agentMd);
            writeTextIfNeeded(new File(summary, "index.md"), indexMd);
            writeTextIfNeeded(new File(summary, "log.md"), logMd);
            writePublicText(getPublicWorkspaceRelativeDir(cleanName), "AGENT.md", agentMd);
            writePublicText(getPublicSummaryRelativeDir(cleanName), "index.md", indexMd);
            writePublicText(getPublicSummaryRelativeDir(cleanName), "log.md", logMd);
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("rootPathLabel", "Downloads/AI教育管家/学生资料/" + cleanName + "知识库");
            out.put("rawCount", countFiles(raw));
            out.put("markdownCount", countMarkdownFiles(summary));
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"初始化内置资料库失败：" + safeJson(e.getMessage()) + "\"}";
        }
    }

    private void writeTextIfNeeded(File file, String content) throws Exception {
        if (file.exists()) return;
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        FileOutputStream stream = new FileOutputStream(file);
        try {
            stream.write((content == null ? "" : content).getBytes(StandardCharsets.UTF_8));
        } finally {
            stream.close();
        }
    }

    private int countFiles(File dir) {
        if (dir == null || !dir.exists()) return 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        int count = 0;
        for (File file : files) {
            if (file.isDirectory()) count += countFiles(file);
            else count++;
        }
        return count;
    }

    private int countMarkdownFiles(File dir) {
        if (dir == null || !dir.exists()) return 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        int count = 0;
        for (File file : files) {
            if (file.isDirectory()) count += countMarkdownFiles(file);
            else if (file.getName().toLowerCase(Locale.ROOT).endsWith(".md")) count++;
        }
        return count;
    }

    private void writePublicText(String relativeDir, String filename, String content) {
        byte[] data = content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8);
        writePublicBytes(relativeDir, filename, data, filename.toLowerCase(Locale.ROOT).endsWith(".md") ? "text/markdown" : "text/plain");
    }

    private void mirrorUriToPublicWorkspace(Uri sourceUri, String displayName, String category) {
        InputStream input = null;
        try {
            input = getContentResolver().openInputStream(sourceUri);
            if (input == null) return;
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                bytes.write(buffer, 0, read);
            }
            writePublicBytes(getPublicRawRelativeDir(pendingImportStudent, category), displayName, bytes.toByteArray(), guessMimeType(displayName));
        } catch (Exception ignored) {
        } finally {
            if (input != null) {
                try {
                    input.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private void writePublicBytes(String relativeDir, String filename, byte[] data, String mimeType) {
        String safeName = filename == null || filename.trim().isEmpty()
                ? "资料-" + System.currentTimeMillis()
                : filename.replaceAll("[\\\\/:*?\"<>|]", "_");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType == null ? "application/octet-stream" : mimeType);
                values.put(MediaStore.Downloads.RELATIVE_PATH, relativeDir);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return;
                OutputStream output = getContentResolver().openOutputStream(uri);
                if (output != null) {
                    output.write(data == null ? new byte[0] : data);
                    output.close();
                }
                return;
            }

            File dir = new File(Environment.getExternalStorageDirectory(), relativeDir.replace(Environment.DIRECTORY_DOWNLOADS + "/", ""));
            if (!dir.exists()) dir.mkdirs();
            FileOutputStream stream = new FileOutputStream(uniqueFile(dir, safeName));
            try {
                stream.write(data == null ? new byte[0] : data);
            } finally {
                stream.close();
            }
        } catch (Exception ignored) {
        }
    }

    private String guessMimeType(String filename) {
        String lower = filename == null ? "" : filename.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".doc")) return "application/msword";
        if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
        if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        return "application/octet-stream";
    }

    private String exportTextFile(String filename, String content) {
        String safeName = filename == null || filename.trim().isEmpty()
                ? "AI教育管家初始化包.json"
                : filename.replaceAll("[\\\\/:*?\"<>|]", "_");
        byte[] data = content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8);
        String mimeType = safeName.toLowerCase(Locale.ROOT).endsWith(".md")
                ? "text/markdown"
                : "application/json";

        try {
            Uri uri = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AI教育管家");
                uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    OutputStream output = getContentResolver().openOutputStream(uri);
                    if (output != null) {
                        output.write(data);
                        output.close();
                    }
                }
            }

            if (uri == null) {
                File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "AI教育管家");
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, safeName);
                FileOutputStream stream = new FileOutputStream(out);
                stream.write(data);
                stream.close();
                uri = Uri.fromFile(out);
            }

            Toast.makeText(this, "已导出到 Downloads/AI教育管家", Toast.LENGTH_LONG).show();
            return "{\"ok\":true,\"uri\":\"" + uri.toString().replace("\"", "\\\"") + "\"}";
        } catch (Exception e) {
            Toast.makeText(this, "导出失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
            return "{\"ok\":false,\"error\":\"" + e.getMessage().replace("\"", "\\\"") + "\"}";
        }
    }

    private boolean startArchiveRootPicker() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            if (intent.resolveActivity(getPackageManager()) == null) {
                notifyMissingArchivePicker();
                return false;
            }
            startActivityForResult(intent, REQUEST_ARCHIVE_ROOT);
            return true;
        } catch (Exception e) {
            notifyMissingArchivePicker();
            return false;
        }
    }

    private void notifyMissingArchivePicker() {
        String message = "系统缺少文件夹授权组件（DocumentsUI/OPEN_DOCUMENT_TREE），无法授权档案目录。请启用系统文件管理器，或换用支持目录授权的系统版本。";
        notifyArchiveRootSelected("{\"ok\":false,\"message\":\"" + safeJson(message) + "\"}");
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private void handleArchiveRootResult(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            notifyArchiveRootSelected("{\"ok\":false,\"message\":\"未选择档案目录\"}");
            return;
        }
        Uri uri = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (Exception ignored) {
        }
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString(PREF_ARCHIVE_ROOT, uri.toString())
                .apply();
        notifyArchiveRootSelected("{\"ok\":true,\"uri\":\"" + safeJson(uri.toString()) + "\"}");
        Toast.makeText(this, "已授权档案目录", Toast.LENGTH_SHORT).show();
    }

    private String getArchiveRootStatus() {
        String uri = getArchiveRootUriString();
        if (uri == null || uri.length() == 0) {
            return "{\"ok\":false,\"message\":\"尚未授权档案目录\"}";
        }
        return "{\"ok\":true,\"uri\":\"" + safeJson(uri) + "\"}";
    }

    private String listMarkdownFiles(String studentName) {
        try {
            File privateSummary = getSummaryDir(studentName);
            if (privateSummary.exists()) {
                JSONArray files = new JSONArray();
                collectPrivateMarkdownFiles(privateSummary, "", files, 0);
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("folder", sanitizeName(studentName) + "学情分析汇总");
                out.put("storageMode", "app_private");
                out.put("files", files);
                return out.toString();
            }
            Uri treeUri = getArchiveTreeUri();
            if (treeUri == null) return "{\"ok\":false,\"message\":\"内置资料库暂无档案；可先保存学生档案或导入资料。Obsidian 授权是高级可选功能。\"}";
            String cleanName = sanitizeName(studentName);
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            String targetFolder = cleanName + "学情分析汇总";
            String targetDocId = findDirectory(treeUri, rootDocId, targetFolder, 0);
            if (targetDocId == null) {
                return "{\"ok\":false,\"message\":\"未找到 " + safeJson(targetFolder) + " 文件夹\"}";
            }
            JSONArray files = new JSONArray();
            collectMarkdownFiles(treeUri, targetDocId, "", files, 0);
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("folder", targetFolder);
            out.put("files", files);
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"读取档案失败：" + safeJson(e.getMessage()) + "\"}";
        }
    }

    private String readMarkdownFile(String documentId) {
        try {
            if (documentId != null && documentId.startsWith("private:")) {
                File file = new File(documentId.substring("private:".length()));
                if (!file.exists()) return "{\"ok\":false,\"message\":\"文件不存在\"}";
                InputStream input = new java.io.FileInputStream(file);
                String content;
                try {
                    content = readAllText(input);
                } finally {
                    input.close();
                }
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("content", content);
                return out.toString();
            }
            Uri treeUri = getArchiveTreeUri();
            if (treeUri == null) return "{\"ok\":false,\"message\":\"请先授权学生资料目录\"}";
            if (documentId == null || documentId.length() == 0) {
                return "{\"ok\":false,\"message\":\"未指定文件\"}";
            }
            Uri uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
            InputStream input = getContentResolver().openInputStream(uri);
            if (input == null) return "{\"ok\":false,\"message\":\"无法打开文件\"}";
            String content;
            try {
                content = readAllText(input);
            } finally {
                try {
                    input.close();
                } catch (Exception ignored) {
                }
            }
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("content", content);
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"读取 Markdown 失败：" + safeJson(e.getMessage()) + "\"}";
        }
    }

    private void collectPrivateMarkdownFiles(File dir, String relativePath, JSONArray files, int depth) throws Exception {
        if (depth > 8) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            String childPath = relativePath.length() == 0 ? child.getName() : relativePath + "/" + child.getName();
            if (child.isDirectory()) {
                collectPrivateMarkdownFiles(child, childPath, files, depth + 1);
            } else if (child.getName().toLowerCase(Locale.ROOT).endsWith(".md")) {
                JSONObject item = new JSONObject();
                item.put("id", "private:" + child.getAbsolutePath());
                item.put("name", child.getName());
                item.put("path", childPath);
                item.put("modified", child.lastModified());
                files.put(item);
            }
        }
    }

    private Uri getArchiveTreeUri() {
        String value = getArchiveRootUriString();
        return value == null || value.length() == 0 ? null : Uri.parse(value);
    }

    private String getArchiveRootUriString() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        return prefs.getString(PREF_ARCHIVE_ROOT, "");
    }

    private String findDirectory(Uri treeUri, String docId, String targetName, int depth) throws Exception {
        if (depth > 8) return null;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
            }, null, null, null);
            if (cursor == null) return null;
            while (cursor.moveToNext()) {
                String childId = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (targetName.equals(name)) return childId;
                    String found = findDirectory(treeUri, childId, targetName, depth + 1);
                    if (found != null) return found;
                }
            }
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    private void collectMarkdownFiles(Uri treeUri, String docId, String relativePath, JSONArray files, int depth) throws Exception {
        if (depth > 8) return;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
            }, null, null, null);
            if (cursor == null) return;
            while (cursor.moveToNext()) {
                String childId = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                long modified = cursor.isNull(3) ? 0 : cursor.getLong(3);
                String childPath = relativePath.length() == 0 ? name : relativePath + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    collectMarkdownFiles(treeUri, childId, childPath, files, depth + 1);
                } else if (name != null && name.toLowerCase(Locale.ROOT).endsWith(".md")) {
                    JSONObject item = new JSONObject();
                    item.put("id", childId);
                    item.put("name", name);
                    item.put("path", childPath);
                    item.put("modified", modified);
                    files.put(item);
                }
            }
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private String readAllText(InputStream input) throws Exception {
        byte[] buffer = new byte[8192];
        StringBuilder builder = new StringBuilder();
        int read;
        while ((read = input.read(buffer)) != -1) {
            builder.append(new String(buffer, 0, read, StandardCharsets.UTF_8));
        }
        return builder.toString();
    }

    private void notifyArchiveRootSelected(String json) {
        if (webView == null) return;
        String escaped = json.replace("\\", "\\\\").replace("'", "\\'");
        runOnUiThread(new EvalJsTask(this, "window.onNativeArchiveRootSelected && window.onNativeArchiveRootSelected('" + escaped + "')"));
    }

    private String getStatusJson() {
        return "{\"qclawOpened\":" + qclawOpened + ",\"marvisOpened\":" + marvisOpened + ",\"obsidianOpened\":" + obsidianOpened + "}";
    }

    private void handleIncomingShare(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) pendingSharedUris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (uris != null) pendingSharedUris.addAll(uris);
        }
    }

    private String getSharedInboxStatus() {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", true);
            out.put("count", pendingSharedUris.size());
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"读取分享收件箱失败：" + safeJson(e.getMessage()) + "\"}";
        }
    }

    private String consumeSharedImports(String studentName) {
        pendingImportStudent = sanitizeName(studentName);
        int imported = 0;
        try {
            for (int i = 0; i < pendingSharedUris.size(); i++) {
                if (copyImportedUri(pendingSharedUris.get(i), "分享导入")) imported++;
            }
            pendingSharedUris.clear();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("imported", imported);
            out.put("message", "已导入分享资料 " + imported + " 个。");
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"导入分享资料失败：" + safeJson(e.getMessage()) + "\"}";
        }
    }

    private String scanDownloads() {
        try {
            ArrayList<DownloadEntry> entries = new ArrayList<DownloadEntry>();
            ArrayList<String> seen = new ArrayList<String>();
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            collectDownloadFiles(downloadsDir, entries, seen, 0);
            collectMediaStoreDownloads(entries, seen);
            sortDownloadEntries(entries);

            JSONArray files = new JSONArray();
            int limit = Math.min(entries.size(), 50);
            for (int i = 0; i < limit; i++) {
                DownloadEntry entry = entries.get(i);
                JSONObject item = new JSONObject();
                item.put("id", entry.id);
                item.put("path", entry.path);
                item.put("name", entry.name);
                item.put("size", entry.size);
                item.put("modified", entry.modified);
                item.put("type", entry.type);
                item.put("importable", entry.importable);
                files.put(item);
            }

            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("files", files);
            out.put("message", "已扫描 Downloads 最近文件。");
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"扫描 Downloads 失败：" + safeJson(e.getMessage()) + "\"}";
        }
    }

    private void collectDownloadFiles(File dir, ArrayList<DownloadEntry> entries, ArrayList<String> seen, int depth) {
        if (dir == null || !dir.exists() || depth > 2) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory()) {
                collectDownloadFiles(child, entries, seen, depth + 1);
                continue;
            }
            if (!isSupportedMaterialFile(child.getName(), "")) continue;
            try {
                String path = child.getCanonicalPath();
                if (seen.contains(path)) continue;
                seen.add(path);
                entries.add(new DownloadEntry(
                        path,
                        path,
                        child.getName(),
                        child.length(),
                        child.lastModified(),
                        guessMaterialType(child.getName(), ""),
                        child.canRead()
                ));
            } catch (Exception ignored) {
            }
        }
    }

    private void collectMediaStoreDownloads(ArrayList<DownloadEntry> entries, ArrayList<String> seen) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        Cursor cursor = null;
        try {
            Uri baseUri = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            String[] projection = new String[]{
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
                entries.add(new DownloadEntry(
                        "content:" + key,
                        "content:" + key,
                        name == null ? "Downloads-" + id : name,
                        size,
                        modifiedSeconds <= 0 ? 0 : modifiedSeconds * 1000,
                        guessMaterialType(name, mime),
                        true
                ));
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private String importDownloadFiles(String studentName, String pathsJson) {
        pendingImportStudent = sanitizeName(studentName);
        int imported = 0;
        try {
            JSONArray paths = new JSONArray(pathsJson == null ? "[]" : pathsJson);
            for (int i = 0; i < paths.length(); i++) {
                String path = paths.optString(i, "");
                if (path.length() == 0) continue;
                if (path.startsWith("content:")) {
                    if (copyImportedUri(Uri.parse(path.substring("content:".length())), "Downloads")) imported++;
                } else {
                    File source = new File(path);
                    if (isAllowedDownloadFile(source) && copyFileToRaw(source, "Downloads")) imported++;
                }
            }
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("imported", imported);
            out.put("message", "已从 Downloads 导入 " + imported + " 个文件。");
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"导入 Downloads 文件失败：" + safeJson(e.getMessage()) + "\"}";
        }
    }

    private boolean isAllowedDownloadFile(File source) throws Exception {
        if (source == null || !source.exists() || !source.isFile() || !source.canRead()) return false;
        File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        String sourcePath = source.getCanonicalPath();
        String rootPath = downloadsDir.getCanonicalPath();
        return sourcePath.startsWith(rootPath) && isSupportedMaterialFile(source.getName(), "");
    }

    private boolean copyFileToRaw(File source, String category) throws Exception {
        File dir = getRawDir(pendingImportStudent);
        if (category != null && category.length() > 0) dir = new File(dir, category);
        if (!dir.exists()) dir.mkdirs();
        InputStream input = new java.io.FileInputStream(source);
        OutputStream output = null;
        try {
            output = new FileOutputStream(uniqueFile(dir, source.getName().replaceAll("[\\\\/:*?\"<>|]", "_")));
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            mirrorFileToPublicWorkspace(source, category);
            return true;
        } finally {
            try {
                input.close();
            } catch (Exception ignored) {
            }
            if (output != null) {
                try {
                    output.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private void mirrorFileToPublicWorkspace(File source, String category) {
        InputStream input = null;
        try {
            input = new java.io.FileInputStream(source);
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                bytes.write(buffer, 0, read);
            }
            writePublicBytes(getPublicRawRelativeDir(pendingImportStudent, category), source.getName(), bytes.toByteArray(), guessMimeType(source.getName()));
        } catch (Exception ignored) {
        } finally {
            if (input != null) {
                try {
                    input.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private boolean isSupportedMaterialFile(String name, String mime) {
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

    private String guessMaterialType(String name, String mime) {
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

    private void sortDownloadEntries(ArrayList<DownloadEntry> entries) {
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

    private String getCompatibilityStatus() {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("filePicker", canResolve(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)));
            out.put("folderPicker", canResolve(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)));
            out.put("imageImport", canResolve(new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).setType("image/*")));
            out.put("cameraImport", canResolve(new Intent(MediaStore.ACTION_IMAGE_CAPTURE)));
            out.put("shareImport", true);
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            out.put("downloadsScan", downloadsDir != null && downloadsDir.exists());
            out.put("appPrivateStorage", getFilesDir() != null && getFilesDir().canWrite());
            out.put("message", "App 内置资料库可用；文件夹授权仅作为高级模式。");
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"兼容性检测失败：" + safeJson(e.getMessage()) + "\"}";
        }
    }

    private boolean canResolve(Intent intent) {
        try {
            return intent.resolveActivity(getPackageManager()) != null;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean checkUpdate(String manifestUrl, int currentVersionCode) {
        if (manifestUrl == null || manifestUrl.trim().isEmpty()) return false;
        new UpdateCheckThread(this, manifestUrl, currentVersionCode).start();
        return true;
    }

    private boolean downloadAndInstallUpdate(String apkUrl) {
        if (apkUrl == null || apkUrl.trim().isEmpty()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
                Toast.makeText(this, "请先允许本应用安装未知来源应用，然后再次点击更新。", Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {
                Toast.makeText(this, "请在系统设置中允许本应用安装未知来源应用。", Toast.LENGTH_LONG).show();
            }
            return true;
        }
        try {
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) return false;
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
            request.setTitle("AI教育管家控制台更新");
            request.setDescription("正在下载新版安装包");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "AI-edu-manager-console-update.apk");
            long id = manager.enqueue(request);
            Toast.makeText(this, "已开始下载更新包", Toast.LENGTH_SHORT).show();
            new ApkInstallWaitThread(this, manager, id).start();
            return true;
        } catch (Exception e) {
            Toast.makeText(this, "下载更新失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
            return false;
        }
    }

    private void notifyUpdateResult(String json) {
        if (webView == null) return;
        String escaped = json.replace("\\", "\\\\").replace("'", "\\'");
        runOnUiThread(new EvalJsTask(this, "window.onNativeUpdateResult && window.onNativeUpdateResult('" + escaped + "')"));
    }

    private void installDownloadedApk(Uri uri) {
        runOnUiThread(new InstallApkTask(this, uri));
    }

    private void installDownloadedApkOnUi(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "无法打开安装器：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private static class DownloadEntry {
        final String id;
        final String path;
        final String name;
        final long size;
        final long modified;
        final String type;
        final boolean importable;

        DownloadEntry(String id, String path, String name, long size, long modified, String type, boolean importable) {
            this.id = id;
            this.path = path;
            this.name = name;
            this.size = size;
            this.modified = modified;
            this.type = type;
            this.importable = importable;
        }
    }

    public static class AndroidBridge {
        private final MainActivity activity;

        AndroidBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void copyText(String value) {
            ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard != null) {
                clipboard.setPrimaryClip(ClipData.newPlainText("QClaw 初始化指令", value));
                Toast.makeText(activity, "已复制到剪贴板", Toast.LENGTH_SHORT).show();
            }
        }

        @JavascriptInterface
        public String exportTextFile(String filename, String content) {
            return activity.exportTextFile(filename, content);
        }

        @JavascriptInterface
        public boolean importFiles(String studentName) {
            return activity.startImportFiles(studentName);
        }

        @JavascriptInterface
        public boolean importImages(String studentName) {
            return activity.startImportImages(studentName);
        }

        @JavascriptInterface
        public boolean takePhoto(String studentName) {
            return activity.startTakePhoto(studentName);
        }

        @JavascriptInterface
        public String initStudentWorkspace(String studentName, String agentMd, String indexMd, String logMd) {
            return activity.initStudentWorkspace(studentName, agentMd, indexMd, logMd);
        }

        @JavascriptInterface
        public String getSharedInboxStatus() {
            return activity.getSharedInboxStatus();
        }

        @JavascriptInterface
        public String consumeSharedImports(String studentName) {
            return activity.consumeSharedImports(studentName);
        }

        @JavascriptInterface
        public String scanDownloads() {
            return activity.scanDownloads();
        }

        @JavascriptInterface
        public String importDownloadFiles(String studentName, String pathsJson) {
            return activity.importDownloadFiles(studentName, pathsJson);
        }

        @JavascriptInterface
        public String getCompatibilityStatus() {
            return activity.getCompatibilityStatus();
        }

        @JavascriptInterface
        public boolean openApp(String app) {
            return activity.openExternal(app);
        }

        @JavascriptInterface
        public String getAppStatus() {
            return activity.getStatusJson();
        }

        @JavascriptInterface
        public boolean checkUpdate(String manifestUrl, int currentVersionCode) {
            return activity.checkUpdate(manifestUrl, currentVersionCode);
        }

        @JavascriptInterface
        public boolean downloadAndInstallUpdate(String apkUrl) {
            return activity.downloadAndInstallUpdate(apkUrl);
        }

        @JavascriptInterface
        public boolean pickArchiveRoot() {
            return activity.startArchiveRootPicker();
        }

        @JavascriptInterface
        public String getArchiveRootStatus() {
            return activity.getArchiveRootStatus();
        }

        @JavascriptInterface
        public String listMarkdownFiles(String studentName) {
            return activity.listMarkdownFiles(studentName);
        }

        @JavascriptInterface
        public String readMarkdownFile(String documentId) {
            return activity.readMarkdownFile(documentId);
        }
    }

    private static class ExternalAppClient extends WebViewClient {
        private final MainActivity activity;

        ExternalAppClient(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (url == null) return false;
            if (url.startsWith("qclaw://")) return activity.openExternal("qclaw");
            if (url.startsWith("marvis://")) return activity.openExternal("marvis");
            if (url.startsWith("obsidian://")) return activity.openExternal("obsidian");
            return false;
        }
    }

    private static class EduWebChromeClient extends WebChromeClient {
        private final MainActivity activity;

        EduWebChromeClient(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(activity)
                    .setTitle("确认操作")
                    .setMessage(message)
                    .setPositiveButton("确定", new JsConfirmPositiveClick(result))
                    .setNegativeButton("取消", new JsConfirmNegativeClick(result))
                    .setOnCancelListener(new JsConfirmCancelListener(result))
                    .show();
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(activity)
                    .setTitle("提示")
                    .setMessage(message)
                    .setPositiveButton("确定", new JsConfirmPositiveClick(result))
                    .setOnCancelListener(new JsConfirmCancelListener(result))
                    .show();
            return true;
        }
    }

    private static class JsConfirmPositiveClick implements DialogInterface.OnClickListener {
        private final JsResult result;

        JsConfirmPositiveClick(JsResult result) {
            this.result = result;
        }

        @Override
        public void onClick(DialogInterface dialog, int which) {
            result.confirm();
        }
    }

    private static class JsConfirmNegativeClick implements DialogInterface.OnClickListener {
        private final JsResult result;

        JsConfirmNegativeClick(JsResult result) {
            this.result = result;
        }

        @Override
        public void onClick(DialogInterface dialog, int which) {
            result.cancel();
        }
    }

    private static class JsConfirmCancelListener implements DialogInterface.OnCancelListener {
        private final JsResult result;

        JsConfirmCancelListener(JsResult result) {
            this.result = result;
        }

        @Override
        public void onCancel(DialogInterface dialog) {
            result.cancel();
        }
    }

    private static class UpdateCheckThread extends Thread {
        private final MainActivity activity;
        private final String manifestUrl;
        private final int currentVersionCode;

        UpdateCheckThread(MainActivity activity, String manifestUrl, int currentVersionCode) {
            this.activity = activity;
            this.manifestUrl = manifestUrl;
            this.currentVersionCode = currentVersionCode;
        }

        @Override
        public void run() {
            String result;
            StringBuilder errors = new StringBuilder();
            try {
                String[] urls = manifestUrl.split("[|,\\n]");
                JSONObject json = null;
                String usedUrl = "";
                for (int i = 0; i < urls.length; i++) {
                    String candidate = urls[i] == null ? "" : urls[i].trim();
                    if (candidate.length() == 0) continue;
                    try {
                        json = fetchManifest(candidate);
                        usedUrl = candidate;
                        break;
                    } catch (Exception e) {
                        if (errors.length() > 0) errors.append("; ");
                        errors.append(candidate).append(" -> ").append(e.getMessage());
                    }
                }
                if (json == null) throw new Exception(errors.length() == 0 ? "没有可用更新地址" : errors.toString());
                int latestCode = json.optInt("versionCode", 0);
                String latestName = json.optString("versionName", "");
                String apkUrl = json.optString("apkUrl", "");
                String notes = json.optString("notes", "");
                boolean hasUpdate = latestCode > currentVersionCode && apkUrl.length() > 0;
                JSONObject out = new JSONObject();
                out.put("hasUpdate", hasUpdate);
                out.put("versionCode", latestCode);
                out.put("versionName", latestName);
                out.put("apkUrl", apkUrl);
                out.put("notes", notes);
                out.put("sourceUrl", usedUrl);
                if (!hasUpdate) out.put("message", "当前已是最新版本");
                result = out.toString();
            } catch (Exception e) {
                result = "{\"hasUpdate\":false,\"message\":\"更新检查失败：服务器暂时不可达。请确认 greatbg.com/download 已开放 80 或 443 端口。详情：" + safeJson(e.getMessage()) + "\"}";
            }
            activity.notifyUpdateResult(result);
        }

        private JSONObject fetchManifest(String manifestUrl) throws Exception {
            URL url = new URL(manifestUrl);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            byte[] buffer = new byte[8192];
            StringBuilder builder = new StringBuilder();
            int read;
            InputStream input = connection.getInputStream();
            try {
                while ((read = input.read(buffer)) != -1) {
                    builder.append(new String(buffer, 0, read, StandardCharsets.UTF_8));
                }
            } finally {
                try {
                    input.close();
                } catch (Exception ignored) {
                }
                connection.disconnect();
            }
            return new JSONObject(builder.toString());
        }
    }

    private static class ApkInstallWaitThread extends Thread {
        private final MainActivity activity;
        private final DownloadManager manager;
        private final long id;

        ApkInstallWaitThread(MainActivity activity, DownloadManager manager, long id) {
            this.activity = activity;
            this.manager = manager;
            this.id = id;
        }

        @Override
        public void run() {
            boolean done = false;
            while (!done) {
                DownloadManager.Query query = new DownloadManager.Query();
                query.setFilterById(id);
                Cursor cursor = null;
                try {
                    cursor = manager.query(query);
                    if (cursor != null && cursor.moveToFirst()) {
                        int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                        int status = statusIndex >= 0 ? cursor.getInt(statusIndex) : 0;
                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            Uri uri = manager.getUriForDownloadedFile(id);
                            if (uri != null) activity.installDownloadedApk(uri);
                            done = true;
                        } else if (status == DownloadManager.STATUS_FAILED) {
                            done = true;
                        }
                    }
                } catch (Exception ignored) {
                    done = true;
                } finally {
                    if (cursor != null) cursor.close();
                }
                if (!done) {
                    try {
                        Thread.sleep(1000);
                    } catch (InterruptedException ignored) {
                        done = true;
                    }
                }
            }
        }
    }

    private static class EvalJsTask implements Runnable {
        private final MainActivity activity;
        private final String script;

        EvalJsTask(MainActivity activity, String script) {
            this.activity = activity;
            this.script = script;
        }

        @Override
        public void run() {
            if (activity.webView != null) activity.webView.evaluateJavascript(script, null);
        }
    }

    private static class ImportResultTask implements Runnable {
        private final MainActivity activity;
        private final String message;

        ImportResultTask(MainActivity activity, String message) {
            this.activity = activity;
            this.message = message;
        }

        @Override
        public void run() {
            if (activity.webView != null) {
                String escaped = message.replace("\\", "\\\\").replace("'", "\\'");
                activity.webView.evaluateJavascript("window.onNativeImportResult && window.onNativeImportResult('" + escaped + "')", null);
            }
            Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
        }
    }

    private static class InstallApkTask implements Runnable {
        private final MainActivity activity;
        private final Uri uri;

        InstallApkTask(MainActivity activity, Uri uri) {
            this.activity = activity;
            this.uri = uri;
        }

        @Override
        public void run() {
            activity.installDownloadedApkOnUi(uri);
        }
    }

    private static String safeJson(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
