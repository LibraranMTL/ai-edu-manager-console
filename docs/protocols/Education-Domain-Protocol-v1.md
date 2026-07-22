# Education Domain Protocol v1

> 协议标识：`edu-manager.education-domain.v1`  
> 状态：P1 已冻结  
> 默认知识引擎：`llm-wiki-local`  
> 兼容策略：登记接管、原地兼容、按需迁移

## 1. 五类正式对象

| 对象 | Schema | 必填字段 | 稳定字段 |
| --- | --- | --- | --- |
| Student | `edu-manager.student.v1` | `id`、`name` | `id`、`rootPath` |
| LearningProject | `edu-manager.learning-project.v1` | `id`、`name`、`studentIds`、`status` | `id`、学生绑定、工作与知识路径 |
| GrowthEvidence | `edu-manager.growth-evidence.v1` | `id`、`studentId`、`title`、`status`、`sourceUri` | `id`、学生、来源 URI、原路径 |
| LearningReport | `edu-manager.learning-report.v1` | `id`、`studentId`、`reportType`、`status`、`sourceClaimIds` | `id`、学生、文件路径 |
| EducationPolicy | `edu-manager.education-policy.v1` | `id`、`version`、`effectiveAt`、`reviewerRoles` | `id`、版本 |

代码定义位于 `electron/education-domain-schemas.cjs`。协议对象是现有数据的兼容视图，不要求改写旧学生、项目、证据和路径。

## 2. 知识语义

- `fact`：可以由直接记录核验的事实。
- `report`：学生、家长、教师等主体的转述或自述。
- `observation`：特定时间和情境中的表现。
- `inference`：基于证据形成、且必须始终标为推断的判断。
- `recommendation`：面向未来并带复核或失效时间的行动建议。

证据来源分为 `student_self_report`、`parent_observation`、`teacher_assessment`、`learning_artifact`、`system_record` 和 `agent_inference`。来源角色和原文片段必须保留，不能把主体意见改写成客观事实。

## 3. 发布规则

confirmed Claim 必须：

1. 至少包含一条带稳定 ID 和来源 URI 的 Evidence。
2. 由学生、家长、教师或管理员中的明确人员审核。
3. 记录 `reviewerRole`、`reviewerId` 和 `reviewedAt`。
4. 画像级结论至少包含两个独立来源，并完成反例检查。
5. 不属于永久学生标签。
6. 不把 Agent 推断伪装成事实。

历史 confirmed 记录缺少审核字段时，不修改原记录；协议视图将其列入 `reviewQueue` 并视为 candidate。用户在现有成长证据界面重新确认、继续观察或驳回后，系统写入本机管理员审核身份、时间和状态历史。

### 3.1 风险分级与批量审核

风险分级只用于安排审核优先级，不能降低第 3 节的正式发布条件。服务端按原始证据重新计算风险，不接受客户端声明的“低风险”结果。

- **低风险**：来源和项目上下文完整、置信度明确，且不含冲突、敏感内容或 Agent 推断。默认不出现在“需要关注”视图中，经用户一次确认后可批量发布。
- **中风险**：来源偏主观、置信度不足、缺少项目或能力标签，或来自待补充语义的旧数据。一次确认后只进入“继续观察”，不发布为正式结论。
- **高风险**：来源缺失、包含敏感内容或冲突、由 Agent 推断形成，或旧 confirmed 记录缺失人工审核。必须逐条处理，批量操作不改变状态。

批量审核是一次用户决定、多个可追溯审核事件：每条记录都必须保留审核人、审核时间、结果和共同批次 ID。默认隐藏低风险只减少日常提示，不删除记录，也不构成自动同意。

## 4. 年龄阶段和角色边界

| 阶段 | 学生参与 | 监护人确认 | 画像级独立确认角色 |
| --- | --- | --- | --- |
| 低龄/小学低段 | 简明说明并邀请表达 | 需要 | 家长、教师、管理员 |
| 小学中高段 | 适龄说明并征求同意 | 需要 | 家长、教师、管理员 |
| 初中阶段 | 完整摘要、知情、异议与纠正 | 画像级需要 | 家长、教师、管理员 |
| 高中阶段 | 学生优先确认 | 高风险画像需要 | 学生、家长、教师、管理员 |
| 成年 | 完整披露并自主决定 | 不需要 | 学生、管理员 |

无法可靠判断年龄时按未成年人保守策略处理。Agent 和 system 永远不能作为正式人工审核人。该产品策略用于界面与协议控制，不替代当地法律、学校制度或监护安排。

## 5. 纠正、申诉和历史

治理事件使用 `edu-manager.education-governance-event.v1`，支持：

- `correction`：学生或其他主体纠正事实、上下文或表达。
- `appeal`：对审核或发布结果提出申诉。
- `review_decision`：记录人工审核状态变化。
- `supersede`：以新 Claim 替代旧 Claim，但保留旧 Claim 和修订。
- `revoke`：撤销当前使用资格，但不无痕删除历史。

每个事件必须记录 Claim、主体角色、主体 ID、理由和时间。历史展示模型分别列出修订、纠正、申诉、审核决定和替代 Claim。

## 6. 禁止行为

- 将“懒惰”“聪明”“没有天赋”等价值判断写成永久学生标签。
- 删除旧结论来隐藏纠正、申诉或冲突。
- 由 Agent 单独发布正式事实或画像结论。
- 将单次表现直接升级为长期能力或因果结论。
- 未经明确人工审核，把项目贡献或旧成长证据写入正式画像。
- 让底层知识引擎决定教育结论是否发布。

## 7. 当前实现

- 对象 Schema：`electron/education-domain-schemas.cjs`
- Claim/Evidence 发布校验：`electron/education-domain-protocol.cjs`
- 年龄、角色、纠正、申诉和历史：`electron/education-governance.cjs`
- 旧成长证据和项目贡献兼容：`electron/education-growth-compatibility.cjs`
- 成长证据风险分级和批量计划：`electron/growth-evidence-risk.cjs`
- 本地知识引擎：`electron/llm-wiki-knowledge-engine.cjs`

P1 不安装外部数据库，不迁移真实学生资料，不改变任何现有业务 ID 或文件路径。
