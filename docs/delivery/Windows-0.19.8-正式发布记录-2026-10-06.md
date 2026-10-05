# Windows 主机 0.19.8 正式发布记录

发布完成日期：2026-10-06（北京时间）。Windows versionCode：248。

## 范围与验收

用户在 0.19.8 候选包交付后明确表示“通过测试”，并授权生成正式程序包、更新网页和阿里云、推送 Git。本次仅发布 Windows 主机；Windows 学生端 0.18.6、Android 学生端 0.6.19、Android 教师端 0.1.4、Android 单机版 1.2.5 与云端服务版本不变。

正式 EXE 原样复制已验收候选包，不重新编译。正式 ZIP 重新封装，仅含使用正式文件名的同一份 EXE。用户验收按其确认记录，不额外推断未提供日志的 Agent、打印或其他逐项场景。

本次包含学生学习语言设置、卡片语言与导出标签适配，以及正在进行／待练新卡切换、生成结果反馈和未开始卡片更新修复。已开始、已完成卡片及作答记录保持不变；生成仍依赖正式学习证据与独立复核，作答不自动成为掌握结论。

## 正式产物

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.19.8.exe` | 98956986 | `898FEEDF7BAAB0EE83EAF267063DF79729BC7EB9D291D9FBF17F40193EB75DDA` |
| `release/windows/AI-edu-manager-console-Windows-0.19.8.zip` | 98967475 | `D37B04006BCC57EDCEF5516145F02C1214F45D27E0F51A517AAE6863D991513F` |

候选来源：`release/windows/candidates/card-update-fix-20261005/`。候选构建基于 `ea27bf13b2c1ec28c80b0e093628d9149447998e` 之上的脏工作区，完整构建审计保留原始来源，不宣称干净提交可复现。正式晋升审计、SHA-256 文本与正式文件名隔离启动记录保存在 `release/windows/`。

- ZIP 唯一条目为 `AI-edu-manager-console-Windows-0.19.8.exe`；包内 EXE、正式 EXE、用户验收候选 EXE 的哈希完全一致。
- FileVersion／ProductVersion 为 0.19.8；Authenticode 为 `NotSigned`，正式发布不等于获得代码签名。
- 实际启动正式文件名 EXE，使用独立 QA 用户目录及禁用任务调度设置；窗口显示 Windows v0.19.8，卡片桥接 API 存在，资料根目录确认为隔离目录。验证进程已退出，未读取或写入真实学生资料。
- 包内核心卡片模块、语言模块、导出模块和编译后卡片界面均与已验收构建一致。

## 测试边界

- 发布前重点回归：34 项通过、0 失败；发布暂存与审计合同：6 项通过。
- 候选阶段全量测试：1792 项，1790 通过、1 按平台条件跳过、1 个既有 Windows 生命周期命令测试在并发负载下触发 3 秒超时。该超时项单独及重点组合重跑均通过；本次没有修改与卡片无关的超时策略，也不将全量结果改写为零失败。
- 赵书源精确卡片记录的隔离副本验证了新卡可访问、重复生成反馈、仅替换未开始卡片和记录保留；真实卡片索引 SHA-256 未变。测试生成器使用桩，无真实模型调用。

## 阿里云与公网

当前域名 `www.greatbg.com` 指向 `47.104.192.137`。实际发布实例为青岛 `i-m5e6r68cl11nbh2y0o6z`，区域 `cn-qingdao`；北京旧实例只做只读检查，没有发布写入或重启。

正式网址：

- 下载页：`https://www.greatbg.com/education/download.html`
- EXE：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.8.exe`
- ZIP：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.8.zip`
- 客户端清单：`https://www.greatbg.com/download/edu-manager-version.json`

发布前备份保留在 `/www/backup/ai-edu-0.19.8-20261005-formal/`，包含 4 个被替换的教育站点文件及下载目录版本清单。上传先进入 `/tmp/ai-edu-0.19.8-20261005-formal/`；校验全部哈希、JSON、页面链接和其他客户端字段后，用目标目录临时文件原子替换，版本清单最后安装。9 个落盘目标的 SHA-256、0644 权限及 root:root 归属均通过校验。没有修改 Web 配置或重启服务。

公网验证：7 个小文件正文 SHA-256 与本地一致；EXE／ZIP 返回 HTTP 200，Content-Length 分别为 98956986／98967475，Range 请求均返回 HTTP 206 和 1024 字节。其余 4 个现有客户端下载入口仍返回 HTTP 200。3 份未变更学生手册的服务器哈希与本地一致。

下载页通过实际 Playwright 浏览器验证：1440×1080 桌面与 390×844 手机，标题与路由正确、非空、无错误遮罩、控制台无错误／警告；显示 0.19.8 和正确 EXE／ZIP 链接。点击主机手册后进入新版说明，再返回下载页；手机无横向溢出。Browser 插件不可用，因此使用既有 Playwright CLI，没有增加项目依赖或修改网站设计。

验证后仅删除本次精确上传暂存目录；发布前备份与旧版本程序包保留。暂存文件可由本地正式产物重新上传。回退时将备份中的 5 个文件分别安装到对应目标目录的临时文件名，再原子替换，并重新核对清单、页面及公网哈希；无需删除旧版或新版二进制文件。

## Git 边界

发布使用既有分支 `release/windows-0.6.5-cleanup` 和 `origin`。仅精确提交本次 Windows 学习卡片运行时、相关测试、版本清单、下载页、主机手册和本记录。不使用 `git add .`，不提交程序二进制、测试临时目录、学生资料、Android／云端开发或其他候选内容。推送不使用 force；最终远端提交以发布结束时的 `git ls-remote` 校验为准。
