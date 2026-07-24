# Windows 0.10.5 局域网与 Tailscale 学生终端连接交付记录

发布日期：2026-07-23

## 发布范围

- Windows 主机端：0.10.5
- Windows 学生终端：0.10.5
- Android 学生终端：保持 0.6.3，本次未重新构建 APK

## 主要变更

- Windows 主机与 Windows 学生终端支持稳定固定机器码、双向局域网发现和明确接受/拒绝。
- Windows 学生端提供“局域网连接”和“Tailscale 远程连接”两种明确连接方式。
- Windows 学生端支持检测 Tailscale 是否安装、打开客户端、进入官方下载页和重新检测。
- 粘贴连接信息会按当前连接方式选择地址，不在 Tailscale 与局域网之间静默回退。
- 恢复 Windows 主机首页版本标识，并更新版本清单、下载页及三端操作手册。

## 安装包与校验值

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.10.5.exe` | 89,560,849 | `63CEA53DA83379063F76D2EECEEB7096221624C60780A32C5DC66D1E7649E8AD` |
| `release/windows/AI-edu-manager-console-Windows-0.10.5.zip` | 89,569,393 | `F9BCB21F2F0C6BC5238078AD5DEAD51A0F2BDF7CFE7C55D40E8AF47F62BC2BF5` |
| `release/windows-terminal/AI-edu-manager-student-terminal-Windows-0.10.5.exe` | 87,476,587 | `2B22512BCB24C66D4C0DDBFABE55A3593E3235B511B1B1606B4469FBAC5A1037` |

## 验证结果

- `pnpm test`：330/330 通过；主机端和学生端打包前各自再次执行完整测试，结果均为 330/330 通过。
- 2026-07-24：用户完成真机验证并反馈未发现问题；0.10.5 真机验证项关闭。
- 主机端构建审计：78 个渲染文件，68/68 个资源可达，0 个不可达资源；`app.asar` 不含 `node_modules`。
- 学生端构建审计：`app.asar` 2,268,064 字节，26 个文件，不含 `node_modules`。
- 学生端包内已验证包含：
  - `pairing-protocol.cjs`
  - `lan-discovery.cjs`
  - `terminal-lan-pairing.cjs`
  - `terminal-connection.cjs`
  - `windows-tailscale.cjs`
- 两个 EXE 的 ProductVersion 与 FileVersion 均为 `0.10.5`。
- 产物发布后重新计算的 SHA-256 与构建审计完全一致。

## 构建审计

- `release/windows/AI-edu-manager-console-Windows-0.10.5-build-audit.json`
- `release/windows-terminal/AI-edu-manager-student-terminal-Windows-0.10.5-build-audit.json`

## 分发注意事项

当前 EXE 未配置 Authenticode 代码签名证书，Windows 可能显示“未知发布者”。本次构建已通过版本、内容和哈希审计；若用于公开下载，建议后续配置证书签名并在签名后重新记录 SHA-256。
