package com.qxmatrix.eduterminal;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.List;

/** Processes the durable student/project material queue without changing its recorded scope. */
public final class ProjectMaterialUploadJobService extends JobService {
    static final String QUEUE_DIRECTORY = "project-material-upload-queue";
    static final String PREFS = "edu_terminal_prefs";
    static final String KEY_SERVER_URL = "server_url";
    static final String KEY_REMOTE_URL = "remote_url";
    static final String KEY_CONNECTION_MODE = "connection_mode";
    static final String KEY_SESSION_TOKEN = "student_session_token";
    static final String KEY_SESSION_STUDENT_ID = "student_session_student_id";
    static final String KEY_DEVICE_ID = "device_id";
    static final String KEY_HOST_ID = "host_device_id";
    static final String KEY_DATA_GENERATION = "host_data_generation";
    static final String KEY_STATUS = "project_material_queue_status";
    static final String KEY_UPDATED_AT = "project_material_queue_updated_at";
    static final String KEY_PENDING_COUNT = "project_material_queue_pending_count";
    static final String KEY_PAUSED_COUNT = "project_material_queue_paused_count";
    static final int JOB_ID = 6204;
    private static final Object RUN_LOCK = new Object();

    @Override public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            @Override public void run() {
                boolean retry = runQueue(ProjectMaterialUploadJobService.this);
                jobFinished(params, retry);
            }
        }, "android-project-material-queue").start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }

    static void schedule(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID,
            new ComponentName(context, ProjectMaterialUploadJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(500L)
            .setOverrideDeadline(5000L)
            .setPersisted(true)
            .setBackoffCriteria(30000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .build();
        scheduler.schedule(job);
    }

    static void runNow(final Context context) {
        final Context app = context.getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() { runQueue(app); }
        }, "android-project-material-queue-now").start();
    }

    static boolean runQueue(Context context) {
        synchronized (RUN_LOCK) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            boolean retry = false;
            int received = 0;
            int pending = 0;
            int paused = 0;
            try {
                ProjectMaterialUploadQueue queue = new ProjectMaterialUploadQueue(
                    new File(context.getFilesDir(), QUEUE_DIRECTORY));
                queue.recoverInterrupted();
                List<ProjectMaterialUploadQueue.Entry> entries = queue.list();
                if (entries.isEmpty()) {
                    writeStatus(prefs, "当前没有待上传的项目资料。", 0, 0);
                    return false;
                }
                String base = normalizedBase(prefs);
                String token = clean(prefs.getString(KEY_SESSION_TOKEN, ""));
                JSONObject health = requestJson(base + "/api/health", "", null, null);
                String observedHostId = clean(health.optString("hostId", ""));
                String observedDataGeneration = clean(health.optString("dataGeneration", ""));
                if (observedHostId.length() == 0 || observedDataGeneration.length() == 0) {
                    throw new Exception("host_scope_unverifiable");
                }
                String credentialHostId = clean(prefs.getString(KEY_HOST_ID, ""));
                ProjectMaterialUploadQueue.RuntimeScope scope = new ProjectMaterialUploadQueue.RuntimeScope(
                    observedHostId, observedDataGeneration,
                    prefs.getString(KEY_DEVICE_ID, ""), prefs.getString(KEY_SESSION_STUDENT_ID, ""),
                    base.length() > 0 && token.length() > 0 && observedHostId.equals(credentialHostId));
                for (ProjectMaterialUploadQueue.Entry entry : entries) {
                    if (entry.state == ProjectMaterialUploadQueue.State.RECEIVED) {
                        received += 1;
                        continue;
                    }
                    if (entry.state == ProjectMaterialUploadQueue.State.PAUSED_PERMISSION
                        && scope.credentialAvailable && queue.verifyPayload(entry)) {
                        entry = queue.resumePermission(entry.requestId);
                    }
                    ProjectMaterialUploadQueue.Action action = queue.nextAction(entry, scope);
                    if (action == ProjectMaterialUploadQueue.Action.HOLD_SCOPE
                        || action == ProjectMaterialUploadQueue.Action.HOLD_PERMISSION
                        || entry.state == ProjectMaterialUploadQueue.State.PAUSED_RECEIPT
                        || entry.state == ProjectMaterialUploadQueue.State.FAILED_PERMANENT) {
                        paused += 1;
                        continue;
                    }
                    try {
                        if (action == ProjectMaterialUploadQueue.Action.QUERY_RECEIPT) {
                            entry = queryReceipt(queue, entry, base, token);
                            action = queue.nextAction(entry, scope);
                        }
                        if (action == ProjectMaterialUploadQueue.Action.UPLOAD) {
                            entry = uploadThenVerify(queue, entry, base, token);
                        }
                    } catch (QueueHttpException error) {
                        if (error.statusCode == 401 || error.statusCode == 403) {
                            queue.pausePermission(entry.requestId, error.code.length() > 0 ? error.code : "authorization_expired");
                            paused += 1;
                        } else if ("host_data_generation_changed".equals(error.code)
                            || "project_unavailable".equals(error.code)
                            || "student_unavailable".equals(error.code)) {
                            queue.applyReceipt(entry.requestId, "scope_unverifiable", "", "");
                            paused += 1;
                        } else if ("upload_id_content_conflict".equals(error.code)
                            || "receipt_source_unavailable".equals(error.code)
                            || "material_registry_unavailable".equals(error.code)
                            || "invalid_receipt_query".equals(error.code)) {
                            queue.applyReceipt(entry.requestId, "scope_unverifiable", "", entry.dataGeneration);
                            paused += 1;
                        } else {
                            queue.markTransportUncertain(entry.requestId,
                                error.code.length() > 0 ? error.code : error.getMessage());
                            retry = true;
                            pending += 1;
                        }
                        continue;
                    } catch (SecurityException error) {
                        queue.pausePermission(entry.requestId, "private_payload_permission_unavailable");
                        paused += 1;
                        continue;
                    } catch (Exception error) {
                        queue.markTransportUncertain(entry.requestId, safeMessage(error));
                        retry = true;
                        pending += 1;
                        continue;
                    }
                    ProjectMaterialUploadQueue.Entry current = queue.get(entry.requestId);
                    if (current != null && current.state == ProjectMaterialUploadQueue.State.RECEIVED) {
                        rememberCaptureDelivery(context, current);
                        received += 1;
                    }
                    else if (current != null && (current.state == ProjectMaterialUploadQueue.State.PAUSED_PERMISSION
                        || current.state == ProjectMaterialUploadQueue.State.PAUSED_RECEIPT
                        || current.state == ProjectMaterialUploadQueue.State.FAILED_PERMANENT)) paused += 1;
                    else pending += 1;
                }
                writeStatus(prefs, pending == 0 && paused == 0
                    ? "上传结果已核对：主机确认接收 " + received + " 个资料。"
                    : "上传状态：待处理 " + pending + " 个，暂停待核对 " + paused + " 个，已确认接收 " + received + " 个。",
                    pending, paused);
            } catch (Exception error) {
                writeStatus(prefs, "上传状态检查失败：" + safeMessage(error) + "。联网后将先查回执再继续。",
                    Math.max(1, pending), paused);
                retry = true;
            }
            return retry;
        }
    }

    private static ProjectMaterialUploadQueue.Entry queryReceipt(ProjectMaterialUploadQueue queue,
            ProjectMaterialUploadQueue.Entry entry, String base, String token) throws Exception {
        queue.markReceiptQuerying(entry.requestId);
        String url = base + "/api/uploads/receipt?targetType=" + encode(entry.targetType)
            + "&targetId=" + encode(entry.targetId)
            + "&studentId=" + encode(entry.studentId)
            + "&uploadId=" + encode(entry.requestId);
        JSONObject response = requestJson(url, token, null, null);
        String returnedHost = response.optString("hostId", "");
        String returnedRequestId = response.optString("clientRequestId",
            response.optString("uploadId", response.optString("receiptId", "")));
        boolean scopeMatches = returnedHost.length() > 0 && entry.hostId.equals(returnedHost)
            && entry.requestId.equals(returnedRequestId)
            && entry.targetType.equals(response.optString("targetType", ""))
            && entry.targetId.equals(response.optString("targetId", ""))
            && entry.studentId.equals(response.optString("studentId", ""));
        if (!scopeMatches) {
            return queue.applyReceipt(entry.requestId, "scope_unverifiable", "", response.optString("dataGeneration", ""));
        }
        JSONObject receipt = response.optJSONObject("receipt");
        if ("received_verified".equals(response.optString("status", ""))
            && (receipt == null || receipt.optLong("size", -1L) != entry.byteSize)) {
            return queue.applyReceipt(entry.requestId, "scope_unverifiable", "",
                response.optString("dataGeneration", ""));
        }
        String sha256 = receipt == null ? "" : receipt.optString("sha256", "");
        return queue.applyReceipt(entry.requestId, response.optString("status", ""), sha256,
            response.optString("dataGeneration", ""));
    }

    private static ProjectMaterialUploadQueue.Entry uploadThenVerify(ProjectMaterialUploadQueue queue,
            ProjectMaterialUploadQueue.Entry entry, String base, String token) throws Exception {
        entry = queue.markUploading(entry.requestId);
        if (entry.state != ProjectMaterialUploadQueue.State.UPLOADING) return entry;
        String url = "project".equals(entry.targetType)
            ? base + "/api/projects/" + encode(entry.targetId) + "/materials?filename=" + encode(entry.fileName)
                + "&studentId=" + encode(entry.studentId)
            : base + "/api/students/" + encode(entry.targetId) + "/materials?filename=" + encode(entry.fileName);
        url += "&uploadId=" + encode(entry.requestId) + "&sourceType=" + encode(entry.sourceType);
        if (entry.attributionQuery.length() > 0) url += "&" + entry.attributionQuery;
        JSONObject response = requestJson(url, token, entry, entry.payloadFile());
        String returnedGeneration = response.optString("dataGeneration", "");
        if (entry.dataGeneration.length() > 0 && returnedGeneration.length() > 0
            && !entry.dataGeneration.equals(returnedGeneration)) {
            return queue.applyReceipt(entry.requestId, "scope_unverifiable", "", returnedGeneration);
        }
        queue.markTransportUncertain(entry.requestId, "upload_response_received_receipt_check_required");
        return queryReceipt(queue, queue.get(entry.requestId), base, token);
    }

    private static JSONObject requestJson(String urlText, String token,
            ProjectMaterialUploadQueue.Entry upload, File payload) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(upload == null ? 15000 : 60000);
        connection.setRequestProperty("Accept", "application/json");
        if (clean(token).length() > 0) {
            connection.setRequestProperty("Authorization", "Bearer " + token);
        }
        if (upload != null) {
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/octet-stream");
            connection.setRequestProperty("X-Edu-Content-Sha256", upload.contentSha256);
            if (upload.dataGeneration.length() > 0) {
                connection.setRequestProperty("X-Edu-Data-Generation", upload.dataGeneration);
            }
            connection.setFixedLengthStreamingMode(upload.byteSize);
            InputStream input = new FileInputStream(payload);
            OutputStream output = connection.getOutputStream();
            try {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) if (read > 0) output.write(buffer, 0, read);
                output.flush();
            } finally {
                try { input.close(); } finally { output.close(); }
            }
        }
        int status = connection.getResponseCode();
        String text = readText(status >= 200 && status < 300
            ? connection.getInputStream() : connection.getErrorStream());
        JSONObject response;
        try { response = text.length() == 0 ? new JSONObject() : new JSONObject(text); }
        catch (Exception error) { response = new JSONObject(); }
        if (status < 200 || status >= 300 || !response.optBoolean("ok", true)) {
            throw new QueueHttpException(status, response.optString("code", ""),
                response.optString("message", text.length() > 0 ? text : "HTTP " + status));
        }
        return response;
    }

    private static String normalizedBase(SharedPreferences prefs) {
        String value = prefs.getInt(KEY_CONNECTION_MODE, 1) == 2
            ? prefs.getString(KEY_REMOTE_URL, "") : prefs.getString(KEY_SERVER_URL, "");
        if (clean(value).length() == 0) value = prefs.getString(KEY_SERVER_URL, "");
        String result = clean(value);
        if (result.length() > 0 && !result.startsWith("http://") && !result.startsWith("https://")) {
            result = "http://" + result;
        }
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    private static void writeStatus(SharedPreferences prefs, String message, int pending, int paused) {
        prefs.edit().putString(KEY_STATUS, message)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .putInt(KEY_PENDING_COUNT, pending)
            .putInt(KEY_PAUSED_COUNT, paused).apply();
    }

    private static void rememberCaptureDelivery(Context context, ProjectMaterialUploadQueue.Entry entry) {
        if (entry == null || entry.sourceReference.length() == 0
            || !entry.sourceType.contains("screenshot")) return;
        try {
            Uri uri = Uri.parse(entry.sourceReference);
            if (!"file".equalsIgnoreCase(uri.getScheme()) || uri.getPath() == null) return;
            SharedPreferences capture = context.getSharedPreferences(CaptureProjectionService.PREFS,
                Context.MODE_PRIVATE);
            java.util.HashSet<String> delivered = new java.util.HashSet<String>(
                capture.getStringSet("uploaded_paths", new java.util.HashSet<String>()));
            delivered.add(uri.getPath());
            capture.edit().putStringSet("uploaded_paths", delivered).apply();
        } catch (Exception ignored) {
        }
    }

    private static String readText(InputStream stream) throws Exception {
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "UTF-8"));
        StringBuilder result = new StringBuilder();
        try {
            String line;
            while ((line = reader.readLine()) != null) result.append(line).append('\n');
        } finally { reader.close(); }
        return result.toString().trim();
    }

    private static String encode(String value) throws Exception {
        return URLEncoder.encode(value == null ? "" : value, "UTF-8").replace("+", "%20");
    }

    private static String clean(String value) { return value == null ? "" : value.trim(); }
    private static String safeMessage(Exception error) {
        String value = error == null ? "未知错误" : error.getMessage();
        return value == null || value.length() == 0 ? "未知错误" : value;
    }

    static final class QueueHttpException extends Exception {
        final int statusCode;
        final String code;
        QueueHttpException(int statusCode, String code, String message) {
            super(message);
            this.statusCode = statusCode;
            this.code = clean(code);
        }
    }
}
