### Task 3：Worker 持久领取与发送屏障

**Files:** 修改 `electron/task-sql-store.cjs`、`electron/task-store-writer.cjs`、`electron/task-store-service.cjs`、`electron/main.cjs`；新增 `tests/task-execution-claim.test.cjs`。既有 task-state-store 的旧 JSON 导入入口保持兼容，不另建存储。

**Interfaces:** 实现 claimTaskExecution/advanceTaskExecution；Worker 操作为 `store_claim_execution`、`store_advance_execution`；返回最新任务行/revision 供主进程定向更新缓存。

- [x] 写测试：两个入口同任务/同工作键只有一次领取；Worker 提交后丢回包、重启后 send_intent、旧 unknown 未回填、撤销/取消/来源变更均不重复启动。
- [x] 运行 `node --test tests/task-execution-claim.test.cjs`；既有实现直接通过，因此按复核项保留，不制造伪红灯。
- [x] 复核已有 v4→v5 在线备份和小型迁移；事务内领取/事件/版本更新及服务层单写 tail、durableRevision/byId/taskRevisions 均已有覆盖，无需重跑迁移或补代码。
- [x] 复核自动即时、兜底、重试、恢复与用户入口最终都经统一适配器提交路径；外部 CLI 进程经持久领取和 `send_intent` 屏障，能力或资源等待发生在领取之前。
- [x] 验证部分唯一索引、回滚、备份恢复、旧模式读取及新模式拒绝降级；正常领取竞争返回业务结果，不把 TASK_STORE_CONFLICT 误升级成全库永久故障。
- [x] 运行新增测试及 task-store 相关回归；确认外部调用前事务已持久提交，限定提交。

