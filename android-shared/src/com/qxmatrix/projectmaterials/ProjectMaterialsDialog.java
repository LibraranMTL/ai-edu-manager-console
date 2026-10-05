package com.qxmatrix.projectmaterials;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
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
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Shared project-material browser used by both Android terminals. The host is
 * authoritative: every write carries the displayed version and record revision,
 * and cached data is read-only and scoped to one host generation and principal.
 */
public final class ProjectMaterialsDialog {
    private static final String CACHE_PREFS = "project_material_views_v1";
    private static final long CACHE_MAX_AGE_MS = 24L * 60L * 60L * 1000L;
    private static final long MAX_DOWNLOAD_BYTES = 128L * 1024L * 1024L;
    private static final String[] TABS = new String[] { "materials", "pending", "knowledge", "contributions" };
    private static final String[] TAB_LABELS = new String[] { "项目资料", "待整理", "项目知识", "贡献证据" };

    public interface Bridge {
        Activity activity();
        String baseUrl();
        String token();
        String hostId();
        String dataGeneration();
        String principalScope();
        JSONObject getJson(String url) throws Exception;
        JSONObject postJson(String url, JSONObject body) throws Exception;
        void status(String message);
    }

    public static final class ProjectRef {
        public final String id;
        public final String name;
        public final String status;
        public final String storageMode;
        public final String migrationState;
        public final JSONObject operations;

        public ProjectRef(String id, String name, String status, String storageMode,
                          String migrationState, JSONObject operations) {
            this.id = safe(id);
            this.name = safe(name).length() == 0 ? this.id : safe(name);
            this.status = safe(status).length() == 0 ? "active" : safe(status);
            this.storageMode = safe(storageMode);
            this.migrationState = safe(migrationState).length() == 0 ? "not_started" : safe(migrationState);
            this.operations = operations == null ? new JSONObject() : operations;
        }

        public boolean can(String operation) {
            return operations.optBoolean(operation, false);
        }
    }

    public static void open(Bridge bridge, ProjectRef project) {
        if (bridge == null || project == null) return;
        new ProjectMaterialsDialog(bridge, project).show();
    }

    private final Bridge bridge;
    private final Activity activity;
    private final ProjectRef project;
    private AlertDialog dialog;
    private LinearLayout list;
    private LinearLayout batchBar;
    private LinearLayout organizationBar;
    private TextView message;
    private EditText search;
    private Spinner categoryFilter;
    private final List<Button> tabButtons = new ArrayList<Button>();
    private final List<String> categoryIds = new ArrayList<String>();
    private final List<String> categoryNames = new ArrayList<String>();
    private final Map<String, String> categoryDrafts = new HashMap<String, String>();
    private final Map<String, JSONObject> suggestions = new HashMap<String, JSONObject>();
    private final Set<String> selectedIds = new HashSet<String>();
    private JSONObject currentView = new JSONObject();
    private JSONObject organizationStatus = new JSONObject();
    private JSONArray currentItems = new JSONArray();
    private String tab = "materials";
    private String categoryId = "";
    private int requestSerial = 0;
    private boolean cached = false;
    private boolean organizationStatusLoaded = false;
    private boolean updatingCategoryFilter = false;

    private ProjectMaterialsDialog(Bridge bridge, ProjectRef project) {
        this.bridge = bridge;
        this.activity = bridge.activity();
        this.project = project;
    }

    private void show() {
        LinearLayout root = vertical();
        root.setPadding(dp(18), dp(12), dp(18), dp(8));

        TextView scope = text(project.name
            + "\n原件由Windows主机统一保管；本端只查看或请求，主机权威执行分类整理、知识和证据处理。",
            14, 0xff425466);
        scope.setPadding(0, 0, 0, dp(10));
        root.addView(scope, matchWrap());

        if ("running".equals(project.migrationState) || "partial".equals(project.migrationState)
            || "attention".equals(project.migrationState)) {
            String title = "running".equals(project.migrationState) ? "Windows主机正在迁移历史资料"
                : "attention".equals(project.migrationState) ? "迁移现场需要在主机核对" : "历史资料已部分统一";
            String detail = "running".equals(project.migrationState)
                ? "本端保持只读，上传与分类等待迁移结束后重试。"
                : "部分旧来源或依赖文件保留原位；本端不会执行磁盘迁移。";
            TextView migration = text(title + "\n" + detail, 13, 0xff745100);
            migration.setPadding(dp(12), dp(9), dp(12), dp(9));
            migration.setBackgroundColor(0xfffff7e3);
            root.addView(migration, matchWrap());
        }

        organizationBar = vertical();
        organizationBar.setPadding(dp(12), dp(10), dp(12), dp(10));
        organizationBar.setBackgroundColor(0xffeef5fb);
        root.addView(organizationBar, matchWrap());

        HorizontalScrollView tabScroll = new HorizontalScrollView(activity);
        tabScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout tabRow = horizontal();
        for (int i = 0; i < TABS.length; i++) {
            final String target = TABS[i];
            Button button = smallButton(TAB_LABELS[i]);
            button.setTag(target);
            button.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) {
                    tab = target;
                    selectedIds.clear();
                    load();
                }
            });
            tabButtons.add(button);
            tabRow.addView(button, wrapWrap());
        }
        tabScroll.addView(tabRow);
        root.addView(tabScroll, matchWrap());

        LinearLayout tools = horizontal();
        tools.setPadding(0, dp(8), 0, dp(6));
        search = new EditText(activity);
        search.setSingleLine(true);
        search.setHint("搜索当前视图");
        tools.addView(search, new LinearLayout.LayoutParams(0, dp(44), 1f));
        Button searchButton = smallButton("搜索");
        searchButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { load(); }
        });
        tools.addView(searchButton, wrapWrap());
        Button refreshButton = smallButton("刷新");
        refreshButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { load(); }
        });
        tools.addView(refreshButton, wrapWrap());
        root.addView(tools, matchWrap());

        categoryFilter = new Spinner(activity);
        categoryFilter.setVisibility(View.GONE);
        root.addView(categoryFilter, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));

        batchBar = horizontal();
        batchBar.setPadding(0, 0, 0, dp(6));
        root.addView(batchBar, matchWrap());

        ScrollView scroll = new ScrollView(activity);
        list = vertical();
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        message = text("", 13, 0xff8a4b00);
        message.setPadding(0, dp(8), 0, 0);
        root.addView(message, matchWrap());

        dialog = new AlertDialog.Builder(activity)
            .setTitle("项目资料与知识")
            .setView(root)
            .setNegativeButton("关闭", null)
            .create();
        dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
            @Override public void onDismiss(DialogInterface value) { requestSerial++; }
        });
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT,
            (int) (activity.getResources().getDisplayMetrics().heightPixels * 0.90f));
        load();
    }

    private void load() {
        final int serial = ++requestSerial;
        cached = false;
        setMessage("正在读取主机授权范围…");
        updateTabAppearance();
        final String selectedTab = tab;
        final String query = safe(search == null ? "" : search.getText().toString()).trim();
        final String selectedCategory = ("materials".equals(selectedTab) || "pending".equals(selectedTab))
            ? categoryId : "";
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String url = bridge.baseUrl() + "/api/projects/" + encode(project.id)
                        + "/material-views?view=" + encode(selectedTab) + "&offset=0&limit=100"
                        + "&search=" + encode(query) + "&categoryId=" + encode(selectedCategory);
                    final JSONObject response = bridge.getJson(url);
                    response.put("_cached", false);
                    if (cacheEligible(selectedTab)) saveCache(selectedTab, response);
                    final Map<String, JSONObject> loadedSuggestions = loadSuggestions(selectedTab);
                    JSONObject remoteOrganization = null;
                    if (project.can("organizationRead")) {
                        try {
                            remoteOrganization = bridge.getJson(bridge.baseUrl() + "/api/projects/"
                                + encode(project.id) + "/materials/organization");
                        } catch (Exception ignored) { }
                    }
                    final JSONObject loadedOrganization = remoteOrganization;
                    runUi(serial, new Runnable() {
                        @Override public void run() {
                            suggestions.clear();
                            suggestions.putAll(loadedSuggestions);
                            organizationStatus = loadedOrganization == null ? new JSONObject() : loadedOrganization;
                            organizationStatusLoaded = loadedOrganization != null;
                            applyView(response, false);
                        }
                    });
                } catch (final Exception error) {
                    final JSONObject fallback = cacheEligible(selectedTab) ? readCache(selectedTab) : null;
                    runUi(serial, new Runnable() {
                        @Override public void run() {
                            suggestions.clear();
                            organizationStatus = new JSONObject();
                            organizationStatusLoaded = false;
                            if (fallback != null) {
                                applyView(fallback, true);
                                setMessage("当前显示24小时内的离线只读缓存；联网刷新后才能分类、审核或下载副本。");
                            } else {
                                currentItems = new JSONArray();
                                list.removeAllViews();
                                list.addView(empty("项目资料读取失败：" + concise(error)));
                                setMessage("未使用跨主机或跨账号缓存。");
                            }
                        }
                    });
                }
            }
        }, "project-material-view").start();
    }

    private Map<String, JSONObject> loadSuggestions(String selectedTab) {
        Map<String, JSONObject> result = new HashMap<String, JSONObject>();
        if (!("materials".equals(selectedTab) || "pending".equals(selectedTab))) return result;
        if (!(project.can("classificationSuggest") || project.can("classificationWrite"))) return result;
        try {
            JSONObject page = bridge.getJson(bridge.baseUrl() + "/api/projects/" + encode(project.id)
                + "/materials/classification-suggestions?status=pending&offset=0&limit=100");
            JSONArray items = page.optJSONArray("items");
            if (items != null) for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item != null) result.put(item.optString("materialId", ""), item);
            }
        } catch (Exception ignored) { }
        return result;
    }

    private void applyView(JSONObject response, boolean fromCache) {
        if (dialog == null || !dialog.isShowing()) return;
        currentView = response;
        currentItems = response.optJSONArray("items") == null ? new JSONArray() : response.optJSONArray("items");
        cached = fromCache;
        selectedIds.clear();
        readCategories(response.optJSONArray("categories"));
        updateTabAppearance();
        renderOrganization();
        render();
        if (!fromCache) setMessage(currentItems.length() == 0 ? "当前筛选下没有可见内容。" : "");
    }

    private void readCategories(JSONArray categories) {
        categoryIds.clear();
        categoryNames.clear();
        if (categories != null) for (int i = 0; i < categories.length(); i++) {
            JSONObject item = categories.optJSONObject(i);
            if (item == null) continue;
            categoryIds.add(item.optString("categoryId", ""));
            categoryNames.add(item.optString("name", "未命名分类"));
        }
        updatingCategoryFilter = true;
        ArrayList<String> labels = new ArrayList<String>();
        labels.add("全部分类");
        labels.addAll(categoryNames);
        categoryFilter.setAdapter(new ArrayAdapter<String>(activity,
            android.R.layout.simple_spinner_dropdown_item, labels));
        int selected = 0;
        for (int i = 0; i < categoryIds.size(); i++) if (categoryIds.get(i).equals(categoryId)) selected = i + 1;
        categoryFilter.setSelection(selected, false);
        categoryFilter.setVisibility(("materials".equals(tab) || "pending".equals(tab)) ? View.VISIBLE : View.GONE);
        categoryFilter.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                String next = position <= 0 ? "" : categoryIds.get(position - 1);
                if (!updatingCategoryFilter && !next.equals(categoryId)) {
                    categoryId = next;
                    load();
                }
                updatingCategoryFilter = false;
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { updatingCategoryFilter = false; }
        });
        updatingCategoryFilter = false;
    }

    private void render() {
        list.removeAllViews();
        batchBar.removeAllViews();
        if ("materials".equals(tab) || "pending".equals(tab)) renderMaterials();
        else if ("knowledge".equals(tab)) renderKnowledge();
        else renderContributions();
        if (currentItems.length() == 0) list.addView(empty("当前视图没有可显示的内容。"));
    }

    private void renderOrganization() {
        if (organizationBar == null) return;
        organizationBar.removeAllViews();
        if (!project.can("organizationRead")) {
            organizationBar.setVisibility(View.GONE);
            return;
        }
        organizationBar.setVisibility(View.VISIBLE);
        if (cached || !organizationStatusLoaded) {
            organizationBar.addView(text(cached
                ? "自动整理状态需联网核对；离线缓存不能请求主机移动文件。"
                : "未能读取主机自动整理状态；资料视图仍可使用，请稍后刷新。", 13, 0xff745100), matchWrap());
            return;
        }
        final JSONObject configuration = organizationStatus.optJSONObject("configuration") == null
            ? new JSONObject() : organizationStatus.optJSONObject("configuration");
        boolean enabled = configuration.optBoolean("enabled", false);
        organizationBar.addView(text(enabled
            ? "主机已授权自动整理收件箱"
            : "主机当前仅提供分类建议", 15, 0xff16324f), matchWrap());
        organizationBar.addView(text(enabled
            ? "安全类型每批最多 " + configuration.optInt("maxBatch", 20)
                + " 份；本端不直接操作主机磁盘。"
            : "需在Windows主机一次授权后，才会物理整理收件箱。", 12, 0xff55697d), matchWrap());
        JSONObject capacity = organizationStatus.optJSONObject("capacity");
        if (capacity != null && !capacity.optBoolean("ok", true)) {
            organizationBar.addView(text("主机容量状态异常，自动整理已暂停；原件保持不变。",
                12, 0xffa33a16), matchWrap());
        }
        if (enabled && project.can("organizationRun") && writable()) {
            Button run = smallButton("请求主机整理");
            run.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { runOrganization(); }
            });
            organizationBar.addView(run, wrapWrap());
        }
        JSONArray operations = organizationStatus.optJSONArray("operations");
        if (operations == null) return;
        for (int i = 0; i < Math.min(2, operations.length()); i++) {
            final JSONObject operation = operations.optJSONObject(i);
            if (operation == null) continue;
            JSONObject counts = operation.optJSONObject("counts");
            int total = counts == null ? 0 : counts.optInt("total", 0);
            int succeeded = counts == null ? 0 : counts.optInt("succeeded", 0);
            int failed = counts == null ? 0 : counts.optInt("failed", 0);
            int attention = counts == null ? 0 : counts.optInt("attention", 0);
            int retryable = counts == null ? 0 : counts.optInt("retryable", 0);
            LinearLayout receipt = vertical();
            receipt.setPadding(0, dp(8), 0, 0);
            receipt.addView(text(organizationStatusLabel(operation.optString("status", ""))
                + " · 成功 " + succeeded + "/" + total
                + (failed > 0 ? " · 异常 " + failed : "")
                + (attention > 0 ? " · 待人工核对 " + attention : ""), 12, 0xff425466), matchWrap());
            if (retryable > 0 && project.can("organizationRetry") && writable()) {
                Button retry = smallButton("重试异常项");
                retry.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View view) { retryOrganization(operation); }
                });
                receipt.addView(retry, wrapWrap());
            }
            JSONArray items = operation.optJSONArray("items");
            int shown = 0;
            if (items != null) for (int j = 0; j < items.length() && shown < 3; j++) {
                JSONObject item = items.optJSONObject(j);
                if (item == null || "succeeded".equals(item.optString("status"))) continue;
                receipt.addView(text(item.optString("title", "已登记资料") + "："
                    + item.optString("message", "等待主机处理"), 12, 0xff745100), matchWrap());
                shown++;
            }
            organizationBar.addView(receipt, matchWrap());
        }
    }

    private void runOrganization() {
        if (cached || !organizationStatusLoaded || !project.can("organizationRun") || !writable()) {
            setMessage("当前不能请求主机整理；请联网刷新权限和项目状态。");
            return;
        }
        try {
            JSONObject body = new JSONObject();
            body.put("idempotencyKey", key("android-organization"));
            body.put("trigger", "manual");
            organizationMutation("/materials/organization:run", body, "主机已处理本次自动整理请求。");
        } catch (Exception error) { setMessage("自动整理请求无效：" + concise(error)); }
    }

    private void retryOrganization(JSONObject operation) {
        if (cached || !organizationStatusLoaded || !project.can("organizationRetry") || !writable()) {
            setMessage("当前不能重试自动整理；请联网刷新权限和项目状态。");
            return;
        }
        try {
            JSONArray materialIds = new JSONArray();
            JSONArray items = operation.optJSONArray("items");
            if (items != null) for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item != null && item.optBoolean("retryable", false)) {
                    materialIds.put(item.optString("materialId", ""));
                }
            }
            if (materialIds.length() == 0) { setMessage("当前没有可安全重试的异常项。"); return; }
            JSONObject body = new JSONObject();
            body.put("materialIds", materialIds);
            body.put("idempotencyKey", key("android-organization-retry"));
            organizationMutation("/materials/organization/"
                + encode(operation.optString("operationId", "")) + "/retry", body,
                "主机已重试可恢复的异常项。");
        } catch (Exception error) { setMessage("重试请求无效：" + concise(error)); }
    }

    private void organizationMutation(final String endpoint, final JSONObject body, final String successMessage) {
        final int serial = ++requestSerial;
        setMessage("正在请求Windows主机执行并返回操作回执…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    final JSONObject response = bridge.postJson(bridge.baseUrl() + "/api/projects/"
                        + encode(project.id) + endpoint, body);
                    if (!response.optBoolean("ok", true)) {
                        throw new Exception(response.optString("message", "主机未执行自动整理。"));
                    }
                    final String outcome = response.optString("message", successMessage);
                    runUi(serial, new Runnable() {
                        @Override public void run() { bridge.status(outcome); load(); }
                    });
                } catch (final Exception error) {
                    runUi(serial, new Runnable() {
                        @Override public void run() { setMessage("自动整理请求失败：" + concise(error)); }
                    });
                }
            }
        }, "project-material-organization").start();
    }

    private void renderMaterials() {
        final boolean formalClassification = project.can("classificationWrite") && writable();
        final boolean formalAdoption = project.can("adoptionWrite") && writable();
        if (!cached && (formalClassification || formalAdoption)) {
            Button classify = smallButton("批量确认分类");
            classify.setEnabled(formalClassification);
            classify.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { classify(selectedItems(), true); }
            });
            batchBar.addView(classify, wrapWrap());
            Button accept = smallButton("批量采用");
            accept.setEnabled(formalAdoption);
            accept.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { adopt(selectedItems(), "accepted"); }
            });
            batchBar.addView(accept, wrapWrap());
            Button exclude = smallButton("批量排除");
            exclude.setEnabled(formalAdoption);
            exclude.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { adopt(selectedItems(), "excluded"); }
            });
            batchBar.addView(exclude, wrapWrap());
        }
        for (int i = 0; i < currentItems.length(); i++) {
            final JSONObject item = currentItems.optJSONObject(i);
            if (item == null) continue;
            final String materialId = item.optString("materialId", "");
            LinearLayout card = card();
            if (!cached && (formalClassification || formalAdoption)) {
                CheckBox select = new CheckBox(activity);
                select.setText("加入批量处理");
                select.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View view) {
                        if (((CheckBox) view).isChecked()) selectedIds.add(materialId);
                        else selectedIds.remove(materialId);
                    }
                });
                card.addView(select, matchWrap());
            }
            card.addView(text(item.optString("title", "项目资料") + " · v" + item.optInt("version", 0), 16, 0xff16324f), matchWrap());
            String detail = item.optString("logicalPath", "") + "\n"
                + adoptionLabel(item.optString("adoption", "candidate")) + " · "
                + processingLabel(item.optJSONObject("processing")) + pendingText(item.optJSONArray("pendingReasons"));
            card.addView(text(detail, 13, 0xff55697d), matchWrap());

            final JSONObject suggestion = suggestions.get(materialId);
            if (suggestion != null) {
                String reason = suggestion.optString("reason", "没有补充说明");
                String sourceLabel = "ai".equals(suggestion.optString("source")) ? "AI建议："
                    : "rule".equals(suggestion.optString("source")) ? "自动规则建议：" : "成员建议：";
                card.addView(text(sourceLabel
                    + categoryName(suggestion.optString("categoryId")) + "\n" + reason, 13, 0xff745100), matchWrap());
            }

            final Spinner category = new Spinner(activity);
            ArrayList<String> labels = new ArrayList<String>();
            labels.add("待分类");
            labels.addAll(categoryNames);
            category.setAdapter(new ArrayAdapter<String>(activity,
                android.R.layout.simple_spinner_dropdown_item, labels));
            JSONObject classification = item.optJSONObject("classification");
            String currentCategory = classification == null ? "" : classification.optString("categoryId", "");
            String draft = categoryDrafts.containsKey(materialId) ? categoryDrafts.get(materialId) : currentCategory;
            int position = 0;
            for (int c = 0; c < categoryIds.size(); c++) if (categoryIds.get(c).equals(draft)) position = c + 1;
            category.setSelection(position, false);
            category.setEnabled(!cached && writable()
                && (project.can("classificationWrite") || project.can("classificationSuggest")));
            category.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                @Override public void onItemSelected(AdapterView<?> parent, View view, int index, long id) {
                    categoryDrafts.put(materialId, index <= 0 ? "" : categoryIds.get(index - 1));
                }
                @Override public void onNothingSelected(AdapterView<?> parent) { }
            });
            card.addView(category, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));

            LinearLayout actions = horizontal();
            if (!cached && writable() && (project.can("classificationWrite") || project.can("classificationSuggest"))) {
                Button classify = smallButton(project.can("classificationWrite") ? "确认分类" : "提交分类建议");
                classify.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View view) {
                        ArrayList<JSONObject> one = new ArrayList<JSONObject>(); one.add(item);
                        classify(one, project.can("classificationWrite"));
                    }
                });
                actions.addView(classify, wrapWrap());
            }
            if (!cached && project.can("originalDownload") && "available".equals(item.optString("availability", "available"))) {
                Button download = smallButton("本地副本");
                download.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View view) { download(item); }
                });
                actions.addView(download, wrapWrap());
            }
            if (!cached && formalAdoption) {
                final String adoption = item.optString("adoption", "candidate");
                if ("candidate".equals(adoption)) {
                    Button accept = smallButton("采用");
                    accept.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View view) {
                            ArrayList<JSONObject> one = new ArrayList<JSONObject>(); one.add(item); adopt(one, "accepted");
                        }
                    });
                    actions.addView(accept, wrapWrap());
                    Button exclude = smallButton("排除");
                    exclude.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View view) {
                            ArrayList<JSONObject> one = new ArrayList<JSONObject>(); one.add(item); adopt(one, "excluded");
                        }
                    });
                    actions.addView(exclude, wrapWrap());
                } else if ("excluded".equals(adoption)) {
                    Button reopen = smallButton("重新纳入候选");
                    reopen.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View view) {
                            ArrayList<JSONObject> one = new ArrayList<JSONObject>(); one.add(item); adopt(one, "candidate");
                        }
                    });
                    actions.addView(reopen, wrapWrap());
                }
            }
            card.addView(actions, matchWrap());
            list.addView(card, matchWrap());
        }
    }

    private void renderKnowledge() {
        for (int i = 0; i < currentItems.length(); i++) {
            final JSONObject item = currentItems.optJSONObject(i);
            if (item == null) continue;
            LinearLayout card = card();
            card.addView(text(item.optString("title", "项目知识"), 16, 0xff16324f), matchWrap());
            JSONArray sources = item.optJSONArray("sources");
            card.addView(text((sources == null ? 0 : sources.length()) + " 个固定版本来源 · "
                + item.optString("status", ""), 13, 0xff55697d), matchWrap());
            Button open = smallButton(cached ? "离线仅显示索引" : "查看正文与来源");
            open.setEnabled(!cached && project.can("knowledgeRead"));
            open.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { openKnowledge(item); }
            });
            card.addView(open, wrapWrap());
            list.addView(card, matchWrap());
        }
    }

    private void renderContributions() {
        for (int i = 0; i < currentItems.length(); i++) {
            JSONObject item = currentItems.optJSONObject(i);
            if (item == null) continue;
            LinearLayout card = card();
            card.addView(text(item.optString("ability", "待确认贡献"), 16, 0xff16324f), matchWrap());
            card.addView(text(item.optString("observation", "") + "\n"
                + evidenceLabel(item.optString("status", "draft")) + " · "
                + ("fixed".equals(item.optString("sourceStatus")) ? "固定版本证据" : "部分来源受限"),
                13, 0xff55697d), matchWrap());
            JSONArray sources = item.optJSONArray("sources");
            if (sources != null) for (int s = 0; s < sources.length(); s++) {
                final JSONObject source = sources.optJSONObject(s);
                if (source == null) continue;
                LinearLayout row = horizontal();
                row.addView(text(source.optString("title", "已登记资料") + " · v"
                    + source.optInt("version", 0), 13, 0xff425466), new LinearLayout.LayoutParams(0,
                    ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                if (project.can("originalDownload")) {
                    Button download = smallButton("证据副本");
                    download.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View view) { download(source); }
                    });
                    row.addView(download, wrapWrap());
                }
                card.addView(row, matchWrap());
            }
            if (!cached && writable() && project.can("evidenceConfirm")
                && !"verified".equals(item.optString("status"))
                && !"published".equals(item.optString("status"))) {
                final JSONObject evidence = item;
                Button confirm = smallButton("预览并确认证据");
                confirm.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View view) { previewEvidence(evidence); }
                });
                card.addView(confirm, wrapWrap());
            }
            list.addView(card, matchWrap());
        }
    }

    private void classify(List<JSONObject> materials, boolean formal) {
        if (cached || materials == null || materials.isEmpty()) {
            setMessage("请先选择要处理的资料。"); return;
        }
        try {
            JSONArray actions = new JSONArray();
            for (JSONObject material : materials) {
                String materialId = material.optString("materialId", "");
                JSONObject classification = material.optJSONObject("classification");
                String current = classification == null ? "" : classification.optString("categoryId", "");
                String target = categoryDrafts.containsKey(materialId) ? categoryDrafts.get(materialId) : current;
                if (target == null || target.length() == 0) continue;
                JSONObject action = new JSONObject();
                action.put("materialId", materialId);
                action.put("expectedVersion", material.optInt("version", 0));
                action.put("expectedRecordRevision", material.optInt("recordRevision", -1));
                action.put("categoryId", target);
                action.put("tags", new JSONArray());
                JSONObject suggestion = suggestions.get(materialId);
                boolean exact = suggestion != null
                    && suggestion.optInt("version", -1) == material.optInt("version", 0)
                    && suggestion.optInt("recordRevision", -1) == material.optInt("recordRevision", -2);
                if (formal) {
                    boolean accepts = exact && target.equals(suggestion.optString("categoryId", ""));
                    action.put("suggestionId", exact ? suggestion.optString("suggestionId", "") : "");
                    action.put("decision", accepts ? "accept" : "correct");
                    if (accepts && suggestion.optJSONArray("tags") != null) action.put("tags", suggestion.optJSONArray("tags"));
                } else {
                    action.put("reason", "由Android端用户人工选择分类，等待项目管理员确认。");
                    action.put("needsConfirmation", true);
                }
                actions.put(action);
            }
            if (actions.length() == 0) { setMessage("所选资料尚未选择分类。"); return; }
            JSONObject body = new JSONObject();
            body.put("idempotencyKey", key(formal ? "android-classify" : "android-suggest"));
            body.put("items", actions);
            String endpoint = formal ? "/materials/classifications:batch" : "/materials/classification-suggestions";
            mutate(endpoint, body, formal ? "分类已由主机确认；原件位置没有改变。" : "分类建议已提交，仍需项目管理员确认。");
        } catch (Exception error) { setMessage("分类请求无效：" + concise(error)); }
    }

    private void adopt(List<JSONObject> materials, String state) {
        if (cached || materials == null || materials.isEmpty()) {
            setMessage("请先选择要审核的资料。"); return;
        }
        try {
            JSONArray actions = new JSONArray();
            for (JSONObject material : materials) {
                String current = material.optString("adoption", "candidate");
                if ("accepted".equals(state) && !"candidate".equals(current)) continue;
                if ("excluded".equals(state) && !"candidate".equals(current)) continue;
                if ("candidate".equals(state) && !"excluded".equals(current)) continue;
                JSONObject action = new JSONObject();
                action.put("materialId", material.optString("materialId", ""));
                action.put("expectedVersion", material.optInt("version", 0));
                action.put("expectedRecordRevision", material.optInt("recordRevision", -1));
                action.put("state", state);
                actions.put(action);
            }
            if (actions.length() == 0) { setMessage("所选资料的当前采用状态不能执行该操作。"); return; }
            JSONObject body = new JSONObject();
            body.put("idempotencyKey", key("android-adoption"));
            body.put("reason", "由Android教师端执行项目采用审核。");
            body.put("items", actions);
            mutate("/materials/adoptions:batch", body, "采用审核已提交；原件位置没有改变。");
        } catch (Exception error) { setMessage("采用审核请求无效：" + concise(error)); }
    }

    private void mutate(final String endpoint, final JSONObject body, final String successMessage) {
        if (cached || !writable()) { setMessage("当前视图只读，不能提交修改。"); return; }
        final int serial = ++requestSerial;
        setMessage("正在由主机核对版本和权限…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    JSONObject response = bridge.postJson(bridge.baseUrl() + "/api/projects/"
                        + encode(project.id) + endpoint, body);
                    JSONArray results = response.optJSONArray("results");
                    int ok = 0;
                    int failed = 0;
                    if (results != null) for (int i = 0; i < results.length(); i++) {
                        if (results.optJSONObject(i) != null && results.optJSONObject(i).optBoolean("ok", false)) ok++;
                        else failed++;
                    }
                    final String outcome = successMessage + (failed > 0 ? " 成功 " + ok + " 项，冲突或失败 " + failed + " 项。" : "");
                    runUi(serial, new Runnable() {
                        @Override public void run() { bridge.status(outcome); load(); }
                    });
                } catch (final Exception error) {
                    runUi(serial, new Runnable() {
                        @Override public void run() { setMessage("提交失败：" + concise(error)); }
                    });
                }
            }
        }, "project-material-mutation").start();
    }

    private void openKnowledge(final JSONObject item) {
        if (cached) { setMessage("离线缓存只显示知识索引，不能打开正文。"); return; }
        final int serial = ++requestSerial;
        setMessage("正在读取知识正文和固定来源…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    final JSONObject document = bridge.getJson(bridge.baseUrl() + "/api/projects/"
                        + encode(project.id) + "/knowledge/document?documentId="
                        + encode(item.optString("documentId", "")));
                    runUi(serial, new Runnable() {
                        @Override public void run() { showKnowledgeDocument(item, document); setMessage(""); }
                    });
                } catch (final Exception error) {
                    runUi(serial, new Runnable() {
                        @Override public void run() { setMessage("知识读取失败：" + concise(error)); }
                    });
                }
            }
        }, "project-knowledge-document").start();
    }

    private void previewEvidence(final JSONObject evidence) {
        if (cached || !project.can("evidenceConfirm")) {
            setMessage("当前身份不能确认证据。"); return;
        }
        final int serial = ++requestSerial;
        setMessage("正在固定并核对贡献证据来源…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    JSONObject body = new JSONObject();
                    body.put("expectedEvidenceRevision", evidence.optString("evidenceRevision", ""));
                    final JSONObject preview = bridge.postJson(bridge.baseUrl() + "/api/projects/"
                        + encode(project.id) + "/evidence/" + encode(evidence.optString("studentId", ""))
                        + "/confirmation-preview", body);
                    runUi(serial, new Runnable() {
                        @Override public void run() { showEvidencePreview(preview); setMessage(""); }
                    });
                } catch (final Exception error) {
                    runUi(serial, new Runnable() {
                        @Override public void run() { setMessage("证据预览失败：" + concise(error)); }
                    });
                }
            }
        }, "project-evidence-preview").start();
    }

    private void showEvidencePreview(final JSONObject preview) {
        StringBuilder details = new StringBuilder();
        details.append("能力：").append(preview.optString("ability", "待标注"))
            .append("\n观察：").append(preview.optString("observation", "待补充"))
            .append("\n\n固定来源：");
        JSONArray sources = preview.optJSONArray("sources");
        if (sources == null || sources.length() == 0) details.append("\n无可确认来源");
        else for (int i = 0; i < sources.length(); i++) {
            JSONObject source = sources.optJSONObject(i);
            if (source == null) continue;
            details.append("\n").append(i + 1).append(". ");
            if ("material".equals(source.optString("kind"))) {
                details.append(source.optString("materialId", "已登记资料"))
                    .append(" · v").append(source.optInt("version", 0));
            } else details.append(source.optString("title", "项目知识固定版本"));
        }
        details.append("\n\n").append(preview.optString("message", "请确认固定来源版本。"));
        new AlertDialog.Builder(activity).setTitle("确认项目贡献证据")
            .setMessage(details.toString()).setNegativeButton("取消", null)
            .setPositiveButton("确认并保存", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) { confirmEvidence(preview); }
            }).show();
    }

    private void confirmEvidence(final JSONObject preview) {
        final int serial = ++requestSerial;
        setMessage("正在提交固定来源证据确认…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    JSONObject body = new JSONObject();
                    body.put("bindingId", preview.optString("bindingId", ""));
                    body.put("expectedEvidenceRevision", preview.optString("evidenceRevision", ""));
                    body.put("idempotencyKey", key("android-evidence-confirm"));
                    final JSONObject result = bridge.postJson(bridge.baseUrl() + "/api/projects/"
                        + encode(project.id) + "/evidence/" + encode(preview.optString("studentId", ""))
                        + "/confirmation", body);
                    runUi(serial, new Runnable() {
                        @Override public void run() {
                            bridge.status(result.optString("message", "贡献证据已确认。"));
                            load();
                        }
                    });
                } catch (final Exception error) {
                    runUi(serial, new Runnable() {
                        @Override public void run() { setMessage("证据确认失败：" + concise(error)); }
                    });
                }
            }
        }, "project-evidence-confirmation").start();
    }

    private void showKnowledgeDocument(JSONObject item, JSONObject document) {
        LinearLayout root = vertical();
        root.setPadding(dp(18), dp(8), dp(18), dp(8));
        TextView content = text(document.optString("content", "知识正文为空。"), 14, 0xff24384c);
        content.setTextIsSelectable(true);
        root.addView(content, matchWrap());
        root.addView(text("\n固定来源版本", 15, 0xff16324f), matchWrap());
        JSONArray sources = document.optJSONArray("sources");
        if (sources != null) for (int i = 0; i < sources.length(); i++) {
            final JSONObject source = sources.optJSONObject(i);
            if (source == null) continue;
            LinearLayout row = horizontal();
            row.addView(text(source.optString("title", "已登记资料")
                + (source.optInt("version", 0) > 0 ? " · v" + source.optInt("version", 0) : ""),
                13, 0xff425466), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            if (source.optBoolean("exportAllowed", false) && project.can("originalDownload")) {
                Button download = smallButton("本地副本");
                download.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View view) { download(source); }
                });
                row.addView(download, wrapWrap());
            }
            root.addView(row, matchWrap());
        }
        ScrollView scroll = new ScrollView(activity);
        scroll.addView(root);
        new AlertDialog.Builder(activity).setTitle(item.optString("title", "项目知识"))
            .setView(scroll).setPositiveButton("关闭", null).show();
    }

    private void download(final JSONObject source) {
        if (cached) { setMessage("离线缓存不能下载原文。"); return; }
        if (!project.can("originalDownload")) { setMessage("当前身份没有原文副本权限。"); return; }
        final String materialId = source.optString("materialId", "");
        final int version = source.optInt("version", 0);
        final String title = source.optString("title", "项目资料");
        setMessage("正在下载并校验固定版本副本…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    final String result = downloadVerified(materialId, version, title);
                    activity.runOnUiThread(new Runnable() {
                        @Override public void run() { setMessage(result); bridge.status(result); }
                    });
                } catch (final Exception error) {
                    activity.runOnUiThread(new Runnable() {
                        @Override public void run() { setMessage("副本下载失败：" + concise(error)); }
                    });
                }
            }
        }, "project-material-download").start();
    }

    private String downloadVerified(String materialId, int version, String title) throws Exception {
        if (materialId.length() == 0 || version < 1) throw new Exception("资料版本标识无效");
        URL url = new URL(bridge.baseUrl() + "/api/projects/" + encode(project.id) + "/materials/"
            + encode(materialId) + "/versions/" + version + "/download");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(45000);
        connection.setRequestProperty("Accept", "application/octet-stream");
        if (bridge.token().length() > 0) connection.setRequestProperty("Authorization", "Bearer " + bridge.token());
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) throw new Exception("主机返回 HTTP " + code);
        long declared;
        try { declared = Long.parseLong(safe(connection.getHeaderField("Content-Length"))); }
        catch (Exception ignored) { declared = -1L; }
        if (declared < 0 || declared > MAX_DOWNLOAD_BYTES) throw new Exception("主机未提供安全的副本长度");
        String headerId = safe(connection.getHeaderField("X-Edu-Material-Id"));
        String headerVersion = safe(connection.getHeaderField("X-Edu-Material-Version"));
        String expectedHash = safe(connection.getHeaderField("X-Edu-Material-Sha256")).toLowerCase(Locale.US);
        if (!materialId.equals(headerId) || !String.valueOf(version).equals(headerVersion)
            || !expectedHash.matches("[a-f0-9]{64}")) throw new Exception("主机副本身份响应不完整");
        File temporary = new File(activity.getCacheDir(), "project-material-" + UUID.randomUUID() + ".download");
        if (!temporary.createNewFile()) throw new Exception("无法创建校验临时文件");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;
        try {
            InputStream input = connection.getInputStream();
            OutputStream output = new FileOutputStream(temporary, false);
            byte[] buffer = new byte[16384];
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_DOWNLOAD_BYTES || total > declared) throw new Exception("副本长度超过主机声明");
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
            }
            output.flush();
            output.close();
            input.close();
            if (total != declared) throw new Exception("副本长度校验失败");
            if (!expectedHash.equals(hex(digest.digest()))) throw new Exception("副本哈希校验失败");
            String fileName = "本地副本-v" + version + "-" + safeFileName(title);
            String location = publishDownload(temporary, fileName);
            return "已保存经校验的本地副本（不会自动执行）：" + location;
        } finally {
            temporary.delete();
            connection.disconnect();
        }
    }

    private String publishDownload(File temporary, String fileName) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream");
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AI教育管家");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("系统下载目录不可用");
            try {
                OutputStream output = activity.getContentResolver().openOutputStream(uri, "w");
                if (output == null) throw new Exception("系统下载目录不可写");
                copy(temporary, output);
                output.close();
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Downloads.IS_PENDING, 0);
                activity.getContentResolver().update(uri, ready, null, null);
                return "下载/AI教育管家/" + fileName;
            } catch (Exception error) {
                activity.getContentResolver().delete(uri, null, null);
                throw error;
            }
        }
        File directory = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (directory == null) directory = activity.getFilesDir();
        if (!directory.exists() && !directory.mkdirs()) throw new Exception("应用下载目录不可用");
        File target = uniqueFile(directory, fileName);
        if (!target.createNewFile()) throw new Exception("无法创建本地副本");
        OutputStream output = new FileOutputStream(target, false);
        copy(temporary, output);
        output.close();
        return target.getAbsolutePath();
    }

    private static void copy(File source, OutputStream output) throws Exception {
        InputStream input = new FileInputStream(source);
        byte[] buffer = new byte[16384];
        int read;
        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        output.flush();
        input.close();
    }

    private void saveCache(String view, JSONObject response) {
        String hostId = response.optString("hostId", bridge.hostId());
        String generation = response.optString("dataGeneration", bridge.dataGeneration());
        if (hostId.length() == 0 || generation.length() == 0 || bridge.principalScope().length() == 0) return;
        try {
            JSONObject wrapper = new JSONObject();
            wrapper.put("hostId", hostId);
            wrapper.put("dataGeneration", generation);
            wrapper.put("principalScope", bridge.principalScope());
            wrapper.put("projectId", project.id);
            wrapper.put("view", view);
            wrapper.put("savedAt", System.currentTimeMillis());
            wrapper.put("response", response);
            activity.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE).edit()
                .putString(cacheKey(hostId, generation, bridge.principalScope(), project.id, view), wrapper.toString()).apply();
        } catch (Exception ignored) { }
    }

    private JSONObject readCache(String view) {
        String hostId = bridge.hostId();
        String generation = bridge.dataGeneration();
        String principal = bridge.principalScope();
        if (hostId.length() == 0 || generation.length() == 0 || principal.length() == 0) return null;
        try {
            SharedPreferences prefs = activity.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE);
            String key = cacheKey(hostId, generation, principal, project.id, view);
            String raw = prefs.getString(key, "");
            if (raw.length() == 0) return null;
            JSONObject wrapper = new JSONObject(raw);
            long savedAt = wrapper.optLong("savedAt", 0);
            boolean exact = hostId.equals(wrapper.optString("hostId"))
                && generation.equals(wrapper.optString("dataGeneration"))
                && principal.equals(wrapper.optString("principalScope"))
                && project.id.equals(wrapper.optString("projectId"))
                && view.equals(wrapper.optString("view"));
            if (!exact || savedAt <= 0 || System.currentTimeMillis() - savedAt > CACHE_MAX_AGE_MS) {
                prefs.edit().remove(key).apply();
                return null;
            }
            JSONObject response = wrapper.optJSONObject("response");
            if (response != null) {
                response.put("_cached", true);
                response.put("_cachedAt", savedAt);
            }
            return response;
        } catch (Exception ignored) { return null; }
    }

    private String cacheKey(String hostId, String generation, String principal, String projectId, String view) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update((hostId + "\n" + generation + "\n" + principal + "\n" + projectId + "\n" + view).getBytes("UTF-8"));
        return "view_" + hex(digest.digest());
    }

    private boolean cacheEligible(String value) {
        return "materials".equals(value) || "pending".equals(value) || "knowledge".equals(value);
    }

    private List<JSONObject> selectedItems() {
        ArrayList<JSONObject> result = new ArrayList<JSONObject>();
        for (int i = 0; i < currentItems.length(); i++) {
            JSONObject item = currentItems.optJSONObject(i);
            if (item != null && selectedIds.contains(item.optString("materialId", ""))) result.add(item);
        }
        return result;
    }

    private void updateTabAppearance() {
        JSONObject counts = currentView.optJSONObject("counts");
        for (int i = 0; i < tabButtons.size(); i++) {
            Button button = tabButtons.get(i);
            int count = counts == null ? 0 : counts.optInt(TABS[i], 0);
            button.setText(TAB_LABELS[i] + " " + count);
            button.setEnabled(!TABS[i].equals(tab));
        }
    }

    private boolean writable() {
        return !"sealed".equals(project.status) && !"archived".equals(project.status)
            && !"running".equals(project.migrationState);
    }

    private String categoryName(String id) {
        for (int i = 0; i < categoryIds.size(); i++) if (categoryIds.get(i).equals(id)) return categoryNames.get(i);
        return id.length() == 0 ? "待分类" : id;
    }

    private static String pendingText(JSONArray values) {
        if (values == null || values.length() == 0) return "";
        ArrayList<String> labels = new ArrayList<String>();
        for (int i = 0; i < values.length(); i++) {
            String value = values.optString(i, "");
            if ("needs_adoption".equals(value)) labels.add("待采用");
            else if ("needs_classification".equals(value)) labels.add("待分类");
            else if ("source_missing".equals(value)) labels.add("原件缺失");
            else if ("source_unavailable".equals(value)) labels.add("来源暂不可用");
            else if ("processing_failed".equals(value)) labels.add("处理异常");
            else if (value.length() > 0) labels.add(value);
        }
        return labels.isEmpty() ? "" : " · " + TextUtils.join(" / ", labels);
    }

    private static String adoptionLabel(String value) {
        if ("accepted".equals(value)) return "已采用";
        if ("excluded".equals(value)) return "已排除";
        return "候选资料";
    }

    private static String processingLabel(JSONObject value) {
        String state = value == null ? "pending" : value.optString("state", "pending");
        if ("completed".equals(state) || "processed".equals(state)) return "已消化";
        if ("failed".equals(state)) return "处理异常";
        if ("running".equals(state)) return "处理中";
        return "等待处理";
    }

    private static String evidenceLabel(String value) {
        return "verified".equals(value) ? "已核验" : "待核验";
    }

    private static String organizationStatusLabel(String value) {
        if ("succeeded".equals(value)) return "整理完成";
        if ("partial".equals(value)) return "部分完成";
        if ("running".equals(value)) return "整理中";
        return "需要处理";
    }

    private void runUi(final int serial, final Runnable action) {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (serial == requestSerial && dialog != null && dialog.isShowing()) action.run();
            }
        });
    }

    private void setMessage(String value) {
        if (message != null) message.setText(value == null ? "" : value);
    }

    private LinearLayout card() {
        LinearLayout result = vertical();
        result.setPadding(dp(12), dp(10), dp(12), dp(10));
        result.setBackgroundColor(0xfff3f7fb);
        LinearLayout.LayoutParams params = matchWrap();
        params.setMargins(0, 0, 0, dp(8));
        result.setLayoutParams(params);
        return result;
    }

    private TextView empty(String value) {
        TextView result = text(value, 14, 0xff65788a);
        result.setGravity(Gravity.CENTER);
        result.setPadding(dp(12), dp(32), dp(12), dp(32));
        return result;
    }

    private LinearLayout vertical() {
        LinearLayout result = new LinearLayout(activity);
        result.setOrientation(LinearLayout.VERTICAL);
        return result;
    }

    private LinearLayout horizontal() {
        LinearLayout result = new LinearLayout(activity);
        result.setOrientation(LinearLayout.HORIZONTAL);
        result.setGravity(Gravity.CENTER_VERTICAL);
        return result;
    }

    private TextView text(String value, int sp, int color) {
        TextView result = new TextView(activity);
        result.setText(value);
        result.setTextSize(sp);
        result.setTextColor(color);
        result.setLineSpacing(0, 1.12f);
        return result;
    }

    private Button smallButton(String value) {
        Button result = new Button(activity);
        result.setText(value);
        result.setTextSize(13);
        result.setMinHeight(dp(40));
        result.setAllCaps(false);
        return result;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams wrapWrap() {
        LinearLayout.LayoutParams result = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT);
        result.setMargins(0, 0, dp(6), 0);
        return result;
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private static String encode(String value) throws Exception {
        return URLEncoder.encode(safe(value), "UTF-8").replace("+", "%20");
    }

    private static String key(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString();
    }

    private static String safe(String value) { return value == null ? "" : value; }

    private static String concise(Exception error) {
        String value = error == null ? "未知错误" : safe(error.getMessage());
        return value.length() > 180 ? value.substring(0, 180) : value;
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.US, "%02x", value & 0xff));
        return result.toString();
    }

    private static String safeFileName(String value) {
        String cleaned = safe(value).replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (cleaned.length() == 0) cleaned = "项目资料";
        if (cleaned.length() > 100) cleaned = cleaned.substring(0, 100);
        return cleaned;
    }

    private static File uniqueFile(File directory, String fileName) {
        File candidate = new File(directory, fileName);
        int index = 2;
        while (candidate.exists() && index < 1000) {
            int dot = fileName.lastIndexOf('.');
            String stem = dot > 0 ? fileName.substring(0, dot) : fileName;
            String extension = dot > 0 ? fileName.substring(dot) : "";
            candidate = new File(directory, stem + "-" + index++ + extension);
        }
        return candidate;
    }
}
