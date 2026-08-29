# Android 单机版资料处理闭环——源码候选验收

日期：2026-08-24
状态：1.1.5 正式签名 Release 已生成并完成静态校验；本轮资料处理功能仍待平板真机验收。

## 本轮范围

1. Windows/U 盘迁入的非便携学生 ID 映射为稳定 KnowledgeEngine `subjectId`，业务学生 ID 和学生目录保持不变。
2. 课程中心与普通连续屏幕采集统一登记到学生原始资料、文件资产和待处理队列。
3. 升级后首次进入“资料收集与处理”时，按旧课程采集台账补登记历史截图；不移动、不删除、不重写原图。
4. 首页“处理中”“需要补充”携带精确筛选条件进入资料队列，并显示学生、来源/采集会话、文件和状态。
5. OCR、OCR + 视觉理解、消化和失败重试支持多选；单批上限 200 份，按学生分组执行。
6. 新增学生原始资料库只读浏览器，可按目录浏览并调用本机应用打开原文件。
7. Agent 测试分别验证文本模型和视觉模型；视觉测试只发送应用内置 1×1 测试图。
8. 资料记录不再在 1000 条、资产索引不再在 5000 条时静默截断；改为保留记录并在达到明确安全上限时拒绝继续写入。

## 自动验证

- `android-standalone-manager/build.ps1 -Task test`：通过。
- `android-standalone-manager/build.ps1 -Task check`：通过，包含 Debug/Release Kotlin 编译、单元测试和 Android Lint。
- 资料处理与既有 W7-W10、离线迁移契约：36/36 通过。
- `android-standalone-manager/build.ps1 -Task assembleDebug`：通过。

Debug 候选：

`android-standalone-manager/app/build/outputs/apk/debug/app-debug.apk`

- 大小：75,097,823 bytes
- SHA-256：`48E5A9C2253A87579975586301A366BED1B67E6B01153C0955795A91201B6CDF`

## 真机验收门槛

1. 用含 Windows 迁入学生 ID 的档案消化一份已完成 OCR 的资料，不再出现 `subjectId 必须是 1-128 位稳定 ID`。
2. 课程中心启动采集并保存至少 3 张，首页“处理中”、文件资产中心和资料队列均显示同一批截图。
3. 用文本模型和真正支持图片的视觉模型分别测试；故意把视觉模型填成纯文本模型时，应仅报告视觉失败。
4. 从首页“需要补充”进入后直接看到失败文件，多选重试；某一文件失败不应阻断其他文件完成。
5. 浏览原始资料库时可以进入“课程采集”等子目录并打开原文件，不能在该页面删除或修改文件。
6. 用 1000 份以上资料的学生档案验证列表、分批选择、处理完成后的记录数，确认不存在 1000 条截断。

## 正式发布结果

已使用原正式版四项签名配置生成：

`android-standalone-manager/delivery/AI-Education-Manager-Android-Standalone-1.1.5-release.apk`

- 包名：`com.qxmatrix.edumanager.standalone`
- 版本：`1.1.5 / code 21`
- 大小：68,575,779 bytes
- SHA-256：`EA3BCA7616C67CCDFF3C7E590932DE38FE731F6A537863F1F52F25748CA66323`
- 签名：APK Signature Scheme v1、v2 均通过
- 证书 SHA-256：`647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F`
- 证书连续性：与 Android 单机版 1.1.4 原正式产品证书一致，可覆盖升级正式签名版本

正式签名、包名和版本校验不替代真机业务验收。以上六项资料闭环仍应按“真机验收门槛”逐项验证；本文件中的 Debug APK 仅保留为源码构建记录，不得对外发布。
