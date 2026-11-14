### Task 2：逐执行器就绪与缓存修复

**Files:** 新增 `electron/agent-capability-readiness.cjs`、`tests/agent-capability-readiness.test.cjs`；修改 `electron/main.cjs` 的 refreshAdapterCapabilities、adapterCapabilities、routeTask 入口；复用 `electron/agent-capability-contract.cjs`、`electron/agent-control-plane.cjs` 合同。

**Interfaces:** 实现上面的 createDispatchCapabilityGate；输入只含候选 Provider、目标合同、配置版本及取消信号，不读全项目。

- [x] 写测试：冷缓存不能直接人工；20 项同配置共享刷新；Codex 超时后成功可自动执行；一家的错误不污染另一家；旧配置迟到结果丢弃；锁定与顺序保持。新增当前缺陷回归：Provider A 正在 `refreshing/unknown`、Provider B 已有新鲜 `available` 证据时，未锁定任务必须选择 B；仅显式锁定 A 时才等待 A。
- [x] 运行 `node --test tests/agent-capability-readiness.test.cjs` 留存红灯。
- [x] 实现 tri-state、期限、TTL 和错误透传；移除 catch 把失败缓存标为成功新鲜的行为。`ensureReady` 必须先扫描全部候选的新鲜 `available` 记录，再决定是否等待仍在刷新者，不能因列表中较早的 Provider 正在刷新而提前返回。主窗创建不等待探测；有待办时按需预热，不启动全部安装工具。
- [x] 在途探测时 ensureReady 立即返回 wait 并订阅完成唤醒，不让一个任务占住串行 drain 等待15秒；单任务取消仅移除订阅，不取消其他任务共享的探测。加入慢Provider不饿死后续可派发任务的测试。
- [x] 测试热缓存不探测、无任务不常驻探测、未知耗尽显示环境帮助；全候选明确不可用才生成幂等人工包。
- [x] 运行新增测试及 `node --test tests/agent-control-plane.test.cjs tests/agent-task-channel.test.cjs`，限定提交。

