# Android 原生本地文件智能体深度研究

> 日期：2026-07-24
> 研究范围：智能体运行时、工具调用循环和文件处理能力部署在 Android 设备本地；大模型推理允许通过远程 API 完成。
> 明确排除：只连接远程智能体的 Android 客户端、必须安装 Termux/Linux 环境的方案、把端侧模型作为 P0 必选项。

## 1. 结论

可以实现，而且不需要 Termux，也不需要本地推理。

最合适的产品路线不是把 OpenClaw 原样搬到 Android，也不是在平板上模拟 Linux，而是：

1. 在现有 Android 学生端 APK 内加入一个原生 `LocalAgentRuntime`；
2. 智能体循环、会话、技能、工具策略和文件操作都在 Android 应用进程内运行；
3. 大模型通过 OpenAI-compatible 或其他 HTTPS API 提供推理；
4. 文件能力严格限制在用户通过 Storage Access Framework（SAF）授权的目录树；
5. 读取可自动执行，写入、移动、重命名、删除按风险分级确认；
6. 每次读取、外发和修改都生成可审计回执。

参考实现中，**PalmClaw 的文件能力与目标最接近，适合做功能架构样板；`ChenKuanSun/mobileClaw` 则是当前更值得参考的 MIT 原生 Android 运行时样板**，因为它把 agent loop、远程 provider、工具审批和凭据加密放在 APK 内。但二者都不能直接进入学生端：PalmClaw 有 AGPLv3/商业双许可和 `MANAGE_EXTERNAL_STORAGE` 问题；后者没有 SAF 目录授权，Downloads 直读写在现代 Android 上不可靠，并且存在路径前缀校验缺陷和过宽设备权限。

需要特别区分同名项目：**`aohp-os/MobileClaw` 不是手机本地智能体运行时**。其 Python agent、记忆和文件工作区运行在电脑，手机 APK 只是通过 ADB/WebSocket 接收 GUI 指令的执行端，仍依赖电脑和 ADB 转发。它不符合“不与远程/外部智能体通讯”的要求。**X-OmniClaw 与 ApkClaw 也主要面向跨应用 GUI 自动化，不能替代有界文件工具层。**

最终建议是：**以 `ChenKuanSun/mobileClaw` 的 MIT 原生运行时、审批门和 Keystore 凭据保存为主要代码参考，以 PalmClaw 的文件工具覆盖面和工作空间思想为功能参考；在 AI 教育管家中复用现有 SAF 授权能力，自行实现 URI 有界文件工具层。P0 删除本地推理依赖、`BYPASS_ALL`、无障碍和非必要手机权限。**

## 2. “本地智能体”在本研究中的准确含义

| 层 | 部署位置 | 本方案 |
|---|---|---|
| 对话界面、任务状态 | Android APK | 本地 |
| Agent loop、工具选择、最大轮次、失败恢复 | Android APK | 本地 |
| 文件枚举、读取、搜索、创建、移动、删除 | Android APK | 本地 |
| 会话、任务回执、授权记录 | Android 本地数据库 | 本地 |
| 大模型推理 | 模型服务商 HTTPS API | 远程 |
| Windows 主机智能体/Gateway | 非必需 | 不依赖 |
| Termux/Linux shell | 非必需 | 不安装 |

因此，“不需要本地推理”只移除了模型权重、端侧推理引擎和高内存占用，并没有把智能体变成远程智能体。真正的行动循环和文件工具仍在 Android 端。

需要注意：**本地运行时不等于数据不离开设备。** 只要采用远程模型，发送给模型的文件片段、文件名、目录结构和工具结果仍可能离开设备。因此必须把“本次将发送哪些文件/哪些片段”做成用户可见边界。

## 3. 候选方案比较

| 方案 | Android 原生运行时 | 本地文件工具 | 远程模型 | 不依赖 Termux | 主要问题 | 结论 |
|---|---:|---:|---:|---:|---|---|
| PalmClaw | 是 | 强：list/read/write/edit/grep/move/delete 等 | 是，自带 provider 配置 | 是 | AGPLv3/商业双许可；申请所有文件访问；项目较新 | **最佳架构样板；先隔离验证，不直接合并** |
| MobileClaw（ChenKuanSun） | 是，Kotlin/Compose | 中：list/read/write/delete/info；限 App 目录与 Downloads | 是，云端 provider；本地 Gemma 可选 | 是 | 未使用 SAF；Downloads 直读写受 scoped storage 限制；路径前缀校验有缺陷；权限面过宽 | **最佳 MIT 原生运行时参考；文件层必须重写** |
| MobileClaw（aohp-os） | 否；Python agent 在电脑 | 手机端文件工具缺失；公开 file API 操作电脑工作区 | 是，需要两个模型 | 不需 Termux，但依赖电脑、Python 和 ADB | APK 是 GUI/WebSocket 执行端；Android 源码未公开；官方警告勿用于主力设备 | **不符合本地运行时要求** |
| X-OmniClaw | 是 | 有 read/write/edit，另有图库与设备工具 | 是 | 是 | 需要无障碍、悬浮窗、录屏、所有文件等广权限；目标偏 GUI 自动化 | **次选源码参考，裁掉大部分设备权限** |
| ApkClaw | 是 | 弱：公开工具只有绝对路径 `send_file`，没有 list/read/write/search | 是，OpenAI/Anthropic-compatible | 是 | 所有文件访问、无障碍、悬浮窗、明文 LAN 配置面；没有文件工作区沙箱 | **跨 App 自动化参考，不作为文件智能体底座** |
| CellClaw | 官网宣称是 | 官网宣称有 file.read/write/list | 是 | 是 | 官网 GitHub 链接当前返回 404，无法审计源码、许可证和实际构建 | **暂不进入采用清单** |
| 官方 OpenClaw Android | 否，只是 companion node | 只读远程 workspace | 依赖外部 Gateway | Android 本身不需 Termux，但需要外部主机 | Android 不承载 Gateway 和智能体运行时 | **不符合需求** |
| OpenClaw + Termux | 是 | 强，甚至可用 shell | 是 | 否 | 安装复杂、进程易受 Android 限制、权限过大、学生设备运维困难 | **排除产品路线** |
| Google AI Edge Gallery / LiteRT-LM | 是 | 可扩展工具调用 | 主要面向本地模型 | 是 | 重点是端侧推理展示，不是完整文件智能体产品 | **仅作未来本地模型参考** |

## 4. 关键候选的源码级判断

### 4.1 PalmClaw

PalmClaw 官方说明其可直接在 Android 运行，内置对本地硬件与文件的访问，并把 memory、skills、tools、channels 放在同一移动运行时中；安装 APK 后配置自己的模型 provider API key 即可使用。

本次源码审计固定在提交：

```text
29a8724ac87ef5c07fd35ce7b2a3e70f7917a5f3
```

源码中可确认：

- `AgentLoop.kt` 在 Android 内完成模型请求、工具选择、工具结果回填和最大轮次控制；
- `FileTools.kt` 提供目录列举、glob、读取、写入、编辑、grep、删除、移动；
- `WorkspacePathResolver.kt` 检查路径是否位于当前会话工作空间、共享根或允许的外部根；
- 递归删除、覆盖目标和外部存储修改存在确认流程；
- provider 层支持 OpenAI-compatible 与 Anthropic-compatible 等远程模型；
- `AndroidManifest.xml` 申请 `MANAGE_EXTERNAL_STORAGE`；
- 许可证为 AGPLv3/商业双许可。

判断：

- 功能形态与需求高度一致；
- 证明了“原生 APK 内运行智能体、调用远程模型、处理本地文件”这条路线可行；
- 但所有文件访问权限不适合直接用于学生端；
- 若直接复制或修改其代码并进入闭源商业产品，需要先解决许可证问题；
- 可把它用于独立、合成数据的技术验证，或只借鉴不受版权保护的架构思想。

来源：[PalmClaw 仓库](https://github.com/ModalityDance/PalmClaw)、[PalmClaw 论文](https://arxiv.org/abs/2607.13027)。

### 4.2 X-OmniClaw

X-OmniClaw 是原生 Android 端的 observation → reasoning → execution 循环，支持远程 API 模型、技能、会话、计划任务和设备工具。本次源码审计固定在提交：

```text
8614c935d4aecb864f60d6c1de2ea9b2688f6ad0
```

源码中可确认：

- `AgentLoop.kt`、`ToolRegistry.kt`、`ReadFileTool.kt`、`WriteFileTool.kt`、`EditFileTool.kt` 均位于 Android 工程内部；
- provider 配置支持 OpenAI、Anthropic、OpenRouter 等远程服务；
- 使用 Apache License 2.0；
- Manifest 申请 `MANAGE_EXTERNAL_STORAGE`、旧版读写存储权限；
- 首次设置还要求无障碍、悬浮窗、录屏、照片、相机、麦克风等能力；
- 公开仓库在审计时只有少量提交，且目标重心是跨应用 GUI 自动化，不是最小文件智能体。

判断：

- 适合参考原生 Kotlin 的 agent/tool/skill 分层；
- 不应照搬其权限清单、外部存储配置和设备自动化面；
- 对 AI 教育管家 P0，只应保留 model provider、agent loop、tool registry 的思想。

来源：[X-OmniClaw 仓库](https://github.com/OPPO-Mente-Lab/X-OmniClaw)、[X-OmniClaw 论文](https://arxiv.org/abs/2605.05765)。

### 4.3 ApkClaw

ApkClaw 是真正运行在 APK 内的 Android agent，不需要 Termux、PC 或远程 Gateway。公开源码使用 LangChain4j 组织 ReAct 循环，通过 OpenAI-compatible 或 Anthropic-compatible API 推理，再由 `ToolRegistry` 调用 Android 无障碍工具执行跨 App 操作。

本次源码审计固定在提交：

```text
1b8d40fad417618f63f62af73fdfe688796dabad
```

公开版本信息：

- Android 原生工程，`minSdk 28`、`targetSdk 36`，版本 `0.0.2`；
- Apache License 2.0；
- agent loop、模型请求和工具执行都在 APK 内；
- 支持钉钉、飞书、QQ、Discord、Telegram、微信等远程指令入口；
- 核心工具是 screen tree、截图、点击、滑动、输入、打开 App 等 GUI 自动化；
- GitHub 仓库审计时只有 3 个提交；两个测试文件均是 Android 模板示例，没有 agent、权限、文件或安全测试。

与本地文件智能体需求的关键差距：

1. `ToolRegistry` 没有 `list_files`、`read_file`、`write_file`、`search_text`、`move_file` 或 `delete_file`；
2. 唯一文件工具 `send_file` 接收任意绝对路径，并通过当前消息通道发送文件；
3. `send_file` 依赖 `MANAGE_EXTERNAL_STORAGE`，没有 SAF 目录树或 workspace resolver；
4. agent loop 收到模型 tool call 后直接执行，没有发现按读、写、移动、删除分级的运行时确认门；
5. Manifest 同时申请所有文件访问、无障碍、悬浮窗、忽略电池优化、查询全部应用、安装 APK、精确闹钟和开机自启等高权限；
6. 公共源码的 LLM key 与各通道 secret 使用 `MMKV.defaultMMKV()` 保存，未看到 crypt key，因此不能从源码确认“本地加密存储”；
7. 可选 LAN 配置服务使用 9527 端口。公开源码的 GET 路由返回完整 LLM key 和通道 secret，未看到身份认证；网络安全配置还允许明文流量。

因此 ApkClaw 的优势是**跨 App 操作、消息通道和后台守护**，不是本地文件知识工作区。它可以通过无障碍去操作系统文件管理器，但这属于脆弱的 GUI 自动化，不能代替可审计、可测试、可限定目录的文件工具。

对 AI 教育管家的判断：

- Apache 2.0 比 PalmClaw 更适合参考或复用；
- 可参考 LangChain4j Android 适配、agent loop、tool registry 和 channel adapter；
- 不应复用其 `send_file`、所有文件访问、LAN 配置服务、secret 保存方式和全套高权限；
- 如果选择以它为分支开发，仍需重写文件层、授权层、凭据层和审批层，改造量已经接近自行实现最小 `LocalAgentRuntime`；
- 排名上低于 PalmClaw：PalmClaw 是文件智能体样板，ApkClaw 是手机 GUI 自动化样板。

来源：[ApkClaw 仓库](https://github.com/apkclaw-team/ApkClaw)、[v0.0.2 发布页](https://github.com/apkclaw-team/ApkClaw/releases/tag/v0.0.2)、[ApkClaw 官网](https://apkclaw.ai/)、[隐私政策](https://apkclaw.ai/privacy-policy.html)。

### 4.4 MobileClaw：两个同名项目，结论相反

#### 4.4.1 `ChenKuanSun/mobileClaw`：原生运行时，符合方向但文件层不合格

该项目是 Kotlin + Jetpack Compose 原生 Android 应用。agent loop、provider、工具注册和执行都在 APK 内，既可以调用远程 Claude、OpenAI、Google 等 provider，也包含可选 LiteRT-LM/Gemma 本地推理。对本研究而言，本地模型不是必需项，使用远程 provider 即可。

本次源码审计固定在提交：

```text
83c66b046fde0a0ffd3ead1514e82c8e8afd41cf
```

版本与工程状态：

- `minSdk 29`、`targetSdk 34`、版本 `1.2.12`；
- 仓库实际 `LICENSE` 和 GitHub 元数据均为 MIT；README 比较表仍写 Apache 2.0，属于文档不一致，应以许可证文件为准；
- 最新 release `v1.2.12` 发布于 2026-05-09，提供 `app-release.apk`；
- release notes 声称 247 个单元测试通过；源码树含 25 个 Kotlin 测试文件，但没有 `FileSystemTool` 的直接边界测试；
- 本次尝试运行单元测试，但当前 Windows 环境没有 Java/JDK，Gradle 在编译前即因 `JAVA_HOME` 缺失退出，因此没有把上游“247 通过”当作本次复测结果。

值得借鉴的部分：

- `AgentRuntime` 会剥离模型输入中的 `__confirmed`，避免模型伪造确认；
- 写入和删除返回 `NeedsConfirmation`，用户确认后才由运行时内部注入 `__confirmed=true` 再执行；
- `PermissionManager` 支持默认逐次确认、allowlist 和会话允许；
- API token 使用 `EncryptedSharedPreferences`，主密钥由 Android Keystore 的 AES-256-GCM 保护；
- 确认对话框默认 60 秒超时，`files` 被归入高风险工具；
- Manifest 没有申请 `MANAGE_EXTERNAL_STORAGE`。

文件能力的实质限制与缺陷：

1. `FileSystemTool` 只有 `list/read/write/delete/info`，读取上限 10KB，没有搜索、追加、移动、重命名、diff 或批量处理；
2. 它不是用户选择工作区：允许根目录硬编码为 App 内部目录、缓存、App 外部目录和公共 Downloads；
3. 没有 `ACTION_OPEN_DOCUMENT_TREE`、`takePersistableUriPermission`、`DocumentsContract` 或 `DocumentFile`，不能复用用户明确授权的任意目录树；
4. `isAllowedPath()` 使用 `canonical.startsWith(root.canonicalPath)`，没有路径分隔符边界。例如允许根为 `/storage/emulated/0/Download` 时，前缀相同的 `/storage/emulated/0/DownloadEvil/...` 也可能被误判为在根内；
5. `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS)` 直接使用 `File`。在 Android scoped storage 下，没有 SAF 或 MediaStore 配套时，公共 Downloads 的任意读写不能视为稳定可用；
6. `deleteRecursively()` 允许递归删除整个目录；虽然有确认门，但学生端仍应限制为已授权 workspace、展示影响文件数，并生成不可抵赖回执；
7. `PermissionManager` 暴露 `BYPASS_ALL`，设置页和斜杠命令均可开启。学生端不应保留该模式；
8. Manifest 还声明短信、通话记录、联系人、日历、电话、相机、麦克风、精确闹钟、无障碍、通知监听和开机启动等权限。它是“手机控制智能体”的权限集合，不适合作为本地文件 P0 的默认权限。

判断：这是目前候选中**最适合作为 MIT 原生 Android agent runtime 代码参考**的项目，但不是可直接部署的文件智能体。产品化时应保留 provider/agent/tool/approval/Keystore 思路，移除 LiteRT-LM、`BYPASS_ALL` 和非文件权限，并用现有 SAF URI 工作区彻底替换 `FileSystemTool`。

来源：[ChenKuanSun/mobileClaw 仓库](https://github.com/ChenKuanSun/mobileClaw)、[v1.2.12 发布页](https://github.com/ChenKuanSun/mobileClaw/releases/tag/v1.2.12)、[FileSystemTool 固定提交](https://github.com/ChenKuanSun/mobileClaw/blob/83c66b046fde0a0ffd3ead1514e82c8e8afd41cf/app/src/main/java/ai/affiora/mobileclaw/tools/FileSystemTool.kt)、[AgentRuntime 固定提交](https://github.com/ChenKuanSun/mobileClaw/blob/83c66b046fde0a0ffd3ead1514e82c8e8afd41cf/app/src/main/java/ai/affiora/mobileclaw/agent/AgentRuntime.kt)、[Manifest 固定提交](https://github.com/ChenKuanSun/mobileClaw/blob/83c66b046fde0a0ffd3ead1514e82c8e8afd41cf/app/src/main/AndroidManifest.xml)。

#### 4.4.2 `aohp-os/MobileClaw`：手机执行器，不是手机本地智能体

该项目的公开 README 同时包含“用户下载 Android App”与“开发者运行 Python”的描述，容易造成误解。源码与使用步骤表明其实际架构是：

```text
电脑：Python agent + 记忆/技能/文件工作区 + 两个远程模型
  │
  ├─ ADB/WebSocket 转发
  ▼
Android：APK 无障碍/截图/GUI 命令执行器
```

本次源码审计固定在提交：

```text
1c553fdd606474e7275f9b730f196f6020214c60
```

可确认的事实：

- 官方开发流程要求 `pip install -e .` 后在电脑运行 `mobileclaw config.yaml`；
- Android 设置要求连接 ADB、安装 APK、启用无障碍/通知，并在电脑执行 `adb forward tcp:<device_port> tcp:6666`；
- 规划模型和 GUI computer-use 模型都由 Python 主程序调用；
- `File_Interface` 的根目录来自电脑配置 `root_dir`，文件读写、搜索、记忆和技能均操作电脑工作区；
- Android `WebSocketDevice.push_file()` 与 `pull_file()` 仍是空实现；
- 仓库只提供预编译 APK，没有 Android 工程源码，因此不能审计 APK 内的权限、网络鉴权和真实命令边界；
- 官方明确警告不要控制主力设备，建议使用独立账号。

它不要求 Termux，但这只意味着“把 Linux/Python 放在电脑”，并没有把智能体运行时放入 Android。因此对本需求的判断是**排除**。它最多可作为多手机 GUI 自动化与消息通道的外部控制参考，不应用作学生端本地文件智能体。

来源：[aohp-os/MobileClaw 仓库](https://github.com/aohp-os/MobileClaw)、[APK v0.3.5 发布页](https://github.com/aohp-os/MobileClaw/releases/tag/apk-v0.3.5)。

### 4.5 CellClaw

CellClaw 官网宣称：

- 原生 Android autonomous agent；
- 33 个工具，包含 `file.read`、`file.write`、`file.list`；
- 手机直接连接用户选择的模型 provider，不经过 CellClaw 后端；
- Balanced 策略下读取自动批准，写入、发送和破坏性操作需要确认；
- Apache 2.0。

但官网的 GitHub 链接在 2026-07-24 指向 `github.com/jordanthejet/cellclaw`，访问和 `git ls-remote` 均返回 repository not found。因此这些信息目前只能算官网声明，不能作为可采用源码的证据。

判断：保留观察，不进入 P0 技术选型。

来源：[CellClaw 官网](https://cellclaw.com/)。

### 4.6 官方 OpenClaw Android

官方文档明确写明：

- Android 角色是 companion node；
- Android 不承载 Gateway；
- Gateway 必须运行在 macOS、Linux 或 Windows/WSL2；
- Android 的 workspace 文件浏览通过 Gateway RPC，且是只读。

因此它属于“Android 与远程智能体通讯”的形态，正是本研究要排除的类型。

来源：[OpenClaw Android 官方文档](https://docs.openclaw.ai/platforms/android)。

## 5. 为什么不需要、也不建议 Termux

Termux 路线的优点是能快速获得 shell、Node.js/Python 和现有桌面 agent 工具链，但这些优点对学生端产品并不占主导：

- 增加第二套应用、包管理器和运行环境；
- shell 与全目录访问很难做成适合学生设备的最小权限；
- Android 12+ 的后台进程、phantom process 和省电策略会影响长任务；
- APK 与 Termux 之间的安装、授权、升级和故障排查成本高；
- 很难通过一个清晰的学生端 UI 解释实际操作边界。

原生 Android 已经具备所需基础：

- HTTPS 调用远程模型；
- Kotlin/Java 实现 agent loop；
- SAF 授权目录树；
- `ContentResolver` / `DocumentsContract` 读写文档；
- Room 保存会话与执行回执；
- WorkManager 保存需要可靠恢复的批处理任务；
- 前台可见任务使用协程，必要的长任务使用带通知的前台服务。

Termux 只应保留为开发者实验工具，不应成为学生端运行依赖。

## 6. 文件安全边界：必须用 SAF，而不是所有文件访问

Android 官方推荐使用 Storage Access Framework。用户通过 `ACTION_OPEN_DOCUMENT_TREE` 选择目录后，应用只能访问该目录及其子目录；持久化 URI 授权后，重启应用仍可继续访问。

这正适合“智能体工作区”：

```text
用户选择的目录树 URI
  ├─ 可读取文件
  ├─ 可创建草稿
  ├─ 可在树内移动/重命名
  └─ 不可越出授权树
```

建议明确禁止：

- `MANAGE_EXTERNAL_STORAGE`；
- 任意绝对路径；
- shell 命令；
- 访问 `Android/data`、`Android/obb`；
- 自动扫描整台设备；
- 无提示把整个目录上传给模型。

Android 11+ 还限制通过 SAF 选择内部存储根、可靠 SD 卡根、Download 根、`Android/data` 和 `Android/obb`。因此产品 UI 应提示用户新建并选择专用目录，例如：

```text
Documents/AI教育管家/学生姓名/项目名/
```

来源：[Android Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files)、[Google Play 所有文件访问政策](https://support.google.com/googleplay/android-developer/answer/10467955)。

## 7. 推荐的 AI 教育管家 Android 架构

```text
AgentChat / Task UI
        |
        v
LocalAgentRuntime
  ├─ SessionStore (Room)
  ├─ SkillSelector
  ├─ AgentLoop
  ├─ RemoteModelProvider (HTTPS)
  ├─ ToolPolicyGate
  └─ ExecutionReceiptStore
        |
        v
DocumentTreeWorkspace
  ├─ list_files
  ├─ read_file
  ├─ search_text
  ├─ create_note
  ├─ append_note
  ├─ rename_file
  ├─ move_file
  └─ trash_file
        |
        v
ContentResolver + DocumentsContract + persisted URI grant
```

与现有项目的衔接点：

- 当前 Android 学生端已经使用 `ACTION_OPEN_DOCUMENT_TREE`；
- 已调用 `takePersistableUriPermission` 保存目录授权；
- 已有 `ContentResolver` / `DocumentsContract` 枚举与读取文件的代码；
- 已有后台投递任务、文件稳定性判断、已处理签名和失败重试；
- 现有学生/项目/目标身份可直接写入智能体回执；
- 当前应用仍只是终端，知识治理由 Windows 主机完成，因此新增模块应先定位为“本地工作区助手”，不要在 P0 改写正式知识空间。

这意味着无需重建 Android 文件底座，主要新增的是 agent loop、远程模型适配器、文件工具策略和审计回执。

## 8. P0 工具边界

### 8.1 自动允许

- `list_files(treeUri, relativePath)`
- `read_text(uri, maxBytes)`
- `search_text(query, scope, maxMatches)`
- `get_metadata(uri)`
- `summarize_selected_files`（只发送用户选定文件的受限片段）

### 8.2 预览后确认

- `create_note`
- `append_note`
- `rename_file`
- `move_file`
- `replace_text`

确认卡必须显示：目标文件、修改前摘要、修改后摘要、是否会将内容发送到远程模型。

### 8.3 每次强确认

- 删除；
- 覆盖现有文件；
- 批量修改；
- 把文件全文发送到模型；
- 把本地结果上传到 Windows 主机或其他服务。

删除优先实现为移动到授权树内的 `.trash/`，而非直接调用不可恢复删除。

### 8.4 P0 禁止

- shell/script 执行；
- 无障碍控制其他应用；
- 屏幕录制；
- 相机、麦克风、短信、联系人；
- 任意网络下载并执行；
- 智能体自行扩大目录授权；
- 后台无限循环。

## 9. 远程模型的数据最小化

推荐把一次模型调用拆成三层：

1. 先发送目录中经过截断和脱敏的元数据；
2. 模型提出需要读取的具体文件和范围；
3. ToolPolicyGate 检查授权后，只返回必要片段。

每次外发记录：

- provider、模型、时间；
- taskId、studentId、projectId；
- 文件 URI 的本地不可逆标识；
- 文件名是否外发；
- 发送的字节范围与哈希；
- 是否包含个人信息；
- 用户确认记录；
- 模型返回和最终文件变更的哈希。

API key 应保存在 Android Keystore 保护的凭据存储中；不能写进普通 JSON、日志或回执。

## 10. 后台运行策略

Android 不适合把智能体设计成永远驻留的 daemon。

- 用户正在看任务时：Activity/ViewModel + coroutine 执行 agent loop；
- 用户主动提交的较长任务：前台服务并显示持续通知；
- 可延迟、可恢复的文件整理或索引：WorkManager；
- 任务必须能持久化阶段状态，进程被系统终止后从安全检查点恢复；
- 一次恢复只能继续已经批准的操作，不能把旧确认扩展到新文件或新动作。

WorkManager 适合可靠、可约束、可重试的任务，并能跨应用退出和设备重启恢复；它不是无限驻留 agent 的替代品。Android 12+ 对后台启动前台服务有限制，Android 14+ 对涉及相机、麦克风、位置等 while-in-use 权限的前台服务更严格。

来源：[WorkManager 官方说明](https://developer.android.com/develop/background-work/background-tasks/persistent)、[前台服务后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)。

## 11. 可执行路线图

### P0-A：只读原生智能体验证

目标：证明一个 APK 内可以完成“用户指令 → 远程模型 → 本地文件工具 → 回答”，不依赖 Termux、Windows 主机或远程 Gateway。

实现：

- 新增 OpenAI-compatible provider；
- 新增最小 agent loop，限制 8 轮；
- 接入一个 SAF 授权目录；
- 实现 list/read/search/metadata 四个只读工具；
- Room 保存会话、工具调用和外发片段记录；
- 使用合成文件，不使用真实学生数据。

验收：

- 20 个合成任务全部在授权目录内完成；
- 10 个越界路径测试全部拒绝；
- 单文件、批量文件、空文件、超大文件、无效 URI 都有明确结果；
- 飞行模式/超时/API 失败不会修改文件；
- 没有 `MANAGE_EXTERNAL_STORAGE`、Termux、无障碍或 shell 依赖。

### P0-B：有界写入

实现：

- create/append/rename/move；
- diff/预览/确认卡；
- `.trash/` 软删除；
- 幂等 operationId 与修改前后哈希；
- 失败恢复和撤销。

验收：

- 重试不会重复追加或重复移动；
- 取消确认不产生任何文件变更；
- URI 授权失效时停止并提示重新授权；
- 所有写操作有回执。

### P1：可靠任务与产品集成

实现：

- WorkManager 执行已批准的索引、整理、摘要草稿任务；
- 与现有 studentId/projectId/targetId 绑定；
- 智能体结果先进入“项目工作空间草稿”，不直接晋升为正式知识资产；
- 用户明确提交后，才复用现有上传链路发送到 Windows 主机。

验收：

- 应用退出、重启和网络恢复后任务状态一致；
- 任务回执能追溯到来源 URI、片段哈希和用户确认；
- 共享终端切换学生时清空会话与授权上下文；
- 不把共享项目材料误记为个人成长证据。

### P2：技能与知识协议

实现：

- 支持受限 Markdown 技能定义；
- 技能只能声明已注册工具，不能执行任意代码；
- 与 `Project Workspace` / `Project Knowledge Space` 分层对接；
- 智能体产物保留 `sourcePaths`、draft、confidence 和审核状态。

## 12. 决策清单

建议立即采用：

- 原生 Android APK 内 agent loop；
- 远程 LLM provider；
- SAF 授权目录作为唯一文件边界；
- read 自动、write 预览确认、delete 强确认；
- Room 回执 + WorkManager 恢复；
- 复用现有 Android 学生端文件授权和身份上下文。

建议仅作参考：

- PalmClaw 的 agent loop、文件工具和 workspace resolver；
- `ChenKuanSun/mobileClaw` 的 MIT 原生 agent runtime、远程 provider、确认门和 Keystore 凭据保存；
- X-OmniClaw 的 Kotlin tool registry 与技能加载。
- ApkClaw 的 LangChain4j Android 适配、消息通道和工具注册方式。

明确不采用：

- 官方 OpenClaw Android companion 架构；
- Termux/Linux 模拟环境；
- `MANAGE_EXTERNAL_STORAGE`；
- shell 工具；
- P0 无障碍/录屏/跨应用控制；
- ApkClaw 当前的绝对路径 `send_file`、明文 LAN 配置面和无审批工具直执行；
- `aohp-os/MobileClaw` 的电脑 Python agent + ADB/WebSocket 手机执行端架构；
- `ChenKuanSun/mobileClaw` 当前的 Downloads 直读写、路径前缀校验、`BYPASS_ALL` 和全套手机控制权限；
- 未经确认的整目录外发；
- CellClaw 未恢复公开源码前的直接集成。

## 13. 证据范围与未完成项

本次完成了网页文献核对、PalmClaw、X-OmniClaw、ApkClaw、两个同名 MobileClaw 项目的固定提交源码审计，以及现有 AI 教育管家 Android 源码的 SAF/后台投递能力核对。

本次没有：

- 把候选项目合并进产品；
- 构建或签名新的 AI 教育管家 APK；
- 在真实 Android 设备上进行安装和验收；
- 使用真实学生资料；
- 对 PalmClaw 商业许可证作法律结论。

因此本报告是技术选型与实施路线证据，不是已发布或已通过设备验收的声明。
