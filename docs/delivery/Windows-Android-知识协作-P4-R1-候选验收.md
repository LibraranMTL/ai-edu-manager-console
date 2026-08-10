# Windows—Android 知识协作 P4-R1 候选验收

日期：2026-08-10

基线：Windows 主机端 0.16.8、Android 单机版 1.1.2（versionCode 18）

候选标签：`knowledge-collaboration-p4-r1`

## 当前结论

P4-R1 已通过源码范围内的自动化门禁并形成隔离候选。它替代 P3-v1、P4-v1 和 P4-v2 作为当前测试入口，但仍不是正式版本：Windows EXE 没有 Authenticode 签名；Android 只有 Debug 构建；Windows—Android 产品签名升级与真机矩阵尚未完成。

## 本轮质量加固

1. Room 升级到 v4，新增按学生、同步范围和相对路径保存的增量文件清单；大小、修改时间与复核时效一致时复用 SHA-256，SAF 无可靠修改时间时仍重新校验。
2. Android 单个同步范围支持最多 20000 个文本文件，扫描使用上限加一判断；超限或单文件超过 64 MB 时明确失败，不静默遗漏。
3. 大文件上传只打开一次 SAF 输入流，从服务端断点位置开始连续读取 1 MB 分块，并要求服务端严格返回下一偏移量。
4. 用户点击“立即同步”时进入 `dataSync` 前台 Worker；后台恢复仍使用普通 WorkManager。任务按批处理并在退出前读取 Room 最早重试时间，精确安排续跑。
5. Windows 将精确学生映射授权与设备网络路由分开，并以行为测试覆盖撤销、错误参与者、错误谱系和不可用密钥。
6. 候选构建审计增加 Git 提交、分支、工作树状态、变更路径数量和状态摘要哈希，防止把脏工作树候选误认为可复现正式版本。

## 自动化门禁

- Windows 全量测试：`810/810` 通过；
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

## Android 构建边界

- Debug APK：`android-standalone-manager/app/build/outputs/apk/debug/app-debug.apk`
- 大小：74688102 字节
- SHA-256：`8B38A7D86688D1EB7F7037A5BD1795EFC0720BC5D92F1FB5DB5AB487E5505C3D`
- APK 签名：v1、v2 验证通过；签名者 `C=US, O=Android, CN=Android Debug`。

该 APK 不能覆盖已安装的产品签名正式版，也不得作为用户候选。真机升级验收必须使用既有一键签名流程临时读取长期产品密钥生成对应 1.1.2 候选；不得保存或回显密钥和密码。

## 尚待真机完成

- 二维码、六位码和粘贴完整连接信息三种 Windows—Android 配对；
- 同一设备多学生精确映射、暂停、撤销和重建；
- 已治理知识、成长模型、已发布学情报告和教育档案双向同步，确认原始资料不发送；
- 5005 文件、多包积压、接近 20000 文件边界以及 64 MB 单文件断点传输；
- 局域网中断、Android 杀进程、设备重启及 Tailscale 回退；
- 并发修改形成冲突副本，远端删除进入可恢复回收区；
- Windows—Windows 映射授权与设备寻址双机回归；
- 普通 Windows/Android 学生端现有终端连接、课程、上传和报告浏览回归。

以上项目与产品签名候选没有全部通过前，P4-R1 保持候选状态，不转正式版本，也不进入 P5 Android—Android 开发。
