# Windows 主机端 0.17.11 发布准备与线上阻断

日期：2026-09-22。发布目标：替换官网 Windows 主机端下载为 0.17.11，不改变学生端和 Android 各端版本。

> 历史记录：本文件记录首次 Workbench 连接失败时的状态。后续连接已恢复，0.17.11 已发布并完成线上校验；最终验收见 [Windows-0.17.11-线上发布验收-2026-09-22.md](Windows-0.17.11-线上发布验收-2026-09-22.md)。

## 本地已完成

- 按用户指定将 0.17.11 作为既有 Windows 修订号 1–10 规则的一次例外；下个版本恢复原规则。
- 更新 `package.json`、更新日志、三份版本清单、下载页、Windows 主机端手册及白皮书中的目标版本。
- 生成 `release/windows/AI-edu-manager-console-Windows-0.17.11.exe` 与同名 ZIP；ZIP 内 EXE 名称也为 0.17.11。
- 全量自动测试：1066 通过、0 失败、1 跳过；安装包审计与本地 SHA-256 核对通过。构建来源工作区含未提交修改。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `AI-edu-manager-console-Windows-0.17.11.exe` | 91023027 | `A5F9A9C59CF516A36B3417023515AFA90DC8466221FDB2C0DEFE76E2DA0210A3` |
| `AI-edu-manager-console-Windows-0.17.11.zip` | 91031385 | `C7472D7B724C6797BD9908F114A8D33945F12060A67D18D55287BDB32CBE3505` |

## 线上仍未完成

- 阿里云实例 `i-2ze2bk4vcw3rm1oiesj1` 可枚举为 Running，但 Workbench CLI 建立 SSH WebSocket 时返回 EOF；没有可关闭的 BROKEN 会话。未取得远程 shell，故未创建服务器备份、未上传、未替换任何线上文件。
- 公开下载页仍引用 0.17.10；0.17.11 ZIP 的公开 HTTPS 请求返回 404。官网的 0.17.11 页面和清单仅在本地准备，不能视为已发布。
- EXE 的 Authenticode 状态为 `NotSigned`。新版真机启动耗时对比尚未完成；自动测试不能替代真机验收。

## 恢复发布时的最小文件集

1. `/www/wwwroot/123.56.83.50/download/AI-edu-manager-console-Windows-0.17.11.exe`
2. `/www/wwwroot/123.56.83.50/download/AI-edu-manager-console-Windows-0.17.11.zip`
3. `/www/wwwroot/123.56.83.50/download/edu-manager-version.json`（本地源：`release/edu-manager-version.json`）
4. `/www/wwwroot/123.56.83.50/education/edu-manager-version.json`
5. `/www/wwwroot/123.56.83.50/education/download.html`
6. `/www/wwwroot/123.56.83.50/education/windows-host-manual.html`
7. `/www/wwwroot/123.56.83.50/education/windows-manual.html`（兼容旧入口）

连接恢复后先核对远端路径和容量，逐项备份，再上传至独立 `/tmp` 暂存目录；核对暂存 SHA-256、JSON 和页面链接后原子替换。最后校验线上文件哈希、公开页面及下载包的状态码和长度，保留备份并清理已核实的暂存目录。
