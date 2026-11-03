package com.qxmatrix.eduterminal;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.security.MessageDigest;

final class ConversationDraftStore {
    static final int MAX_BATCH_BYTES = 5 * 1024 * 1024;

    static final class Draft {
        final String id;
        final String text;
        final String source;
        final String reference;
        final JSONArray items;
        Draft(String id, String text, String source, String reference, JSONArray items) {
            this.id = id; this.text = text; this.source = source; this.reference = reference; this.items = items;
        }
    }

    static File root(Context context) {
        File root = new File(context.getFilesDir(), "conversation-drafts");
        if (!root.exists()) root.mkdirs();
        return root;
    }

    static Draft capture(Context context, Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return null;
        String id = "conversation-draft-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString();
        File folder = new File(root(context), id);
        folder.mkdirs();
        JSONArray items = new JSONArray();
        StringBuilder combined = new StringBuilder();
        CharSequence extraText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (extraText != null && extraText.toString().trim().length() > 0) {
            appendSection(combined, "分享说明", extraText.toString().trim());
            items.put(item("text", "分享说明", "saved", extraText.toString().length(), ""));
        }
        List<Uri> uris = extractUris(intent);
        List<Uri> textUris = new ArrayList<Uri>();
        List<String> textNames = new ArrayList<String>();
        for (int index = 0; index < uris.size(); index++) {
            Uri uri = uris.get(index);
            String name = displayName(context, uri, index);
            String mime = context.getContentResolver().getType(uri);
            String lower = name.toLowerCase(Locale.ROOT);
            boolean textual = (mime != null && (mime.startsWith("text/") || "application/json".equals(mime)))
                || lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".json");
            if (!textual) continue;
            textUris.add(uri);
            textNames.add(name);
            items.put(item("file", name, "pending", 0, "等待复制"));
        }
        if (combined.length() == 0 && textUris.isEmpty()) {
            deleteTree(folder);
            return null;
        }
        JSONObject manifest = new JSONObject();
        try {
            manifest.put("id", id);
            manifest.put("createdAt", System.currentTimeMillis());
            manifest.put("source", "系统分享");
            manifest.put("reference", intent.getPackage() == null ? "android-share" : intent.getPackage());
            persistManifest(folder, manifest, combined, items, "saving");
        } catch (Exception error) {
            deleteTree(folder);
            return null;
        }
        int total = 0;
        int itemOffset = extraText != null && extraText.toString().trim().length() > 0 ? 1 : 0;
        for (int index = 0; index < textUris.size(); index++) {
            Uri uri = textUris.get(index);
            String name = textNames.get(index);
            InputStream input = null;
            try {
                items.put(itemOffset + index, item("file", name, "copying", 0, "正在保存到应用私有目录"));
                persistManifest(folder, manifest, combined, items, "saving");
                input = context.getContentResolver().openInputStream(uri);
                if (input == null) throw new IllegalStateException("无法读取");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[16384];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_BATCH_BYTES) throw new IllegalArgumentException("整批文字超过 5 MB");
                    output.write(buffer, 0, read);
                }
                byte[] bytes = output.toByteArray();
                File payload = new File(folder, String.format(Locale.ROOT, "%02d-%s", index, safeName(name)));
                writeAtomic(payload, bytes);
                String text = new String(bytes, "UTF-8").trim();
                if (text.length() > 0) appendSection(combined, name, text);
                JSONObject saved = item("file", name, "saved", bytes.length, payload.getName());
                saved.put("sha256", sha256(bytes));
                items.put(itemOffset + index, saved);
                persistManifest(folder, manifest, combined, items, "saving");
            } catch (Exception error) {
                try {
                    items.put(itemOffset + index, item("file", name, "failed", 0, String.valueOf(error.getMessage())));
                    persistManifest(folder, manifest, combined, items, "saving");
                } catch (Exception ignored) {}
            } finally {
                if (input != null) try { input.close(); } catch (Exception ignored) {}
            }
        }
        try {
            persistManifest(folder, manifest, combined, items, "saved");
        } catch (Exception error) {
            return new Draft(id, combined.toString(), "系统分享", "android-share", items);
        }
        return new Draft(id, combined.toString(), "系统分享", "android-share", items);
    }

    static List<Draft> pending(Context context) {
        List<Draft> drafts = new ArrayList<Draft>();
        File[] folders = root(context).listFiles();
        if (folders == null) return drafts;
        Arrays.sort(folders, new Comparator<File>() {
            @Override public int compare(File a, File b) { return Long.compare(a.lastModified(), b.lastModified()); }
        });
        for (File folder : folders) {
            File manifest = new File(folder, "draft.json");
            if (!manifest.isFile()) continue;
            try {
                JSONObject json = new JSONObject(readFile(manifest));
                if (!"saved".equals(json.optString("status")) && !"saving".equals(json.optString("status"))) continue;
                drafts.add(new Draft(json.optString("id", folder.getName()), json.optString("text", ""),
                    json.optString("source", "系统分享"), json.optString("reference", "android-share"),
                    json.optJSONArray("items") == null ? new JSONArray() : json.optJSONArray("items")));
            } catch (Exception ignored) {}
        }
        return drafts;
    }

    static void complete(Context context, String id) {
        if (id == null || !id.startsWith("conversation-draft-")) return;
        File folder = new File(root(context), id);
        try {
            if (!folder.getCanonicalPath().startsWith(root(context).getCanonicalPath() + File.separator)) return;
        } catch (Exception error) { return; }
        deleteTree(folder);
    }

    private static List<Uri> extractUris(Intent intent) {
        ArrayList<Uri> result = new ArrayList<Uri>();
        ClipData clip = intent.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) add(result, clip.getItemAt(i).getUri());
        add(result, intent.getData());
        try {
            ArrayList<Uri> multiple = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (multiple != null) for (Uri uri : multiple) add(result, uri);
        } catch (Exception ignored) {}
        try {
            Object single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single instanceof Uri) add(result, (Uri) single);
        } catch (Exception ignored) {}
        return result;
    }

    private static void add(List<Uri> values, Uri uri) {
        if (uri != null && !values.contains(uri)) values.add(uri);
    }

    private static JSONObject item(String type, String name, String status, long size, String detail) {
        JSONObject item = new JSONObject();
        try { item.put("type", type); item.put("name", name); item.put("status", status); item.put("size", size); item.put("detail", detail); }
        catch (Exception ignored) {}
        return item;
    }

    private static void appendSection(StringBuilder target, String title, String body) {
        if (target.length() > 0) target.append("\n\n");
        target.append("## 来源：").append(title).append("\n\n").append(body);
    }

    private static void persistManifest(File folder, JSONObject manifest, StringBuilder text, JSONArray items, String status) throws Exception {
        manifest.put("text", text.toString());
        manifest.put("items", items);
        manifest.put("status", status);
        writeAtomic(new File(folder, "draft.json"), manifest.toString(2).getBytes("UTF-8"));
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder value = new StringBuilder();
        for (byte item : digest) value.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return value.toString();
    }

    private static String displayName(Context context, Uri uri, int index) {
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && name.trim().length() > 0) return name.trim();
            }
        } catch (Exception ignored) {
        } finally { if (cursor != null) cursor.close(); }
        String last = uri == null ? "" : uri.getLastPathSegment();
        return last == null || last.length() == 0 ? "对话文件-" + (index + 1) + ".txt" : last;
    }

    private static String safeName(String name) {
        String safe = String.valueOf(name).replaceAll("[\\\\/:*?\"<>|]", "_");
        return safe.length() > 120 ? safe.substring(safe.length() - 120) : safe;
    }

    private static void writeAtomic(File target, byte[] bytes) throws Exception {
        File temporary = new File(target.getParentFile(), target.getName() + ".tmp-" + UUID.randomUUID().toString());
        FileOutputStream output = new FileOutputStream(temporary);
        try { output.write(bytes); output.getFD().sync(); } finally { output.close(); }
        if (!temporary.renameTo(target)) {
            FileOutputStream direct = new FileOutputStream(target);
            try { direct.write(bytes); direct.getFD().sync(); } finally { direct.close(); }
            temporary.delete();
        }
    }

    private static String readFile(File file) throws Exception {
        FileInputStream input = new FileInputStream(file);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192]; int read;
        try { while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read); }
        finally { input.close(); }
        return new String(output.toByteArray(), "UTF-8");
    }

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }
}
