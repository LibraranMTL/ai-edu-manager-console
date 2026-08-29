# Windows—Android 知识协作 P4-R1 候选验收

日期：2026-08-10

基线：Windows 主机端 0.16.8、Android 单机版 1.1.3（versionCode 19）、Android 学生端 0.6.14（versionCode 84）

候选标签：`knowledge-collaboration-p4-r1`

## 当前结论

P4-R1 已通过源码范围内的自动化门禁并形成隔离候选。它替代 P3-v1、P4-v1 和 P4-v2 作为当前 Windows 测试入口。Android 单机版 1.1.3 已使用长期产品证书正式签名，且包内确认包含本阶段知识协作实现，可直接作为 Android 真机测试包。知识协作整体仍不是正式稳定功能：Windows EXE 没有 Authenticode 签名，Windows—Windows、Windows—Android 真机矩阵尚未完成。

## 本轮质量加固

1. Room 升级到 v4，新增按学生、同步范围和相对路径保存的增量文件清单；大小、修改时间与复核时效一致时复用 SHA-256，SAF 无可靠修改时间时仍重新校验。
2. Android 单个同步范围支持最多 20000 个文本文件，扫描使用上限加一判断；超限或单文件超过 64 MB 时明确失败，不静默遗漏。
3. 大文件上传只打开一次 SAF 输入流，从服务端断点位置开始连续读取 1 MB 分块，并要求服务端严格返回下一偏移量。
4. 用户点击“立即同步”时进入 `dataSync` 前台 Worker；后台恢复仍使用普通 WorkManager。任务按批处理并在退出前读取 Room 最早重试时间，精确安排续跑。
5. Windows 将精确学生映射授权与设备网络路由分开，并以行为测试覆盖撤销、错误参与者、错误谱系和不可用密钥。
6. 候选构建审计增加 Git 提交、分支、工作树状态、变更路径数量和状态摘要哈希，防止把脏工作树候选误认为可复现正式版本。

## 自动化门禁

- Windows 候选构建时全量测试：`810/810` 通过；在补充 Android 1.1.3 真机验收入口和专项合同后，当前源码全量回归为 `818/818` 通过；
- Windows 生产构建：`pnpm build` 通过；
- Android：`build.ps1 -Task check` 通过，包含 Kotlin 编译、单元测试、Lint、KAPT 和 Room v4 Schema；
- Android 前台 Worker Manifest：已覆盖 WorkManager `SystemForegroundService` 的 `dataSync` 类型，Lint 通过；
- 工作树格式：`git diff --check` 通过，仅报告既有换行转换提示；
- 候选敏感信息扫描：源码 158 个文件、暂存运行时 193 个文件、打包产物 2 个文件，均为 0 项。

## Windows 测试候选

- EXE：[AI-edu-manager-console-Windows-0.16.8-knowledge-collaboration-p4-r1.exe](../../release/windows/candidates/knowledge-collaboration-p4-r1/AI-edu-manager-console-Windows-0.16.8-knowledge-collaboration-p4-r1.exe)
- EXE 大小：90897384 字节
- EXE SHA-256：`09A8EE8B0F6F283D49EE05FBC997FB7F48D5F2C951DBBD7182E8AE18BB9D28D3`
- ZIP：[AI-edu-manager-console-Windows-0.16.8-knowledge-collaboration-p4-r1.zip](../../release/windows/candidates/knowledge-collaboration-p4-r1/AI-edu-manager-console-Windows-0.16.8-knowledge-collaboration-p4-r1.zip)
- ZIP 大小：90904544 字节
- ZIP SHA-256：`B5C9FECFB614E80F425E81C20D58041BA5417AD318C9BF79A9AE7C5910129B95`
- ZIP 条目：仅上述 EXE；独立复算哈希与 build audit 一致；Authenticode 状态为 `NotSigned`。
- 审计：[build-audit.json](../../release/windows/candidates/knowledge-collaboration-p4-r1/AI-edu-manager-console-Windows-0.16.8-knowledge-collaboration-p4-r1-build-audit.json)

构建时源码状态为提交 `126b6ec4c98cf4857381a106edf1caac4cf31398`、分支 `release/windows-0.6.5-cleanup`、工作树 `dirty=true`、105 个状态路径，状态摘要 SHA-256 为 `AECF51F032D914DCE651FF40B665ACAD97C465B9EDEA088EAA734A1B90918BD0`。因此该包只可作为当前工作树快照测试，不可视为已提交、可复现的正式发布来源。

## Android 产品签名测试包

- APK：[AI-Education-Manager-Android-Standalone-1.1.3-release.apk](../../android-standalone-manager/delivery/AI-Education-Manager-Android-Standalone-1.1.3-release.apk)
- 包名：`com.qxmatrix.edumanager.standalone`
- 版本：`1.1.3`（versionCode 19）
- 大小：68510161 字节
- SHA-256：`1F87751B641778B6C2A7B25A3217E1E6BB1274A52AB47E024D94B241FAE26C1B`
- 产品证书 SHA-256：`647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F`
- APK 签名：v1、v2 验证通过。

通过 APK 结构检查确认存在 `CollaborationActivity`、`CollaborationQrScannerActivity`、Room `CollaborationDatabase`、`CollaborationRecoveryWorker`，Manifest 同时注册知识协作入口和 WorkManager `SystemForegroundService` 的 `dataSync` 类型。该 APK 本身是 1.1.3 正式签名包；其中知识协作能力在本验收矩阵完成前仍按候选功能使用。

Android 学生端回归使用 `AI-edu-manager-tablet-terminal-0.6.14.apk`：版本 `0.6.14`（versionCode 84），SHA-256 `2A17CA6A977D4D6803AA2884CAB406E3ECF89EE57CBA51075ECCBD438AA0F427`，v1/v2/v3 签名验证通过。普通学生端不注册为知识协作节点。

## 实体平板验收入口

使用以下命令启动产品签名、真实设备、安装版本、冷启动和 P4 专项结构检查：

```powershell
powershell -ExecutionPolicy Bypass -File android-standalone-manager\verify-physical-device.ps1 `
  -ApkPath android-standalone-manager\delivery\AI-Education-Manager-Android-Standalone-1.1.3-release.apk `
  -DeviceSerial <实体平板序列号> `
  -KnowledgeCollaboration
```

脚本拒绝模拟器、Android Debug 证书、低于 1.1.3 的版本和缺少知识协作组件的 APK；安装冷启动后生成 `physical-acceptance.json`，其中包含本文件下方真机矩阵的逐项状态和证据位置。2026-08-10 本机执行入口检查时 ADB 就绪实体设备为 0 台，因此没有安装 APK，也没有把任何真机项目标记为通过。

## 尚待真机完成

- 二维码、六位码和粘贴完整连接信息三种 Windows—Android 配对；
- 同一设备多学生精确映射、暂停、撤销和重建；
- 已治理知识、成长模型、已发布学情报告和教育档案双向同步，确认原始资料不发送；
- 5005 文件、多包积压、接近 20000 文件边界以及 64 MB 单文件断点传输；
- 局域网中断、Android 杀进程、设备重启及 Tailscale 回退；
- 并发修改形成冲突副本，远端删除进入可恢复回收区；
- Windows—Windows 映射授权与设备寻址双机回归；
- 普通 Windows/Android 学生端现有终端连接、课程、上传和报告浏览回归。

以上真机项目没有全部通过前，P4-R1 知识协作保持候选状态，不转为正式稳定功能。按用户安排，P3/P4 真机验收延后，开发继续进入 P5 Android—Android 源码阶段；这不表示 P3/P4 真机门禁已通过，也不改变本候选包的验收结论。
