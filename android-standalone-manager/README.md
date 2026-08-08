# AI教育管家独立安卓版

本工程以 Windows 主机版教育管家的业务架构为权威基线，只增加 Android 平台适配层。

## W0-W10状态

- W0：冻结 Windows 业务协议和 Android 独立 APK 边界。
- W1：SAF 持久授权、原子文件和安全相对路径。
- W2：新建/接管学生档案库，保持 Windows 目录和索引字段。
- W3：LLM Wiki 与 KnowledgeEngine v1，按 AGENT.md 和精确学生 ID 隔离。
- W4：文件资产中心、资料导入、SHA-1 索引和资料状态流转。
- W5：新建/接管项目知识库，保留 Windows 项目工作空间和知识 Schema。
- W6：Task Protocol 1.2、教育编排、审批和受控 Agent 文件工具。
- W7：设备本地 ML Kit OCR、可选视觉理解和候选结果治理。
- W8：成长模型 v2、证据审核和四类学情报告。
- W9：Windows 课程包 v3、受限 WebView 和用户主动屏幕采集。
- W10：逐文件加密备份、空目录恢复、URI 重映射和发布构建。

累计契约测试、Android `check`、Lint、Android 14 平板模拟器端到端验收结果见 `delivery/W0-W10-验收报告.md`。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File android-standalone-manager\build.ps1 -Task check
powershell -ExecutionPolicy Bypass -File android-standalone-manager\build.ps1 -Task assembleDebug
powershell -ExecutionPolicy Bypass -File android-standalone-manager\build.ps1 -Task assembleRelease
```

首次构建会把 Gradle 8.7 下载到本工程的 `.gradle-dist`，JDK 与 Android SDK 使用仓库已有的 `.android-tools`。

正式 Release 签名仅从进程环境读取 `EDU_ANDROID_KEYSTORE`、`EDU_ANDROID_KEYSTORE_PASSWORD`、`EDU_ANDROID_KEY_ALIAS` 和 `EDU_ANDROID_KEY_PASSWORD`；不得把 keystore 或密码写入仓库。

日常发布直接运行 `android-standalone-manager\发布正式版.ps1`。首次运行只需填写一次 keystore 完整路径和 key alias；它们作为非秘密信息保存在当前 Windows 用户的 `%LOCALAPPDATA%\QxMatrix\EduManager\android-signing-location.json`。以后发布只安全输入密码，不需要重启 Codex 或手工设置四项环境变量。密码只注入当前签名子流程，流程结束后恢复原进程环境，不会写入配置、仓库或日志。需要更换证书位置时运行 `android-standalone-manager\publish-release.ps1 -ResetSigningLocation`。

底层 `sign-release.ps1` 仍只接受四项进程环境变量，并继续拒绝仓库内 keystore 和 Android Debug 证书，强制验证 v2 签名、包名、版本、证书指纹和 SHA-256，再生成 `delivery/*-release.apk` 与不含秘密的发布元数据。需要安装到指定设备复核时运行 `android-standalone-manager\publish-release.ps1 -DeviceSerial <序列号>`。

正式 APK 生成后，使用实体家庭平板执行：

```powershell
powershell -ExecutionPolicy Bypass -File android-standalone-manager\verify-physical-device.ps1 `
  -ApkPath android-standalone-manager\delivery\AI-Education-Manager-Android-Standalone-1.0.0-release.apk `
  -DeviceSerial <实体平板序列号>
```

终验脚本强制拒绝模拟器、Android Debug 证书和包版本不一致；随后安装、冷启动并采集设备属性、截图、UI 层级、包信息和应用日志。自动检查通过后仍只标记为 `automated-ready-manual-pending`，必须在生成的 `physical-acceptance.json` 中逐项完成学生档案库、文件资产/OCR、项目知识库、课程学习、屏幕采集、加密备份恢复和重启持久化人工验收，不能以模拟器或自动启动结果替代家庭平板终验。

## 明确关闭范围

- Windows 主机服务与终端配对；
- Tailscale 连接；
- 跨主机知识协作；
- 家长角色界面；
- 机构课程管理。

关闭这些入口不改变学生、资产、项目、任务、知识、成长、报告和课程采集的现有协议。
