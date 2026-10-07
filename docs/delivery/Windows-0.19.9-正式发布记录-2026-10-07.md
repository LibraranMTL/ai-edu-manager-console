# Windows 主机 0.19.9 正式发布记录

发布完成日期：2026-10-07（北京时间）。Windows versionCode：249。

## 范围与验收

用户在 0.19.9 候选包真机测试后明确表示测试通过，并授权生成正式 EXE、发布服务器和网页、更新文档以及提交推送 Git。本次仅升级 Windows 主机；Windows 学生端 0.18.6、Android 学生端 0.6.19、Android 教师端 0.1.4、Android 单机版 1.2.5 与云端服务版本不变。

正式 EXE 原样复制已验收候选，不重新编译；其 SHA-256 与用户测试的候选 EXE 完全相同。正式 ZIP 重新封装，仅含使用正式文件名的同一份 EXE。用户验收按其明确确认记录，不虚构未提供的设备型号、摄像头型号或性能数据。

本次将屏幕采集设置和启动直接集成到快捷工具条，继续复用原截图会话的暂停、继续、重点截取和结束控制；拍照使用隔离悬浮窗完成摄像头预览、拍摄、重拍和确认保存。录音仍跳转原页面，屏幕录像不在本次范围。

## 正式产物

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.19.9.exe` | 98965406 | `0823A18DE510F90DF64E86067E384159C9A5AB9B4ABCA8C0D5527C8EDCE09BD7` |
| `release/windows/AI-edu-manager-console-Windows-0.19.9.zip` | 98976755 | `2C70404E1A5FAB56B7AFD28E81E8D9A39CFE8BBF33B665DF08E16C3BCC267225` |

候选来源：`release/windows/candidates/quick-capture-direct-20261006/`。候选构建基于 Git HEAD `074d685aa8857e82536b641f49d0d0dad9a74b66` 之上的脏工作区，构建审计如实保留该来源，不宣称由干净提交可复现。正式晋升审计、SHA-256 文本和正式文件名隔离启动记录保存在 `release/windows/`。

- ZIP 唯一条目为 `AI-edu-manager-console-Windows-0.19.9.exe`，条目大小 98965406 字节，条目 SHA-256 与正式及候选 EXE 一致。
- FileVersion／ProductVersion 为 0.19.9；Authenticode 为 `NotSigned`，正式发布不等于获得代码签名。
- 正式文件名 EXE 使用独立 QA 用户目录实际启动；主窗口显示 0.19.9，工具条可见，无学生时受控动作禁用，展开高度 161、收起高度 73。包内 8 个工具条／拍照文件与当前源码一致，验证进程已退出，未读取真实学生资料。

## 测试边界

- 候选阶段全量 Node 测试 1799 项：1798 通过、0 失败、1 条件跳过。
- 本次发布前重新运行工具条行为和版本合同 11 项：11 通过、0 失败；`git diff --check` 无错误。
- 隔离 Electron 交互、Chromium 虚拟摄像头、Vite 构建、资源可达性、构建审计及敏感信息扫描均在候选记录中通过。
- 真机业务验收由用户于 2026-10-07 明确确认通过；本记录不把未提供的逐设备测试日志补写为测量事实。

## 阿里云与公网

实际发布实例：`i-m5e6r68cl11nbh2y0o6z`，区域 `cn-qingdao`。站点根目录为 `/www/wwwroot/123.56.83.50`。本次为静态文件更新，没有修改 Web 配置，也没有重启服务。

正式网址：

- 下载页：`https://www.greatbg.com/education/download.html`
- EXE：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.9.exe`
- ZIP：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.9.zip`
- 客户端清单：`https://www.greatbg.com/download/edu-manager-version.json`
- Windows 主机手册：`https://www.greatbg.com/education/windows-host-manual.html`

发布前备份保留在 `/www/backup/ai-edu-0.19.9-20261007-formal/`，包含被替换的 4 个教育站点文件和下载目录版本清单。上传先进入 `/tmp/ai-edu-0.19.9-20261007-formal/`；校验 7 个文件的哈希、JSON、页面链接及其他客户端字段后，以目标目录临时文件原子替换，两个版本清单最后安装。所有目标为 `root:root`、权限 `0644`；公网验证结束后仅删除本次精确暂存目录，备份和旧版本程序包均保留。

服务器落盘 SHA-256 与本地完全一致。公网 5 个网页／清单文件的正文 SHA-256 与本地一致；EXE／ZIP 返回 HTTP 200，Content-Length 分别为 98965406／98976755。既有 Windows 学生端、Android 学生端、Android 教师端和 Android 单机版下载入口仍返回 HTTP 200。

公开下载页另用实际 Playwright Chromium 验证 1440×1080 桌面和 390×844 手机视口：标题、0.19.9 标识、EXE／ZIP 链接正确，控制台 0 错误／0 警告，手机页面无横向溢出。截图位于 `output/playwright/windows-0.19.9-public/`，不纳入发布提交。

回退时将备份中的 5 个文件分别安装到原目录的同目录临时文件，再原子替换并重新核对清单和公网哈希；二进制使用新文件名，不需要删除 0.19.8 或 0.19.9 文件即可让清单和下载页回退。

## Git 边界

发布使用分支 `release/windows-0.6.5-cleanup` 和远端 `origin`。仅精确暂存本次 Windows 工具条／拍照运行时、对应测试、版本清单、下载页、两份主机手册、变更日志及本记录；不使用 `git add .`，不提交 EXE／ZIP、测试临时目录、学生资料、Android／云端开发或其他候选内容。推送不使用 force，最终远端提交以发布结束时 `git ls-remote` 校验为准。
