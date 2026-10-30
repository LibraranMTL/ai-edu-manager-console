# Windows 0.22.8 Agent 闭环只读基线

日期：2026-10-30

## 同源边界

当前运行程序为 `0.22.8-agent-readiness-r13-20261030`，EXE SHA-256 为 `0EA194E6FF0FB31B5989103EC5A3DC9F8A22921E144D2FCAF1C5FE0D2C5CB483`。当前隔离源码基线为 Git HEAD `1bc23c68d09c495bd0f9d2800ccbe1d46b5c937e` 加当前 0.22.8 未提交快照，`electron/main.cjs` SHA-256 为 `414E3426B6E16270951AC193A9986F840A95722BF8F9E2921784B9DBFCFF7B98`。

没有新的构建审计证明这两者逐字节同源，因此 r13 运行结论保留为历史运行证据，当前源码结论来自当前测试和静态路径；跨层结论一律标为待 Task 8 真实复验。Task 0 未重启正式程序、未修改正式任务库，也未读取学生正文。

## 首个失败转换

| 样本 | 首个不良转换 | 证据支持 | 根因状态 |
|---|---|---|---|
| `task-weekly_action-4580d72f2b69` | `task_prepared → manual_execution_prepared`，自动任务在没有真实 Agent 启动前转为人工包 | 旧任务时间线 | 原时间线支持；当前逐 Provider 修复待真实复验 |
| `intake-15d99c96e70cfa582003` | `intake_checked → reviewing/needs_attention`，未完成自动归属即进入任务中心人工态 | 旧任务时间线、当前 Smart Inbox 路径 | 源码与时间线支持；未绑定来源的统一分流仍缺失 |
| `task-project_digest-fdaf3489ebfa` | `controlled_material_started → timed_out/failed`，多次新 executionId 重试但未形成可验证结算 | 旧任务时间线 | 原时间线支持；旧执行不得因缺少领取证据而自动重派 |
| `task-learning_changes-08ca19a6c9eb` | 成功对照：`adapter_started → adapter_completed → report_auto_published` | 旧任务时间线 | 仅证明一个 Codex 自动闭环，不外推所有任务 |

## 根因分级

- **源码确认**：能力门控在迭代候选时可因较早 Provider 为 `refreshing/unknown` 提前返回 wait，尚未先扫描后续 fresh available Provider。
- **源码确认**：Codex 研究超时路径终止子进程后立即拒绝，没有 close/流排空/关闭后输出复查的受限证据，也没有 `safe_retry` 与 `execution_unknown` 的可靠分类。
- **源码确认 + 运行时间线支持**：全局来源没有学生和目标时，资料仍可被提升为任务中心 `needs_user_action`，而不是留在收件箱 `unassigned`。
- **当前测试已验证**：任务库 v5 的持久领取/发送屏障、能力等待持久恢复、闭环分类和会话统计。它们不需要重写，只在新状态接入后复核。
- **待真实复验**：修复后的真实 WorkBuddy/Codex 成功、明确失败、迟到回执、异常退出、结果未知，以及真实可见窗口性能。

## 验收口径勘误

- internal 任务性能不等于真实 Agent 性能。
- 注入失败或 Node 替身异常不等于 WorkBuddy/Codex 真实宿主失败。
- 完成数量不等于吞吐，必须具有相同可执行基线和时间窗。
- JavaScript `setTimeout` 延迟不等于用户点击响应；可见交互必须覆盖命令、Renderer、状态提交和下一帧。
- 旧原始 JSON 保留，不回写成通过。无法同源、未执行或证据不足的项目保持 `not_run`。

详细文件哈希和每个任务样本见 `evidence-index.json`；当前差量冻结见 `current-delta.json`。
