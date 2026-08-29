# Android—Android 知识协作 P5-R 候选验收

日期：2026-08-10

基线：Windows 主机端 0.16.8、Android 单机版已发布版本 1.1.3、Android 学生端 0.6.14。

## 当前结论

P5 及补充加固 P5-R 已完成源码和自动化质量门，并已生成 Android 单机版 `1.1.4 / versionCode 20` 产品签名候选 APK。当前没有执行两台 Android 真机互联；因此本记录证明候选包已可安装验收，不证明真机矩阵或正式发布已通过。

## 已实现范围

1. 用户在“知识协作”中主动开启或停止附近接收服务；服务以前台持续通知运行，应用进程被系统回收后不会擅自自动常驻。
2. 同一 Wi-Fi、热点或既有 Tailscale 网络可发现 Android 单机版节点；支持二维码、六位临时码和完整连接信息，不使用蓝牙、Wi-Fi Direct 或云中继。
3. 设备配对采用十五分钟邀请、随机请求令牌、共享证明和请求签名；请求令牌经 Android Keystore 加密保存，接收端校验时间、nonce、防重放、正文哈希和设备身份。
4. 共享学生必须由双方人工选择精确学生，不按姓名推断；设备信任和学生映射分层，一台可信设备可建立多个独立学生映射。
5. 传输复用四类治理成果、版本清单、SHA-256、分块续传、Room 检查点、冲突副本、可恢复删除和非传递修订。原始资料、草稿、绝对路径、SAF URI、Token、License 和密钥不进入协作包。
6. 普通 Android 学生端继续使用现有主机连接，未注册附近接收服务或知识节点能力。
7. 配对连续失败最多五次，按来源地址递增冷却；防重放 nonce 持久化、过期清理并限定为最多 512 条。
8. 未完成接收暂存最多保留七天，总暂存上限 4 GB，写入前预留 512 MB 空间；设备撤销时清理其未完成暂存，不删除已治理归档。
9. 界面固定为“协作设备、共享学生、同步异常”三区；设备状态和单个学生共享状态分离，可分别暂停、恢复和解除，解除不删除本地档案。
10. 附近接收启动和反向同步排队不再预设成功；界面只在端口实际监听后显示运行中，启动、存储或回传失败会保留可操作的原因。

## 自动化证据

- Android 单机版 `build.ps1 -Task check`：通过，包括 Kotlin/Java 编译、单元测试和 Lint。
- P5/P5-R 专项 Node 契约：`12/12` 通过。
- 仓库全量自动测试：`830/830` 通过。
- Windows 主机端 Web 生产构建 `pnpm build`：通过，但本阶段没有重打 Windows 安装包。
- Android 6 / API 23 兼容修正：过期 nonce 不使用 API 24 `removeIf`；通知构建器按 API 26 分支创建。

## 候选包

- APK：[AI-Education-Manager-Android-Standalone-1.1.4-knowledge-collaboration-p5-r1.apk](../../android-standalone-manager/delivery/candidates/knowledge-collaboration-p5-r1/AI-Education-Manager-Android-Standalone-1.1.4-knowledge-collaboration-p5-r1.apk)
- 包名：`com.qxmatrix.edumanager.standalone`
- 版本：`1.1.4`（versionCode `20`）
- 大小：`68,559,348` 字节
- SHA-256：`722F3F775D447B95B8C7360EC1B1A36A0A0036F5EDF5E2BBAEE27082ED870389`
- 产品证书 SHA-256：`647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F`，与 1.1.3 正式版一致，无 Android Debug 证书。
- 签名：v1/v2 通过；候选元数据标记 `releaseStatus: candidate`。
- 包内结构：已独立复核 `CollaborationActivity`、`CollaborationQrScannerActivity`、`CollaborationNearbyService`、`CollaborationDatabase` 和 `CollaborationRecoveryWorker`。

## 延后真机门禁

- 两台不同品牌 Android 单机版同一 Wi-Fi 发现、扫码和六位码配对；
- 一台设备开启热点时的发现、连接和双向同步；
- 双方轮流点击“立即同步”，验证精确学生、四类成果和非传递修订；
- 大文件分块、网络中断、续传、杀进程和设备重启；
- 并发修改生成冲突副本，远端删除进入可恢复回收区；
- 普通 Android 学生端 0.6.14 不出现知识节点入口且现有连接、课程、上传和报告功能正常。

真机脚本已增加 P5 包内接收服务检查，以及 Android—Android 的持续通知、Wi-Fi/热点、五次配对保护、反向排队和暂存边界待验收项。

以上项目在真机留证完成前全部保持未通过，P5 不进入正式发布。
