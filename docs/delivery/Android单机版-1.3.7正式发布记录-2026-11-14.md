# Android 单机版 1.3.7 正式发布记录

- 版本：1.3.7 / code 41；包名 `com.qxmatrix.edumanager.standalone`。
- 下载：`https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.3.7-release.apk`；下载页：`https://www.greatbg.com/education/download.html`。
- APK：69143814 字节；SHA-256 `e959aeb5d78f070e05e7a0a1f3c73ce310b4349c9bca3503bb02e336b16a756f`；v1、v2 签名通过，签名证书 SHA-256 `647087c196380bed06ff285a95b29617dc5a31c4977a0c04ddba895adc67164f`。
- 构建源码提交 `8fb952f1412a7cb8ac6833ab65c13ba9a1a1cc2b`；r32 与 r31 及 TAS-AL00 真机覆盖安装包的哈希相同。r32 构建使用 Gradle 增量缓存，非无缓存独立重现。
- 合成学生真机测试：明确选择姓名与学习资料，界面显示直到关闭授权；正式云对应写入授权无到期时间，既有学习资料可见。关闭后手机自动同步关闭，正式云 `report.write.enabled=0`。已上传或下载资料不会自动删除。
- 云端服务 `2.3.0-until-revoked-20261114-r1`；变更前代码回滚点 `/opt/edu-cloud-documents/releases/2.3.0-source-integrity-20261113-r1`；数据库快照 `/var/backups/edu-cloud-before-until-revoked-20261114-r1/cloud-reports.sqlite` 通过 quick_check。回滚数据库前须评估其后的新数据。
- 网站文件备份 `/var/backups/standalone-1.3.7-release-20261114-r1`；下载页 SHA-256 `f0b6fcf02dda214ab833c202e5a3d8560c19eb591f16c924e4c05090f2244bc3`；两份版本清单 SHA-256 `947211873b3c17a7d431250ac9fbb6bdbeebdfc83bdde01a0c402042d1f4fa74`。
- 公网 APK HTTP 200、Content-Length 69143814；公网下载页和清单哈希与服务器文件一致。清单保留 Windows 主机 0.23.7、Windows 学生端 0.18.9、Android 学生端 0.6.33、Android 教师端 0.1.5。
- 按用户决定跳过正式云 Windows 图形主机配对查看及撤权检查；设备矩阵未完成。未将单机测试视为全机型覆盖。
