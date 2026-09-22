package com.qxmatrix.eduteacher;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.PersistableBundle;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;

/**
 * Delivers only screenshots from one already-authorized MediaProjection session.
 * It never starts screen capture, reads another application's data, or changes the
 * student/project written in that session's own metadata.
 */
public class CaptureAutoDeliveryJobService extends JobService {
    static final String PREFS = CaptureProjectionService.PREFS;
    static final String KEY_STATUS = "auto_delivery_status";
    static final String KEY_UPDATED_AT = "auto_delivery_updated_at";
    private static final String EXTRA_SESSION_DIR = "session_dir";
    private static final String DELIVERY_STATE_FILE = ".auto-delivery.json";
    private static final int JOB_ID_BASE = 629000;
    private static final long MAX_FILE_BYTES = 50L * 1024L * 1024L;
    private static final boolean REQUIRE_PERSONAL_TERMINAL = false;

    static void schedule(Context context, File sessionDir) {
        if (context == null || sessionDir == null) return;
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        PersistableBundle extras = new PersistableBundle();
        extras.putString(EXTRA_SESSION_DIR, sessionDir.getAbsolutePath());
        int jobId = JOB_ID_BASE + Math.abs(sessionDir.getName().hashCode() % 9000);
        JobInfo job = new JobInfo.Builder(jobId, new ComponentName(context, CaptureAutoDeliveryJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(1000L)
            .setOverrideDeadline(10000L)
            .setBackoffCriteria(30000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .setExtras(extras)
            .build();
        scheduler.schedule(job);
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            @Override public void run() {
                String sessionPath = params.getExtras().getString(EXTRA_SESSION_DIR, "");
                boolean retry = deliver(CaptureAutoDeliveryJobService.this, sessionPath);
                jobFinished(params, retry);
            }
        }, "android-capture-auto-delivery").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    static boolean deliver(Context context, String sessionPath) {
        try {
            File sessionDir = new File(sessionPath == null ? "" : sessionPath);
            JSONObject session = readObject(new File(sessionDir, "session.json"));
            if (!session.optBoolean("autoDelivery", false)) return false;
            String studentId = session.optString("studentId", "").trim();
            if (studentId.length() == 0 || !CaptureStorage.isInside(sessionDir, CaptureStorage.studentDir(context, studentId))) {
                status(context, "自动投递已停止：采集会话归属校验失败。");
                return false;
            }

            SharedPreferences terminal = context.getSharedPreferences("edu_terminal_prefs", Context.MODE_PRIVATE);
            if (REQUIRE_PERSONAL_TERMINAL && !"personal".equals(terminal.getString("terminal_mode", "shared"))) {
                status(context, "自动投递已保留：学生端仅在个人终端中发送截图。");
                return false;
            }
            String base = normalizeBase(connectionBase(terminal));
            String token = terminal.getString("api_token", "").trim();
            if (base.length() == 0 || token.length() == 0) {
                status(context, "自动投递待重试：学生会话或主机连接已失效。");
                return true;
            }

            String projectId = session.optString("projectId", "").trim();
            String targetType = projectId.length() > 0 ? "project" : "student";
            String targetId = projectId.length() > 0 ? projectId : studentId;
            Set<String> uploaded = readDelivered(new File(sessionDir, DELIVERY_STATE_FILE));
            File[] entries = sessionDir.listFiles();
            if (entries == null) return false;
            ArrayList<File> images = new ArrayList<File>();
            for (File entry : entries) {
                if (CaptureStorage.isImage(entry) && entry.length() > 0L && entry.length() <= MAX_FILE_BYTES) images.add(entry);
            }
            Collections.sort(images, new Comparator<File>() {
                @Override public int compare(File left, File right) { return left.getName().compareTo(right.getName()); }
            });
            int uploadedCount = 0;
            int failedCount = 0;
            for (File image : images) {
                String signature = image.getName() + "|" + image.length() + "|" + image.lastModified();
                if (uploaded.contains(signature)) continue;
                try {
                    JSONObject item = readObject(new File(sessionDir, image.getName() + ".json"));
                    upload(base, token, studentId, targetType, targetId, session, item, image, signature);
                    uploaded.add(signature);
                    writeDelivered(new File(sessionDir, DELIVERY_STATE_FILE), uploaded);
                    uploadedCount += 1;
                } catch (Exception ignored) {
                    failedCount += 1;
                }
            }
            status(context, failedCount > 0
                ? "本次自动投递 " + uploadedCount + " 张，失败 " + failedCount + " 张；联网后会继续重试。"
                : "本次自动投递完成：" + uploadedCount + " 张截图已送达指定资料库。");
            if (failedCount == 0 && uploaded.size() >= images.size()) {
                try {
                    completeCaptureSession(base, token, studentId, projectId, session, images.size());
                } catch (Exception error) {
                    status(context, "截图已送达，采集会话完成回执待重试：" + safeMessage(error));
                    return true;
                }
            }
            return failedCount > 0;
        } catch (Exception error) {
            status(context, "自动投递待重试：" + safeMessage(error));
            return true;
        }
    }

    static void upload(String base, String token, String studentId, String targetType, String targetId, JSONObject session, JSONObject item, File image, String signature) throws Exception {
        String url = "project".equals(targetType)
            ? base + "/api/projects/" + encode(targetId) + "/materials?filename=" + encode(image.getName()) + "&studentId=" + encode(studentId)
            : base + "/api/students/" + encode(targetId) + "/materials?filename=" + encode(image.getName());
        String sessionId = session.optString("sessionId", "");
        String captureItemId = item.optString("captureItemId", "android-item-" + sha1(signature).substring(0, 16));
        long capturedAt = item.optLong("capturedAt", image.lastModified());
        int captureSequence = Math.max(0, item.optInt("sequence", 0));
        boolean highlighted = item.optBoolean("highlighted", false);
        url += "&uploadId=" + encode("android-capture-auto-" + sha1(sessionId + "|" + signature))
            + "&sourceType=android_screen_capture_auto"
            + "&capturePlatform=android-teacher-terminal"
            + "&captureSessionId=" + encode(sessionId)
            + "&captureItemId=" + encode(captureItemId)
            + "&capturedAt=" + encode(String.valueOf(capturedAt))
            + "&captureSequence=" + encode(String.valueOf(captureSequence))
            + "&captureHighlighted=" + (highlighted ? "1" : "0");
        String courseId = item.optString("courseId", session.optString("courseId", "")).trim();
        if (courseId.length() > 0) {
            String courseUrl = item.optString("courseUrl", session.optString("courseUrl", ""));
            long courseStartedAt = item.optLong("courseStartedAt", session.optLong("courseStartedAt", 0L));
            long courseCompletedAt = session.optLong("courseCompletedAt", 0L);
            url += "&courseId=" + encode(courseId)
                + "&courseUrl=" + encode(courseUrl)
                + "&courseStartedAt=" + encode(String.valueOf(courseStartedAt))
                + "&courseCompletedAt=" + encode(String.valueOf(courseCompletedAt));
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(60000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Content-Type", "image/jpeg");
        connection.setChunkedStreamingMode(16384);
        InputStream input = new FileInputStream(image);
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

    static void completeCaptureSession(String base, String token, String studentId, String projectId, JSONObject session, int expectedItemCount) throws Exception {
        String sessionId = session.optString("sessionId", "").trim();
        if (sessionId.length() == 0) throw new Exception("采集会话缺少标识。");
        HttpURLConnection connection = (HttpURLConnection) new URL(base + "/api/students/" + encode(studentId) + "/capture-sessions/" + encode(sessionId) + "/complete").openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(60000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        JSONObject body = new JSONObject();
        body.put("projectId", projectId == null ? "" : projectId);
        body.put("expectedItemCount", expectedItemCount);
        OutputStream output = connection.getOutputStream();
        output.write(body.toString().getBytes("UTF-8"));
        output.close();
        int code = connection.getResponseCode();
        String response = readText(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream());
        if (code < 200 || code >= 300) throw new Exception(response.length() > 0 ? response : "HTTP " + code);
    }

    static String connectionBase(SharedPreferences prefs) {
        String value = prefs.getInt("connection_mode", 1) == 2 ? prefs.getString("remote_url", "") : prefs.getString("server_url", "");
        return value.length() > 0 ? value : prefs.getString("server_url", "");
    }

    static Set<String> readDelivered(File marker) {
        HashSet<String> result = new HashSet<String>();
        JSONArray values = readObject(marker).optJSONArray("uploaded");
        if (values != null) for (int i = 0; i < values.length(); i++) result.add(values.optString(i, ""));
        return result;
    }

    static void writeDelivered(File marker, Set<String> uploaded) throws Exception {
        JSONArray values = new JSONArray();
        for (String value : uploaded) values.put(value);
        JSONObject state = new JSONObject();
        state.put("uploaded", values);
        state.put("updatedAt", System.currentTimeMillis());
        File temporary = new File(marker.getParentFile(), marker.getName() + ".tmp");
        FileOutputStream output = new FileOutputStream(temporary);
        output.write(state.toString().getBytes("UTF-8"));
        output.close();
        if (marker.exists()) marker.delete();
        if (!temporary.renameTo(marker)) throw new Exception("无法保存自动投递回执");
    }

    static JSONObject readObject(File file) {
        try {
            if (file == null || !file.isFile()) return new JSONObject();
            BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), "UTF-8"));
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) text.append(line);
            reader.close();
            return new JSONObject(text.toString());
        } catch (Exception ignored) { return new JSONObject(); }
    }

    static void status(Context context, String value) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_STATUS, value)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .apply();
    }

    static String normalizeBase(String value) {
        String result = value == null ? "" : value.trim();
        if (result.length() > 0 && !result.startsWith("http://") && !result.startsWith("https://")) result = "http://" + result;
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    static String encode(String value) throws Exception { return URLEncoder.encode(value == null ? "" : value, "UTF-8").replace("+", "%20"); }
    static String safeMessage(Exception error) { String value = error == null ? "未知错误" : error.getMessage(); return value == null || value.length() == 0 ? "未知错误" : value; }

    static String sha1(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        byte[] bytes = digest.digest(String.valueOf(value).getBytes("UTF-8"));
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
}
