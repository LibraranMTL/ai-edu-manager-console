package com.qxmatrix.eduterminal;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

public class AutoDeliveryJobService extends JobService {
    static final String PREFS = "edu_auto_delivery";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_TREE_URI = "tree_uri";
    static final String KEY_TREE_NAME = "tree_name";
    static final String KEY_STUDENT_ID = "student_id";
    static final String KEY_STUDENT_NAME = "student_name";
    static final String KEY_TARGET_TYPE = "target_type";
    static final String KEY_TARGET_ID = "target_id";
    static final String KEY_TARGET_NAME = "target_name";
    static final String KEY_PROCESSED = "processed_signatures";
    static final String KEY_PENDING = "pending_signatures";
    static final String KEY_LAST_RESULT = "last_result";
    static final String KEY_LAST_CHECKED_AT = "last_checked_at";
    static final int JOB_ID = 6202;
    static final long PERIOD_MS = 15L * 60L * 1000L;
    static final long STABLE_MS = 10L * 1000L;
    static final long MAX_FILE_BYTES = 200L * 1024L * 1024L;

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            @Override public void run() {
                runDelivery(AutoDeliveryJobService.this, false);
                jobFinished(params, false);
            }
        }, "android-auto-delivery").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    static void schedule(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        if (!prefs.getBoolean(KEY_ENABLED, false)) {
            scheduler.cancel(JOB_ID);
            return;
        }
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, AutoDeliveryJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_NONE)
            .setPeriodic(PERIOD_MS)
            .build();
        scheduler.schedule(job);
    }

    static void runNow(final Context context, final boolean force) {
        final Context appContext = context.getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() { runDelivery(appContext, force); }
        }, "android-auto-delivery-now").start();
    }

    static synchronized void runDelivery(Context context, boolean force) {
        SharedPreferences config = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!config.getBoolean(KEY_ENABLED, false)) return;
        SharedPreferences terminal = context.getSharedPreferences("edu_terminal_prefs", Context.MODE_PRIVATE);
        if (!"personal".equals(terminal.getString("terminal_mode", "shared"))) {
            result(config, "共享终端不执行自动投递。", 0, 0);
            return;
        }
        long now = System.currentTimeMillis();
        long previousCheck = config.getLong(KEY_LAST_CHECKED_AT, 0L);
        if (!force && now - previousCheck < 30000L) return;
        String treeText = config.getString(KEY_TREE_URI, "");
        String studentId = config.getString(KEY_STUDENT_ID, "");
        String targetType = config.getString(KEY_TARGET_TYPE, "student");
        String targetId = config.getString(KEY_TARGET_ID, studentId);
        if (treeText.length() == 0 || studentId.length() == 0 || targetId.length() == 0) {
            result(config, "自动投递配置不完整，请打开应用重新设置。", 0, 0);
            return;
        }

        Uri treeUri = Uri.parse(treeText);
        Set<String> processed = new HashSet<String>(config.getStringSet(KEY_PROCESSED, new HashSet<String>()));
        JSONObject pending = parseObject(config.getString(KEY_PENDING, "{}"));
        int uploaded = 0;
        int failed = 0;
        int waiting = 0;
        try {
            ArrayList<DocumentEntry> files = listDirectFiles(context.getContentResolver(), treeUri);
            for (DocumentEntry file : files) {
                if (file.size < 0L || file.size > MAX_FILE_BYTES) continue;
                String signature = sha1(file.uri.toString() + "|" + file.name + "|" + file.size + "|" + file.modified + "|" + targetType + "|" + targetId);
                if (processed.contains(signature)) continue;
                long firstSeen = pending.optLong(signature, 0L);
                boolean oldEnough = file.modified > 0L && now - file.modified >= STABLE_MS;
                boolean seenStable = firstSeen > 0L && now - firstSeen >= STABLE_MS;
                if (!oldEnough && !seenStable) {
                    try { pending.put(signature, now); } catch (Exception ignored) {}
                    waiting += 1;
                    continue;
                }
                try {
                    StudentCollectionInbox inbox = new StudentCollectionInbox(new java.io.File(context.getFilesDir(), "student-collection-inbox"));
                    InputStream input = context.getContentResolver().openInputStream(file.uri);
                    if (input == null) throw new IllegalStateException("无法读取文件");
                    StudentCollectionInbox.Entry collected;
                    try {
                        collected = inbox.collect(input, new StudentCollectionInbox.Metadata(studentId, "android_auto_delivery",
                            file.name, "application/octet-stream", file.uri.toString()));
                    } finally { input.close(); }
                    SharedPreferences queuePrefs = context.getSharedPreferences(ProjectMaterialUploadJobService.PREFS, Context.MODE_PRIVATE);
                    String hostId = queuePrefs.getString(ProjectMaterialUploadJobService.KEY_HOST_ID, "");
                    String dataGeneration = queuePrefs.getString(ProjectMaterialUploadJobService.KEY_DATA_GENERATION, "");
                    String deviceId = queuePrefs.getString(ProjectMaterialUploadJobService.KEY_DEVICE_ID, "");
                    String sessionStudentId = queuePrefs.getString(ProjectMaterialUploadJobService.KEY_SESSION_STUDENT_ID, "");
                    if (hostId.length() == 0 || dataGeneration.length() == 0 || deviceId.length() == 0 || !studentId.equals(sessionStudentId)) {
                        throw new IllegalStateException("主机或学生会话已变化，资料保留在本机等待重新确认");
                    }
                    ProjectMaterialUploadQueue queue = new ProjectMaterialUploadQueue(
                        new java.io.File(context.getFilesDir(), ProjectMaterialUploadJobService.QUEUE_DIRECTORY));
                    InputStream stable = new java.io.FileInputStream(collected.payloadFile());
                    ProjectMaterialUploadQueue.Entry queued;
                    try {
                        queued = queue.enqueue(stable, new ProjectMaterialUploadQueue.Metadata(
                            hostId, dataGeneration, deviceId, studentId, targetType, targetId,
                            collected.metadata.fileName, "android_auto_delivery", "", collected.metadata.sourceReference));
                    } finally { stable.close(); }
                    if (!inbox.markQueuedByPayloadPath(collected.payloadPath, queued.requestId)) {
                        throw new IllegalStateException("自动投递交接复核失败，原件仍保留在本机");
                    }
                    processed.add(signature);
                    pending.remove(signature);
                    uploaded += 1;
                } catch (Exception ignored) {
                    failed += 1;
                }
            }
            trimProcessed(processed, 1200);
            config.edit()
                .putStringSet(KEY_PROCESSED, processed)
                .putString(KEY_PENDING, pending.toString())
                .putLong(KEY_LAST_CHECKED_AT, now)
                .putString(KEY_LAST_RESULT, "本次已有 " + uploaded + " 个进入持久上传队列，等待文件稳定 " + waiting + " 个，保留待重试 " + failed + " 个。本地原文件未删除。")
                .apply();
            if (uploaded > 0) {
                ProjectMaterialUploadJobService.schedule(context);
                ProjectMaterialUploadJobService.runNow(context);
            }
        } catch (Exception error) {
            result(config, "自动投递检查失败：" + safeMessage(error) + "。稍后将自动重试。", uploaded, failed + 1);
        }
    }

    static ArrayList<DocumentEntry> listDirectFiles(ContentResolver resolver, Uri treeUri) throws Exception {
        ArrayList<DocumentEntry> result = new ArrayList<DocumentEntry>();
        String parentId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] columns = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE
        };
        Cursor cursor = resolver.query(childrenUri, columns, null, null, null);
        if (cursor == null) return result;
        try {
            int idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int modifiedIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
            int sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            while (cursor.moveToNext()) {
                String mime = mimeIndex >= 0 ? cursor.getString(mimeIndex) : "";
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) continue;
                String documentId = idIndex >= 0 ? cursor.getString(idIndex) : "";
                if (documentId == null || documentId.length() == 0) continue;
                Uri uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
                String name = nameIndex >= 0 ? cursor.getString(nameIndex) : "android-material";
                long modified = modifiedIndex >= 0 && !cursor.isNull(modifiedIndex) ? cursor.getLong(modifiedIndex) : 0L;
                long size = sizeIndex >= 0 && !cursor.isNull(sizeIndex) ? cursor.getLong(sizeIndex) : -1L;
                result.add(new DocumentEntry(uri, sanitizeName(name), size, modified));
            }
        } finally {
            cursor.close();
        }
        return result;
    }

    static void upload(ContentResolver resolver, String base, String token, String studentId, String targetType, String targetId, DocumentEntry file, String signature) throws Exception {
        String url = "project".equals(targetType)
            ? base + "/api/projects/" + encode(targetId) + "/materials?filename=" + encode(file.name) + "&studentId=" + encode(studentId)
            : base + "/api/students/" + encode(targetId) + "/materials?filename=" + encode(file.name);
        url += "&uploadId=" + encode("android-auto-" + signature) + "&sourceType=android_auto_delivery";
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(45000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Content-Type", "application/octet-stream");
        connection.setChunkedStreamingMode(16384);
        InputStream input = resolver.openInputStream(file.uri);
        if (input == null) throw new Exception("无法读取文件");
        OutputStream output = connection.getOutputStream();
        byte[] buffer = new byte[16384];
        int read;
        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        input.close();
        output.flush();
        output.close();
        int code = connection.getResponseCode();
        String response = readText(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream());
        if (code < 200 || code >= 300) throw new Exception(response.length() > 0 ? response : "HTTP " + code);
    }

    static void result(SharedPreferences prefs, String message, int uploaded, int failed) {
        prefs.edit().putLong(KEY_LAST_CHECKED_AT, System.currentTimeMillis()).putString(KEY_LAST_RESULT, message).apply();
    }

    static JSONObject parseObject(String text) {
        try { return new JSONObject(text == null ? "{}" : text); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    static void trimProcessed(Set<String> values, int limit) {
        if (values.size() <= limit) return;
        Iterator<String> iterator = values.iterator();
        while (values.size() > limit && iterator.hasNext()) { iterator.next(); iterator.remove(); }
    }

    static String normalizeBase(String value) {
        String result = value == null ? "" : value.trim();
        if (result.length() > 0 && !result.startsWith("http://") && !result.startsWith("https://")) result = "http://" + result;
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    static String encode(String value) throws Exception { return URLEncoder.encode(value == null ? "" : value, "UTF-8").replace("+", "%20"); }
    static String sanitizeName(String value) { return (value == null || value.trim().length() == 0 ? "android-material" : value).replaceAll("[\\\\/:*?\"<>|]", "_"); }
    static String safeMessage(Exception error) { String value = error == null ? "未知错误" : error.getMessage(); return value == null || value.length() == 0 ? "未知错误" : value; }

    static String sha1(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        byte[] bytes = digest.digest(value.getBytes("UTF-8"));
        StringBuilder result = new StringBuilder();
        for (byte item : bytes) result.append(String.format("%02x", item & 0xff));
        return result.toString();
    }

    static String readText(InputStream stream) throws Exception {
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "UTF-8"));
        StringBuilder result = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) result.append(line).append('\n');
        reader.close();
        return result.toString().trim();
    }

    static final class DocumentEntry {
        final Uri uri;
        final String name;
        final long size;
        final long modified;
        DocumentEntry(Uri uri, String name, long size, long modified) {
            this.uri = uri;
            this.name = name;
            this.size = size;
            this.modified = modified;
        }
    }
}
