### Task 5a：未绑定全局收件箱不再制造“需要帮助”任务

**Files:** 修改 `electron/smart-inbox.cjs`、`electron/smart-inbox-host.cjs`、`electron/main.cjs`、`electron/task-read-model.cjs`、`src/SmartInboxPanel.tsx`；新增或扩展 `tests/smart-inbox-task-center.test.cjs`、`tests/smart-inbox.test.cjs`。

**已确认的运行事实（2026-10-30，只读）：** 来源 `legacy-download`（“下载文件”）仍持久化为 `enabled=true`、`automatic=true`，但 `studentId=''` 且 `target=null`。新发现的 `SHU YUAN ZHAO.pdf` 在 12:00:18Z 被登记为 `review`，原因是“仅确认学生/指定投递位置”；随后内置批次在约 0.32 秒内结算为 `needs_user_action`，生成任务 `intake-b9ac69d124ab2a23bb13`。没有调用 WorkBuddy 或任何外部 Agent。这是“无归属资料被错误提升到任务中心”的产品/状态机缺陷，不能归因于 Agent 超时或资源繁忙。

**Interfaces:** 无 `studentId` 且无 `target` 的来源项在收件箱中使用 `unassigned` / “待指定归属”表示；该状态不是任务中心的 `needs_help`，也不消耗任务、执行或回执核对预算。只有已存在学生/项目映射，或用户在收件箱明确选择学生（可选择“仅确认学生，由 AI 分类”）后，才可建立 `smart_material_intake` 工作键和进入自动调度。

- [x] 写红灯：启用的全局来源发现一个可支持文件、但 `studentId=''` 且 `target=null` 时，只新增一条收件箱 `review/unassigned` 项，不创建任务中心行、不调用 Agent、也不显示“需要帮助”。
- [x] 写红灯：用户关闭来源后，必须持久保存 `enabled=false`、`automatic=false`、`nextRunAt=''`，取消待触发扫描/重试；重启后不再发现、分类或生成候选。页面不能只改变按钮文案而遗漏写入。
- [x] 写红灯：用户明确绑定学生或目标后，同一资料只创建一次正常候选；若自动分类可安全完成则进入自动处理，不能因旧的 `unassigned` 状态生成第二张人工任务卡。
- [x] 实现来源级分流：保留原件、发现记录和手工投递入口；未绑定项只聚合显示为“待指定归属 N 份”，不在 `beginBatch/endBatch` 将 `review` 提升成 `needs_user_action`。已有已绑定来源、真实未知外部执行、回执核对仍沿用 Task 5 规则，不被该分流掩盖。
- [x] 为 `legacy-download` 保持兼容：不篡改既有收件箱记录、回执或已归档任务；仅从新候选及来源状态变化开始阻止新的无归属任务污染任务中心。提供来源设置读取回显，以验证“关闭自动整理”确实已保存。
- [x] 通过上述测试后，在隔离临时用户数据验证：放入未绑定资料后任务中心总数不增加；完成一次学生绑定后仅产生一个成功任务；关闭来源并重启后保持 `enabled=false`、`automatic=false` 且不再产生待办工作。

