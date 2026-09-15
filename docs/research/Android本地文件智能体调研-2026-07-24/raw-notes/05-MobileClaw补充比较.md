# MobileClaw 补充比较原始笔记

日期：2026-07-24

## 名称消歧

本次至少发现两个不同项目：

1. `aohp-os/MobileClaw`（旧组织链接可能重定向）；
2. `ChenKuanSun/mobileClaw`。

不能把两者的“原生 Android”“无服务器”“文件工具”等描述混合引用。

## `aohp-os/MobileClaw`

- 固定提交：`1c553fdd606474e7275f9b730f196f6020214c60`
- MIT
- GitHub API 快照：181 stars、16 forks
- 最新 release：`apk-v0.3.5`，2026-04-02
- README：电脑 `pip install -e .`、运行 `mobileclaw config.yaml`
- 手机：ADB 安装 APK，启用无障碍/通知
- 电脑：`adb forward tcp:<device_port> tcp:6666`
- 两模型：foundation model + GUI computer-use model
- Python `File_Interface` 操作电脑 `root_dir`
- `push_file()`/`pull_file()` 未实现
- 只有 APK 二进制，无 Android 源码
- 官方警告：不要在主设备使用，使用隔离账号

结论：不是 Android 本地 agent runtime。

## `ChenKuanSun/mobileClaw`

- 固定提交：`83c66b046fde0a0ffd3ead1514e82c8e8afd41cf`
- GitHub `LICENSE`：MIT
- README 比较表误写 Apache 2.0，底部写 MIT
- GitHub API 快照：36 stars、4 forks
- 最新 release：`v1.2.12`，2026-05-09
- Kotlin/Compose，`minSdk 29`、`targetSdk 34`
- agent/provider/tool 都在 APK
- 支持远程 provider；LiteRT-LM/Gemma 可选
- 29 个 Android 工具
- token 使用 EncryptedSharedPreferences + Android Keystore
- `__confirmed` 会从模型参数剥离
- write/delete 需要确认；files=HIGH risk；默认超时 60 秒
- `BYPASS_ALL` 必须从学生版移除

### FileSystemTool

- list/read/write/delete/info
- read max 10KB
- roots：filesDir/cacheDir/externalFilesDir/Downloads
- no SAF tree
- no DocumentsContract/DocumentFile
- no FileSystemTool direct test
- path boundary bug：`canonical.startsWith(root.canonicalPath)`
- public Downloads direct File access unreliable under scoped storage
- deleteRecursively high risk

### 本地验证

执行：

```text
gradlew.bat testDebugUnitTest --no-daemon --console=plain
```

结果：

```text
ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
```

没有进入编译/测试阶段。不能把 release notes 的 247 tests green 当成本次复测。

## 比较定位

1. `ChenKuanSun/mobileClaw`：最佳 MIT 原生 runtime 参考，但 SAF 文件层必须重写。
2. PalmClaw：文件能力最完整，但许可和所有文件访问阻碍直接采用。
3. ApkClaw：GUI 自动化参考，文件能力弱且权限/配置风险高。
4. `aohp-os/MobileClaw`：电脑 agent + 手机执行器，排除。
