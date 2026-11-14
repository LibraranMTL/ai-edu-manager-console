### Task 4a：Codex 联网研究超时的可判定恢复

**Files:** 修改 `electron/planning-research.cjs`、`electron/research-task-policy.cjs`、`electron/main.cjs` 的 `submitResearchTask` 与持久执行结算；扩展 `tests/planning-research.test.cjs`、`tests/task-capability-wakeup.test.cjs`，新增 `tests/research-timeout-recovery.test.cjs`。

**已确认的运行事实（2026-10-30，只读）：** 包书源任务 `task-competition_research_check-cdfc5d62b577` 于本地 21:30:48 通过 Codex `research.v1` 能力门控，完成持久领取、`send_intent` 与进程启动（PID 10028），在 180,071ms 后得到 `RESEARCH_TIMEOUT`；记录到 `completedWebEvents=0`，无结构化产物。进程已退出，但执行尝试仍为 `phase=unknown, active=1`，任务为 `waiting_result / execution_unknown`，且 `nextRetryAt=''`、`reconcileAttempt=null`。因此当前“自动核对中”没有可执行的核对计划。该任务没有使用 WorkBuddy，也不是资源门控失败。

**Interfaces:**

- `terminateAndCollectResearchEvidence({ child, outputPath, events, stderrTail, startedAt, timeoutAt, graceMs:250 }) -> Promise<ResearchTimeoutEvidence>`：发出终止后等待匹配 PID 的 `close`，排空 stdout/stderr，并在 `close` 后和 250ms 有限观察窗后各检查一次输出文件；总收尾期限 5 秒，超期返回 `terminationState='unknown'`，不得阻塞主进程。
- `ResearchTimeoutEvidence={ executionId, workKey, sourceVersion, providerId, terminationState:'closed'|'alive'|'unknown', terminationCause:'timeout_kill'|'natural_exit'|'user_cancel'|'unknown', exitCode, signal, stdoutDrained, stderrDrained, outputCheckedAfterClose, completedWebEvents, completedToolEvents, outputPresent, outputSize, localReceiptPresent, businessWriteStarted, sideEffectClass:'read_only_research', stderrSummary, eventTypeCounts, startedAt, timeoutAt, closedAt, graceCompletedAt, checkedAt }`。`stderrSummary` 最多 2KiB，事件只保存类型和数量，不保存提示词、学生正文、搜索词、URL、网页正文或模型输出。
- `classifyResearchTimeout(evidence, retryBudget) -> { disposition:'safe_retry'|'execution_unknown'|'terminal_failure', reasonCode, nextRetryAt?, nextProviderPolicy?, evidenceRef }`。

固定判据：

- `safe_retry`：只允许 `terminationState==='closed'`、`terminationCause==='timeout_kill'` 或明确可重试的自然退出、不是用户取消、stdout/stderr 已排空、close 后输出复查及观察窗已完成、`completedWebEvents===0`、无任何工具完成事件、无输出/本地回执、`businessWriteStarted===false`、只读研究副作用类别、执行身份/工作键/来源版本一致，且仍有失败预算。模型调用可能已经计费，报告必须如实记录这一成本，不能称为“从未发送”。
- `execution_unknown`：任一网页/工具事件、输出或回执；进程仍存活或终止未确认；流未排空；输出未在 close 后复查；业务写入可能开始；身份不一致；诊断字段缺失。不可查询的所谓“远端回执”不作为虚构条件，Codex CLI 仅以本地可观测协议和只读副作用边界判定。
- `terminal_failure`：旧执行已按上述规则安全关闭或明确失败，且同一 `workKey+sourceVersion` 的全路由预算耗尽；仍有未知原执行时禁止转终态。

固定重试预算：同一 Provider 每个路由轮次最多启动一次，同一 `workKey+sourceVersion` 24 小时内最多两轮完整路由；首轮 `safe_retry` 优先在 15 秒内选择用户顺序中尚未尝试且已就绪的下一 Provider；没有其他合格 Provider 时，原 Provider 最多在 5 分钟后再试一次。资源/能力等待不计执行次数；`execution_unknown` 不切换 Provider、不建立新尝试。

- [x] 红灯覆盖已确认关闭、零工具/输出的超时，现产生有预算的 `safe_retry`，持久结算旧尝试但不制造业务成功或人工包。
- [x] 红灯覆盖未收到 `close`、迟到输出、流/观察窗不完整、任意工具/网页事件、回执、身份不匹配与用户取消；统一保持原执行核对或取消语义。
- [x] 超时、close 与输出竞态只允许一次分类；既有 executionId/sourceVersion 防护继续拒绝迟到外来结果覆盖。
- [x] `createCodexResearchSearch` 已改为异步收尾，5 秒上限内等待 close、流排空及 close 后观察，并在临时目录清理前返回去敏证据。
- [x] `submitResearchTask` 先分类再结算：安全无输出采用 `safe_retry_no_output`；未知保持原 executionId、核对时间且不重派。
- [x] 复用 Task 2 路由、Task 4 单计时器及 v5 execution budget；下一 Provider 排除本轮已超时 Provider，同一工作键仍受单活跃尝试约束。
- [x] 隔离真实 Codex 0.130.0-alpha.5 已验证“确认关闭→safe_retry”和“未确认关闭→execution_unknown”，并确认测试子进程清理；网页事件稳定性及完整进程树继续由 Task 4b/C4 同候选三轮验收，不以本项替代。
- [x] 运行 research/planning/capability/claim/dispatch 测试 52 项及 typecheck，零失败。

