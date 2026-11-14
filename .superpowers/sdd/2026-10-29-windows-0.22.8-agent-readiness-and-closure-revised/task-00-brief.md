### Task 00：复基线并冻结差量范围

**Files:** 修改本计划状态表；新增 `artifacts/p0-agent-0228/current-delta.json`、`artifacts/p0-agent-0228/current-delta.md`；不修改生产代码。

**Interfaces:** `current-delta.json` 对每项记录 `task, requirement, implementationFiles, testFiles, status=implemented_verified|implemented_unverified|partial|missing|superseded, evidence, remainingPatch, ownerTask`。

- [ ] 记录当前 Git HEAD、工作区差异、`package.json` 版本、任务库模式、关键源码哈希、正在运行候选 EXE/ASAR/ZIP 哈希；无法同源的运行证据标 `not_run`，不沿用旧结论。
- [ ] 对 Task 0—8、4a、4b、5a 逐项映射当前代码和测试；文件存在不得直接标 `implemented_verified`，必须有当前同源绿灯或真实证据。
- [ ] 标出本轮允许修改的确切代码块和不得触碰的用户改动；把已经实现且不需变更的步骤改为“复核”，不再次红灯或重写。
- [ ] 运行只读计划一致性检查：所有 `partial/missing` 都有一个后续红灯和负责人任务，所有 `implemented_verified` 都有证据路径及哈希。
- [ ] 提交仅包含复基线证据和计划状态更新；未经该差量清单冻结，不进入生产代码修改。

