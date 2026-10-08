# Windows 主机 0.19.10 正式发布记录

发布日期：2026-10-08（北京时间）。Windows versionCode：250。

## 范围与验收

用户在 0.19.10 候选包真机测试后明确表示测试通过，并授权生成正式 EXE、更新服务器与下载网页、更新文档以及提交推送 Git。本次仅升级 Windows 主机；Windows 学生端 0.18.6、Android 学生端 0.6.19、Android 教师端 0.1.4、Android 单机版 1.2.5 与云端服务版本不变。

正式 EXE 原样复制已验收候选，不重新编译；其 SHA-256 与用户测试的候选 EXE完全相同。正式 ZIP 重新封装，仅含使用正式文件名的同一份 EXE。用户验收按其明确确认记录，不虚构未提供的设备型号或性能数据。

本版在快捷工具条增加快速截屏，保留连续截图采集；自动会话采集增加待投递、已投递、全部和回收站分组，支持逐条、多选、跨页全选、批量投递、恢复与回收。成功项依真实回执归入已投递并保留投递目标和时间，失败项继续留在待投递；已投递记录不会自动删除。

## 正式产物

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.19.10.exe` | 98971846 | `9F518F095411BAAC701A3F557E2FEC3014332B1D223485F0BBA09518C5B628DA` |
| `release/windows/AI-edu-manager-console-Windows-0.19.10.zip` | 98983251 | `CCEA8922AB80E93F3A74ED847AE4996D4DED0409F484EEFF8C2179F132FA5A82` |

候选来源：`release/windows/candidates/session-status-20261008/`。候选构建基于 Git HEAD `d78bc6fd80f93f6fb5e04facabd1832c5edbb26d` 之上的脏工作区，构建审计如实保留该来源，不宣称由干净提交可复现。

- ZIP 唯一条目为 `AI-edu-manager-console-Windows-0.19.10.exe`，条目 SHA-256 与正式及候选 EXE 一致。
- FileVersion／ProductVersion 为 0.19.10；Authenticode 为 `NotSigned`。
- 正式文件名 EXE 使用独立数据目录实际启动，版本、工具条和自动会话批量桥接均可见；包内 10 个相关 Electron 文件与当前源码一致，验证进程已退出，未读取真实学生资料。

## 测试边界

- 相关 Node 测试 31 项通过；Electron 合成界面 21 项通过。
- 候选阶段全量 Node 测试 1810 项：1807 通过、2 失败、1 跳过。其一为既有下载收件箱静态契约断言未同步此前快速截屏刷新改动；其二为 Windows 生命周期命令在全量并发时超过固定 3 秒，单独复测 8 项全部通过。保留首次失败记录，不将全量结果标为全绿。
- Vite、发布暂存、包体审计与三层敏感信息扫描通过；正式 EXE 独立启动通过。
- 真机业务验收由用户于 2026-10-08 明确确认通过；本记录不把未提供的逐设备测试日志补写为测量事实。

## 阿里云、公网页面与 Git

实际发布目标为阿里云实例 `i-m5e6r68cl11nbh2y0o6z`（`cn-qingdao`），站点根目录 `/www/wwwroot/123.56.83.50`。本次为静态文件更新，没有修改 Web 配置，也没有重启服务。

发布前将被替换的下载页、两份 Windows 主机手册及两个版本清单备份到 `/www/backup/ai-edu-0.19.10-20261008-formal/`。7 个新文件先上传到 `/tmp/ai-edu-0.19.10-20261008-formal/`，逐项核对大小、SHA-256、JSON 和页面链接后，用目标目录内临时文件原子替换，版本清单最后安装。所有目标文件为 `root:root`、权限 `0644`；公网验证完成后仅删除本次精确暂存目录，备份与旧版程序包保留。

服务器落盘的 EXE、ZIP、下载页、两份手册和两个版本清单 SHA-256 均与本地一致。公网下载页、手册与清单正文哈希和本地一致；EXE／ZIP 返回 HTTP 200，Content-Length 分别为 98971846／98983251。Windows 学生端、Android 学生端、Android 教师端和 Android 单机版既有下载均继续返回 HTTP 200。公开清单显示 Windows `0.19.10 / 250 / stable`，其他端版本保持不变。

下载页另用本机 Chrome 实际渲染桌面 1440×1080 和手机 390×844 视口：0.19.10 标识及 EXE／ZIP 链接正确，控制台 0 错误／0 警告，无横向溢出。截图位于 `output/playwright/windows-0.19.10-public/`，不纳入 Git 发布提交。

正式网址：

- 下载页：`https://www.greatbg.com/education/download.html`
- EXE：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.10.exe`
- ZIP：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.10.zip`
- 客户端清单：`https://www.greatbg.com/download/edu-manager-version.json`
- Windows 主机手册：`https://www.greatbg.com/education/windows-host-manual.html`

Git 仅精确暂存本次 Windows 快速截屏、自动会话采集批量与分组、测试、版本清单、网页、手册和发布记录；不使用 `git add .`，不提交二进制、学生资料、Android、云服务及其他并行开发内容。提交与远端校验结果以本次发布最终记录为准。
