### Task 4b：把“研究任务可恢复”与“Codex 联网真实可用”分开验收

**Files:** 新增 `scripts/probe-codex-research-host.cjs`、`tests/planning-research-host-contract.test.cjs`；按因果证据最小修改 `electron/planning-research.cjs` 或 Agent 配置，不预设一定需要生产修复；新增 `artifacts/p0-agent-0228/codex-research-host-diagnosis.json`。

**Interfaces:** `probeCodexResearchHost({ executable, timeoutMs, isolatedInput, outputDir }) -> { processStarted, toolDiscoveryObserved, firstEventAt, webEventCount, structuredOutputPresent, exitCode, failureClass:'tool_discovery'|'authentication'|'network'|'model_no_tool_call'|'output_protocol'|'timeout'|'none', evidenceFiles }`。输入只用隔离合成主题，不读取学生或项目资料。

- [x] 合同测试区分启动、认证、网络、模型配置、工具发现、无调用、输出协议、超时与成功；证据字段缺失直接失败。
- [x] 同候选 Codex CLI/账号/网络连续运行3次并保存进程树与受限事件；3次均在联网前稳定失败。
- [x] 因果证据定位到 Codex CLI 0.130.0-alpha.5 与账号模型不兼容；未降低真实性门槛，新增 `not_sent` 模型配置失败到下一合格 Provider 的自动回退。
- [x] Task 4a 的零副作用超时闭环已独立通过；Task 4b 的 Codex 联网能力为0/3，明确不合格并由自动回退满足失败闭环，不能宣称 Codex 联网通过。
- [x] 探针仅为验收脚本，不进入启动路径、安装包依赖或常驻探测。

