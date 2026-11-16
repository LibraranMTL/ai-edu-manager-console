# Android 单机版 1.3.8 发布记录

- 发布日期：2026-11-16（北京时间）。包名 `com.qxmatrix.edumanager.standalone`，版本 1.3.8 / code 42。
- 源码基线：`237ce3d47f2ab183ff23853ad1f2df539bb212b6`，基于此前远程主线 `7942798794068f747dcd4e572fc2496b356255f2`；包含近期单机版学情、成长及联网规划改动，以及最近七天资料统计图月日分隔符调整。
- APK：`AI-Education-Manager-Android-Standalone-1.3.8.apk`，69,160,176 字节，SHA-256 `AF6398AE4A2D33D7709F5E4EDBCC9838D87B2CCC7813FCA39BBAE0C3AC11730C`。v1、v2 签名验证通过，证书 SHA-256 `647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F`。
- 测试：模型提供方、独立搜索和成长文档相关定向测试及 Debug 构建通过；TAS-AL00 覆盖安装成功，实装 APK 哈希与发布文件一致，日期标签显示 11/10 至 11/16。
- 性能状态：`pending_verification`。正式签名流程要求的九项同设备性能基线与当前对比数据尚未具备；用户明确同意按待验证状态使用经过正式证书签名的候选二进制发布。不得将九项性能门禁记为通过。
- 规划内容：检索来源仅供参考，来源身份、事实、地区、年龄和资格须核验；比赛和升学建议尚不能保证完整或适用。此前结果未知的模型任务未重试。
- ECS：`i-m5e6r68cl11nbh2y0o6z`，`cn-qingdao`；站点根目录 `/www/wwwroot/123.56.83.50`。发布前备份：`/var/backups/standalone-138-date-20261116-r1`，包含下载页、手册及两份清单；原 1.3.7 APK 保留。
- 公网：[APK](https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.3.8.apk)、[下载页](https://www.greatbg.com/education/download.html)、[手册](https://www.greatbg.com/education/android-standalone-manual.html)、[客户端下载清单](https://www.greatbg.com/download/edu-manager-version.json)、[产品站清单](https://www.greatbg.com/education/edu-manager-version.json)。
- 公网校验：下载页、手册及两份清单响应体 SHA-256 与本地发布文件一致；APK HTTP 200、长度 69,160,176 字节，HTTPS Range 首 8,192 字节与签名 APK 一致。完整下载过程中两次超时，核对已下载前缀后断点续传；最终完整公网文件为 69,160,176 字节，SHA-256 `AF6398AE4A2D33D7709F5E4EDBCC9838D87B2CCC7813FCA39BBAE0C3AC11730C`，与签名 APK 一致。其他客户端清单版本字段与发布前一致。
