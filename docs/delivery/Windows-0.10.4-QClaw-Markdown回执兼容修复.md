# Windows 0.10.4 QClaw Markdown 回执兼容修复交付记录

日期：2026-07-23

## 修复范围

- 修复项目单文件资料已经由 QClaw 完成消化、生成知识产物和 Markdown 回执，但未生成固定名称 JSON 回执时，教育管家持续显示“等待 Agent 回执”的问题。
- 兼容仅适用于单文件项目批次，并要求回执和至少一个非日志知识产物均在批次提交后生成；回执必须明确包含完成状态和当前项目名称。
- 兼容结果会生成可审计的严格 JSON 回执，再交由原有项目 ID、批次 ID、相对路径和 SHA-1 校验器核对。
- 多文件批次、只有回执没有知识产物、过期文件、错误项目或错误批次不会自动结算。
- `log.md`、`index.md`、学生绑定索引和 Markdown 消化回执不登记为知识资产。
- 完成批次同步清零持久化待处理计数，避免完成状态与数量不一致。

## 真实问题修复结果

项目“海外图书出版”的批次 `manual-copy-2026-07-23T05-55-34-0a3673` 已完成严格核对：

- 源资料：`Screenshot_20260714_231054.jpg`
- SHA-1：`1f31e8ee787fa5f83e8fdd6a8dbdd81dea2a218f`
- 批次状态：`completed`
- 待处理数量：`0`
- 知识治理记录：已生成

## 验证

- 针对性回执兼容、知识治理和工作流测试：18/18 通过。
- 完整自动测试：308/308 通过。
- Windows 主机版与 Windows 学生终端构建时再次执行完整测试：均为 308/308 通过。
- Android 学生终端未改动，继续使用 0.6.3。

## 交付产物

| 产物 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.10.4.exe` | 89,553,315 | `947C423FF96AF6D26E8715614F4FF175261268B3F076F6056335CE4F2A3BE9A5` |
| `release/windows/AI-edu-manager-console-Windows-0.10.4.zip` | 89,561,329 | `8036D8C6BE13A8472FEC3C6294876644F57D43387F514C3F039F493F83DBAE48` |
| `release/windows-terminal/AI-edu-manager-student-terminal-Windows-0.10.4.exe` | 87,465,544 | `8B0831FA1EF8CFB79CE0E15BC05C331D649B2E72E9220AA75EE729FC2ADB7882` |

构建审计：

- `release/windows/AI-edu-manager-console-Windows-0.10.4-build-audit.json`
- `release/windows-terminal/AI-edu-manager-student-terminal-Windows-0.10.4-build-audit.json`
