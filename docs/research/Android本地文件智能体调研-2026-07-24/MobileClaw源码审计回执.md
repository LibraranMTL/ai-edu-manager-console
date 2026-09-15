# MobileClaw 源码审计回执

> 审计日期：2026-07-24
> 目的：区分同名 MobileClaw 项目，并判断是否满足“Android 本地运行智能体、可处理本地文件、允许远程推理、不依赖 Termux、也不依赖电脑智能体”的要求。

## 1. 审计对象

| 项目 | 固定提交 | 最新公开 release | 许可证 |
|---|---|---|---|
| `ChenKuanSun/mobileClaw` | `83c66b046fde0a0ffd3ead1514e82c8e8afd41cf` | `v1.2.12`，2026-05-09，含 `app-release.apk` | MIT（以 `LICENSE` 为准） |
| `aohp-os/MobileClaw` | `1c553fdd606474e7275f9b730f196f6020214c60` | `apk-v0.3.5`，2026-04-02，含 `MobileClaw.apk` | MIT |

仓库状态是 2026-07-24 的快照，不等于安全认证、商店审核或真机验收。

## 2. 结论

- `ChenKuanSun/mobileClaw`：智能体运行时原生位于 Android APK，远程模型可用，本地推理可选，不依赖 Termux/电脑 Gateway。**架构符合方向，但文件层不满足学生端安全与可用性要求。**
- `aohp-os/MobileClaw`：Python agent、文件工作区、记忆和模型调用位于电脑，Android APK 只是 ADB/WebSocket GUI 执行器。**不符合本地运行时要求。**
- 推荐把前者作为 MIT agent runtime/审批/凭据层参考，不直接合并；文件层应复用 AI 教育管家现有 SAF 授权目录，自行实现。

## 3. `ChenKuanSun/mobileClaw` 审计

### 3.1 符合项

- Kotlin/Jetpack Compose 原生应用，agent loop、tool registry 和 provider 均在 APK 内；
- 支持云端 provider，不要求下载本地模型；
- `AgentRuntime` 剥离模型传入的 `__confirmed`，确认后由运行时内部再注入；
- `files` 的 write/delete 返回 `NeedsConfirmation`；
- `files` 在 UI 风险映射中属于 HIGH；
- token 使用 `EncryptedSharedPreferences` 和 Android Keystore；
- 没有 `MANAGE_EXTERNAL_STORAGE`；
- 实际 `LICENSE` 为 MIT。

### 3.2 文件工具缺口

`FileSystemTool.kt` 实际只有：

```text
list / read / write / delete / info
```

读取上限为 10KB；没有 search、append、edit、move、rename、diff、批量操作。

允许根目录硬编码为：

```text
context.filesDir
context.cacheDir
context.getExternalFilesDir(null)
Environment.DIRECTORY_DOWNLOADS
```

未发现：

```text
ACTION_OPEN_DOCUMENT_TREE
takePersistableUriPermission
DocumentsContract
DocumentFile
```

因此它不是“用户选择并持久授权工作区”的实现。

### 3.3 已发现的安全与产品风险

1. 路径边界使用字符串前缀：

   ```kotlin
   canonical.startsWith(downloadsDir.canonicalPath)
   ```

   缺少分隔符边界，前缀相同的相邻目录可能被误判为允许目录。

2. 公共 Downloads 通过旧式 `File` API 直接访问；在 scoped storage 下不能据此保证任意文件稳定读写。
3. `deleteRecursively()` 可以删除整棵目录；确认预览没有枚举影响文件数。
4. `BYPASS_ALL` 会自动批准全部确认型工具，学生端必须删除或编译期禁用。
5. Manifest 同时声明短信、通话记录、联系人、日历、电话、相机、麦克风、精确闹钟、通知监听、无障碍和开机启动等能力，远超本地文件 P0。
6. 本地推理虽然可选，但 LiteRT-LM 仍作为依赖打入工程，并启用 `largeHeap`/OpenCL 声明。既然产品不需要本地推理，P0 应删除该依赖与设置入口。
7. README 比较表写 Apache 2.0，但仓库 `LICENSE` 与 README 底部写 MIT；采用前应记录这一文档不一致。

### 3.4 测试边界

- release notes 声称 `247 unit tests green`；
- 源码树含 25 个 Kotlin 测试文件；
- 未找到 `FileSystemToolTest` 或针对 Downloads/路径逃逸/递归删除的直接测试；
- 本次执行 `gradlew.bat testDebugUnitTest` 时，当前 Windows 环境没有 Java/JDK，Gradle 在编译前因 `JAVA_HOME` 未设置退出；
- 因此本回执没有宣称上游测试已由本地复现，也没有真机验证 scoped storage 行为。

## 4. `aohp-os/MobileClaw` 审计

### 4.1 实际部署结构

官方 README 要求：

1. 电脑端 `pip install -e .`；
2. 电脑端运行 `mobileclaw config.yaml`；
3. 手机通过 ADB 安装 APK并启用无障碍/通知；
4. 电脑执行 `adb forward tcp:<device_port> tcp:6666`；
5. Python 端配置一个规划模型和一个 GUI computer-use 模型。

源码进一步确认：

- `File_Interface` 使用电脑配置的 `root_dir`；
- 文件 read/search/write/append/edit/delete 和 memory/skills 都是 Python 主机文件；
- `WebSocketDevice.push_file()`、`pull_file()` 是空实现；
- 手机侧主要提供截图、点击、输入、滑动、App 操作等 GUI 命令；
- 仓库只有预编译 APK，没有 Android 工程源码。

### 4.2 判断

- 不需要 Termux，但必须有电脑、Python 和 ADB/WebSocket；
- 本地文件工具处理的是电脑工作区，不是用户在 Android 授权的目录；
- 无法对 APK 内部权限、网络鉴权和执行边界做源码审计；
- 官方警告不要控制主力设备，建议使用隔离账号。

因此它属于“外部智能体控制 Android 执行端”，不进入 AI 教育管家本地文件智能体 P0 候选。

## 5. 建议吸收与拒绝

建议吸收：

- `ChenKuanSun/mobileClaw` 的 agent/tool/provider 分层；
- 模型不能伪造确认标志的运行时设计；
- 写/删确认事件、60 秒默认拒绝和 Keystore token 保存；
- PalmClaw 的搜索、编辑、移动和 workspace 功能覆盖面。

必须重写或删除：

- 用 SAF `content://` URI 工作区替换 `FileSystemTool` 的直接路径；
- 使用 `DocumentsContract`/`ContentResolver` 实现 list/read/search/create/rename/move/delete；
- 删除 `BYPASS_ALL`、LiteRT-LM、本地模型 UI 和非必要手机权限；
- 写入展示 diff，删除展示影响清单，外发展示精确文件/片段；
- 每次操作写入 Room 审计回执并绑定学生/终端/项目身份；
- 不采用 `aohp-os/MobileClaw` 的电脑 agent + ADB 执行端架构。

## 6. 证据链接

- [ChenKuanSun/mobileClaw](https://github.com/ChenKuanSun/mobileClaw)
- [ChenKuanSun/mobileClaw v1.2.12](https://github.com/ChenKuanSun/mobileClaw/releases/tag/v1.2.12)
- [FileSystemTool.kt（固定提交）](https://github.com/ChenKuanSun/mobileClaw/blob/83c66b046fde0a0ffd3ead1514e82c8e8afd41cf/app/src/main/java/ai/affiora/mobileclaw/tools/FileSystemTool.kt)
- [AgentRuntime.kt（固定提交）](https://github.com/ChenKuanSun/mobileClaw/blob/83c66b046fde0a0ffd3ead1514e82c8e8afd41cf/app/src/main/java/ai/affiora/mobileclaw/agent/AgentRuntime.kt)
- [PermissionManager.kt（固定提交）](https://github.com/ChenKuanSun/mobileClaw/blob/83c66b046fde0a0ffd3ead1514e82c8e8afd41cf/app/src/main/java/ai/affiora/mobileclaw/agent/PermissionManager.kt)
- [UserPreferences.kt（固定提交）](https://github.com/ChenKuanSun/mobileClaw/blob/83c66b046fde0a0ffd3ead1514e82c8e8afd41cf/app/src/main/java/ai/affiora/mobileclaw/data/prefs/UserPreferences.kt)
- [AndroidManifest.xml（固定提交）](https://github.com/ChenKuanSun/mobileClaw/blob/83c66b046fde0a0ffd3ead1514e82c8e8afd41cf/app/src/main/AndroidManifest.xml)
- [aohp-os/MobileClaw](https://github.com/aohp-os/MobileClaw)
- [aohp-os/MobileClaw APK v0.3.5](https://github.com/aohp-os/MobileClaw/releases/tag/apk-v0.3.5)
