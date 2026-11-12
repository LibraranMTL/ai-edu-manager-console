# Android 单机版 1.3.7 学情工作台候选交付记录

日期：2026-11-12  
分支：`codex/android-standalone-workbench-20261111`  
功能提交：`d9d500214a53c3d93fa3d36c2f8bf6e8609bce76`

## 状态结论

- `source_complete`：通过。自动化恢复、学情/项目投影、四菜单工作台、课程/公共学习卡消费、安卓激活免码建档和显式上传授权已进入隔离源码提交。
- `automated_verified`：通过。Android JVM 测试、Lint、R8 发布构建，云端 57 项测试及跨端合同 42 项测试通过；候选构建关闭故障注入并绑定候选云。
- `candidate`：通过。正式产品证书签名 APK 与云端 `2.3.0-candidate.2` 已形成。
- `device_smoke_verified`：通过。TAS-AL00 覆盖安装、版本、启动、四菜单、设置和原激活保留通过。
- `device_verified`：未授予。设备当前没有学生档案，未在本候选上重复创建人工数据并执行学生资料、项目资料和显式云上传三条真实业务链。
- `released`：否。本记录是候选交付，不更新正式下载清单。

## Android 候选

- APK：`D:\AndroidCandidates\standalone-workbench-1.3.7-20261112-r2\AI-Education-Manager-Android-Standalone-1.3.7-workbench-candidate-r2.apk`
- 包名：`com.qxmatrix.edumanager.standalone`
- 版本：`1.3.7 / 41`
- SHA-256：`6018FB8E2E1657F144B5340D5EE4C402D95CAF5A7F886B716005020EFEA58CC1`
- 签名证书 SHA-256：`647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F`
- 签名：APK v1、v2 通过；未启用 v3/v4，与当前产品签名链保持一致。
- 云端地址：`https://www.greatbg.com/edu-cloud-candidate`
- `FAULT_HARNESS=false`；源码树在构建时为干净状态。
- 元数据、源码文件哈希和真机截图/XML 位于候选目录。

真机：`TAS-AL00 / 88Y0219B28005238`。使用 `adb install -r` 覆盖安装成功；`dumpsys package` 返回 `versionName=1.3.7`、`versionCode=41`，进程启动成功。界面证据确认“学情工作台”以及“收集整理、教育档案、学习行动、项目成果”四菜单；设置中的自动处理、备份恢复、产品授权、版本更新、连接测试和任务回执仍可达。原产品授权显示已激活、永久有效，覆盖升级未清空授权。

## 云端候选

- ECS：`i-m5e6r68cl11nbh2y0o6z`，`cn-qingdao`
- 候选归档：`release/cloud/candidates/android-standalone-entitlement-20261112-r2/edu-cloud-documents-android-standalone-entitlement-20261112-r2.tar.gz`
- 归档 SHA-256：`840DC70F241B8E33E55F44CF6B44BAB534E7FB70B0179812831253D75A47221F`
- 清单 SHA-256：`E1A59E5B05B1E8CD23B28393DC8405931BAE4EE7DB1B22FE9E3D1586DD22152F`
- 当前目录：`/opt/edu-cloud-documents-candidate/releases/android-standalone-entitlement-20261112-r2`
- 公网健康接口：`https://www.greatbg.com/edu-cloud-candidate/health`
- 健康版本：`2.3.0-candidate.2`；Schema、公共内容签名和学习卡迁移均就绪。
- 公共清单严格 HTTPS 返回 200，包含 4 门课程；`/v2/source-auto-enroll` 路由存在，无效空请求返回 400 而非 404。
- 数据/配置备份：`/var/backups/edu-cloud-documents-candidate/deploy-android-entitlement-20261112-r1`
- r1 废弃暂存和 r2 已验证暂存均已清理；旧候选 release 与备份保留，可回滚。

## HTTPS 证书修复

旧 RapidSSL 证书于 2026-11-10 到期。已为 `www.greatbg.com` 签发并部署 Let’s Encrypt 证书：

- 颁发者：`Let's Encrypt YR1`
- 序列号：`05C2FDA14903FB9012BC48EE9C6BB9D56446`
- 有效期：2026-11-12 至 2027-02-10
- SAN：`DNS:www.greatbg.com`
- 证书与私钥公钥匹配，服务链包含叶证书和两级中间链。
- Apache 配置检查通过并使用 graceful 平滑加载；PowerShell、Node 和服务器端严格 TLS 请求均通过，未使用跳过证书校验的方式验收。
- Apache/旧证书备份：`/var/backups/greatbg-letsencrypt-20261112-r1`
- 本机私密备份：`C:\Users\bxw00\AppData\Local\AI-Education-Manager\certificates\www.greatbg.com\20261112`，ACL 仅当前用户、SYSTEM 和 Administrators 可访问。

ECS 到 Let’s Encrypt ACME 接口的 POST 请求持续超时，宝塔 ACME 与系统 Certbot 均无法在服务器内完成签发；本次改为本机 ACME、远端 HTTP-01 挑战和受控上传。Apache 已保留 `/.well-known/acme-challenge/` 的 HTTP 例外，但在修复 ECS ACME POST 出站前，下一次续期仍需走相同受控流程，不能宣称服务器自动续期已完成。

## 人工体验入口与剩余发布门

候选可直接用于日常人工体验。正式授予 `device_verified` 前，在测试学生范围内完成：

1. 建立或接管一个测试学生，导入一份学生图片/文档，核对 OCR/解析、消化、知识、报告、首页投影和来源。
2. 新建或选择一个测试项目，导入项目资料，核对项目知识、项目进展和综合报告。
3. 从专家入口进入授权预览，确认“激活不等于上传授权”；选择范围后验证候选云回执和撤权停止上传。
4. 同步云端课程/公共学习卡，核对 4 门课程、卡片实例和个人作答隔离。

这些是候选人工业务验收，不是剩余源码开发。未完成上述真实数据验证前，不把冒烟安装、构建日志或公网健康接口等同于正式发布。
