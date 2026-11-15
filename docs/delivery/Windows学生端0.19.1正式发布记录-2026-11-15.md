# Windows 学生端 0.19.1 正式发布记录

## 范围与源码

- 仅发布 Windows 学生端 `0.19.1`（版本码 `241`），不替换 Windows 主机、Android 学生端、Android 教师端或 Android 单机版安装文件。
- 构建源：`release/windows-student-0191` 的合并提交 `db7091394c99e4fb4ea92dd3455107585359ef78`；构建审计 `sourceControl.dirty=false`。该分支把 Windows 学生端受控 Agent 会话采集修复整合到 2026-11-15 当前主线，并在发布元数据中保留 Android 学生端 `0.6.34`。
- 学生端 UI 的“资料搜集 → 对话采集”提供个人终端固定绑定学生后的授权入口。Codex 与 WorkBuddy 的本机真实新会话提问及回复曾在 0.19.1 r2 候选包完成送达验收；用户明确要求跳过此次正式包的额外 Codex 验收。相关设备证据在 `D:\AI-Education-Manager\acceptance\windows-student-agent-capture-r2-20261115.md`。

## 本地包与构建检查

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `AI-edu-manager-student-terminal-Windows-0.19.1.exe` | 86,902,220 | `724B5B4C8F2594529380A782C3E071F38985C68036FB2B0AB28ECDC2C55E09F6` |
| `AI-edu-manager-student-terminal-Windows-0.19.1.zip` | 86,909,800 | `868D51DECF983114482A6237D6C57BBE7B2D4E1C90007F40A4798F4285773C08` |

- 本地保存目录：`D:\AI-Education-Manager\release\windows-student-0.19.1\`，含 EXE、ZIP、构建审计和检查日志；仓库忽略的正式构建副本位于 `release/windows-terminal/`。
- 构建审计确认 ASAR 为 5,307,947 字节、173 个文件、`node_modules` 为 0；扫描 30 个 Electron 脚本及 27 条静态相对导入，无缺失模块。最终包的必需文件清单包含 `project-mentor-actions.cjs` 与 Agent 生命周期 Hook。
- `pnpm typecheck`、`pnpm build:terminal`、网站清单一致性检查及 44 项 Windows 学生端定向测试通过。全量测试结果另见下节。
- EXE 的 Authenticode 状态为 `NotSigned`；本次没有对新正式 EXE 进行安装后真实设备验收。

## 阿里云发布与公网核对

- ECS：`i-m5e6r68cl11nbh2y0o6z`，区域 `cn-qingdao`；站点根目录 `/www/wwwroot/123.56.83.50`。
- EXE、ZIP 写入 `/download/`；`/education/download.html` 与 `/education/windows-student-manual.html` 已更新；`/download/edu-manager-version.json` 和 `/education/edu-manager-version.json` 同步为 Windows 学生端 `0.19.1/241/stable`。其他客户端版本沿用当前线上值。
- 发布前原文件备份：`/www/backup/windows-student-0.19.1-20261115-1458`；旧 `0.18.10` EXE 保留，可将备份的小文件按同目录临时文件方式恢复以回滚下载入口。上传暂存 `/tmp/windows-student-0191-20261115-1458` 已在全部验证后清理。
- 上传暂存 SHA-256、JSON 解析、页面引用、EXE/ZIP 字节数与 ZIP 完整性均通过；上线后六个远端文件 SHA-256 与本地一致，权限均为 `0644 root:root`。
- 公网 HTTPS 对下载页、学生端手册、两处清单和 EXE/ZIP 均返回 `200`；四个小文件的公网内容 SHA-256 与本地一致，EXE/ZIP 的 `Content-Length` 分别为 86,902,220 和 86,909,800 字节。下载页链接指向 `https://www.greatbg.com/download/AI-edu-manager-student-terminal-Windows-0.19.1.exe`。

## 全量测试边界

最终全量测试共 3,118 项：3,107 通过、8 失败、3 跳过，日志为 `D:\AI-Education-Manager\release\windows-student-0.19.1\test-final-20261115.log`。失败项涉及 Android 单机版 UI/资料流程及发布渠道、Android 学生端旧版本断言、下载页和单机版手册旧文案断言，以及 Windows 主机版本策略；Windows 学生端 44 项定向测试全部通过。整个仓库的全量测试仍为红色，因此本次使用直接构建脚本生成安装包，没有声称 `pnpm build:win-terminal` 门禁通过。这些剩余失败需在各自产品线核对并修复。
