package com.qxmatrix.eduterminal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.util.UUID;

public class CaptureProjectionService extends Service {
    public static final String ACTION_START = "com.qxmatrix.eduterminal.capture.START";
    public static final String ACTION_PAUSE = "com.qxmatrix.eduterminal.capture.PAUSE";
    public static final String ACTION_RESUME = "com.qxmatrix.eduterminal.capture.RESUME";
    public static final String ACTION_HIGHLIGHT = "com.qxmatrix.eduterminal.capture.HIGHLIGHT";
    public static final String ACTION_STOP = "com.qxmatrix.eduterminal.capture.STOP";
    public static final String PREFS = "edu_capture_state";
    public static final String KEY_STATUS = "status";
    public static final String KEY_SESSION_ID = "session_id";
    public static final String KEY_CAPTURE_DIR = "capture_dir";
    public static final String KEY_SAVED = "saved";
    public static final String KEY_CANDIDATE = "candidate";
    public static final String KEY_DEDUP = "dedup";
    public static final String KEY_HIGHLIGHTED = "highlighted";
    public static final String KEY_STUDENT_ID = "capture_student_id";
    public static final String KEY_PROJECT_ID = "capture_project_id";
    public static final String KEY_PROJECT_NAME = "capture_project_name";

    private static final String CHANNEL_ID = "screen_capture";
    private static final int NOTIFICATION_ID = 5201;

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private Handler mainHandler;
    private boolean paused;
    private boolean stopping;
    private String sessionId;
    private String mode = "smart";
    private long sampleIntervalMs = 2000L;
    private long minimumSaveIntervalMs = 5000L;
    private long maximumSaveIntervalMs = 90000L;
    private double visualChangeThreshold = 0.12d;
    private long lastEvaluatedAt;
    private long lastSavedAt;
    private int[] lastSignature;
    private Bitmap lastFrame;
    private File sessionDir;
    private int candidateCount;
    private int savedCount;
    private int dedupCount;
    private int highlightedCount;
    private long startedAt;
    private long durationMs;
    private String studentId = "";
    private String studentName = "";
    private String projectId = "";
    private String projectName = "";
    private long endedAt;
    private String endReason = "";

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(getMainLooper());
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if (ACTION_START.equals(action)) {
            startForegroundCompat(buildNotification("正在准备屏幕采集"));
            startProjection(intent);
        } else if (ACTION_PAUSE.equals(action)) {
            paused = true;
            saveState("paused");
            updateNotification("采集已暂停");
        } else if (ACTION_RESUME.equals(action)) {
            paused = false;
            saveState("capturing");
            updateNotification("正在采集屏幕资料");
        } else if (ACTION_HIGHLIGHT.equals(action)) {
            saveHighlightedFrame();
        } else if (ACTION_STOP.equals(action)) {
            stopCapture("manual");
        }
        return START_NOT_STICKY;
    }

    private void startProjection(Intent intent) {
        if (projection != null) return;
        int resultCode = intent.getIntExtra("result_code", 0);
        Intent resultData = intent.getParcelableExtra("result_data");
        mode = intent.getStringExtra("mode");
        if (mode == null) mode = "smart";
        studentId = safeExtra(intent, "student_id");
        studentName = safeExtra(intent, "student_name");
        projectId = safeExtra(intent, "project_id");
        projectName = safeExtra(intent, "project_name");
        durationMs = Math.max(60000L, intent.getLongExtra("duration_ms", 30L * 60L * 1000L));
        configurePolicy(mode);
        startedAt = System.currentTimeMillis();
        sessionId = "android-capture-" + startedAt + "-" + UUID.randomUUID().toString().substring(0, 8);
        sessionDir = new File(CaptureStorage.studentDir(this, studentId), sessionId);
        if (!sessionDir.exists()) sessionDir.mkdirs();

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null || resultData == null) {
            stopCapture("permission_missing");
            return;
        }
        projection = manager.getMediaProjection(resultCode, resultData);
        if (projection == null) {
            stopCapture("permission_denied");
            return;
        }
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                stopCapture("projection_stopped");
            }
        }, mainHandler);

        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        final int width = Math.max(1, metrics.widthPixels);
        final int height = Math.max(1, metrics.heightPixels);
        int density = Math.max(1, metrics.densityDpi);
        captureThread = new HandlerThread("edu-screen-capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
            @Override public void onImageAvailable(ImageReader reader) {
                CaptureProjectionService.this.onImageAvailable(reader, width, height);
            }
        }, captureHandler);
        virtualDisplay = projection.createVirtualDisplay(
            "AI Education Screen Capture",
            width,
            height,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            captureHandler
        );
        saveState("capturing");
        updateNotification("正在采集屏幕资料");
        mainHandler.postDelayed(new Runnable() {
            @Override public void run() { stopCapture("duration_complete"); }
        }, durationMs);
    }

    private void configurePolicy(String selectedMode) {
        if ("interval".equals(selectedMode)) {
            sampleIntervalMs = 10000L;
            minimumSaveIntervalMs = 5000L;
            maximumSaveIntervalMs = 60000L;
            visualChangeThreshold = 0d;
        } else if ("change".equals(selectedMode)) {
            sampleIntervalMs = 2000L;
            minimumSaveIntervalMs = 5000L;
            maximumSaveIntervalMs = 120000L;
            visualChangeThreshold = 0.16d;
        } else {
            sampleIntervalMs = 2000L;
            minimumSaveIntervalMs = 5000L;
            maximumSaveIntervalMs = 90000L;
            visualChangeThreshold = 0.12d;
        }
    }

    private void onImageAvailable(ImageReader reader, int width, int height) {
        Image image = null;
        Bitmap bitmap = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null || paused || stopping) return;
            long now = System.currentTimeMillis();
            if (now - lastEvaluatedAt < sampleIntervalMs) return;
            lastEvaluatedAt = now;
            candidateCount += 1;
            bitmap = imageToBitmap(image, width, height);
            replaceLastFrame(bitmap);
            int[] signature = signature(bitmap);
            double difference = signatureDifference(lastSignature, signature);
            long elapsed = lastSavedAt == 0 ? Long.MAX_VALUE : now - lastSavedAt;
            boolean exactDuplicate = lastSignature != null && difference <= 0.003d;
            boolean minimumPassed = elapsed >= minimumSaveIntervalMs;
            boolean save = !exactDuplicate && minimumPassed && (
                "interval".equals(mode)
                    || difference >= visualChangeThreshold
                    || elapsed >= maximumSaveIntervalMs
            );
            if (save) {
                saveBitmap(bitmap, false, difference);
                lastSavedAt = now;
                lastSignature = signature;
            } else {
                dedupCount += 1;
                saveState(paused ? "paused" : "capturing");
            }
        } catch (Exception ignored) {
            saveState("error");
        } finally {
            if (image != null) image.close();
            if (bitmap != null) bitmap.recycle();
        }
    }

    private Bitmap imageToBitmap(Image image, int width, int height) {
        Image.Plane plane = image.getPlanes()[0];
        ByteBuffer buffer = plane.getBuffer();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int rowPadding = rowStride - pixelStride * width;
        Bitmap padded = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888);
        padded.copyPixelsFromBuffer(buffer);
        Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, width, height);
        if (cropped != padded) padded.recycle();
        return cropped;
    }

    private int[] signature(Bitmap bitmap) {
        Bitmap small = Bitmap.createScaledBitmap(bitmap, 16, 16, true);
        int[] pixels = new int[256];
        small.getPixels(pixels, 0, 16, 0, 0, 16, 16);
        for (int i = 0; i < pixels.length; i++) {
            int color = pixels[i];
            pixels[i] = (int) ((android.graphics.Color.red(color) * 0.299d)
                + (android.graphics.Color.green(color) * 0.587d)
                + (android.graphics.Color.blue(color) * 0.114d));
        }
        small.recycle();
        return pixels;
    }

    private double signatureDifference(int[] previous, int[] current) {
        if (previous == null || current == null || previous.length != current.length) return 1d;
        double total = 0d;
        for (int i = 0; i < previous.length; i++) total += Math.abs(previous[i] - current[i]) / 255d;
        return total / previous.length;
    }

    private void replaceLastFrame(Bitmap bitmap) {
        if (lastFrame != null) lastFrame.recycle();
        lastFrame = bitmap.copy(Bitmap.Config.ARGB_8888, false);
    }

    private synchronized void saveHighlightedFrame() {
        if (lastFrame == null || stopping) return;
        saveBitmap(lastFrame, true, 1d);
        highlightedCount += 1;
        lastSavedAt = System.currentTimeMillis();
        lastSignature = signature(lastFrame);
        updateNotification(paused ? "采集已暂停，已保存重点页面" : "正在采集，已保存重点页面");
    }

    private synchronized void saveBitmap(Bitmap bitmap, boolean highlighted, double difference) {
        try {
            long now = System.currentTimeMillis();
            String name = (highlighted ? "highlight-" : "capture-") + now + ".jpg";
            File target = new File(sessionDir, name);
            FileOutputStream output = new FileOutputStream(target);
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output);
            output.flush();
            output.close();
            savedCount += 1;
            JSONObject metadata = new JSONObject();
            metadata.put("captureItemId", "android-item-" + now);
            metadata.put("sessionId", sessionId);
            metadata.put("capturedAt", now);
            metadata.put("highlighted", highlighted);
            metadata.put("difference", difference);
            metadata.put("sourceType", "android_screenshot");
            metadata.put("studentId", studentId);
            metadata.put("studentName", studentName);
            metadata.put("projectId", projectId);
            metadata.put("projectName", projectName);
            FileOutputStream metadataOutput = new FileOutputStream(new File(sessionDir, name + ".json"));
            metadataOutput.write(metadata.toString(2).getBytes("UTF-8"));
            metadataOutput.close();
            saveState(paused ? "paused" : "capturing");
            updateNotification((paused ? "采集已暂停" : "正在采集") + " · 已保留 " + savedCount + " 张");
        } catch (Exception ignored) {
            saveState("error");
        }
    }

    private void saveState(String status) {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        editor.putString(KEY_STATUS, status);
        editor.putString(KEY_SESSION_ID, sessionId == null ? "" : sessionId);
        editor.putString(KEY_CAPTURE_DIR, sessionDir == null ? "" : sessionDir.getAbsolutePath());
        editor.putInt(KEY_SAVED, savedCount);
        editor.putInt(KEY_CANDIDATE, candidateCount);
        editor.putInt(KEY_DEDUP, dedupCount);
        editor.putInt(KEY_HIGHLIGHTED, highlightedCount);
        editor.putLong("started_at", startedAt);
        editor.putString("mode", mode);
        editor.putString(KEY_STUDENT_ID, studentId);
        editor.putString(KEY_PROJECT_ID, projectId);
        editor.putString(KEY_PROJECT_NAME, projectName);
        editor.apply();
        writeSessionMetadata(status);
        CaptureTileService.requestRefresh(this);
    }

    private String safeExtra(Intent intent, String key) {
        String value = intent == null ? "" : intent.getStringExtra(key);
        return value == null ? "" : value.trim();
    }

    private void writeSessionMetadata(String status) {
        if (sessionDir == null) return;
        try {
            JSONObject metadata = new JSONObject();
            metadata.put("schema", "edu-manager.android-capture-session.v1");
            metadata.put("sessionId", sessionId == null ? "" : sessionId);
            metadata.put("studentId", studentId);
            metadata.put("studentName", studentName);
            metadata.put("projectId", projectId);
            metadata.put("projectName", projectName);
            metadata.put("mode", mode);
            metadata.put("status", status);
            metadata.put("startedAt", startedAt);
            metadata.put("endedAt", endedAt);
            metadata.put("endReason", endReason);
            metadata.put("candidateCount", candidateCount);
            metadata.put("savedCount", savedCount);
            metadata.put("dedupCount", dedupCount);
            metadata.put("highlightedCount", highlightedCount);
            metadata.put("captureDir", sessionDir.getAbsolutePath());
            File temporary = new File(sessionDir, "session.json.tmp");
            File target = new File(sessionDir, "session.json");
            FileOutputStream output = new FileOutputStream(temporary);
            output.write(metadata.toString(2).getBytes("UTF-8"));
            output.close();
            if (target.exists()) target.delete();
            if (!temporary.renameTo(target)) {
                FileOutputStream fallback = new FileOutputStream(target);
                fallback.write(metadata.toString(2).getBytes("UTF-8"));
                fallback.close();
                temporary.delete();
            }
        } catch (Exception ignored) {}
    }

    private Notification buildNotification(String text) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPending = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.brand_logo_round)
            .setContentTitle("AI教育管家屏幕采集")
            .setContentText(text)
            .setContentIntent(openPending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(notificationAction(android.R.drawable.btn_star_big_on, "重点", ACTION_HIGHLIGHT, 1))
            .addAction(notificationAction(android.R.drawable.ic_media_pause, paused ? "继续" : "暂停", paused ? ACTION_RESUME : ACTION_PAUSE, 2))
            .addAction(notificationAction(android.R.drawable.ic_menu_close_clear_cancel, "结束", ACTION_STOP, 3));
        return builder.build();
    }

    private Notification.Action notificationAction(int icon, String title, String action, int requestCode) {
        Intent intent = new Intent(this, CaptureProjectionService.class).setAction(action);
        PendingIntent pending = PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        return new Notification.Action.Builder(icon, title, pending).build();
    }

    private int immutableFlag() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "屏幕资料采集", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("显示正在运行的屏幕资料采集会话及控制按钮");
        manager.createNotificationChannel(channel);
    }

    private synchronized void stopCapture(String reason) {
        if (stopping) return;
        stopping = true;
        mainHandler.removeCallbacksAndMessages(null);
        if (imageReader != null) imageReader.setOnImageAvailableListener(null, null);
        if (virtualDisplay != null) virtualDisplay.release();
        virtualDisplay = null;
        if (imageReader != null) imageReader.close();
        imageReader = null;
        MediaProjection currentProjection = projection;
        projection = null;
        if (currentProjection != null) currentProjection.stop();
        if (captureThread != null) captureThread.quitSafely();
        captureThread = null;
        if (lastFrame != null) lastFrame.recycle();
        lastFrame = null;
        endedAt = System.currentTimeMillis();
        endReason = reason == null ? "" : reason;
        saveState("completed");
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("end_reason", endReason).apply();
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (!stopping) stopCapture("service_destroyed");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
