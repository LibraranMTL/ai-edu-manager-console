# Android 学生端 0.6.27 与教师端 0.1.5 下载端点恢复（2026-11-07）

## 修复范围

此前公开下载页及更新清单错误指向 Android 学生端 `0.6.26 / code 96`、Android 教师端 `0.1.4 / code 5`。本次恢复已发布的终端源码、版本常量、下载页、产品站清单和客户端更新清单；Windows 主机端继续保持 `0.23.3`。

| 客户端 | 正确版本 | 公共文件 | SHA-256 |
| --- | --- | --- | --- |
| Android 学生端 | `0.6.27 / code 97` | `AI-edu-manager-tablet-terminal-0.6.27.apk` | `F0A29D9B8F952FA021872F871A91D9E92CA56319E5A302EAE00E2DE31B113EF7` |
| Android 教师端 | `0.1.5 / code 6` | `AI-edu-manager-teacher-terminal-0.1.5.apk` | `7654B196990F089175581D1F0FE7E7348283160C7144B2FB70DB47C6003A586A` |

## 发布记录

- 源码提交：`3fc344536cded3bb5cc2cc83df7f4a9d9ea54e07`，已推送至 `codex/project-report-workbench-0233`。
- 服务器：青岛实例 `i-m5e6r68cl11nbh2y0o6z`。
- 原子更新的线上文件：
  - `/www/wwwroot/123.56.83.50/education/download.html`
  - `/www/wwwroot/123.56.83.50/education/edu-manager-version.json`
  - `/www/wwwroot/123.56.83.50/download/edu-manager-version.json`
- 未重传或替换 APK；服务器及公开 HTTPS 下载均已复算上述两个 APK 的 SHA-256。
- 回滚备份：`/www/backups/edu-manager-android-endpoints-20261107-3fc3445`。
- 暂存目录已清理：`/tmp/edu-manager-android-endpoints-20261107-3fc3445`。

## 验证

- Android 终端、发布页和版本策略的定向 Node 测试：`47/47` 通过。
- 公开下载页和两个公开清单均与本地发布源文件 SHA-256 一致。
- 公开更新清单字段已验证为 Windows `0.23.3`、学生端 `0.6.27 / 97`、教师端 `0.1.5 / 6`。
