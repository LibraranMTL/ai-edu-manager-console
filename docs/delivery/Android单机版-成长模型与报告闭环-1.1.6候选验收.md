# Android 单机版 1.1.6 成长模型与报告闭环——候选验收

日期：2026-08-24
状态：源码与 Debug 候选完成；尚未使用产品证书签名，尚未完成本轮平板真机验收。

## 修复范围

1. Windows 迁入候选缺少 `sourceUri` 时不再崩溃；保留旧 `sourcePath/migratedFrom` 供审计。
2. 历史学情报告不能作为自身的一手成长证据；用户需从当前学生原始资料库补充支撑材料后才能确认采用。
3. 资料消化和已保存 Agent 对话消化自动提取有直接来源的成长证据候选，以稳定 ID 去重并保持 `pending`。
4. 成长模型菜单优先显示“审核待确认成长证据（数量）”，手工添加降为高级入口。
5. 四类报告逐份生成；缺失章节、无依据文本和未知证据引用自动替换为“资料不足”，不再整批失败。
6. 草稿生成后可渲染预览四份 Markdown；只有用户明确确认才发布正式报告。

## 自动验证

- Android `check`：通过，包含 Debug/Release Kotlin 编译、单元测试和 Android Lint。
- 新增 `GrowthEvidencePolicyTest`：3/3 通过。
- 新增 `ReportDraftPolicyTest`：3/3 通过。
- W8 相关契约：7/7 通过。
- 仓库全量契约：853 项，852 通过、1 项按既有配置跳过、0 失败。

## Debug 候选

`android-standalone-manager/delivery/candidates/AI-Education-Manager-Android-Standalone-1.1.6-growth-report-fix-debug.apk`

- 包名：`com.qxmatrix.edumanager.standalone`
- 版本：`1.1.6 / code 22`
- 大小：75,114,199 bytes
- SHA-256：`B276EC29DB2BE31E202BF13E754D8DD1106173A24D512D73F877C06060B8B536`
- v1、v2 签名结构校验通过，但证书为 `Android Debug`；不能覆盖已安装的正式版，不得作为对外发布包。

## 真机验收步骤

1. 打开由 Windows 迁入且缺少 `sourceUri` 的历史候选，确认页面显示“缺少可核验的原始资料”，不再出现 `No value for sourceUri`。
2. 点击“补充来源”，从当前学生原始资料中选择一项；再次打开后可确认采用，并在 `成长证据.md` 中看到 `edu://student/.../raw/...` 来源。
3. 消化一份包含明确学习行为或作品成果的资料，确认成长模型菜单的待审核数量增加；再次消化同一内容不生成重复候选。
4. 使用会漏掉部分章节的文本模型生成报告，确认仍生成四份草稿，漏项显示“资料不足”且没有整批失败。
5. 在“预览草稿”中切换整体画像、历史变化、每周行动建议和阶段总结；点击“暂不发布”时原正式报告保持不变。
6. 故意让模型返回不存在的 `[依据:fake]`，确认该章节不采用模型文本并回退为“资料不足”。

通过以上真机步骤后，再使用原正式版四项签名配置生成 1.1.6 正式 Release APK，并更新公开下载清单。
