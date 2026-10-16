# Windows 0.21.1 任务删除与 TRAE/Qoder 接入

## 队列处理原则

- 不清空现有统一任务队列，也不依赖重新生成来恢复自动执行。
- 保留待处理、排队、已批准、运行中、等待结果和审核中的有效任务及其执行上下文。
- 允许删除从未执行的手工协作任务：`pending`、`collaboration_assignment`、`manual`、`attempt=0`、无 `executionId`、无结果。
- 删除后保留协作审计、远端协作记录、学生资料和已有产物；任务墓碑阻止同一协作任务在后续扫描中重建任务卡。

## TRAE IDE / TraeCode

- 检测 TRAE IDE 与官方 `traecli`。
- `traecli` 可用时，通过 `exec` 非交互执行；按任务写权限选择 `read-only` 或 `workspace-write` 沙箱，并使用 `never` 审批策略避免常规任务反复确认。
- 只有 TRAE IDE、没有 CLI 时，任务明确标记为桌面交接，不显示为自动执行。
- 学生知识目录写入 `.trae/mcp.json` 项目 MCP 配置，仍由学生令牌、项目范围和宿主校验约束。

## Qoder Work / Qoder CLI

- 检测 QoderWork 桌面端与官方 `qoder` CLI。
- CLI 可用时使用非交互 JSON 输出；只读任务只开放 `Read/Grep/Glob`，其他目录通过明确的附加目录传入。
- 只有 QoderWork 桌面端时，因官方尚未提供外部任务自动发送接口，仅打开桌面端并复制完整任务；发送动作如实保留为用户操作。
- 学生知识目录写入 `.mcp.json` 项目 MCP 配置，结果通过统一 Agent 通道回写并校验任务 ID、执行批次和 Agent 身份。

## 验证边界

- 当前机器未检测到 TRAE、TraeCode CLI、QoderWork 或 Qoder CLI，因此本轮完成的是命令构造、安装检测、路由、UI、MCP 和统一回执的自动测试；真实账号登录及厂商客户端执行仍需安装后的本机验收。
- 相关 Agent、任务中心、删除策略和版本测试 136 项通过；新增专项组合复核 43 项通过；前端生产构建通过。
- 真实便携 EXE 已在空白隔离用户目录启动，版本、独立存储、工具栏和 Agent 会话桥接正常，未读取现有学生资料或任务队列。
- 独立启动记录：`release/windows/candidates/task-delete-trae-qoder-20261011/isolated-launch-verification.json`。

## Windows 交付物

- EXE：`release/windows/AI-edu-manager-console-Windows-0.21.1.exe`
  - 大小：100,204,170 bytes
  - SHA-256：`BD4E41EDF9D87357A99A81F50C0FCB3C851BCA2F43AC127B6D2A76261E43BDA6`
- ZIP：`release/windows/AI-edu-manager-console-Windows-0.21.1.zip`
  - 大小：100,215,388 bytes
  - SHA-256：`43A98812D76F7ADEA98340A19C7D78FACB7EB8D36F88EF95548754D6B4BE631D`
- 源码、暂存运行时及交付包敏感信息扫描均为 0 项发现。
- Authenticode：`NotSigned`；正式公开分发前仍需代码签名。
