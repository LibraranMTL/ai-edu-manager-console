# Education Domain Protocol v1 草案

> 已由 [Education Domain Protocol v1](Education-Domain-Protocol-v1.md) 取代；本文仅保留为 P1 冻结前的历史草案。

> 协议标识：`edu-manager.education-domain.v1-draft`  
> 状态：P1 实施草案，尚未冻结  
> 原则：教育语义和发布责任独立于 LLM Wiki、GBrain 或未来知识引擎。

## 1. 五种知识类型

| 类型 | 含义 | 示例 | 展示要求 |
| --- | --- | --- | --- |
| `fact` | 可由直接记录核验的事实 | 某次任务提交时间 | 显示记录来源 |
| `report` | 某个主体的转述或自述 | 学生自述最近感到困难 | 显示谁说的，不改写成事实 |
| `observation` | 特定情境和时间中的表现 | 某次作品使用两种解法 | 显示情境、时间和观察者 |
| `inference` | 基于证据形成的推断 | 可能偏好图示策略 | 始终保留“推断”标签 |
| `recommendation` | 面向未来的行动建议 | 下周尝试一次口头复述 | 必须设置失效或复核时间 |

模型生成的推断即使经过人工确认，仍然是推断，不能改写成事实。

## 2. 六种证据来源

- `student_self_report`：学生自述；
- `parent_observation`：家长观察；
- `teacher_assessment`：教师评价；
- `learning_artifact`：作品、作业、报告等学习制品；
- `system_record`：提交、执行、完成等系统记录；
- `agent_inference`：Agent 基于其他资料生成的推断。

协议不使用单一数字把来源角色直接换算为真值。每种来源都必须明确展示，发布规则根据结论范围、来源独立性、人工审核和反例检查进行判断。

## 3. 结论范围

| 范围 | 含义 |
| --- | --- |
| `event` | 单次事件 |
| `context` | 特定课程、项目或环境 |
| `period` | 明确时间段 |
| `profile` | 跨场景、跨时间的画像级结论 |
| `permanent` | 永久标签；协议禁止 |

单次行为不得直接升级为画像结论。画像级 confirmed Claim 至少需要两个独立来源，并明确完成反例和冲突证据检查。

## 4. 正式发布条件

教育 Claim 进入 confirmed 前必须：

1. 至少包含一条 Evidence；
2. Evidence 有稳定 ID、来源 URI、来源类型和主体角色；
3. 由学生、家长、教师或管理员中的明确人员审核；
4. 记录审核人 ID 和审核时间；
5. 画像级结论至少两个独立来源；
6. 画像级结论明确记录已检查反例；
7. 不属于永久学生标签；
8. Agent 推断不被伪装成事实。

## 5. 禁止行为

- 将“懒惰”“聪明”“没有天赋”等价值判断写成永久学生标签；
- 把教师评价、家长观察或学生自述去掉主体后呈现为客观事实；
- 仅凭 Agent 推断发布事实；
- 用一次结果证明长期能力或因果关系；
- 删除旧结论来隐藏纠正、申诉或冲突；
- 让底层知识引擎自行决定教育结论是否发布。

## 6. 纠正、申诉与历史

纠正和申诉通过 Event Ledger 追加记录。错误 Claim 可以被 rejected 或 superseded，但不得无痕删除其历史。最终处理必须能定位到处理人、时间、依据和替代结论。

## 7. 当前代码与测试

- 校验实现：`electron/education-domain-protocol.cjs`；
- 现有成长证据只读兼容层：`electron/education-growth-compatibility.cjs`；
- 自动测试：`tests/education-domain-protocol.test.cjs`；
- 兼容测试：`tests/education-growth-compatibility.test.cjs`；
- [成长证据兼容映射 v1](成长证据兼容映射-v1.md)；
- 通用引擎合同：[KnowledgeEngine 合同 v1](../architecture/KnowledgeEngine-contract-v1.md)；
- 阶段记录：[P0 执行记录](../validation/P0-KnowledgeEngine与GBrain隔离评估执行记录.md)。

## 8. 冻结前待决策

1. 学生对不同年龄阶段画像结论的知情与确认方式；
2. 家长、教师和机构管理员审核权限的边界；
3. 哪些敏感字段禁止提供给外部 Agent；
4. `profile` 结论对来源数量和时间跨度的更细规则；
5. 纠正、申诉、删除和法定保留期限；
6. 旧 confirmed 成长证据缺少 reviewerRole、reviewerId、reviewedAt 时的补审体验和迁移期限。
