# Android单机版1.3.9正式发布记录

发布日期：2026年11月25日（北京时间）。状态：已发布1.3.9/code43，原证书签名；综合性能状态保持pending_verification。

## 正式地址

- APK：https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.3.9.apk
- 下载页：https://www.greatbg.com/education/download.html
- 使用手册：https://www.greatbg.com/education/android-standalone-manual.html
- 客户端清单：https://www.greatbg.com/download/edu-manager-version.json
- 产品站清单：https://www.greatbg.com/education/edu-manager-version.json
- 旧1.3.8包：https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.3.8.apk

本次仅更新安卓单机版发布单元。Windows0.24.4/code283、Windows学生端0.19.3、安卓学生端0.6.34、教师端0.1.5及其他非standalone清单字段与发布前逐项相同。授权管理工具0.5.0未上传公开下载区，继续仅内部使用；激活服务与云文档服务仍正常运行。

## 冻结包、签名与源码

直接将已完成真机验收的self-activation-1.3.9-r1候选复制为正式命名，没有重编译、重签或修改APK字节。包名com.qxmatrix.edumanager.standalone，版本1.3.9/code43，大小69,160,643字节，SHA-256为9DE2EEFDA00B37C6CBB4446A581DECB927E15493BA801ABC9EADD58A6EEDAED7。

v1/v2签名验证通过；证书SHA-256为647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F，与原1.3.8正式安装包一致。实际真机安装后的APK指纹也与该冻结包一致。原候选、构建登记和独立真机验收记录继续保留。

实现源码已归档于提交1efbc42877b1541a6b685ac198a959f73ff96219。该提交包含此前已验收的收件箱与自助激活实现；与本次安卓发布文档/清单提交分开。归档发生在候选构建之后，不将其表述成原APK构建时的干净Git提交。本次发布修正旧candidate.json的1.3.7登记为实际1.3.9，并让更新合同测试按正式发布记录验证版本、包名与SHA，而不是沿用旧的固定文件名。

## 交付文件指纹

| 服务器目标 | 字节数 | SHA-256 |
| --- | ---: | --- |
| download/AI-Education-Manager-Android-Standalone-1.3.9.apk | 69160643 | 9DE2EEFDA00B37C6CBB4446A581DECB927E15493BA801ABC9EADD58A6EEDAED7 |
| download/edu-manager-version.json | 3534 | D0D06E15665CB77F82D4988238F917BCF80ECB4D4797EF23D90EFE958154AA4B |
| education/edu-manager-version.json | 3534 | D0D06E15665CB77F82D4988238F917BCF80ECB4D4797EF23D90EFE958154AA4B |
| education/download.html | 11686 | E099F2786C2D669652C48817BC60865C6F2D2D8C3DA8B13183E32B97B03DF1F1 |
| education/android-standalone-manual.html | 36428 | F2B3B362605175648FF2E1E531BBBD528365393F016C8B8B86DB95B4CD5FDD3D |

手册使用线上完整页面模板，仅按更新后的Android单机版Markdown源文件生成对应文章与目录，保留原导航、样式和其他功能章节；补充购买码自助激活、扫码确认、同设备恢复、有效期内离线使用与原AIE3兼容说明。源手册为docs/delivery/Android单机版操作手册.md，其他端手册未重新生成。

## 验证与实际边界

- 真机：华为NAM-AL00、Android12/API31。本轮首次激活、重复、恢复、非法码保护、断网冷启动、两个隔离身份的绑定拒绝、相册和摄像头识码均通过；机主原永久授权100席位、1个档案、75份资料和2个项目保持。详见[真机验收记录](Android单机版-1.3.9-激活真机验收-2026-11-25.md)。
- 本次发布相关Node合同37项通过；非目标安卓学生端版本完整性和站点一致性检查通过。既有Debug JVM308项通过记录沿用；本次没有修改已验收Kotlin业务代码。
- 暂存及上线后逐文件SHA-256、大小与0644 root:root验证；服务器本机HTTPS/SNI路由通过。公网页面、完整手册、两份清单完整响应体哈希与本地一致。
- 从本Windows管理电脑完整下载公网APK，69,160,643字节，SHA-256与冻结包一致。新旧APK均HTTP200，长度正确。
- Edge实际打开下载页与手册，验证1.3.9及1.3.8回退入口、Windows0.24.4保持；中文手册桌面1440px和手机390px宽度无水平溢出，完整原章节和新激活章节可读。
- 未运行整机综合性能/长时间稳定性基准、完整真实资料模型处理回归、全部原件逐字节审计或第二台物理手机测试；这些项目没有被标为通过。清单standalonePerformanceStatus仍为pending_verification，网页和手册保留说明。

## 服务器备份与回退

实例i-m5e6r68cl11nbh2y0o6z，cn-qingdao。站点根/www/wwwroot/123.56.83.50。备份目录/var/backups/edu-android-139-20261125-r1保留发布前下载页、完整手册和两处清单；旧1.3.8APK继续在原地址，前后SHA-256均为AF6398AE4A2D33D7709F5E4EDBCC9838D87B2CCC7813FCA39BBAE0C3AC11730C。

需要恢复公开下载指向时，在该实例执行python3 /var/backups/edu-android-139-20261125-r1/rollback.py，再复核公网页面、手册和两处清单。脚本通过同目录临时文件原子恢复小文件，保留新旧不可变APK；本轮未实际执行回退。Android降级可能受系统限制，1.3.8也不支持新联网码，不能据保留旧包承诺无损降级；新授权客户回退前应先核验。

暂存/tmp/edu-android-139-20261125-r1已在完整验证后核对真实路径并清理，备份保留。本轮未改写客户端资料、激活库存或其他产品二进制。

完整发布审计为artifacts/android-139-promotion/promotion-audit.json，公网验证为public-verification.json、public-apk-sha256.json和public-ui-verification.json。原始运维日志、测试库存和凭据不提交Git。
