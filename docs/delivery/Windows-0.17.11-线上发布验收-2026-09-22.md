# Windows 主机端 0.17.11 线上发布验收

日期：2026-09-22。ECS 实例：`i-2ze2bk4vcw3rm1oiesj1`，区域：`cn-beijing`，站点根目录：`/www/wwwroot/123.56.83.50`。

## 发布文件与校验

| 线上路径（相对于站点根目录） | 字节 | SHA-256 |
| --- | ---: | --- |
| `download/AI-edu-manager-console-Windows-0.17.11.exe` | 91023027 | `A5F9A9C59CF516A36B3417023515AFA90DC8466221FDB2C0DEFE76E2DA0210A3` |
| `download/AI-edu-manager-console-Windows-0.17.11.zip` | 91031385 | `C7472D7B724C6797BD9908F114A8D33945F12060A67D18D55287BDB32CBE3505` |
| `download/edu-manager-version.json` | 2175 | `5FB52989F2D0C170D1B1FDDD92F095545DA7410D4D9C5A2169B20987ED2E2A1F` |
| `education/edu-manager-version.json` | 2175 | 同上 |
| `education/download.html` | 9676 | `58D189A9077E2448B34BBA226A90C88405EEAF7C25C3A503CC651A349C905871` |
| `education/windows-host-manual.html` | 82076 | `67C4BF9639BF0BF4D715C00EC73EE1947FC3557D13384F6BDF4A9458E13682F7` |
| `education/windows-manual.html` | 82076 | 同上 |

- 7 个线上文件的 SHA-256 与本地发布文件一致；权限与属主均为 `0644 root:root`。
- 从 ECS 和操作机分别通过公开 HTTPS 下载 5 个小文件，正文哈希与本地一致。EXE 与 ZIP 的 HTTPS HEAD 均为 200，`Content-Length` 分别为 91023027、91031385。
- 下载页所引用的 Windows 主机端、Windows 学生端、Android 学生端、Android 教师端及 Android 单机版 5 个安装包均返回 200。
- ZIP 内仅包含命名为 `AI-edu-manager-console-Windows-0.17.11.exe` 的程序。版本清单与下载页均指向 `0.17.11.zip`。
- 本地全量自动测试：1066 通过、0 失败、1 跳过；安装包构建审计、源代码/暂存/包体敏感签名扫描均通过。

## 发布过程与回滚

发布前备份保留于 `/www/backup/ai-edu-0.17.11-20260922T165003CST`，包含发布前页面、两份清单及两份手册。旧版 0.17.10 安装包未删除。新文件先上传到 `/tmp/ai-edu-0.17.11-20260922T165003CST`，核对大小、SHA-256、JSON 与页面链接后，以同目录临时文件原子替换；暂存目录在公开 HTTPS 校验通过后已删除。

如需回滚，先核对上述备份，再把 5 个被覆盖的小文件从备份安装到各自目录中的临时名并原子替换；确认页面和清单恢复指向 0.17.10 后，再重复线上哈希与公开 HTTPS 检查。0.17.11 新 EXE/ZIP 可保留为历史文件，不应在回滚页面仍引用时删除。

## 尚未完成的独立验收

EXE 的 Authenticode 状态为 `NotSigned`。尚无 0.17.11 新版真机启动耗时对比记录；服务器发布和自动测试不构成这两项验收。构建来源工作区含未提交修改，本次未推送 Git。
