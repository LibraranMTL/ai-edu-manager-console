# ADR-001：GBrain P0 采用边界

> 状态：接受（P0 有条件完成）  
> 日期：2026-07-21  
> 实测版本：GBrain `0.42.63.0`、Bun `1.3.14`  
> 数据集：`education-synthetic-v1`，仅虚构数据  
> 检索模式：`conservative`，未配置嵌入或外部模型凭据

## 决策

AI教育管家继续保留 `KnowledgeEngine` 可替换边界。GBrain 可作为实验性、可选知识引擎，通过适配层接入；不得成为教育业务代码、学生业务 ID、权限决策或正式知识发布规则的直接依赖。

P0 之后可以继续 P1 教育协议和兼容映射，但不能据此启用真实学生数据、生产 GBrain 后端或 Agent 写回。

## adopt：直接采用

1. PGLite 本地单机运行方式，用于隔离试验和小规模本地知识引擎。
2. GBrain CLI/MCP 的统一操作面，包括 `get_page`、`search`、`add_link`、`add_timeline_entry` 和图遍历。
3. 原生关系图和时间账本，用于承载通用关系与事件能力。
4. Markdown 页面和 CLI Markdown 导出，作为可读、可迁移的数据层。
5. `doctor --json`、Schema 迁移和健康检查，作为引擎运维诊断基础。

## adapt：通过适配器使用

1. 使用教育管家稳定业务 ID 生成 GBrain slug；不能让 GBrain 页面 ID 替代 Student、Project、Claim 或 Evidence ID。
2. 原始资料不可变、confirmed Claim 强制 Evidence、候选默认隐藏和 Claim 历史修订由 `KnowledgeEngine` 适配层补充。
3. 学生范围过滤、敏感字段过滤和 Agent 授权由上层 `AgentPolicy / ContextGrant` 执行；GBrain 不决定教育可见性。
4. GBrain 原生导出补充合同级 `snapshot.json`，确保 Markdown 与稳定 ID JSON 可同时审计。
5. Windows 写入统一走 UTF-8 文件与 `gbrain capture --file`，避免把大段或复杂内容直接塞入命令行参数。
6. P0 每次运行使用独立 `GBRAIN_HOME + PGLite`。同一 brain 中仅用 slug 前缀模拟隔离时，重复内容检索会被去重到先写入页面，不能视为强租户隔离。
7. 生产适配器必须定义写后检索缓存失效、结果作用域复核和跨 Profile 泄漏测试。

## build：教育管家自建

1. Education Domain Protocol：教育对象、证据权重、反例、过期、纠正、申诉和发布规则。
2. 未成年人权限：设备、人员、学生资料和 Agent 授权分层。
3. KnowledgeProposal 审核、正式发布、撤销和审计事务。
4. 行动建议、执行、反馈和结果变化闭环，且不得自动推断因果。
5. 现有 LLM Wiki 本地引擎、任务包和人工流程的离线降级。
6. 引擎绑定、稳定 ID 映射和可回滚切换。

## defer：暂缓

1. GBrain 生产后端和真实学生资料导入。
2. 向量嵌入、语义扩展、reranker 和完整混合检索质量/成本评估。
3. Supabase、多主机共享 brain、HTTP MCP OAuth 和机构多租户。
4. GBrain 技能包、自动采集、autopilot 和 dream cycle。
5. Agent 写回、A2A 编排和无人审核的长期知识更新。

## 实测证据

- 十个固定教育场景：`10/10` 通过；
- MCP stdio：通过，列出 `102` 个工具，并成功调用 `search`；
- 图谱：`add_link + traverse_graph` 通过；
- 时间账本：纠正与申诉各写入一条 timeline；
- 导出：`17` 个 namespace 页面导出为 Markdown，并生成合同级 JSON；
- 引擎停用：本地 LLM Wiki 仍可读取同一稳定来源 ID；
- 总实跑时间约 `120.5` 秒，Windows CLI 进程启动开销明显。

运行证据位于忽略版本控制的 `.gbrain-evaluation/results/latest.json` 和 `.gbrain-evaluation/results/latest.md`。

## 未关闭风险

1. 未配置嵌入提供商，因此只验证关键字/FTS 检索，没有验证完整向量和 reranker 路径。
2. `doctor` 健康分为 `70`，警告来自未安装技能包、无嵌入、空 take 等刻意限制；连接、pgvector 和 Schema v124 正常。
3. 当前 transport 为同步 CLI 评估实现，性能不足以作为生产请求路径；P4 应改用长驻 MCP 或正式 SDK/HTTP transport。
4. GBrain 的多 source、OAuth scope 和远程安全能力尚未按未成年人多主体模型验证。

## 复审条件

在启用真实资料或进入 P4 生产适配前，必须补充：

- 独立测试凭据下的向量/混合检索质量和成本评估；
- 多 Profile、多 Agent、过期授权和敏感字段的端到端越权测试；
- 长驻 MCP transport 的并发、超时、重试和缓存失效测试；
- 备份、恢复、升级和回滚演练。
