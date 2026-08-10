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

## 多端知识协作 P2–P4-R（源码候选）

系统设置中的“知识协作”已具备 Android 完整节点基础：Room v4 保存设备绑定、精确学生映射、版本清单、增量文件清单、持久队列、检查点和冲突记录；WorkManager 负责重启恢复；协作凭据经 Android Keystore 加密；本机学生目录继续使用用户明确授予的 SAF 权限。

连接 Windows 主机可选择扫描连接二维码、输入六位临时码或粘贴完整连接信息。设备只配对一次；添加共享学生时必须从本机档案中人工选择确切学生 ID，Android 会把带设备信任校验的确认回执自动发回 Windows，只有 Windows 验证并落库成功后 Android 才会把映射标记为有效。界面只保留“协作设备、共享学生、同步异常”三个区域。

P3 已接入 Windows—Android 学生知识档案正文同步：Android 每十五分钟或按“立即同步”主动连接 Windows，先拉取再推送；手工同步使用带持续通知的前台 Worker，后台恢复仍由 WorkManager 调度，失败队列按最早重试时间继续。传输复用 Windows 的签名请求、版本清单、SHA-256、1 MB 分块与断点，局域网不可达时继续尝试已保存的 Tailscale 地址。双方按最多 999 个档案条目稳定分包，并在 Windows 初始化与提交时复核精确学生和版本谱系。同步范围仅包含已治理知识、成长模型、已发布学情报告和教育档案，不包含原始资料。

P4-R 将单个同步范围的明确上限提高为 20000 个文本文件，超限或单文件超过 64 MB 时直接报告异常，不把遗漏文件标记为成功。Room v4 增量清单复用大小、修改时间和复核时效均一致的哈希；SAF 无可靠修改时间时仍重新计算。上传大文件时只打开一次输入流，并从断点位置连续读取后续分块，避免每个分块从文件开头重复扫描。

远端正文只有在本地未修改时才快进覆盖；并发修改写入“协作冲突”，远端删除写入可恢复的“协作回收站”。Android 在 SAF 物化后先写 Room 检查点，再确认 Windows，断网重试不会重复生成冲突副本。当前仍需完成 Windows—Android 真机的大文件、断网、杀进程、并发修改和多学生隔离验收，未通过前不发布为正式协作版本。

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

- 普通 Windows/Android 学生端注册为知识协作节点；
- Android—Android 接收服务与同步（P5）；
- 家长角色界面；
- 机构课程管理。

关闭这些入口不改变学生、资产、项目、任务、知识、成长、报告和课程采集的现有协议。

## Android 单机版整机换机迁移（1.1.3）

系统设置保留原有“加密备份/备份恢复”作为归档能力，同时增加面向大量照片和长期家庭资料库的目录式整机迁移：

1. 旧平板选择“换新平板：导出整机迁移目录”，把资料逐文件写入 U 盘空目录；
2. 新平板先使用本机设备码完成独立激活，再选择“在新平板恢复并接管”；
3. 选择 U 盘迁移目录和本机空资料目录，前台服务逐文件校验并保留学生/项目业务 ID；
4. 中断、重启或 U 盘暂时断开后，可从系统设置继续同一次迁移。

协议使用 `edu-manager.standalone-portable-folder.v1` 与 `edu-manager.standalone-portable-manifest.v1`，不生成大型 ZIP；每 10 个文件保存一次断点，文件使用 SHA-256 校验。导入只允许进入没有学生档案和学习项目的单机版，不提供两套家庭资料库合并。License、设备码、Agent API Key、Android Keystore、SAF 授权、录屏授权和协作设备绑定不会迁移；界面皮肤、布局和 Agent 的非秘密接口/模型参数会迁移，API Key 必须在新平板重新填写。
