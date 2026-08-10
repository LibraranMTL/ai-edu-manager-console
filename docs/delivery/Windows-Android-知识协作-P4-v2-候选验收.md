# Windows—Android 知识协作 P4-v2 候选验收

> **历史快照，不再用于测试。** P4-R 已继续修复 Android 大目录扫描、SAF 大文件上传、手工前台同步和精确重试调度；本文件中的包和哈希仅用于追溯 P4-v2，新的测试入口以 P4-R 验收记录为准。

日期：2026-08-10

基线：Windows 主机端 0.16.8、Android 单机版 1.1.2（versionCode 18）

## 当前结论

P2 协作节点基础和 P3 Windows—Android 双向同步已通过源码审查、协议固定向量、Windows 全量测试、Windows 生产构建和 Android `check`。P4-v2 自动化候选已形成，但尚未完成产品签名 Android APK 与真机矩阵，因此不能转正式版本。

本轮历史质量审查修复了五项真机前阻断问题：

1. Android 学生同步改用学生映射凭据，而不是设备级配对凭据；
2. Windows 在初始化和提交时同时校验目标学生、来源学生和版本谱系，阻止受信设备跨学生写入；
3. 本地删除不再周期性重复发布墓碑，冲突记录使用稳定 ID，杀进程重试不会重复增加记录；
4. Windows 与 Android 均支持稳定分包，5005 条档案对象拆分为 999、999、999、999、999、10 六包，不再触发每包 1000 文件上限；
5. Windows 直传把“学生映射授权”与“设备网络路由”分离，历史队列重试也按包内谱系重新解析授权关系，避免 Windows—Windows 误用设备绑定而被精确学生校验拒绝。

## 自动化结果

- Windows：`pnpm test`，806/806 通过；
- Windows：`pnpm build` 通过；
- Android：`build.ps1 -Task check` 通过，包含 Kotlin 编译、单元测试、Lint、KAPT 和 Room v3 Schema；
- Room：v1→v2 增加学生映射传输关系 ID，v2→v3 增加包物化/确认检查点；
- 候选构建：源代码、staging 和打包产物敏感信息扫描均为 0 项；
- 工作树：`git diff --check` 通过，没有引入空白错误。

## Windows 测试候选

- EXE：`release/windows/candidates/knowledge-collaboration-p4-v2/AI-edu-manager-console-Windows-0.16.8-knowledge-collaboration-p4-v2.exe`
- EXE 大小：90896328 字节
- EXE SHA-256：`9A85E47033EC414FAB9C2759797B8DCC819339962ADA88F12AE3EF32D54FBA8A`
- ZIP：`release/windows/candidates/knowledge-collaboration-p4-v2/AI-edu-manager-console-Windows-0.16.8-knowledge-collaboration-p4-v2.zip`
- ZIP 大小：90903500 字节
- ZIP SHA-256：`8BB2ED7BB2FDC7FBB0403EE1A87E4A27D2801936F0A93E73FC0346AEE20A0EAB`
- 审计：`release/windows/candidates/knowledge-collaboration-p4-v2/AI-edu-manager-console-Windows-0.16.8-knowledge-collaboration-p4-v2-build-audit.json`
- ZIP 内容：仅包含上述 EXE；独立复算哈希与 build audit 一致；Authenticode 为 `NotSigned`。

此前生成的 `knowledge-collaboration-p3-v1` 和 `knowledge-collaboration-p4-v1` 都是修复完成前的阶段快照；P4-v2 也已被 P4-R 替代，以上包均不再作为测试入口。

## Android 构建边界

- Debug APK：`android-standalone-manager/app/build/outputs/apk/debug/app-debug.apk`
- SHA-256：`24B0EFA478E7DEDB5592F675503AD3038D22D3F918E14985DCDD36E66AC13C33`
- 大小：74671716 字节；v1/v2 APK 签名校验通过；签名者为 Android Debug。

该 APK 不能覆盖已安装的产品签名正式版，也不得对外作为候选发布。当前进程未配置 Android 产品签名四项环境变量；应通过既有一键签名流程临时读取长期密钥，生成产品签名候选后再执行真机升级测试。

## 尚待真机完成

- 二维码、六位码、完整连接信息三种 Windows—Android 配对；
- 同一设备多个学生的精确映射、暂停、撤销及重建；
- 已治理知识、成长模型、已发布报告和教育档案双向同步，确认原始资料不发送；
- 5005 个文件、64 MB 单文件和多包积压；
- 局域网中断、断点续传、Android 杀进程、设备重启及 Tailscale 回退；
- 同文件并发修改形成冲突副本，远端删除进入可恢复回收区；
- Windows—Windows 使用映射关系授权、设备关系寻址的双机互传回归；
- 普通 Windows/Android 学生端现有终端连接、课程、上传与报告浏览回归。

以上未全部通过前，P4 保持候选状态。
