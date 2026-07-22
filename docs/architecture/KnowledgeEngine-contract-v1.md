# KnowledgeEngine 合同 v1

> 合同版本：`edu-manager.knowledge-engine.v1`  
> 阶段：P0  
> 状态：已实现第一版，并由自动测试覆盖。

## 1. 边界

`KnowledgeEngine` 只负责知识的存储、检索、事件、关系和开放导出，不负责决定教育结论是否可以发布。以下责任必须留在教育管家产品与治理层：

- 学生、家长、教师和 Agent 的身份与权限；
- 什么可以成为成长证据；
- 事实、转述、观察、推断和建议的区分；
- 未成年人知情、纠正、申诉和删除；
- 候选知识审核、正式发布和行动反馈。

业务代码不得依赖 GBrain、PGLite、Postgres 或本地 Wiki 的内部表结构。

## 2. 必需方法

| 方法 | 作用 | 关键约束 |
| --- | --- | --- |
| `health` | 返回引擎、版本、读写和健康状态 | 不包含敏感凭据 |
| `importAsset` | 登记不可变原始资料 | 同一来源 ID 不允许静默覆盖 |
| `upsertClaim` | 新增或修订 Claim | confirmed 必须带 Evidence |
| `getClaim` | 按稳定 ID 读取 Claim | 未授权调用由上层阻断 |
| `search` | 按查询、状态和主体检索 | 默认只检索 confirmed |
| `appendEvent` | 追加知识事件 | 事件不可用来擦除历史 |
| `upsertRelationship` | 维护稳定对象关系 | 两端使用业务 ID |
| `exportSnapshot` | 导出 Markdown/JSON | 脱离原引擎仍可审计 |

## 3. 稳定 ID

引擎不生成 Student、LearningProject、GrowthEvidence、Claim 或 Evidence 的业务 ID。ID 由教育治理层产生，并在引擎切换、恢复和导出时保持不变。

第一版只接受 1–128 位可移植 ID：字母、数字、点、下划线、冒号和连字符。显示名称可以使用中文，但不能替代稳定 ID。

## 4. Claim/Evidence 最小约束

- Claim 状态：`candidate / confirmed / rejected / superseded`；
- confirmed Claim 至少包含一条 Evidence；
- Evidence 必须包含稳定 ID 和 `sourceUri`；
- Claim 修订不改变 Claim ID；
- 旧修订保留在历史目录中；
- 普通查询默认只返回 confirmed。

这只是通用引擎合同。教育语义、证据权重和禁止行为由 P1 的 Education Domain Protocol 定义。

## 5. 当前实现

- `electron/knowledge-engine-contract.cjs`：合同、错误码、ID 与 Claim 校验；
- `electron/llm-wiki-knowledge-engine.cjs`：现有本地 LLM Wiki 的 v1 适配器；
- `electron/gbrain-evaluation-adapter.cjs`：P0 隔离评估适配器，默认硬阻断非虚构写入；
- `electron/gbrain-cli-evaluation-transport.cjs`：真实 GBrain CLI/PGLite 隔离 transport；
- `tests/fixtures/knowledge-engine/education-synthetic-v1.json`：十个固定教育评估场景。

本地适配器将结构化索引写入知识空间的 `.edu-manager/knowledge-engine-v1`，不会改写现有概念库、实体库、摘要库或综合汇总库。

## 6. GBrain 适配约束

P0 只允许：

- 独立 namespace；
- 虚构评估资料；
- 独立凭据和独立存储；
- 可删除、可重复创建的环境；
- 通过 transport 适配器调用，不把 GBrain 操作散落到业务代码。

十个场景已在 GBrain `0.42.63.0` 独立 PGLite 中完成 `10/10` 实测，并形成 [ADR-001](ADR-001-GBrain-P0采用边界.md)。生产接入仍必须等待向量/混合检索、多主体权限、长驻 transport、备份恢复和升级回滚补充闸门完成。
