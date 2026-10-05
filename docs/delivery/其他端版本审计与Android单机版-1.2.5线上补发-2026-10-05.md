# 其他端版本审计与 Android 单机版 1.2.5 线上补发

日期：2026-10-05
目标服务器：阿里云 ECS `i-m5e6r68cl11nbh2y0o6z`（实例名 `iZm5e6r68cl11nbh2y0o6zZ`，青岛）
站点根目录：`/www/wwwroot/123.56.83.50`

## 1. 审计结论

| 产品端 | 当前公开正式版 | 本地更高版本 | 本次处理 |
| --- | --- | --- | --- |
| Windows 主机端 | 0.19.6 | 无更高正式包 | 保持稳定版，公开链接复核通过 |
| Windows 学生端 | 0.16.10 | 0.18.6 候选 | 未完成跨设备与覆盖安装验收，不晋升 |
| Android 学生端 | 0.6.16 | 0.6.19 候选 | 未完成真机、跨端与覆盖安装验收，不晋升 |
| Android 教师端 | 0.1.1 | 0.1.4 候选 | 未完成真机、跨端与覆盖安装验收，不晋升 |
| Android 单机版 | 1.2.5 / code 29 | 1.2.8 候选 | 1.2.5 的本地发布元数据为 `release` 且使用产品长期证书；修复官网仍停在 1.2.2 的漏同步并正式补发 1.2.5 |
| 旧 Android 控制台 | 0.2.3，仅内部 | 无可信公网发布包 | 原清单 URL 返回 404，仓库中未找到可核验 APK；保留版本字段，将状态改为 `internal`，清空公网 URL，不用其他 APK 顶替 |

Android 单机版 1.2.8 虽已用产品证书签名，但候选元数据明确记录 `physicalDeviceAcceptancePassed: false`、`upgradeInstalledOnDevice: false`、`cloudServiceDeployed: false`、`published: false`，因此未上传、未改成正式版。其余三端 2026-10-02 候选记录也明确为仅本地候选，未完成真实跨端、覆盖安装和旧主机兼容验收。

## 2. Android 单机版 1.2.5 正式包

- 文件：`AI-Education-Manager-Android-Standalone-1.2.5-release.apk`
- 包名：`com.qxmatrix.edumanager.standalone`
- 版本：1.2.5 / code 29
- 字节：68,641,445
- SHA-256：`DB7332D62B5B94FEB542035D2A2A051C6CB71D015EE22C598B9E3AA2B442284D`
- 签名：v1、v2 通过；v3/v4 未使用
- 证书 SHA-256：`647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F`
- 发布元数据：`releaseStatus: release`

本版完善成长证据审核、报告选择与证据回退，并改进报告打印准备和最近输出记录。任务 Agent 未配置、超时或返回异常时，仍可按已确认成长证据原文和证据编号生成可核对的报告。

## 3. 正式下载文件核对

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `AI-edu-manager-console-Windows-0.19.6.exe` | 98,954,616 | `842B038021EF865485566667E89EC3D7FDE1F43AB134104FA81C794AF62FFC80` |
| `AI-edu-manager-console-Windows-0.19.6.zip` | 98,965,220 | `EFFF5709B7DFF8559296CE4D8870710A2FCCBAD7D7637BCCF155CBCFBC46415C` |
| `AI-edu-manager-student-terminal-Windows-0.16.10.exe` | 85,546,976 | `796933FECFA8A4B707EB69FFC847952213AE087BEFD48EAA711AE323B8C52DDA` |
| `AI-edu-manager-tablet-terminal-0.6.16.apk` | 1,823,720 | `9D2E961428E3B26D1B8D87BB529D7F46F6D2C3B43E4C8FFF0A5C649DAE4B7301` |
| `AI-edu-manager-teacher-terminal-0.1.1.apk` | 1,819,705 | `53599B3F08B71A2E11D28E03A45F49BA7A9D5B3B7D09450B6FC49BB6CC2D2F56` |
| `AI-Education-Manager-Android-Standalone-1.2.5-release.apk` | 68,641,445 | `DB7332D62B5B94FEB542035D2A2A051C6CB71D015EE22C598B9E3AA2B442284D` |

本地 `release/download/` 已补齐上述当前正式下载文件副本；网站、Windows 包内和下载目录中的版本清单已对齐。Windows 学生端清单仍保留源码候选版本 `0.18.6 / candidate`，但公开下载 URL 继续指向正式版 0.16.10，避免把候选包误晋升。

## 4. 网站与服务器发布

发布前备份：`/www/backup/ai-edu-other-ends-20261005-134904/`

采用独立暂存目录上传并校验，先原子切换 APK 与其校验文件，再切换手册、下载页，最后切换 `/education/` 与 `/download/` 两份版本清单。未重启服务、未修改 Nginx 配置。

| 线上文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `education/download.html` | 10,095 | `7435524427DA28E0FC84A9007F54D333535AC687FA275083CAE711A5579D11DD` |
| `education/android-standalone-manual.html` | 31,185 | `34D34CCF192435B0884E7C9766A0078C425B2BFB13BDB8A988D0EDBBB33ABD40` |
| `education/edu-manager-version.json` | 2,088 | `337C09C767FA80C93C930BC5DD51BAAE1B9FC0C76EB1C0BDCAF13DDE4A2C7128` |
| `download/edu-manager-version.json` | 2,088 | `337C09C767FA80C93C930BC5DD51BAAE1B9FC0C76EB1C0BDCAF13DDE4A2C7128` |
| `download/AI-Education-Manager-Android-Standalone-1.2.5-release.apk` | 68,641,445 | `DB7332D62B5B94FEB542035D2A2A051C6CB71D015EE22C598B9E3AA2B442284D` |
| 对应发布 JSON | 687 | `9135B4C530B422539B2A7D2C7E2590444998C6B2F334E8898D8133EBF1852649` |
| 对应 SHA 文件 | 124 | `D9E9C1B4E232B0D79A805546F365196C8E675C764F367BC40FC5D3C05DE17A9A` |

公网正文哈希与服务器实文件一致；APK `HEAD` 返回 200、`Content-Length: 68641445`、`Content-Type: application/vnd.android.package-archive`。Windows 主机、Windows 学生端、Android 学生端和 Android 教师端现有正式下载链接也均返回 200 且长度匹配。

初次回环检查使用 HTTP 虚拟主机地址时得到重定向/空响应，导致 JSON 解析失败；服务器实文件已成功切换，随后改用正式 HTTPS 域名完成正文哈希校验。该现象不作为发布失败，也未通过忽略错误来冒充回环通过。

## 5. 自动检查与发布边界

- `node --check scripts/sync-windows-host-web-manual.cjs`：通过。
- 定向合同测试：16 通过、0 失败；覆盖 Android 单机更新合同、下载页/网页手册、版本策略和旧内部控制台状态。
- JSON 解析、APK SHA 校验、APK v1/v2 签名校验、下载页候选版本泄漏检查：通过。
- Android 单机版 1.2.5 的本轮工作是补齐既有正式发布文件与官网状态，不代表本次重新完成平板覆盖升级、系统打印或不同分享目标的真机验收；升级前仍应备份。
- Windows 学生端 0.18.6、Android 学生端 0.6.19、Android 教师端 0.1.4、Android 单机版 1.2.8 均保持候选/未发布。
- 当前工作树原本包含大量未提交修改；本次只修改版本清单、Android 单机版手册、网页下载页、手册同步脚本和对应测试，并补齐下载目录文件。未清理、重置或覆盖其他开发成果。
- 本次未执行 Git 提交或推送；线上发布状态与 Git 状态分开记录。

公开入口：

- 下载页：<https://www.greatbg.com/education/download.html>
- Android 单机版手册：<https://www.greatbg.com/education/android-standalone-manual.html>
- Android 单机版 1.2.5 APK：<https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.2.5-release.apk>
