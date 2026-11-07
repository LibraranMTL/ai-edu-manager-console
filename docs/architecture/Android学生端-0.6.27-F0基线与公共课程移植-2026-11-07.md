# Android 学生端 0.6.27 F0 基线与公共课程移植

## 1. 冻结基线

- 产品：Android 学生端
- 包名：`com.qxmatrix.eduterminal`
- 正式版本：`0.6.27`
- `versionCode`：`97`
- 源码基线提交：`88430861f31189d050e01bec55afaefe1a3b2861`
- 正式 APK：`release/tablet-terminal/candidates/project-report-readonly-dialog-r1-20261103/AI-edu-manager-tablet-terminal-0.6.27.apk`
- APK 字节数：`1913832`
- APK SHA-256：`F0A29D9B8F952FA021872F871A91D9E92CA56319E5A302EAE00E2DE31B113EF7`
- 签名证书 SHA-256：`42FF27472C21FD214C17A9DFB153DA0454489D4E2AD70CE823F3369118A5F1CB`
- 签名方案：v1、v2、v3 均通过

公开下载清单与本地留档使用同一 SHA-256。仓库既有学生端 keystore 的证书指纹与正式 APK 一致，可继续用于覆盖升级。

此前 `D:/AndroidCandidates/0.6.27-public-course-manual-test-20261106-r1` 中 SHA-256 为 `8AB27A63F053C68C5A71CF6A8D7E17AA55760B5C211E17F679F335B977792ACE` 的 APK 不属于本基线，不再作为公共课程候选。

## 2. 移植边界

只从公共课程实施分支移植以下能力：

- 学生课程投影 v2；
- `hostId + studentId` 缓存隔离；
- ETag/304；
- 打开前授权与撤回复核；
- 在线/离线租约；
- 发布者双信任；
- HTTPS 课程入口；
- 升级签名证书连续性门禁。

不覆盖 0.6.27 已有的四入口、只读 Markdown 弹窗、项目综合报告、学情档案、导入对话、学习状态和知识增长图能力。

## 3. 目标候选

- 目标版本：`0.6.28`
- 目标 `versionCode`：`98`
- 构建状态必须依次标记为 `candidate`、`device_verified`、`released`；源码测试不得替代覆盖安装与真机验收。
