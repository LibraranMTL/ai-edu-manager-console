# Windows 0.22.8 Agent 闭环差量冻结

日期：2026-10-30  
隔离分支：`codex/windows-0228-agent-closure`  
基线提交：`1bc23c68d09c495bd0f9d2800ccbe1d46b5c937e`

## 结论

当前工作区不是从干净 HEAD 重新开发，而是把正式工作区尚未提交的 0.22.8 状态复制到隔离 worktree 后继续。该复制快照包含 164 个已跟踪修改和 139 个未跟踪条目，只用于建立可执行基线；不得把整个快照直接合并回原工作区。

任务库只读检查为 `user_version=5`，并存在 `task_execution_attempts`。`package.json` 已为 `0.22.8`。因此 Task 3 的模式迁移不得重跑。

当前运行程序是 `agent-readiness-r13-20261030`：

- EXE SHA-256：`0EA194E6FF0FB31B5989103EC5A3DC9F8A22921E144D2FCAF1C5FE0D2C5CB483`
- ZIP SHA-256：`BE7AD1BA9AC5B233E2C400CC5FABB370CD8AC80AF04D799988C776F892DEABC0`
- 当前源码与运行包同源关系：`not_run`

在没有新的构建审计前，r13 的运行现象只能作为历史/运行事实，不能替代本 worktree 的绿灯。

## 测试基线

首次全量测试因隔离 worktree 缺少 Android JDK 和发布二进制夹具出现两项环境失败；将 `.android-tools` 指向原工作区并复制只读发布夹具后，全量测试为 2731 项、2730 通过、0 失败、1 跳过。冻结前重点 Windows 差量测试共 52 项，52 项通过。

仍缺两个计划要求的测试文件：

- `tests/research-timeout-recovery.test.cjs`
- `tests/planning-research-host-contract.test.cjs`

这两项分别归 Task 4a 和 Task 4b，不得被既有普通研究测试替代。

## 冻结后的实施范围

| 任务 | 状态 | 后续动作 |
|---|---|---|
| 0 | partial | 刷新同源证据与首个失败转换 |
| 1 | implemented_verified | 仅在证据 schema 改变时复核 |
| 2 | partial | 新增 A 正在刷新、B 已可用红灯；修复提前 wait |
| 3 | implemented_verified | 不重跑迁移；只审新外部入口 |
| 4 | implemented_verified | Task 4a 接线后复核唤醒 |
| 4a | missing | 新增超时收尾、分类和预算 TDD |
| 4b | missing | 新增真实 Codex 联网探测器和合同测试 |
| 5 | implemented_verified | 仅处理 Task 5a/真实闭环暴露的回归 |
| 5a | missing | 先阻止未绑定来源制造任务中心求助 |
| 6 | partial | 前置补丁通过后做副本渐进恢复验收 |
| 7 | implemented_verified | 新状态接入后复核展示 |
| 8 | partial | 最后构建同源预候选、真机矩阵与三件套 |

## 允许修改的代码块

- `electron/agent-capability-readiness.cjs`：只修改候选扫描与 wait 选择顺序。
- `electron/planning-research.cjs`、`electron/research-task-policy.cjs`、`electron/main.cjs`：只增加 Task 4a 的受限超时证据、分类、预算和结算接线。
- `electron/smart-inbox.cjs`、`electron/smart-inbox-host.cjs`、`electron/task-read-model.cjs`、`src/SmartInboxPanel.tsx`：只增加 Task 5a 的 unassigned 分流、来源关闭持久化及绑定幂等。
- Task 6/7/8 文件只在对应前置测试通过后修改。

不得触碰或覆盖：云端 `/v1`/`/v2`/MCP 合同、Android 业务代码、学生/项目物理资料、正式任务库、旧回执、迁移备份、正式发布清单，以及原工作区其他未提交改动。

## 一致性检查

- 每个 `partial` 或 `missing` 项都具有 `ownerTask` 和明确的后续红灯/验收动作。
- 每个 `implemented_verified` 项都具有本次冻结 worktree 内通过的测试证据。
- 无任何运行包同源结论被从旧报告继承；无法证明的 ASAR/源码对应关系明确标为 `not_run`。
- 正式任务库仅做只读模式检查，没有写入或迁移。
