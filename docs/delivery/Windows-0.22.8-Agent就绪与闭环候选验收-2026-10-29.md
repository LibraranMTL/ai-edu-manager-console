# Windows 0.22.8 Agent 就绪与闭环候选验收

日期：2026-11-01
候选：`0.22.8-agent-closure-r1`
结论：**本地候选验收通过；未正式发布、未上传、未更新正式发布清单。**

## 1. 候选身份与包体

- 构建审计提交：`bc1b6d0fe9750d401cd25fe20fd89f0f1923686e`
- 源状态内容哈希：`38F6FF32CBCEC282178B57D47E7D83B0A1CAD373D46629D3E43F8DF7C0E6E1F6`
- `app.asar`：`F4C453CF69B37325D06FE72D8539AC2FA196C43AA644CFFA5E91C069BEB08C58`
- 便携 EXE：98,994,009 bytes；SHA-256 `30BB8F8FECB96720DC035344C8DBA2BAE14DB218143755D0548CBB4C66744B16`
- ZIP：99,002,839 bytes；SHA-256 `EAC626BAD5E706EC0CF714B61112490BCA1B3974355F90684C01FD7551416129`
- 安装包：99,699,670 bytes；SHA-256 `F94049DC45BDD0D948D9B95ED5A32CA04825073F27E26C27D81BA3A959BBCB10`
- EXE / 安装包 Authenticode：`NotSigned`；不得宣称已签名。
- 三种交付物均来自同一冻结运行时；安装包逐文件比对 246 个运行时文件，ASAR 哈希一致。

## 2. 真实 Agent 与强制矩阵

- WorkBuddy、Codex 各完成 3 次独立合成资料闭环：登记、真实外部进程、结构化结果、主机提交和结算均完整。
- 明确失败、异常退出、结果未知和迟到回执保护通过；未知结果没有盲目切换或重复调用。
- A1—A15、B1—B7、C1—C5 共 27 项全部绑定同一候选哈希并通过。
- C4 诊断确认当前 Codex CLI 因账号模型 `gpt-5.5` 不兼容在发送前失败；系统安全回退 WorkBuddy。
- WorkBuddy C4 使用生产 `research.v1` 资格缓存和最小 IANA 单页 WebSearch，3/3 通过；实际研究耗时 26,627ms、23,646ms、32,130ms，均经主机独立抓取和结构化校验。
- 全部真实 Agent 验收使用隔离合成资料，`formalStudentDataTouched=false`。

## 3. 性能结果

正式配对场景均为 3 轮：空闲 10 分钟、正常真实 Agent 10 分钟、积压真实 Agent 30 分钟。

- 空闲主进程单核等效 CPU：0.03%。
- 可见操作 90 次，点击至下一帧 P95：38.21ms；新增主线程长任务最大 0ms。
- 主进程额外内存：532,480 bytes。
- 正常场景完成 3 个业务工作；积压场景完成 39 个业务工作；没有重复执行或超时。
- 配对吞吐损失为 -333.33%，即积压场景吞吐高于基线，不存在计划所限的超过 5% 下降。
- 资产 5k、项目 30k/100k、任务 162/10k/100k 基准均通过；10万任务当前页 P95 27.92ms、单任务更新 P95 10.35ms、100条批量更新 P95 18.53ms、RSS 增量 33.95MiB。

## 4. 安装、升级与启动

- NSIS 静默安装退出码 0，安装后的 ASAR 与冻结候选一致。
- 在同一隔离安装目录再次覆盖安装，外置临时 `%APPDATA%` 用户数据标记保持不变。
- 安装后运行时成功启动 4 个同路径进程；测试结束后仅关闭本次启动的进程。
- 测试揭示同 AppId 的 NSIS 安装会迁移现有 0.21.6 安装位置，即使指定 `/D`；本机卸载登记当前指向隔离候选目录。正式发布前需由用户决定是否保留该候选安装或恢复正式版。
- 正式学生资料、项目资料和任务数据库未修改；验收报告 `formalDataModified=false`。

## 5. 回归与门禁

- `pnpm typecheck`：通过。
- `pnpm test`：2782 passed、0 failed、1 skipped。
- `pnpm test:windows`：437/437 文件通过；Android-only 合同不属于本候选门禁。
- `pnpm test:p0:evidence`：29/29 通过。
- `pnpm acceptance:p0:green`：12/12 通过。
- `acceptance-agent-0228 --stage=release`：`passed=true`、27/27、`formalDataModified=false`、`published=false`。

核心证据：

- `artifacts/p0-agent-0228/acceptance-index.json`
- `artifacts/p0-agent-0228/acceptance-result.json`
- `artifacts/p0-agent-0228/formal-performance.json`
- `artifacts/p0-agent-0228/r1-real-host/packaged-research-fallback-cached/summary.json`
- `artifacts/p0-agent-0228/install-upgrade-acceptance.json`
- `release/windows/candidates/agent-closure-r1/installer/installer-audit.json`

## 6. 发布边界

本结论只表示本地候选验收通过。候选未上传、未部署、未更新下载页或正式发布清单。正式发布和代码合并仍需另行明确授权；`NotSigned` 状态必须如实保留。
