# Android 单机版 1.3.7 工作台修订版发布记录

- 发布日期：2026-11-15（北京时间）。版本 1.3.7 / code 41，包名 `com.qxmatrix.edumanager.standalone`。正式发布使用通过真机复测的 r2 原始 APK。
- APK 69,143,783 字节。SHA-256 `E48359341A8FCD1082AD6965C2638C0E5771D2C0CC4CD49B8DCA93F5BEFBAEF8`。正式证书 v1、v2 均通过，证书 SHA-256 `647087c196380bed06ff285a95b29617dc5a31c4977a0c04ddba895adc67164f`。手机覆盖安装后 `base.apk` 哈希一致。
- 构建基线 `2c761f7c964343cf976ee9519a6afa56be48118a`，合入本记录所在提交中的安卓单机版源码改动。发布前逐一核对 r2 构建时记录的 267 个输入文件哈希。分支随后快进至 `c9feaa4`，未改动 r2 的构建输入。
- 自然后台投递：TAS-AL00 在 13:20:14 返回桌面后放入合成资料，未点击“立即检查”，也未强制运行系统任务。13:20:32 观察到首次 WorkManager 成功回执，文件尚未归档。13:35:33 测试学生原始资料库中生成副本，13:35:34 同一 `StandaloneAutoDeliveryWorker` 自然执行成功。原件与唯一的归档副本均保留，SHA-256 一致，为 `71E90B98EDFB2C3127F3902ED61059C950285E39F8113DF2C349DB8B71842A19`。检查完成后已关闭测试规则。
- 其他真机验收：r1 核对了单文件和多文件系统分享、取消后补选、学生与项目归属隔离、菜单折叠和详情弹窗。r2 复测等候稳定、后续投递和展开/收起无障碍描述。无障碍验证基于系统界面树，未做 TalkBack 语音试听。同设备导航样本的卡顿帧比例从旧正式版 20.00% 降到 r1 的 12.82%，p95 从 1250 ms 降至 28 ms，该单轮结果不代表所有机型。
- [正式 APK](https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.3.7-workbench-r2.apk) · [产品下载页](https://www.greatbg.com/education/download.html) · [操作手册](https://www.greatbg.com/education/android-standalone-manual.html)。两处现网清单均指向 r2。已装上一批 1.3.7 时需从下载页手动覆盖安装，版本号相同的安装不会触发应用内更新提示。
- ECS `i-m5e6r68cl11nbh2y0o6z`（青岛）。站点根目录 `/www/wwwroot/123.56.83.50`。发布前保留原 APK，备份位置 `/var/backups/standalone-137-workbench-r2-20261115`，包括两处清单、下载页和操作手册。回滚时从该备份恢复四个文件，并核对旧 APK 链接。
- 校验：阿里云文件 SHA-256、服务器本地 HTTPS、外部公网下载页、手册及两个清单的 HTTP 200 和响应体哈希均通过。公网 APK 响应为 HTTP 200 和 69,143,783 字节，HTTPS Range 首尾各 8192 字节与签名候选一致。保留 Windows 主机 0.23.8、Windows 学生端 0.18.10、Android 学生端 0.6.34、教师端 0.1.5 现有下载入口及清单字段。已核对回滚文件哈希并清理服务器临时投递目录。
