package com.qxmatrix.markdown;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** A network-isolated Markdown reader shared by the Android student and teacher terminals. */
public final class MarkdownReadOnlyDialog {
    private static final int STUDENT_ACCENT = Color.rgb(15, 118, 110);
    private static final int STUDENT_SOFT = Color.rgb(226, 246, 241);
    private static final int TEACHER_ACCENT = Color.rgb(211, 45, 124);
    private static final int TEACHER_SOFT = Color.rgb(255, 231, 243);
    private static final Pattern ORDERED_ITEM = Pattern.compile("^(\\s*)\\d+[.)]\\s+(.+)$");
    private static final Pattern UNORDERED_ITEM = Pattern.compile("^(\\s*)[-*+]\\s+(.+)$");
    private static final Pattern TASK_ITEM = Pattern.compile("^(\\s*)[-*+]\\s+\\[([ xX])\\]\\s+(.+)$");

    private MarkdownReadOnlyDialog() {}

    public static void show(Activity activity, String title, String metadata, String markdown, boolean teacherTheme) {
        show(activity, title, metadata, markdown, teacherTheme, "", null);
    }

    public static void show(Activity activity, String title, String metadata, String markdown, boolean teacherTheme,
                            String secondaryLabel, DialogInterface.OnClickListener secondaryAction) {
        final int accent = teacherTheme ? TEACHER_ACCENT : STUDENT_ACCENT;
        final int soft = teacherTheme ? TEACHER_SOFT : STUDENT_SOFT;
        final String source = markdown == null || markdown.trim().length() == 0 ? "暂无内容。" : markdown;
        final int[] fontSize = new int[] {16};

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(activity, 16), dp(activity, 8), dp(activity, 16), dp(activity, 10));

        if (metadata != null && metadata.trim().length() > 0) {
            TextView meta = new TextView(activity);
            meta.setText(metadata.trim());
            meta.setTextSize(12);
            meta.setTextColor(Color.rgb(81, 101, 98));
            meta.setBackgroundColor(soft);
            meta.setPadding(dp(activity, 12), dp(activity, 8), dp(activity, 12), dp(activity, 8));
            root.addView(meta, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        // Keep the primary copy action above the scrollable reader.  On narrow phones a
        // bottom toolbar can otherwise fall behind the platform dialog button strip.
        final Button copy = new Button(activity);
        copy.setText("复制正文");
        copy.setTextSize(15);
        copy.setTextColor(Color.WHITE);
        copy.setAllCaps(false);
        copy.setContentDescription("复制正文到剪贴板");
        copy.setMinHeight(dp(activity, 48));
        android.graphics.drawable.GradientDrawable copyBackground = new android.graphics.drawable.GradientDrawable();
        copyBackground.setColor(accent);
        copyBackground.setCornerRadius(dp(activity, 10));
        copy.setBackground(copyBackground);
        LinearLayout.LayoutParams copyParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(activity, 48));
        copyParams.setMargins(0, dp(activity, 10), 0, dp(activity, 4));
        root.addView(copy, copyParams);

        FrameLayout content = new FrameLayout(activity);
        int screenHeight = activity.getResources().getDisplayMetrics().heightPixels;
        int contentHeight = Math.max(dp(activity, 260), Math.min(dp(activity, 520), screenHeight * 48 / 100));
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, contentHeight));

        final WebView reader = new WebView(activity);
        configureReader(activity, reader, source, fontSize[0], accent, soft);
        content.addView(reader, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        final TextView original = new TextView(activity);
        original.setText(source);
        original.setTextSize(fontSize[0]);
        original.setTextColor(Color.rgb(35, 55, 52));
        original.setTextIsSelectable(true);
        original.setPadding(dp(activity, 10), dp(activity, 12), dp(activity, 10), dp(activity, 24));
        ScrollView sourceScroll = new ScrollView(activity);
        sourceScroll.addView(original);
        sourceScroll.setVisibility(View.GONE);
        content.addView(sourceScroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout toolbar = new LinearLayout(activity);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setPadding(0, dp(activity, 8), 0, 0);
        final Button mode = compactButton(activity, "查看原文", accent);
        Button smaller = compactButton(activity, "A−", accent);
        Button larger = compactButton(activity, "A+", accent);
        toolbar.addView(mode, weighted());
        toolbar.addView(smaller, weighted());
        toolbar.addView(larger, weighted());
        root.addView(toolbar);

        final ScrollView rawScroll = sourceScroll;
        mode.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                boolean showSource = reader.getVisibility() == View.VISIBLE;
                reader.setVisibility(showSource ? View.GONE : View.VISIBLE);
                rawScroll.setVisibility(showSource ? View.VISIBLE : View.GONE);
                mode.setText(showSource ? "阅读模式" : "查看原文");
            }
        });
        smaller.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                fontSize[0] = Math.max(13, fontSize[0] - 1);
                reader.getSettings().setTextZoom(fontSize[0] * 100 / 16);
                original.setTextSize(fontSize[0]);
            }
        });
        larger.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                fontSize[0] = Math.min(24, fontSize[0] + 1);
                reader.getSettings().setTextZoom(fontSize[0] * 100 / 16);
                original.setTextSize(fontSize[0]);
            }
        });
        copy.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText(title, source));
                Toast.makeText(activity, "正文已复制。", Toast.LENGTH_SHORT).show();
            }
        });

        AlertDialog.Builder builder = new AlertDialog.Builder(activity).setTitle(title).setView(root).setPositiveButton("关闭", null);
        if (secondaryLabel != null && secondaryLabel.length() > 0 && secondaryAction != null) {
            builder.setNeutralButton(secondaryLabel, secondaryAction);
        }
        final AlertDialog dialog = builder.create();
        dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
            @Override public void onDismiss(DialogInterface ignored) {
                reader.stopLoading();
                reader.loadUrl("about:blank");
                reader.destroy();
            }
        });
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            int screenWidth = activity.getResources().getDisplayMetrics().widthPixels;
            window.setLayout(Math.min(screenWidth - dp(activity, 24), dp(activity, 820)), ViewGroup.LayoutParams.WRAP_CONTENT);
        }
    }

    private static LinearLayout.LayoutParams weighted() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    }

    private static Button compactButton(Activity activity, String label, int color) {
        Button button = new Button(activity);
        button.setText(label);
        button.setTextSize(13);
        button.setTextColor(color);
        button.setMinHeight(dp(activity, 44));
        button.setAllCaps(false);
        return button;
    }

    private static void configureReader(final Activity activity, WebView reader, String markdown, int fontSize, int accent, int soft) {
        WebSettings settings = reader.getSettings();
        settings.setJavaScriptEnabled(false);
        settings.setDomStorageEnabled(false);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBlockNetworkLoads(true);
        settings.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= 16) {
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
        }
        reader.setBackgroundColor(Color.WHITE);
        reader.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return confirmExternalLink(activity, request == null || request.getUrl() == null ? "" : request.getUrl().toString());
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return confirmExternalLink(activity, url);
            }
        });
        reader.loadDataWithBaseURL("about:blank", renderHtml(markdown, fontSize, accent, soft), "text/html", "UTF-8", null);
    }

    private static boolean confirmExternalLink(final Activity activity, final String value) {
        Uri uri;
        try { uri = Uri.parse(value); } catch (Exception error) { return true; }
        String scheme = uri.getScheme();
        if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) return true;
        new AlertDialog.Builder(activity).setTitle("打开外部链接？").setMessage(value)
            .setPositiveButton("在浏览器打开", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(value))); }
                    catch (Exception error) { Toast.makeText(activity, "无法打开该链接。", Toast.LENGTH_SHORT).show(); }
                }
            }).setNegativeButton("取消", null).show();
        return true;
    }

    public static String renderHtml(String markdown, int baseFontSize, int accent, int soft) {
        String normalized = stripFrontMatter(markdown == null ? "" : markdown.replace("\r\n", "\n").replace('\r', '\n'));
        String[] lines = normalized.split("\n", -1);
        StringBuilder body = new StringBuilder();
        boolean inCode = false, inTable = false;
        String listTag = "";
        int tableRows = 0;
        for (int index = 0; index < lines.length; index++) {
            String line = lines[index];
            String trimmed = line.trim();
            if (trimmed.startsWith("```")) {
                if (inTable) { body.append("</tbody></table></div>"); inTable = false; tableRows = 0; }
                if (listTag.length() > 0) { body.append("</").append(listTag).append('>'); listTag = ""; }
                body.append(inCode ? "</code></pre>" : "<pre><code>");
                inCode = !inCode;
                continue;
            }
            if (inCode) { body.append(escapeHtml(line)).append('\n'); continue; }
            if (trimmed.length() == 0) {
                if (inTable) { body.append("</tbody></table></div>"); inTable = false; tableRows = 0; }
                if (listTag.length() > 0) { body.append("</").append(listTag).append('>'); listTag = ""; }
                body.append("<div class=\"space\"></div>");
                continue;
            }
            if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
                if (listTag.length() > 0) { body.append("</").append(listTag).append('>'); listTag = ""; }
                if (!inTable) { body.append("<div class=\"table-wrap\"><table><tbody>"); inTable = true; tableRows = 0; }
                List<String> cells = splitTableCells(trimmed);
                boolean separator = !cells.isEmpty();
                for (String cell : cells) if (!cell.trim().matches(":?-{3,}:?")) separator = false;
                if (!separator) {
                    body.append("<tr>");
                    String tag = tableRows == 0 ? "th" : "td";
                    for (String cell : cells) body.append('<').append(tag).append('>').append(inlineMarkdown(cell.trim())).append("</").append(tag).append('>');
                    body.append("</tr>");
                    tableRows++;
                }
                continue;
            }
            if (inTable) { body.append("</tbody></table></div>"); inTable = false; tableRows = 0; }

            Matcher task = TASK_ITEM.matcher(line);
            Matcher unordered = UNORDERED_ITEM.matcher(line);
            Matcher ordered = ORDERED_ITEM.matcher(line);
            String desiredList = "";
            String item = "";
            int indent = 0;
            if (task.matches()) {
                desiredList = "ul"; indent = task.group(1).length();
                item = "<span class=\"task\">" + (task.group(2).trim().length() == 0 ? "☐" : "☑") + "</span> " + inlineMarkdown(task.group(3));
            } else if (unordered.matches()) {
                desiredList = "ul"; indent = unordered.group(1).length(); item = inlineMarkdown(unordered.group(2));
            } else if (ordered.matches()) {
                desiredList = "ol"; indent = ordered.group(1).length(); item = inlineMarkdown(ordered.group(2));
            }
            if (desiredList.length() > 0) {
                if (!desiredList.equals(listTag)) {
                    if (listTag.length() > 0) body.append("</").append(listTag).append('>');
                    body.append('<').append(desiredList).append('>');
                    listTag = desiredList;
                }
                body.append("<li style=\"margin-left:").append(Math.min(4, indent / 2)).append("em\">").append(item).append("</li>");
                continue;
            }
            if (listTag.length() > 0) { body.append("</").append(listTag).append('>'); listTag = ""; }

            int heading = headingLevel(trimmed);
            if (heading > 0) {
                String text = trimmed.substring(heading + 1);
                body.append("<h").append(heading).append('>').append(inlineMarkdown(text)).append("</h").append(heading).append('>');
            } else if (trimmed.startsWith("> ")) body.append("<blockquote>").append(inlineMarkdown(trimmed.substring(2))).append("</blockquote>");
            else if (trimmed.matches("-{3,}|\\*{3,}|_{3,}")) body.append("<hr>");
            else body.append("<p>").append(inlineMarkdown(line)).append("</p>");
        }
        if (inCode) body.append("</code></pre>");
        if (listTag.length() > 0) body.append("</").append(listTag).append('>');
        if (inTable) body.append("</tbody></table></div>");

        String accentHex = colorHex(accent), softHex = colorHex(soft);
        return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>"
            + "body{margin:0;padding:14px 8px 34px;background:#fff;color:#21312f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans CJK SC',sans-serif;font-size:" + baseFontSize + "px;line-height:1.78;word-break:break-word;}"
            + "h1,h2,h3,h4,h5,h6{color:" + accentHex + ";margin:18px 0 8px;line-height:1.34;}h1{font-size:1.65em;}h2{font-size:1.38em;}h3{font-size:1.2em;}h4,h5,h6{font-size:1.08em;}"
            + "p{margin:0 0 11px;}a{color:" + accentHex + ";font-weight:700;text-decoration:underline;}strong{font-weight:800;}em{color:#3c5652;}del{color:#778985;}"
            + "blockquote{margin:10px 0;padding:10px 12px;border-left:4px solid " + accentHex + ";border-radius:10px;background:" + softHex + ";color:#49605c;}ul,ol{margin:0 0 12px;padding-left:25px;}li{margin:6px 0;}.task{color:" + accentHex + ";font-weight:800;}"
            + "code{padding:2px 5px;border-radius:6px;background:#edf3f1;color:" + accentHex + ";font-family:monospace;}pre{overflow-x:auto;margin:10px 0;padding:12px;border-radius:12px;background:#10201f;color:#e8fff8;}pre code{padding:0;background:transparent;color:inherit;white-space:pre;}"
            + ".table-wrap{overflow-x:auto;margin:12px 0;}table{min-width:520px;width:100%;border-collapse:collapse;font-size:.92em;}th,td{border:1px solid #d7e7e2;padding:8px;text-align:left;vertical-align:top;}th{background:" + softHex + ";color:" + accentHex + ";}hr{border:0;border-top:1px solid #d7e7e2;margin:14px 0;}.space{height:8px;}.remote-image{padding:8px 10px;border-radius:8px;background:#f4f7f6;color:#60716e;}"
            + "</style></head><body>" + body.toString() + "</body></html>";
    }

    private static String stripFrontMatter(String value) {
        if (!value.startsWith("---\n")) return value;
        int end = value.indexOf("\n---\n", 4);
        return end < 0 ? value : value.substring(end + 5);
    }

    private static int headingLevel(String trimmed) {
        int count = 0;
        while (count < trimmed.length() && count < 6 && trimmed.charAt(count) == '#') count++;
        return count > 0 && count < trimmed.length() && trimmed.charAt(count) == ' ' ? count : 0;
    }

    private static List<String> splitTableCells(String row) {
        List<String> cells = new ArrayList<String>();
        StringBuilder cell = new StringBuilder();
        boolean escaped = false;
        for (int index = 1; index < row.length() - 1; index++) {
            char value = row.charAt(index);
            if (escaped) { cell.append(value); escaped = false; }
            else if (value == '\\') escaped = true;
            else if (value == '|') { cells.add(cell.toString()); cell.setLength(0); }
            else cell.append(value);
        }
        if (escaped) cell.append('\\');
        cells.add(cell.toString());
        return cells;
    }

    private static String inlineMarkdown(String text) {
        String value = escapeHtml(text == null ? "" : text);
        value = value.replaceAll("!\\[([^\\]]*)\\]\\((https?://[A-Za-z0-9\\-._~:/?#\\[\\]@!$%*+,;=]+(?:&amp;[A-Za-z0-9\\-._~:/?#\\[\\]@!$%*+,;=]*)*)\\)", "<span class=\"remote-image\">远程图片未自动加载：$1</span>");
        value = value.replaceAll("\\[([^\\]]+)\\]\\((https?://[A-Za-z0-9\\-._~:/?#\\[\\]@!$%*+,;=]+(?:&amp;[A-Za-z0-9\\-._~:/?#\\[\\]@!$%*+,;=]*)*)\\)", "<a href=\"$2\">$1</a>");
        value = value.replaceAll("`([^`]+)`", "<code>$1</code>");
        value = value.replaceAll("\\*\\*([^*]+)\\*\\*", "<strong>$1</strong>");
        value = value.replaceAll("__([^_]+)__", "<strong>$1</strong>");
        value = value.replaceAll("~~([^~]+)~~", "<del>$1</del>");
        value = value.replaceAll("\\*([^*]+)\\*", "<em>$1</em>");
        return value;
    }

    private static String escapeHtml(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    }

    private static String colorHex(int color) {
        return String.format(Locale.ROOT, "#%06X", color & 0xFFFFFF);
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
