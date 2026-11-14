### Task 6：低负荷存量恢复与人工兜底

**Files:** 新增 `electron/task-backlog-recovery.cjs`、`tests/task-backlog-recovery.test.cjs`、`scripts/preview-task-backlog-recovery.cjs`；修改 `electron/task-sql-store.cjs` 的来源投影和修复游标、`electron/task-store-writer.cjs`、`electron/task-store-service.cjs`、`electron/main.cjs`、`electron/preload.cjs`、`src/SmartInboxPanel.tsx` 与 `src/main.tsx` 的既有批量核对入口。

**Interfaces:** `planTaskRecovery(task,evidence)` 返回 `settle_existing|requeue_proven_not_sent|reconcile_original|resume_safe_items|keep_paused|needs_confirmation|no_change`；`applyTaskRecovery({taskId,expectedTaskRevision,evidenceRevision,action})` 条件提交并追加审计；Worker cursor/job 元数据支持续跑。

- [x] 未认领、进程停止、人工包不完整、迟到回执竞争、取消与暂停边界均有测试。
- [x] 恢复规划和Worker条件提交测试4项通过；实现已在冻结0.22.8差量中。
- [x] 正式库只读预览；副本恢复仅接受匹配的有效回执、持久`not_sent`或原执行核对，不重新生成Agent成果。
- [x] Worker预览每页最多20、500ms墙钟；100k任务5000页中单页最大2ms，主事件循环最大11.96ms。
- [x] 副本按1→剩余7项验证；合成100k任务按1→20验证，数量、执行身份、预算、结果哈希和审计守恒。
- [x] 当前页筛选入口只允许三种证据操作，展示后果；未知执行不能批量标成功或绕过版本校验。
- [x] 30k/40k/100k资料、40k/100k投影、100k消化记录及100k任务恢复/增量性能均通过；正式积压未执行。

