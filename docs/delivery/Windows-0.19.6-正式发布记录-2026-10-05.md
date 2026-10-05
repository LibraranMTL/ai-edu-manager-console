# Windows 主机版 0.19.6 正式发布记录

日期：2026-10-05。Windows versionCode：246。

## 发布范围

本次只把 Windows 主机端 0.19.6 发布为正式版。Android、Windows 轻终端和云端报告服务均不升级、不虚增版本号；官网清单中这些产品的既有版本、正式下载地址和状态保持不变。

正式产物继续采用便携形式：EXE 可直接运行，ZIP 内只有同一份 EXE。官网、阿里云服务器和 Git 分别验证，不以本地构建成功替代线上发布结果。构建来自分支 `release/windows-0.6.5-cleanup`、提交 `aef89e80605d9ac752edfebebbdbb21031d631b9` 上的脏工作树；其他开发成果保留，不能把本包描述为干净提交可复现产物。

本地发布前备份位于 `.codex_tmp/windows-0.19.6-formal-20261005/`。本次没有清理、重置或覆盖工作树中的 Android、云端及其他候选开发内容。

## 主要功能

- 新增置顶快捷采集工具条，集中提供屏幕采集、拍照、本机文件导入、资料收件箱和录音采集页面入口；屏幕录像不在本版范围。
- 工具条“更多”展开后再次收起可恢复约 72 px 的紧凑高度；当前操作使用互斥高亮，切换到录音、拍照等操作后屏幕采集按钮不再保持固定主色。
- 延续并完善 0.19.6 的个性化选题、比赛收藏、规划与指导、学习卡片、资料收件箱、云端文档和 Obsidian 查看入口。联网研究仍要求已通过真实来源能力探测并获授权的 Agent。
- 用户于 2026-10-05 明确确认候选包真机验证通过。该结论作为人工验收门槛记录；未提供逐操作录像或日志的场景不额外推断。

## 本地构建与校验

最终正式构建完成于 `2026-10-05T00:53:39.019Z`，`candidateTag` 为空。

| 本地产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.19.6.exe` | 98954616 | `842B038021EF865485566667E89EC3D7FDE1F43AB134104FA81C794AF62FFC80` |
| `release/windows/AI-edu-manager-console-Windows-0.19.6.zip` | 98965220 | `EFFF5709B7DFF8559296CE4D8870710A2FCCBAD7D7637BCCF155CBCFBC46415C` |

- 全量 Node 测试共 1774 项：1773 通过、1 项按平台条件跳过、0 失败。首次定向测试时，下载页合同仅因正式 ZIP 尚未生成而失败；使用同一受审计构建脚本生成正式产物后，全量合同通过。
- Vite 生产构建通过；仅保留既有大分块提示，不是构建错误。
- 构建审计显示源码 292 文件、暂存运行时 506 文件和 2 个包体对象的敏感信息特征扫描均为 0 发现；正式包 ASAR 包含 303 个文件，未携带外部 `node_modules` 运行时。
- EXE 的 FileVersion／ProductVersion 均为 `0.19.6`；Authenticode 状态为 `NotSigned`。
- ZIP 只有一份 `AI-edu-manager-console-Windows-0.19.6.exe`，包内 EXE 的字节数和 SHA-256 与正式 EXE 完全一致。
- 使用独立非敏感 `--user-data-dir` 和 QA 标志启动正式 EXE，主进程、主窗口渲染进程和快捷采集渲染进程均实际出现；验证结束后本次进程全部退出，没有读取真实学生资料。

## 官网与阿里云服务器

- 已发布到阿里云青岛实例 `i-m5e6r68cl11nbh2y0o6z`（实例名 `iZm5e6r68cl11nbh2y0o6zZ`，公网 IP `47.104.192.137`），未操作其他实例。
- 正式下载地址：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.6.exe` 和 `https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.6.zip`。
- 官网下载页、两份 Windows 主机手册及 `/education/`、`/download/` 下的版本清单已更新；同时发布 SHA-256 文本和构建审计 JSON。
- 发布前线上备份保留在 `/www/backup/ai-edu-0.19.6-20261005-085834-qingdao/`；上传暂存目录 `/tmp/ai-edu-0.19.6-20261005-20261005-085834` 已在验收通过后删除。
- 9 个服务器落盘文件通过 SHA-256 校验；5 个公网小文件的正文 SHA-256 与本地一致。公网 EXE／ZIP 的 `Content-Length` 分别为 98954616 和 98965220，分段读取均返回 HTTP 206 和 1024 字节。
- Web 服务配置未改变，无需重启或重载。云端报告服务未部署新版本。

## Git

本次发布只会精确暂存 Windows 主机运行时、相关测试、版本清单、官网页面和发布技术文档；不会使用 `git add .`。正式发布提交与远端推送结果将在完成后补记。
