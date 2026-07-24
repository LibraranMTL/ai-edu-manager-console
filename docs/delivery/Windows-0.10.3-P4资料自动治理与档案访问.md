# Windows 0.10.3 P4 资料自动治理与档案访问交付记录

## 交付范围

本阶段保持现有 LLM Wiki Engine 和最低依赖部署，不安装 GBrain、数据库、向量服务或技能包。P4 只增强 Windows 主机端的资料处理闭环；Windows 学生终端随统一 Windows 版本号发布 0.10.3，Android 学生端保持 0.6.3。

## 已完成

1. 分批消化回执按结构识别，不依赖固定文件名；兼容中文和自定义 JSON 文件名，同一批次多份回执合并，旧批次隔离。
2. 资料状态统一为待处理、已提交、处理中、已完成、已忽略、无效和失败，旧 `digested` 状态自动兼容。
3. 学生任务只有在当前批次逐文件回执通过 ID、路径和 SHA-1 校验后才成功，模糊日志不再使任务误完成。
4. 任务中心采用异步读取、快照缓存、可见页低频刷新、默认待处理筛选、分段渲染、历史限量和事件日志轮转。
5. QClaw 领取与结果文件按 TaskResult 内容识别，通过执行身份校验后归档；直接执行、收件箱、文件导入和手工粘贴共用结果校验。
6. 消化成功后自动生成知识治理运行记录，完成资产登记、来源覆盖分析、风险分级和质量门。
7. 低风险治理项默认收起，中风险仅内部观察，缺失、空文件、越界等高风险异常进入任务中心；全为已忽略或无效资料的批次安静结束，不产生缺少知识资产的虚假告警。
8. `ArchiveAccess v1` 支持 `search`、`getResource`、`listChanges` 和 `buildContextBundle`；任务包自动携带最小上下文和 `edu://` 引用。
9. ArchiveAccess 排除学生原始资料目录，限制学生/项目范围和真实路径边界；进程内只读 RPC 不监听网络。

## 验收

- P4 专项测试：回执兼容、任务中心性能、统一结果收件箱、知识治理、ArchiveAccess 均通过。
- 全量自动测试：304/304 通过（打包前基线，最终包以构建审计记录为准）。
- Vite 生产构建通过。
- 任务中心浏览器人工检查：可即时进入，默认“待处理/阻塞”，刷新与空列表状态正常。
- Windows 主机端与学生终端正式发布包分别由 `pnpm build:win`、`pnpm build:win-terminal` 生成并写入独立构建审计；两个运行包的 `nodeModuleFiles` 均为 `0`。

| 发布物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.10.3.exe` | 89,553,784 | `8F35514C949A1C946A15B0A6020C3B16DFBD86EEBED0A9F37A76376A63B1BC55` |
| `release/windows/AI-edu-manager-console-Windows-0.10.3.zip` | 89,561,720 | `0E0195DF4409851A11D374BC4DBA9868211C03DF996E73C811C279A23DCC943C` |
| `release/windows-terminal/AI-edu-manager-student-terminal-Windows-0.10.3.exe` | 87,468,156 | `91CED9DAF3983989CE55A4E91572F0D2101674263460D9FD9AB7F4328E465E16` |

构建审计：

- `release/windows/AI-edu-manager-console-Windows-0.10.3-build-audit.json`
- `release/windows-terminal/AI-edu-manager-student-terminal-Windows-0.10.3-build-audit.json`

## 用户操作变化

普通使用仍只需“开始处理”一次。正常回执自动同步，知识治理和档案上下文在后台完成。只有会阻断资料闭环的异常进入待处理列表；批次、哈希、JSON、MCP 和路由细节继续保留在高级诊断或内部任务包中。
