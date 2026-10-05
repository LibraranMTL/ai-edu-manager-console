package com.qxmatrix.terminallearning;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.EditText;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/** The host owns identity and decisions; this view only reads the selected scope. */
public final class TerminalLearningDialog {
    public interface Transport {
        JSONObject get(String route) throws Exception;
        JSONObject post(String route, JSONObject body) throws Exception;
        String hostId();
    }

    private TerminalLearningDialog() {}

    public static void open(Activity activity, Transport transport, String studentId, boolean teacher) {
        if (studentId == null || studentId.length() == 0) {
            new AlertDialog.Builder(activity).setMessage("请先进入或选择学生空间。").setPositiveButton("知道了", null).show();
            return;
        }
        new Thread(new Runnable() { @Override public void run() {
            boolean practice = false, planning = false, favorites = false, inbox = false;
            String scope = "";
            try {
                String route = teacher ? "/api/teacher/students/" + Uri.encode(studentId) + "/capabilities" : "/api/student-session/capabilities";
                JSONObject response = transport.get(route), capabilities = response.optJSONObject("capabilities");
                practice = !teacher && capabilities != null && capabilities.optBoolean("practice");
                planning = capabilities != null && capabilities.optBoolean("planningRead");
                favorites = !teacher && capabilities != null && capabilities.optBoolean("planningFavorites");
                inbox = !teacher && capabilities != null && capabilities.optBoolean("remoteInbox");
                scope = response.optString("hostId") + ":" + response.optString("dataGeneration");
            } catch (Exception ignored) { /* An older host has no learning contract. */ }
            final boolean canPractice = practice, canPlan = planning, canFavorite = favorites, canInbox = inbox;
            final String confirmedScope = scope;
            activity.runOnUiThread(new Runnable() { @Override public void run() {
                if (!canPractice && !canPlan && !canInbox) { showText(activity, "暂不可用", "当前主机尚未提供学习卡片或规划接口；请先更新主机端。"); return; }
                if (confirmedScope.endsWith(":")) { showText(activity, "暂不可用", "未能核实主机资料代次，不能打开本地学习缓存。"); return; }
                Transport scoped = new Transport() {
                    @Override public JSONObject get(String route) throws Exception { return transport.get(route); }
                    @Override public JSONObject post(String route, JSONObject body) throws Exception { return transport.post(route, body); }
                    @Override public String hostId() { return confirmedScope; }
                };
                showMenu(activity, scoped, studentId, teacher, canPractice, canPlan, canFavorite, canInbox);
            }});
        }}).start();
    }

    private static void showMenu(Activity activity, Transport transport, String studentId, boolean teacher, boolean practice, boolean planning, boolean favorites, boolean inbox) {
        ArrayList<String> labels = new ArrayList<String>(), actions = new ArrayList<String>();
        if (practice) { labels.add("学习卡片"); actions.add("practice"); }
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
                    else if ("favorites".equals(action)) showFavorites(activity, transport);
                    else if ("inbox".equals(action)) showInbox(activity, transport, studentId);
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
                        transport.post("/api/student-session/practice/" + record.getString("cardId") + "/attempt", record.getJSONObject("attempt"));
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
                    String original = record.getJSONObject("attempt").optString("answer");
                    new AlertDialog.Builder(activity).setTitle("未确认作答原文").setMessage(original)
                            .setNegativeButton("保留", null)
                            .setPositiveButton("按原编号重试", new DialogInterface.OnClickListener() {
                                @Override public void onClick(DialogInterface retry, int selected) { showPractice(activity, transport, studentId); }
                            }).setNeutralButton("丢弃本机暂存", new DialogInterface.OnClickListener() {
                                @Override public void onClick(DialogInterface discard, int selected) {
                                    new AlertDialog.Builder(activity).setMessage("若主机此前已接收，此操作不会撤回主机作答。仅丢弃本机暂存并允许重新填写，确定？")
                                            .setNegativeButton("取消", null).setPositiveButton("确定", new DialogInterface.OnClickListener() {
                                                @Override public void onClick(DialogInterface confirm, int value) {
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
        TextView hintView = new TextView(activity); hintView.setText("提示：" + (hint.isEmpty() ? "暂无" : hint)); form.addView(hintView);
        EditText answer = new EditText(activity); answer.setHint("填写我的作答"); answer.setMinLines(4); form.addView(answer);
        String[] difficulty = {"太简单", "正合适", "有点难"};
        Spinner difficultyPicker = new Spinner(activity);
        difficultyPicker.setAdapter(new ArrayAdapter<String>(activity, android.R.layout.simple_spinner_dropdown_item, difficulty));
        difficultyPicker.setSelection(1); form.addView(difficultyPicker);
        new AlertDialog.Builder(activity).setTitle("提交练习").setView(form)
                .setNegativeButton("取消", null).setPositiveButton("提交", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    String value = answer.getText().toString().trim();
                    if (value.isEmpty()) { showText(activity, "未提交", "请先填写作答。"); return; }
                    try {
                        JSONObject attempt = new JSONObject().put("attemptId", UUID.randomUUID().toString()).put("answer", value)
                                .put("difficulty", difficultyPicker.getSelectedItemPosition() == 0 ? "easy" : difficultyPicker.getSelectedItemPosition() == 2 ? "hard" : "right").put("confidence", 3);
                        prefs(activity).edit().putString(key + ":pending", new JSONObject().put("cardId", cardId).put("attempt", attempt).toString()).apply();
                        showPractice(activity, transport, studentId);
                    } catch (Exception error) { showText(activity, "暂存失败", error.getMessage()); }
                }}).show();
    }

    private static void showPlanning(Activity activity, Transport transport, String studentId, boolean teacher, String kind) {
        String prefix = teacher ? "/api/teacher/students/" + Uri.encode(studentId) + "/planning/" : "/api/student-session/planning/";
        new Thread(new Runnable() { @Override public void run() {
            String title = "guidance".equals(kind) ? "规划总览" : "topics".equals(kind) ? "选题建议" : "推荐比赛";
            String text;
            JSONObject currentVersion = null;
            try {
                JSONObject result = transport.get(prefix + kind), current = result.optJSONObject("current");
                currentVersion = current;
                if (current == null) text = "主机尚未形成此类建议。";
                else {
                    StringBuilder out = new StringBuilder("版本：").append(current.optInt("version", 1))
                            .append("\n核验：").append(current.optString("verifiedAt", current.optString("createdAt", "未记录"))).append("\n\n");
                    appendArray(out, current.optJSONArray("findings")); appendArray(out, current.optJSONArray("nearTermActions"));
                    JSONArray candidates = current.optJSONArray("candidates");
                    if (candidates != null) for (int i = 0; i < candidates.length(); i++) {
                        JSONObject item = candidates.optJSONObject(i); if (item == null) continue;
                        out.append("\n").append(i + 1).append(". ").append(item.optString("title", item.optString("name")))
                                .append("\n").append(item.optString("rationale", ""));
                        if (!item.optString("deadline").isEmpty()) out.append("\n截止：").append(item.optString("deadline"));
                        if (!item.optString("officialUrl").isEmpty()) out.append("\n来源：").append(item.optString("officialUrl"));
                        out.append("\n");
                    }
                    if (result.optBoolean("needsRefresh")) out.append("\n资料已变化，建议由主机重新核验。");
                    text = out.toString();
                }
            } catch (Exception error) { text = "读取失败：" + error.getMessage(); }
            final String content = text; final JSONObject version = currentVersion;
            activity.runOnUiThread(new Runnable() { @Override public void run() {
                if (teacher || "guidance".equals(kind) || version == null || version.optJSONArray("candidates") == null) {
                    showText(activity, title, content); return;
                }
                ScrollView scroll = new ScrollView(activity);
                TextView view = new TextView(activity); view.setText(content); view.setPadding(32, 24, 32, 24); view.setTextSize(16); scroll.addView(view);
                new AlertDialog.Builder(activity).setTitle(title).setView(scroll).setNegativeButton("关闭", null)
                        .setPositiveButton("管理收藏", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface dialog, int which) { choosePlanningFavorite(activity, transport, kind, version); }
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
