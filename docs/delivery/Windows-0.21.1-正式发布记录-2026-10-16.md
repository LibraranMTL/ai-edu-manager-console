# Windows 0.21.1 正式发布记录

日期：2026-10-16。

## 发布结论

用户确认 R18 候选已通过真机验证。正式版采用原样晋升：正式 EXE 与真机验证候选保持完全相同的字节和 SHA-256；正式 ZIP 只把包内文件名改为不含候选标签的正式名称，没有重新编译程序。

Windows 0.21.1 已发布为 `stable`，下载页、客户端更新清单和 Windows 主机手册已经同步更新。程序仍未进行 Authenticode 签名，首次运行可能显示 Windows 安全提示。

## 正式文件

- `AI-edu-manager-console-Windows-0.21.1.exe`
  - 大小：100,263,861 字节
  - SHA-256：`BA799698514AE903098282C169045168629615884383D8C88B1787741F19AE89`
- `AI-edu-manager-console-Windows-0.21.1.zip`
  - 大小：100,275,445 字节
  - SHA-256：`30F598802391B4AB72A9FF8A4EBD6EFCFD11646680293769BDCCF7FA3181D368`
  - ZIP 内文件：`AI-edu-manager-console-Windows-0.21.1.exe`

## 验收证据

- 用户确认 R18 已完成真机验证。
- Windows 全量自动测试：2265 项，2264 通过、0 失败、1 条件跳过。
- 正式发布专项回归：25/25 通过，覆盖版本契约、发布打包契约、批量任务治理和新建项目 ID 修复。
- 正式 EXE 的 Authenticode 状态：`NotSigned`。
- 下载页同时引用正式 EXE 和 ZIP；两个版本清单均为 `windowsVersionName=0.21.1`、`windowsVersionCode=261`、`windowsReleaseStatus=stable`。

## 阿里云发布

公网 DNS `www.greatbg.com` 指向 `47.104.192.137`。正式发布目标为：

- 实例：`i-m5e6r68cl11nbh2y0o6z`
- 区域：`cn-qingdao`
- 站点根目录：`/www/wwwroot/123.56.83.50`
- 回滚备份：`/www/backup/ai-edu-0.21.1-20261016T120202CST`

发布使用独立 `/tmp/ai-edu-0.21.1-20261016T120202CST` 暂存目录。上传后逐文件比较 SHA-256、校验 JSON、页面链接、手册关键内容和 ZIP 条目，再使用同目录临时文件原子替换；发布完成后暂存目录已经清理，回滚备份保留。静态文件发布没有修改 Web 配置，也没有重启服务器。

北京保留实例 `i-2ze2bk4vcw3rm1oiesj1` 同步了相同文件，备份路径同名；公网验收以青岛实例为准。

## 公网验收

- 下载页：<https://www.greatbg.com/education/download.html>
- Windows 主机手册：<https://www.greatbg.com/education/windows-host-manual.html>
- 客户端清单：<https://www.greatbg.com/download/edu-manager-version.json>
- 正式 EXE：<https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.21.1.exe>
- 正式 ZIP：<https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.21.1.zip>

公网下载页、两个手册和两份版本清单的响应体 SHA-256 均与本地文件一致。正式 EXE 和 ZIP 均返回 HTTP 200，`Content-Length` 分别为 100,263,861 和 100,275,445 字节。

## 本版重点

- “AI 接入与调度中心”统一管理全局授权、Agent、LLM API、连接状态与调度顺序。
- WorkBuddy、Codex、OpenClaw、QClaw、TRAE、Qoder 按逐任务合同开放受控自动执行，LLM API 作为适用任务的后备执行器。
- Agent 数据管理、Agent 连接管理和 AI 对话采集按职责归并页面入口。
- 统一任务队列支持自动触发、跨页全选以及批量归档、取消和安全删除；活动或结果未知任务继续受保护。
- 修复新建 `workspace-v1` 项目首次读取资料状态时“项目 ID 无效”。
- 学情页面更新了 Tab 顺序、知识轨迹刷新按钮和报告高级区域布局。
