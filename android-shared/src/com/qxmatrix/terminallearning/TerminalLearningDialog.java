package com.qxmatrix.terminallearning;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.widget.EditText;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.UUID;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Map;
import java.util.WeakHashMap;

/** The host owns identity and decisions; this view only reads the selected scope. */
public final class TerminalLearningDialog {
    public static final int REQUEST_PRACTICE_IMAGE = 8291;
    public static final int REQUEST_PRACTICE_FILE = 8292;
    public static final int REQUEST_PRACTICE_CAMERA = 8293;
    private static final int MAX_PRACTICE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
    private static final Map<Activity, PendingAttachmentPicker> ATTACHMENT_PICKERS =
            Collections.synchronizedMap(new WeakHashMap<Activity, PendingAttachmentPicker>());

    public interface Transport {
        JSONObject get(String route) throws Exception;
        JSONObject post(String route, JSONObject body) throws Exception;
        String hostId();
    }

    private interface AttachmentSelected {
        void selected(JSONObject attachment);
        void failed(String message);
    }

    private static final class PendingAttachmentPicker {
        final AttachmentSelected callback;
        Uri cameraUri;
        PendingAttachmentPicker(AttachmentSelected callback) { this.callback = callback; }
    }

    private TerminalLearningDialog() {}

    public static void open(Activity activity, Transport transport, String studentId, boolean teacher) {
        openAction(activity, transport, studentId, teacher, "");
    }

    public static void openAction(Activity activity, Transport transport, String studentId, boolean teacher, String requestedAction) {
        if (studentId == null || studentId.length() == 0) {
            new AlertDialog.Builder(activity).setMessage("请先进入或选择学生空间。").setPositiveButton("知道了", null).show();
            return;
        }
        new Thread(new Runnable() { @Override public void run() {
            boolean practice = false, planning = false, planningSections = false, favorites = false, inbox = false, trajectory = false;
            String scope = "";
            try {
                String route = teacher ? "/api/teacher/students/" + Uri.encode(studentId) + "/capabilities" : "/api/student-session/capabilities";
                JSONObject response = transport.get(route), capabilities = response.optJSONObject("capabilities");
                practice = !teacher && capabilities != null && capabilities.optBoolean("practice");
                planning = capabilities != null && capabilities.optBoolean("planningRead");
                planningSections = capabilities != null && capabilities.optBoolean("planningSections");
                favorites = !teacher && capabilities != null && capabilities.optBoolean("planningFavorites");
                inbox = !teacher && capabilities != null && capabilities.optBoolean("remoteInbox");
                trajectory = !teacher && capabilities != null && capabilities.optBoolean("learningTrajectory");
                scope = response.optString("hostId") + ":" + response.optString("dataGeneration");
            } catch (Exception ignored) { /* An older host has no learning contract. */ }
            final boolean canPractice = practice, canPlan = planning, canPlanSections = planningSections,
                    canFavorite = favorites, canInbox = inbox, canTrajectory = trajectory;
            final String confirmedScope = scope;
            activity.runOnUiThread(new Runnable() { @Override public void run() {
                if (!canPractice && !canPlan && !canInbox && !canTrajectory) { showText(activity, "暂不可用", "当前主机尚未提供学习行动或规划接口；请先更新主机端。"); return; }
                if (confirmedScope.endsWith(":")) { showText(activity, "暂不可用", "未能核实主机资料代次，不能打开本地学习缓存。"); return; }
                Transport scoped = new Transport() {
                    @Override public JSONObject get(String route) throws Exception { return transport.get(route); }
                    @Override public JSONObject post(String route, JSONObject body) throws Exception { return transport.post(route, body); }
                    @Override public String hostId() { return confirmedScope; }
                };
                String action = requestedAction == null ? "" : requestedAction;
                if (action.isEmpty()) showMenu(activity, scoped, studentId, teacher, canPractice, canPlan, canPlanSections, canFavorite, canInbox, canTrajectory);
                else dispatchAction(activity, scoped, studentId, teacher, action, canPractice, canPlan, canPlanSections, canTrajectory);
            }});
        }}).start();
    }

    private static void dispatchAction(Activity activity, Transport transport, String studentId, boolean teacher, String action,
                                       boolean practice, boolean planning, boolean planningSections, boolean trajectory) {
        if ("practice".equals(action)) {
            if (practice) showPractice(activity, transport, studentId);
            else showText(activity, "学习卡片暂不可用", "当前主机尚未提供学习卡片接口；请先更新主机端。");
        } else if ("trajectory".equals(action)) {
            if (trajectory) showTrajectory(activity, transport, studentId);
            else showText(activity, "知识点跟踪暂不可用", "当前主机尚未提供知识点跟踪接口；请先更新主机端。");
        } else if (action.startsWith("guidance") || "topics".equals(action) || "competitions".equals(action)) {
            if (action.startsWith("guidance:") && !planningSections) showText(activity, "规划指导暂不可用", "当前主机尚未提供结构化规划栏目；请先更新主机端。");
            else if (planning) showPlanning(activity, transport, studentId, teacher, action);
            else showText(activity, "规划建议暂不可用", "当前主机尚未提供规划建议接口；请先更新主机端。");
        } else showText(activity, "暂不可用", "未知的学习行动入口。");
    }

    private static void showMenu(Activity activity, Transport transport, String studentId, boolean teacher, boolean practice,
                                 boolean planning, boolean planningSections, boolean favorites, boolean inbox, boolean trajectory) {
        ArrayList<String> labels = new ArrayList<String>(), actions = new ArrayList<String>();
        if (practice) { labels.add("学习卡片"); actions.add("practice"); }
        if (trajectory) { labels.add("知识点跟踪"); actions.add("trajectory"); }
        if (planning) {
            labels.add("规划总览"); actions.add("guidance");
            labels.add("选题建议"); actions.add("topics");
            labels.add("推荐比赛"); actions.add("competitions");
        }
        if (favorites) { labels.add("我的收藏"); actions.add("favorites"); }
        if (inbox) { labels.add("文字分享收件箱"); actions.add("inbox"); }
        new AlertDialog.Builder(activity).setTitle(teacher ? "所选学生的建议" : "我的学习与规划")
                .setItems(labels.toArray(new String[0]), new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int index) {
                    String action = actions.get(index);
                    if ("practice".equals(action)) showPractice(activity, transport, studentId);
                    else if ("trajectory".equals(action)) showTrajectory(activity, transport, studentId);
                    else if ("favorites".equals(action)) showFavorites(activity, transport);
                    else if ("inbox".equals(action)) showInbox(activity, transport, studentId);
                    else if (action.startsWith("guidance:") && !planningSections) showText(activity, "规划指导暂不可用", "当前主机尚未提供结构化规划栏目；请先更新主机端。");
                    else showPlanning(activity, transport, studentId, teacher, action);
                }}).setNegativeButton("关闭", null).show();
    }

    private static String scopeKey(Transport transport, String studentId) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest((transport.hostId() + ":" + studentId).getBytes(StandardCharsets.UTF_8));
            StringBuilder value = new StringBuilder();
            for (int index = 0; index < 16; index++) value.append(String.format("%02x", hash[index] & 0xff));
            return value.toString();
        } catch (Exception error) { throw new IllegalStateException("无法核实学习缓存范围", error); }
    }

    private static SharedPreferences prefs(Activity activity) {
        return activity.getSharedPreferences("terminal_learning", Activity.MODE_PRIVATE);
    }

    private static File practiceDraftDirectory(Activity activity) throws Exception {
        File directory = new File(activity.getFilesDir(), "practice-answer-drafts");
        if (!directory.exists() && !directory.mkdirs()) throw new Exception("无法创建作答暂存目录");
        if (!directory.isDirectory()) throw new Exception("作答暂存目录不可用");
        File[] oldDrafts = directory.listFiles();
        if (oldDrafts != null) for (File file : oldDrafts) {
            if (file.isFile() && System.currentTimeMillis() - file.lastModified() > 7L * 24L * 60L * 60L * 1000L) file.delete();
        }
        return directory.getCanonicalFile();
    }

    private static String safeAttachmentName(Activity activity, Uri uri, String mimeType) {
        String name = "";
        Cursor cursor = null;
        try {
            cursor = activity.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        } catch (Exception ignored) { /* Fall back to the URI segment. */ }
        finally { if (cursor != null) cursor.close(); }
        if (name == null || name.trim().isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.trim().isEmpty()) name = "practice-answer";
        name = name.replaceAll("[\\\\/\\x00-\\x1f]", "_").trim();
        String lower = name.toLowerCase();
        if (!lower.matches(".*\\.(png|jpg|jpeg|pdf|txt|md|docx)$")) {
            String extension = "";
            if ("image/png".equalsIgnoreCase(mimeType)) extension = ".png";
            else if (mimeType != null && mimeType.toLowerCase().startsWith("image/")) extension = ".jpg";
            else if ("application/pdf".equalsIgnoreCase(mimeType)) extension = ".pdf";
            else if ("application/vnd.openxmlformats-officedocument.wordprocessingml.document".equalsIgnoreCase(mimeType)) extension = ".docx";
            else if ("text/markdown".equalsIgnoreCase(mimeType)) extension = ".md";
            else if (mimeType != null && mimeType.toLowerCase().startsWith("text/")) extension = ".txt";
            name += extension;
        }
        if (name.length() > 150) name = name.substring(name.length() - 150);
        return name;
    }

    private static String extensionOf(String name) {
        String value = name == null ? "" : name.toLowerCase();
        int dot = value.lastIndexOf('.');
        return dot < 0 ? "" : value.substring(dot);
    }

    private static JSONObject persistPracticeAttachment(Activity activity, Uri uri) throws Exception {
        String mimeType = activity.getContentResolver().getType(uri);
        String name = safeAttachmentName(activity, uri, mimeType);
        String extension = extensionOf(name);
        if (!(extension.equals(".png") || extension.equals(".jpg") || extension.equals(".jpeg") || extension.equals(".pdf")
                || extension.equals(".txt") || extension.equals(".md") || extension.equals(".docx"))) {
            throw new Exception("仅支持 PNG、JPG、PDF、DOCX、TXT 或 Markdown 作答文件");
        }
        String localId = UUID.randomUUID().toString() + extension;
        File target = new File(practiceDraftDirectory(activity), localId);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0L;
        try (InputStream input = activity.getContentResolver().openInputStream(uri);
             FileOutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new Exception("无法读取所选作答文件");
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count == 0) continue;
                total += count;
                if (total > MAX_PRACTICE_ATTACHMENT_BYTES) throw new Exception("作答文件超过 10 MiB，请压缩或拆分后重试");
                output.write(buffer, 0, count);
                digest.update(buffer, 0, count);
            }
            output.flush();
        } catch (Exception error) {
            target.delete();
            throw error;
        }
        if (total <= 0) { target.delete(); throw new Exception("所选作答文件为空"); }
        StringBuilder sha256 = new StringBuilder();
        for (byte value : digest.digest()) sha256.append(String.format("%02x", value & 0xff));
        return new JSONObject().put("name", name).put("localId", localId).put("bytes", total)
                .put("sha256", sha256.toString()).put("mime", mimeType == null ? "" : mimeType)
                .put("visualReview", extension.equals(".png") || extension.equals(".jpg") || extension.equals(".jpeg"));
    }

    private static File practiceDraftFile(Activity activity, JSONObject attachment) throws Exception {
        String localId = attachment == null ? "" : attachment.optString("localId");
        if (!localId.matches("[0-9a-fA-F-]{36}\\.(png|jpg|jpeg|pdf|txt|md|docx)")) throw new Exception("作答暂存引用无效");
        File directory = practiceDraftDirectory(activity), file = new File(directory, localId).getCanonicalFile();
        String prefix = directory.getPath() + File.separator;
        if (!file.getPath().startsWith(prefix) || !file.isFile()) throw new Exception("作答原件暂存已丢失，请重新选择");
        return file;
    }

    private static JSONObject networkAttempt(Activity activity, JSONObject stored) throws Exception {
        JSONObject outgoing = new JSONObject(stored.toString());
        JSONObject attachment = outgoing.optJSONObject("attachment");
        if (attachment == null) return outgoing;
        File file = practiceDraftFile(activity, attachment);
        long expectedBytes = attachment.optLong("bytes", -1L);
        if (expectedBytes <= 0 || expectedBytes > MAX_PRACTICE_ATTACHMENT_BYTES || file.length() != expectedBytes) throw new Exception("作答原件暂存大小已变化，请重新选择");
        byte[] bytes = new byte[(int) expectedBytes];
        int offset = 0;
        try (FileInputStream input = new FileInputStream(file)) {
            while (offset < bytes.length) {
                int count = input.read(bytes, offset, bytes.length - offset);
                if (count < 0) break;
                offset += count;
            }
        }
        if (offset != bytes.length) throw new Exception("作答原件暂存读取不完整，请重新选择");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        StringBuilder sha256 = new StringBuilder();
        for (byte value : digest.digest(bytes)) sha256.append(String.format("%02x", value & 0xff));
        if (!sha256.toString().equals(attachment.optString("sha256"))) throw new Exception("作答原件暂存已变化，请重新选择");
        outgoing.put("attachment", new JSONObject().put("name", attachment.optString("name"))
                .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)));
        outgoing.put("allowImageReview", attachment.optBoolean("visualReview"));
        return outgoing;
    }

    private static void deleteDraftAttachment(Activity activity, JSONObject attempt) {
        try {
            JSONObject attachment = attempt == null ? null : attempt.optJSONObject("attachment");
            if (attachment != null) practiceDraftFile(activity, attachment).delete();
        } catch (Exception ignored) { /* Nothing outside the private draft directory is touched. */ }
    }

    private static void choosePracticeAttachment(Activity activity, AttachmentSelected callback) {
        new AlertDialog.Builder(activity).setTitle("添加作答原件")
                .setItems(new String[] { "拍照作答", "选择图片", "选择文件" }, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) {
                        PendingAttachmentPicker pending = new PendingAttachmentPicker(callback);
                        ATTACHMENT_PICKERS.put(activity, pending);
                        try {
                            Intent intent;
                            int requestCode;
                            if (which == 0) {
                                ContentValues values = new ContentValues();
                                values.put(MediaStore.Images.Media.DISPLAY_NAME, "practice-answer-" + System.currentTimeMillis() + ".jpg");
                                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AI教育管家/学习卡片");
                                pending.cameraUri = activity.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                                if (pending.cameraUri == null) throw new Exception("无法创建拍照作答文件");
                                intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, pending.cameraUri)
                                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                                requestCode = REQUEST_PRACTICE_CAMERA;
                            } else {
                                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                requestCode = which == 1 ? REQUEST_PRACTICE_IMAGE : REQUEST_PRACTICE_FILE;
                                if (which == 1) intent.setType("image/*");
                                else intent.setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                                        "image/png", "image/jpeg", "application/pdf", "text/plain", "text/markdown",
                                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                });
                            }
                            activity.startActivityForResult(intent, requestCode);
                        } catch (Exception error) {
                            ATTACHMENT_PICKERS.remove(activity);
                            callback.failed(error.getMessage());
                        }
                    }
                }).setNegativeButton("取消", null).show();
    }

    public static boolean handleActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_PRACTICE_IMAGE && requestCode != REQUEST_PRACTICE_FILE && requestCode != REQUEST_PRACTICE_CAMERA) return false;
        PendingAttachmentPicker pending = ATTACHMENT_PICKERS.remove(activity);
        if (pending == null) return true;
        if (resultCode != Activity.RESULT_OK) {
            if (pending.cameraUri != null) try { activity.getContentResolver().delete(pending.cameraUri, null, null); } catch (Exception ignored) {}
            pending.callback.failed("已取消选择作答原件");
            return true;
        }
        Uri uri = requestCode == REQUEST_PRACTICE_CAMERA ? pending.cameraUri : (data == null ? null : data.getData());
        if (uri == null) { pending.callback.failed("没有取得作答原件"); return true; }
        new Thread(new Runnable() { @Override public void run() {
            try {
                JSONObject attachment = persistPracticeAttachment(activity, uri);
                activity.runOnUiThread(new Runnable() { @Override public void run() { pending.callback.selected(attachment); } });
            } catch (Exception error) {
                final String message = error.getMessage();
                activity.runOnUiThread(new Runnable() { @Override public void run() { pending.callback.failed(message); } });
            }
        }}).start();
        return true;
    }

    private static void showPractice(Activity activity, Transport transport, String studentId) {
        final String key = scopeKey(transport, studentId);
        new Thread(new Runnable() { @Override public void run() {
            JSONObject payload = null;
            String failure = "";
            try {
                String pending = prefs(activity).getString(key + ":pending", "");
                if (!pending.isEmpty()) {
                    JSONObject record = new JSONObject(pending);
                    try {
                        transport.post("/api/student-session/practice/" + record.getString("cardId") + "/attempt",
                                networkAttempt(activity, record.getJSONObject("attempt")));
                        deleteDraftAttachment(activity, record.getJSONObject("attempt"));
                        prefs(activity).edit().remove(key + ":pending").apply();
                    } catch (Exception ignored) { /* Keep the same attempt ID for the next retry. */ }
                }
                payload = transport.get("/api/student-session/practice");
                JSONObject card = payload.optJSONObject("dashboard") == null ? null : payload.optJSONObject("dashboard").optJSONObject("current");
                if (card != null) prefs(activity).edit().putString(key + ":card", card.toString()).apply();
            } catch (Exception error) {
                failure = error.getMessage();
                try { payload = new JSONObject().put("dashboard", new JSONObject().put("current", new JSONObject(prefs(activity).getString(key + ":card", "{}")))); }
                catch (Exception ignored) { payload = new JSONObject(); }
            }
            final JSONObject result = payload;
            final String warning = failure;
            activity.runOnUiThread(new Runnable() { @Override public void run() { renderPractice(activity, transport, studentId, key, result, warning); } });
        }}).start();
    }

    private static void renderPractice(Activity activity, Transport transport, String studentId, String key, JSONObject payload, String warning) {
        JSONObject dashboard = payload == null ? null : payload.optJSONObject("dashboard");
        JSONObject card = dashboard == null ? null : dashboard.optJSONObject("current");
        if (card == null || card.optString("id").isEmpty()) {
            showText(activity, "学习卡片", warning.isEmpty() ? "当前没有已投递的卡片。" : "当前无法读取主机：" + warning);
            return;
        }
        JSONObject content = card.optJSONObject("content");
        if (content == null) content = new JSONObject();
        final JSONObject cardContent = content;
        String cardId = card.optString("id"), state = card.optString("status");
        String text = content.optString("title") + "\n" + content.optString("subject") + " · " + content.optString("knowledgePoint")
                + "\n\n" + content.optString("prompt") + "\n\n" + (warning.isEmpty() ? "" : "离线缓存；提交后会在下次打开时重试。\n")
                + (prefs(activity).contains(key + ":pending") ? "上一份作答待主机确认，请勿重复填写。\n" : "")
                + ("completed".equals(state) ? "参考答案：" + content.optString("answer") + "\n" + content.optString("explanation") : "");
        AlertDialog.Builder builder = new AlertDialog.Builder(activity).setTitle("学习卡片").setMessage(text).setNegativeButton("关闭", null);
        if ("ready".equals(state) && warning.isEmpty()) builder.setPositiveButton("开始练习", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface dialog, int which) {
                new Thread(new Runnable() { @Override public void run() {
                    try { transport.post("/api/student-session/practice/" + cardId + "/start", new JSONObject()); showPractice(activity, transport, studentId); }
                    catch (Exception error) { final String message = error.getMessage(); activity.runOnUiThread(new Runnable() { @Override public void run() { showText(activity, "开始失败", message); } }); }
                }}).start();
            }
        });
        if ("started".equals(state) && !prefs(activity).contains(key + ":pending")) builder.setPositiveButton("作答", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface dialog, int which) { answer(activity, transport, studentId, key, cardId, cardContent.optString("hint")); }
        });
        if (prefs(activity).contains(key + ":pending")) builder.setNeutralButton("检查暂存作答", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface dialog, int which) {
                try {
                    JSONObject record = new JSONObject(prefs(activity).getString(key + ":pending", ""));
                    JSONObject storedAttempt = record.getJSONObject("attempt");
                    String original = storedAttempt.optString("answer");
                    JSONObject storedAttachment = storedAttempt.optJSONObject("attachment");
                    if (storedAttachment != null) original += (original.isEmpty() ? "" : "\n\n") + "作答原件：" + storedAttachment.optString("name")
                            + "\n主机接收后将先进行 OCR/视觉理解，再进入评阅与反馈。";
                    new AlertDialog.Builder(activity).setTitle("未确认作答原文").setMessage(original)
                            .setNegativeButton("保留", null)
                            .setPositiveButton("按原编号重试", new DialogInterface.OnClickListener() {
                                @Override public void onClick(DialogInterface retry, int selected) { showPractice(activity, transport, studentId); }
                            }).setNeutralButton("丢弃本机暂存", new DialogInterface.OnClickListener() {
                                @Override public void onClick(DialogInterface discard, int selected) {
                                    new AlertDialog.Builder(activity).setMessage("若主机此前已接收，此操作不会撤回主机作答。仅丢弃本机暂存并允许重新填写，确定？")
                                            .setNegativeButton("取消", null).setPositiveButton("确定", new DialogInterface.OnClickListener() {
                                                @Override public void onClick(DialogInterface confirm, int value) {
                                                    deleteDraftAttachment(activity, storedAttempt);
                                                    prefs(activity).edit().remove(key + ":pending").apply(); showPractice(activity, transport, studentId);
                                                }
                                            }).show();
                                }
                            }).show();
                } catch (Exception error) { showText(activity, "暂存异常", "本机作答暂存无法读取，请保留应用数据并联系管理员。"); }
            }
        });
        builder.show();
    }

    private static void answer(Activity activity, Transport transport, String studentId, String key, String cardId, String hint) {
        LinearLayout form = new LinearLayout(activity); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(24, 8, 24, 8);
        ScrollView formScroll = new ScrollView(activity); formScroll.setFillViewport(false); formScroll.addView(form);
        TextView hintView = new TextView(activity); hintView.setText("提示：" + (hint.isEmpty() ? "暂无" : hint)); form.addView(hintView);
        EditText answer = new EditText(activity); answer.setHint("填写我的作答（可与图片/文件一起提交）"); answer.setMinLines(4); form.addView(answer);
        final JSONObject[] selectedAttachment = new JSONObject[] { null };
        TextView attachmentStatus = new TextView(activity);
        attachmentStatus.setText("可选：拍照或选择图片、PDF、DOCX、TXT、Markdown（最大 10 MiB）。\n图片会在主机中先做 OCR 与视觉理解；识别不清时保留原件并提示核对。");
        attachmentStatus.setPadding(0, 12, 0, 8);
        form.addView(attachmentStatus);
        Button attachmentButton = new Button(activity); attachmentButton.setText("拍照 / 上传图片或文件");
        attachmentButton.setMinHeight((int) (48 * activity.getResources().getDisplayMetrics().density + 0.5f));
        form.addView(attachmentButton);
        attachmentButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                choosePracticeAttachment(activity, new AttachmentSelected() {
                    @Override public void selected(JSONObject attachment) {
                        if (selectedAttachment[0] != null) {
                            try { practiceDraftFile(activity, selectedAttachment[0]).delete(); } catch (Exception ignored) {}
                        }
                        selectedAttachment[0] = attachment;
                        attachmentStatus.setText("已选择：" + attachment.optString("name") + "（" + Math.max(1L, attachment.optLong("bytes") / 1024L) + " KiB）\n"
                                + (attachment.optBoolean("visualReview")
                                ? "提交后先进行 OCR 与视觉理解，再进入评阅和反馈。"
                                : "提交后先提取文件文字，再进入评阅和反馈。"));
                        attachmentButton.setText("更换作答原件");
                    }
                    @Override public void failed(String message) { attachmentStatus.setText(message); }
                });
            }
        });
        String[] difficulty = {"太简单", "正合适", "有点难"};
        Spinner difficultyPicker = new Spinner(activity);
        difficultyPicker.setAdapter(new ArrayAdapter<String>(activity, android.R.layout.simple_spinner_dropdown_item, difficulty));
        difficultyPicker.setSelection(1); form.addView(difficultyPicker);
        new AlertDialog.Builder(activity).setTitle("提交练习").setView(formScroll)
                .setOnCancelListener(new DialogInterface.OnCancelListener() {
                    @Override public void onCancel(DialogInterface dialog) {
                        if (selectedAttachment[0] != null) {
                            try { practiceDraftFile(activity, selectedAttachment[0]).delete(); } catch (Exception ignored) {}
                        }
                    }
                })
                .setNegativeButton("取消", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) {
                        if (selectedAttachment[0] != null) {
                            try { practiceDraftFile(activity, selectedAttachment[0]).delete(); } catch (Exception ignored) {}
                        }
                    }
                }).setPositiveButton("提交", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    String value = answer.getText().toString().trim();
                    if (value.isEmpty() && selectedAttachment[0] == null) { showText(activity, "未提交", "请填写文字作答，或拍照/选择一个作答文件。"); return; }
                    try {
                        JSONObject attempt = new JSONObject().put("attemptId", UUID.randomUUID().toString())
                                .put("difficulty", difficultyPicker.getSelectedItemPosition() == 0 ? "easy" : difficultyPicker.getSelectedItemPosition() == 2 ? "hard" : "right").put("confidence", 3);
                        if (!value.isEmpty()) attempt.put("answer", value);
                        if (selectedAttachment[0] != null) attempt.put("attachment", selectedAttachment[0]);
                        prefs(activity).edit().putString(key + ":pending", new JSONObject().put("cardId", cardId).put("attempt", attempt).toString()).apply();
                        showPractice(activity, transport, studentId);
                    } catch (Exception error) { showText(activity, "暂存失败", error.getMessage()); }
                }}).show();
    }

    private static void showTrajectory(Activity activity, Transport transport, String studentId) {
        final String key = scopeKey(transport, studentId) + ":trajectory";
        new Thread(new Runnable() { @Override public void run() {
            JSONObject payload = null;
            String warning = "";
            try {
                payload = transport.get("/api/student-session/learning-trajectory");
                prefs(activity).edit().putString(key, payload.toString()).apply();
            } catch (Exception error) {
                warning = error.getMessage();
                try { payload = new JSONObject(prefs(activity).getString(key, "{}")); }
                catch (Exception ignored) { payload = new JSONObject(); }
            }
            StringBuilder out = new StringBuilder();
            if (!warning.isEmpty()) out.append("当前显示按本主机、资料代次和学生隔离的离线缓存。\n读取提示：").append(warning).append("\n\n");
            JSONArray states = payload.optJSONArray("states");
            if (states == null || states.length() == 0) {
                out.append(payload.optString("message", warning.isEmpty() ? "当前还没有可用于知识点跟踪的已核验学习证据。" : "当前没有可用缓存。"));
            } else {
                String currentSubject = "";
                for (int index = 0; index < states.length(); index++) {
                    JSONObject state = states.optJSONObject(index);
                    if (state == null) continue;
                    JSONObject point = state.optJSONObject("knowledgePoint");
                    String subject = point == null ? "其他" : point.optString("subject", "其他");
                    if (!subject.equals(currentSubject)) {
                        currentSubject = subject;
                        out.append(index == 0 ? "" : "\n").append("【").append(subject).append("】\n");
                    }
                    String label = point == null ? "未命名知识点" : point.optString("label", point.optString("id", "未命名知识点"));
                    out.append("• ").append(label).append("：").append(stateLabel(state.optString("state")))
                            .append("\n  证据 ").append(state.optInt("evidenceCount", 0)).append(" 条")
                            .append(" · 复习优先级 ").append(priorityLabel(state.optString("reviewPriority")));
                    String last = state.optString("lastPracticedAt");
                    if (!last.isEmpty()) out.append("\n  最近练习：").append(shortDate(last));
                    String reviewAt = state.optString("recommendedReviewAt");
                    if (!reviewAt.isEmpty()) out.append(" · 建议复习：").append(shortDate(reviewAt));
                    if (!state.optString("retentionNote").isEmpty()) out.append("\n  ").append(state.optString("retentionNote"));
                    out.append("\n");
                }
                out.append("\n以上为学习证据的只读投影，不等于考试成绩、确定性掌握结论或已确认遗忘。");
            }
            final String content = out.toString();
            activity.runOnUiThread(new Runnable() { @Override public void run() { showText(activity, "知识点跟踪", content); } });
        }}).start();
    }

    private static void showPlanning(Activity activity, Transport transport, String studentId, boolean teacher, String kind) {
        String prefix = teacher ? "/api/teacher/students/" + Uri.encode(studentId) + "/planning/" : "/api/student-session/planning/";
        final String routeKind = kind.startsWith("guidance") ? "guidance" : kind;
        final String guidanceSection = kind.startsWith("guidance:") ? kind.substring("guidance:".length()) : "";
        new Thread(new Runnable() { @Override public void run() {
            String title = guidanceTitle(guidanceSection, routeKind);
            String text;
            JSONObject currentVersion = null;
            try {
                JSONObject result = transport.get(prefix + routeKind), current = result.optJSONObject("current");
                currentVersion = current;
                if (current == null) text = "主机尚未形成此类建议。";
                else {
                    StringBuilder out = new StringBuilder("版本：").append(current.optInt("version", 1))
                            .append("\n核验：").append(current.optString("verifiedAt", current.optString("createdAt", "未记录"))).append("\n\n");
                    if ("guidance".equals(routeKind) && !guidanceSection.isEmpty()) {
                        JSONObject sections = current.optJSONObject("sections");
                        JSONObject section = sections == null ? null : sections.optJSONObject(guidanceSection);
                        if (section == null) out.append("主机没有返回").append(title).append("结构，请刷新主机规划数据或更新主机端。\n");
                        else appendGuidanceSection(out, section);
                    } else {
                        appendArray(out, current.optJSONArray("findings"));
                        appendArray(out, current.optJSONArray("nearTermActions"));
                    }
                    JSONArray candidates = current.optJSONArray("candidates");
                    if (candidates != null) for (int i = 0; i < candidates.length(); i++) {
                        JSONObject item = candidates.optJSONObject(i); if (item == null) continue;
                        out.append("\n").append(i + 1).append(". ").append(item.optString("title", item.optString("name")))
                                .append("\n").append(item.optString("rationale", item.optString("fitReason", "")));
                        appendArray(out, item.optJSONArray("matchReasons"));
                        appendArray(out, item.optJSONArray("missing"));
                        if (!item.optString("deadline").isEmpty()) out.append("\n截止：").append(item.optString("deadline"));
                        if (!item.optString("officialUrl").isEmpty()) out.append("\n来源：").append(item.optString("officialUrl"));
                        out.append("\n");
                    }
                    if (result.optBoolean("needsRefresh")) out.append("\n资料已变化，建议由主机重新核验。");
                    out.append("\n候选建议不代表能力证明、录取保证、职业结果或比赛结果预测。\n");
                    text = out.toString();
                }
            } catch (Exception error) { text = "读取失败：" + error.getMessage(); }
            final String content = text; final JSONObject version = currentVersion;
            activity.runOnUiThread(new Runnable() { @Override public void run() {
                if (teacher || "guidance".equals(routeKind) || version == null || version.optJSONArray("candidates") == null) {
                    showText(activity, title, content); return;
                }
                ScrollView scroll = new ScrollView(activity);
                TextView view = new TextView(activity); view.setText(content); view.setPadding(32, 24, 32, 24); view.setTextSize(16); scroll.addView(view);
                new AlertDialog.Builder(activity).setTitle(title).setView(scroll).setNegativeButton("关闭", null)
                        .setPositiveButton("管理收藏", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface dialog, int which) { choosePlanningFavorite(activity, transport, routeKind, version); }
                        }).show();
            }});
        }}).start();
    }

    private static void choosePlanningFavorite(Activity activity, Transport transport, String kind, JSONObject version) {
        JSONArray candidates = version.optJSONArray("candidates");
        if (candidates == null || candidates.length() == 0) { showText(activity, "收藏", "当前没有可收藏的建议。"); return; }
        new Thread(new Runnable() { @Override public void run() {
            try {
                JSONObject result = transport.get("/api/student-session/planning-favorites/" + kind);
                JSONArray favorites = result.optJSONArray("favorites");
                String[] labels = new String[candidates.length()];
                boolean[] saved = new boolean[candidates.length()];
                for (int index = 0; index < candidates.length(); index++) {
                    JSONObject candidate = candidates.optJSONObject(index);
                    String id = candidate == null ? "" : candidate.optString("id");
                    if (favorites != null) for (int j = 0; j < favorites.length(); j++) {
                        JSONObject item = favorites.optJSONObject(j);
                        if (item != null && id.equals(item.optString("candidateId"))) { saved[index] = true; break; }
                    }
                    labels[index] = (saved[index] ? "★ " : "☆ ") + (candidate == null ? "建议" : candidate.optString("title", candidate.optString("name", "建议")));
                }
                activity.runOnUiThread(new Runnable() { @Override public void run() {
                    new AlertDialog.Builder(activity).setTitle("选择要收藏或取消的建议").setItems(labels, new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface dialog, int which) {
                            JSONObject candidate = candidates.optJSONObject(which);
                            if (candidate == null || candidate.optString("id").isEmpty()) return;
                            new Thread(new Runnable() { @Override public void run() {
                                String message;
                                try {
                                    transport.post("/api/student-session/planning-favorites/" + kind,
                                            new JSONObject().put("versionId", version.optString("id"))
                                                    .put("candidateId", candidate.optString("id")).put("saved", !saved[which]));
                                    message = saved[which] ? "已取消收藏。" : "已收藏当前建议版本。";
                                } catch (Exception error) { message = "收藏未更新：" + error.getMessage(); }
                                final String feedback = message;
                                activity.runOnUiThread(new Runnable() { @Override public void run() { showText(activity, "收藏", feedback); } });
                            }}).start();
                        }
                    }).setNegativeButton("关闭", null).show();
                }});
            } catch (Exception error) {
                final String message = error.getMessage();
                activity.runOnUiThread(new Runnable() { @Override public void run() { showText(activity, "收藏暂不可用", message); } });
            }
        }}).start();
    }

    private static void showFavorites(Activity activity, Transport transport) {
        new Thread(new Runnable() { @Override public void run() {
            StringBuilder text = new StringBuilder();
            try {
                for (String kind : new String[]{"topics", "competitions"}) {
                    JSONObject result = transport.get("/api/student-session/planning-favorites/" + kind);
                    JSONArray favorites = result.optJSONArray("favorites");
                    text.append("topics".equals(kind) ? "选题\n" : "\n比赛\n");
                    if (favorites == null || favorites.length() == 0) text.append("暂无收藏\n");
                    else for (int i = 0; i < favorites.length(); i++) {
                        JSONObject item = favorites.optJSONObject(i), candidate = item == null ? null : item.optJSONObject("candidate");
                        if (candidate != null) text.append("• ").append(candidate.optString("title", candidate.optString("name", "建议")))
                                .append(" · ").append(item.optString("savedAt")).append("\n");
                    }
                }
            } catch (Exception error) { text.append("读取失败：").append(error.getMessage()); }
            final String content = text.toString();
            activity.runOnUiThread(new Runnable() { @Override public void run() { showText(activity, "我的收藏", content); } });
        }}).start();
    }

    private static void showInbox(Activity activity, Transport transport, String studentId) {
        final String key = scopeKey(transport, studentId) + ":inboxPending";
        String pending = prefs(activity).getString(key, "");
        if (!pending.isEmpty()) {
            try {
                JSONObject record = new JSONObject(pending);
                new AlertDialog.Builder(activity).setTitle("上一份分享等待确认")
                        .setMessage(record.optString("title") + "\n\n" + record.optString("text"))
                        .setPositiveButton("按原编号重试", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface dialog, int which) { sendInbox(activity, transport, studentId, key, record); }
                        }).setNegativeButton("稍后再说", null)
                        .setNeutralButton("丢弃本机暂存", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface dialog, int which) {
                                new AlertDialog.Builder(activity).setMessage("只丢弃本机暂存；若主机此前已接收，主机副本不会删除。确定继续？")
                                        .setNegativeButton("取消", null).setPositiveButton("确定", new DialogInterface.OnClickListener() {
                                            @Override public void onClick(DialogInterface confirm, int selected) {
                                                prefs(activity).edit().remove(key).apply(); showInbox(activity, transport, studentId);
                                            }
                                        }).show();
                            }
                        }).show();
            } catch (Exception error) { showText(activity, "暂存异常", "本机分享草稿无法读取，请保留应用数据并联系管理员。"); }
            return;
        }
        new Thread(new Runnable() { @Override public void run() {
            StringBuilder summary = new StringBuilder("分享文字资料会进入当前学生的主机待整理收件箱，不自动成为已确认成长证据。\n\n最近接收：\n");
            try {
                JSONArray items = transport.get("/api/student-session/inbox").optJSONArray("items");
                if (items == null || items.length() == 0) summary.append("暂无\n");
                else for (int i = 0; i < Math.min(items.length(), 10); i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item != null) summary.append("• ").append(item.optString("originalName")).append(" · ").append(item.optString("status")).append("\n");
                }
            } catch (Exception error) { summary.append("暂无法读取：").append(error.getMessage()).append("\n"); }
            final String content = summary.toString();
            activity.runOnUiThread(new Runnable() { @Override public void run() {
                new AlertDialog.Builder(activity).setTitle("文字分享收件箱").setMessage(content).setNegativeButton("关闭", null)
                        .setPositiveButton("新建分享", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface dialog, int which) { composeInbox(activity, transport, studentId, key); }
                        }).show();
            }});
        }}).start();
    }

    private static void composeInbox(Activity activity, Transport transport, String studentId, String key) {
        LinearLayout form = new LinearLayout(activity); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(24, 8, 24, 8);
        EditText title = new EditText(activity); title.setHint("标题，如课堂笔记"); title.setSingleLine(true); title.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(80)}); form.addView(title);
        EditText body = new EditText(activity); body.setHint("分享文字"); body.setMinLines(5); body.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(10000)}); form.addView(body);
        new AlertDialog.Builder(activity).setTitle("分享给主机收件箱").setView(form).setNegativeButton("取消", null)
                .setPositiveButton("发送", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) {
                        String text = body.getText().toString().trim();
                        if (text.isEmpty()) { showText(activity, "未发送", "请先填写分享内容。"); return; }
                        try {
                            JSONObject record = new JSONObject().put("eventId", UUID.randomUUID().toString())
                                    .put("title", title.getText().toString().trim()).put("text", text);
                            if (!prefs(activity).edit().putString(key, record.toString()).commit()) throw new IllegalStateException("本机暂存失败");
                            sendInbox(activity, transport, studentId, key, record);
                        } catch (Exception error) { showText(activity, "未发送", error.getMessage()); }
                    }
                }).show();
    }

    private static void sendInbox(Activity activity, Transport transport, String studentId, String key, JSONObject record) {
        new Thread(new Runnable() { @Override public void run() {
            String message;
            try {
                JSONObject result = transport.post("/api/student-session/inbox", record);
                if (!studentId.equals(result.optString("studentId"))) throw new IllegalStateException("主机回执的学生范围不一致");
                prefs(activity).edit().remove(key).apply();
                message = result.optBoolean("duplicate") ? "主机已确认先前的分享回执。" : "已送入主机收件箱，等待整理。";
            } catch (Exception error) { message = "发送结果未确认，原文已留在本机。下次打开可按同一编号重试：" + error.getMessage(); }
            final String feedback = message;
            activity.runOnUiThread(new Runnable() { @Override public void run() { showText(activity, "分享回执", feedback); } });
        }}).start();
    }

    private static String guidanceTitle(String section, String kind) {
        if ("pathways".equals(section)) return "升学路径";
        if ("majors".equals(section)) return "专业探索";
        if ("careers".equals(section)) return "职业发展";
        if ("guidance".equals(kind)) return "规划总览";
        return "topics".equals(kind) ? "推荐选题" : "推荐比赛";
    }

    private static void appendGuidanceSection(StringBuilder out, JSONObject section) {
        String[] fields = new String[] {
            "studentBasis", "routeOptions", "milestones", "majorOptions", "trialCourses", "roleOptions", "practiceTasks",
            "facts", "inferences", "missing", "conditions", "limitations", "alternatives", "actions", "sourceUrls"
        };
        String[] labels = new String[] {
            "学生依据", "路径选项", "阶段节点", "专业方向", "体验课程", "职业方向", "实践任务",
            "已核实事实", "推断", "待补信息", "适用条件", "限制", "备选方案", "下一步行动", "来源"
        };
        for (int index = 0; index < fields.length; index++) {
            JSONArray values = section.optJSONArray(fields[index]);
            if (values == null || values.length() == 0) continue;
            out.append("【").append(labels[index]).append("】\n");
            appendArray(out, values);
        }
    }

    private static String stateLabel(String value) {
        if ("mastered".equals(value)) return "近期证据较稳定";
        if ("mostly_mastered".equals(value)) return "多数近期证据稳定";
        if ("practiced".equals(value)) return "已有练习证据";
        if ("developing".equals(value)) return "持续练习中";
        if ("unstable".equals(value)) return "表现波动";
        if ("needs_review".equals(value)) return "建议复习";
        return "证据不足";
    }

    private static String priorityLabel(String value) {
        if ("high".equals(value)) return "高";
        if ("medium".equals(value)) return "中";
        if ("low".equals(value)) return "低";
        return "待判断";
    }

    private static String shortDate(String value) {
        return value != null && value.length() >= 10 ? value.substring(0, 10) : String.valueOf(value == null ? "" : value);
    }

    private static void appendArray(StringBuilder out, JSONArray values) {
        if (values == null) return;
        for (int i = 0; i < values.length(); i++) if (!values.optString(i).isEmpty()) out.append("• ").append(values.optString(i)).append("\n");
    }

    private static void showText(Activity activity, String title, String content) {
        ScrollView scroll = new ScrollView(activity);
        TextView text = new TextView(activity); text.setPadding(32, 24, 32, 24); text.setTextSize(16); text.setText(content);
        scroll.addView(text);
        new AlertDialog.Builder(activity).setTitle(title).setView(scroll).setPositiveButton("关闭", null).show();
    }
}
