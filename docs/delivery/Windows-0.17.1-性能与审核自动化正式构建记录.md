# Windows 主机端 0.17.1 性能与审核自动化正式构建记录

日期：2026-09-08
范围：Windows 主机端，本轮不重打 Windows 学生端和 Android 各端。

## 构建产物

| 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.17.1.exe` | 90,930,838 字节 | `E0466424A15A6FA87EE02DCC5186F688BB3CBDA47B8325BEF1F320AFDAC77FE5` |
| `release/windows/AI-edu-manager-console-Windows-0.17.1.zip` | 90,938,585 字节 | `267800424DCB65C7CFC971FCF8DFC01B8835B5BE4DC1BFC40E446F77E10B7733` |
| `release/windows/AI-edu-manager-console-Windows-0.17.1-build-audit.json` | 2,005 字节 | `BD4CA5A5DB0C373C8D945BB0A88BB266FBC85C5362E12A7E236AF8C37467A931` |

ZIP 只包含上述正式 EXE；包内 EXE 的大小和 SHA-256 与独立 EXE 完全一致。

## 包内审计

- 文件版本：`0.17.1`；产品版本：`0.17.1`。
- 公司：`Robogala`；产品：`AI Education Manager Console`。
- 渲染资源：83 个文件、68 个资源文件，68 个全部可达。
- `app.asar`：11,733,047 字节、209 个文件、0 个 `node_modules` 文件。
- 源码、暂存运行时和打包产物三层敏感信息扫描均为 0 命中。
- 包内确认包含项目低风险自动采用、成长证据自动分流、学情报告自动校验发布和失败自动重试标记。
- Authenticode：`NotSigned`。

## 自动验证

- 发布相关专项测试：52/52 通过。
- 排除三个已有 Android 基线文件后的 Windows 发布范围回归：911 通过、1 项按环境条件跳过、0 失败。
- 全量仓库测试：935 项，其中 930 通过、1 项跳过、4 项失败。四项均来自工作区既有 Android 单机版版本/迁移基线和旧版“报告草稿人工发布”契约，不属于本轮 Windows 主机包。
- Windows 生产构建、ASAR 语法检查、包内运行时检查和 ZIP 一致性检查通过。

## 发布边界

本产物位于无候选后缀的本地正式目录，可用于已知来源下的受控安装和升级。构建来源工作树为 `dirty=true`，包含 133 个状态路径；构建提交基线为 `adf1f5de141968092f4a296197d55b64b21db322`。Authenticode 仍为 `NotSigned`，因此不表示已签名的稳定版本；首次部署仍需在已知来源、受控设备上完成安装与真机验收。

## 网站发布

- 发布时间：2026-09-08；目标实例：`i-2ze2bk4vcw3rm1oiesj1`（`cn-beijing`）。
- 下载页：`https://www.greatbg.com/education/download.html`。
- Windows 主机端手册：`https://www.greatbg.com/education/windows-host-manual.html`。
- 正式 ZIP：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.17.1.zip`。
- 正式 EXE：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.17.1.exe`。
- 线上下载页、全部已发布手册和两份版本清单均通过公网 HTTPS 内容哈希校验；服务器正式目录中的 EXE、ZIP 与本地构建产物 SHA-256 一致。
- 公网 EXE/ZIP 均返回 HTTP 200，`Content-Length` 分别为 90,930,838 和 90,938,585 字节。ZIP 公网全量哈希下载在 300 秒链路时限内未完成，因此以服务器正式目录哈希和公网长度双重校验作为本次发布证据。
- 上线前备份：`/www/backup/ai-edu-0.17.1-20260908T193332`；发布暂存目录已在验证成功后清理。

## Git 发布

发布分支：`release/windows-0.6.5-cleanup`。本文件所在的 0.17.1 发布提交推送至 `origin` 后，以远端提交 SHA 为准。
