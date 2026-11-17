# Windows 0.24.1 工具条置顶恢复发布记录

日期：2026-11-17。范围：仅 Windows 主机端；Windows 学生端、Android 学生端、Android 教师端和 Android 单机版未升级。

## 产物与源码

- 候选构建源提交：`b471cf6`，源码审计 `dirty=false`；候选标识 `toolbar-topmost-qa1`。
- 正式安装器 `AI-edu-manager-console-Windows-0.24.1-Setup.exe`：99,811,618 字节，SHA-256 `42D88E49D59FF973448F4A3CC6E9DA4CDB71CBEF229CBB51E5C1B700D1B03ED4`。
- 正式便携 EXE `AI-edu-manager-console-Windows-0.24.1.exe`：99,163,702 字节，SHA-256 `0B23E7AE39328F146B767D0EFDFC24BF08D7A2D915741E2DE97E6CD833C78B94`。
- 正式 ZIP `AI-edu-manager-console-Windows-0.24.1.zip`：99,172,366 字节，SHA-256 `37C7B3D8E0EB722E3F1EEE62ACA877E74E04CEE10DF47E7EA32A678744306521`。
- 正式文件名由已验收候选逐字节复制，复制前后哈希一致。安装包 Authenticode 状态为 `NotSigned`。

## 验证边界

- `pnpm build:win` 通过类型检查、498 个 Windows 测试文件、严格资源审计、下载网站一致性、资产／项目／任务基准和候选打包。发布元数据更新后的 15 项定向测试与网站一致性检查通过。
- 隔离学生数据的候选便携包完成真实桌面启动、工具条和学生范围检查。随后在 Windows 上最小化主窗口、切换到其他应用，模拟清除工具条 `WS_EX_TOPMOST` 后，确认候选包自动恢复该标志。
- 候选安装器与便携包的 246 个运行时文件逐一一致，`app.asar` 哈希为 `76A512A04A534ABBE716C8C33A56D7F93821C2491199D3A8EFFECBC4B83EA9F9`。
- 按用户此前“跳过门禁”的决定，旧版 P0 完整恢复矩阵未执行；安装器向导和本机覆盖升级本次未执行，不将其记为通过。未做客户现场验收。

## 服务器与公网

- Qingdao ECS：`i-m5e6r68cl11nbh2y0o6z`。旧网页、两份版本清单和手册备份保留在 `/www/backup/edu-windows-0241-20261117233412`。
- 新包发布于 `/www/wwwroot/123.56.83.50/download/`；下载页、两份清单和手册发布于 `/www/wwwroot/123.56.83.50/education/` 及 `/download/edu-manager-version.json`。
- 9 个暂存文件和 9 个线上文件哈希均与本地一致；公网下载页、两份清单、主机与学生端手册的正文哈希与本地一致，三个包的 HTTP 状态为 200，`Content-Length` 与本地相同。
- 本机从公网完整下载正式安装器后，SHA-256 与本地正式文件相同；服务器隔离暂存目录已清理，备份保留。
- 三份版本清单相对上一正式版仅更改 Windows 主机版本码、版本名、两个下载链接和说明；其他终端字段逐项相同。
