### Task 4：把等待接回真实唤醒

**Files:** 修改 `electron/main.cjs` 的 resumeAutomaticTaskWake、restoreAutomaticTaskWakeups、runUnifiedTaskScheduler、手工执行入口，及 `electron/task-auto-dispatch.cjs`、`electron/task-runtime-policy.cjs`；按需改 `electron/task-retry-queue.cjs`；新增 `tests/task-capability-wakeup.test.cjs`。

**Interfaces:** `capabilityWait={providerIds,profileId,configRevision,probeAttempt,nextRetryAt,reasonCode}` 保存任务 payload；同时使用现有可索引 next_retry_at，但通过 reason 区分业务失败重试，避免双队列所有权。等待结束原子清理本原因，不清除其他资源等待。

- [x] 写测试：没有任何新事件仍到期唤醒；重启分页重建；能力就绪事件提前唤醒；旧 timer 不覆盖新到期时间；候选刷新保留等待；等待不消耗执行预算。
- [x] 运行 `node --test tests/task-capability-wakeup.test.cjs`；既有实现直接通过，因此按复核项保留，不制造伪红灯。
- [x] 复核 existing automaticTaskWakeQueue：每批最多 20 项、最近到期单计时器、退出关闭、重启 SQL 分页恢复；能力变化只定向唤醒受影响任务。
- [x] 所有自动和显式入口复用 Task 2；普通任务页刷新不触发能力探测。unknown 等待不进入手工包；周期兜底跳过已在队列/领取中的任务。
- [x] 受控队列测试验证精确到期回调；生产保留 15s 合并窗并单独记录资源等待。能力恢复事件可重置耗尽等待并定向唤醒。
- [x] 运行新增测试与 `tests/task-auto-dispatch.test.cjs`，限定提交。

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

- [ ] 写红灯：启动已确认、零工具事件、零输出、子进程 `close` 已确认、流已排空且观察窗完成的 `RESEARCH_TIMEOUT` 应产生 `safe_retry`，保存 `nextRetryAt/nextProviderPolicy`，关闭旧活跃尝试但保留审计，并且不进入“需要帮助”。
- [ ] 写红灯：仅调用 `terminateProcess` 但未收到 `close`、关闭后发现输出、流未排空、观察窗未完成、任意网页/工具事件、结果文件/回执或仍存活进程，必须保持 `execution_unknown`；用户取消必须保持取消语义且不得自动重试；不得调用下一 Agent，且须保存下一次核对时间或明确核对耗尽状态。
- [ ] 写红灯：超时触发与 `close`/输出写入同时发生时，只允许一次分类；同一 `executionId/workKey/sourceVersion` 的迟到有效结果先结算成功，旧执行已安全关闭后到达的不匹配结果只记录审计，不得覆盖新执行。
- [ ] 在 `createCodexResearchSearch` 用异步收尾替代“终止后立即 reject”：诊断在临时目录删除前生成并持久交给调用方；5 秒收尾期限内不持有任务重资源许可之外的新全局锁，超期归 `execution_unknown`。
- [ ] 让 `submitResearchTask` 先调用 `classifyResearchTimeout` 再决定 `settlePersistentTaskAttempt`：`safe_retry` 将旧尝试结算为 `result_kind='safe_retry_no_output'` 并写入定向重试；`execution_unknown` 保留原尝试和真实核对计划；成功/迟到回执仍用原 executionId 幂等结算。
- [ ] 复用 Task 2 能力路由和 Task 4 单计时器；一次 `safe_retry` 不持有重资源许可，真正启动时才申请。同一工作键同时最多一个活跃尝试，所有入口共享上述两轮预算，不能换 Provider 或重启后清零。
- [ ] 在隔离真实 Codex 子进程验收：分别验证零工具事件超时、安全重试后的成功、一个网页事件后超时、终止未确认、关闭后迟到输出、迟到回执竞争及 CLI 明确退出失败；记录进程树、受限诊断、任务事件和页面状态。不得以注入事件替代全部真实场景。
- [ ] 运行 `node --test tests/planning-research.test.cjs tests/research-timeout-recovery.test.cjs tests/task-capability-wakeup.test.cjs`，并将“零网页事件但无后续动作”和“未确认退出却重派”列为必须消除的红灯；限定提交。

### Task 4b：把“研究任务可恢复”与“Codex 联网真实可用”分开验收

**Files:** 新增 `scripts/probe-codex-research-host.cjs`、`tests/planning-research-host-contract.test.cjs`；按因果证据最小修改 `electron/planning-research.cjs` 或 Agent 配置，不预设一定需要生产修复；新增 `artifacts/p0-agent-0228/codex-research-host-diagnosis.json`。

**Interfaces:** `probeCodexResearchHost({ executable, timeoutMs, isolatedInput, outputDir }) -> { processStarted, toolDiscoveryObserved, firstEventAt, webEventCount, structuredOutputPresent, exitCode, failureClass:'tool_discovery'|'authentication'|'network'|'model_no_tool_call'|'output_protocol'|'timeout'|'none', evidenceFiles }`。输入只用隔离合成主题，不读取学生或项目资料。

- [ ] 先写合同测试：探测器必须区分“CLI未启动、登录失败、无联网工具、模型未调用工具、已联网但输出协议失败、成功”；缺字段或仅凭超时猜测原因时验收失败。
- [ ] 使用与候选相同的 Codex 可执行文件、参数、账号环境和网络运行至少3次最小联网研究，保留完整进程树、受限事件类型、退出码和输出存在性；不得把一次成功当作稳定能力。
- [ ] 只有证据指向具体生产缺陷时才做最小修复，并为该缺陷先写红灯；若是外部登录、网络或模型波动，保持环境错误并让 Task 2 路由下一合格 Provider，不修改研究真实性门槛。
- [ ] 验收两个独立结果：Task 4a 必须保证失败可自动闭环；Task 4b 必须证明 Codex `research.v1` 在同候选环境至少2/3次成功并返回可验证网页事件和结构化结果。前者通过不能替代后者。
- [ ] 把探测工具限定为验收脚本，不加入启动路径、常驻探测或安装包生产依赖；限定提交。

