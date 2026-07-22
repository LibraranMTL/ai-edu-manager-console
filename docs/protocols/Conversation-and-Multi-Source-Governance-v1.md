# Conversation and Multi-Source Governance v1

> 协议标识：`edu-manager.conversation-governance.v1`  
> 阶段：P2  
> 默认知识引擎：`llm-wiki-local`  
> 部署约束：本地文件、零新增服务、原始资料不可变

## 1. 正式对象

| 对象 | Schema | 作用 |
| --- | --- | --- |
| Interaction | `edu-manager.interaction.v1` | 保存会话、工具、稳定会话 ID、消息及角色、时间、工具调用和消息定位 |
| ConversationAsset | `edu-manager.conversation-asset.v1` | 保存原始对话的稳定来源 URI、原路径、内容哈希、大小和本机存储位置 |
| KnowledgeCandidate | `edu-manager.knowledge-candidate.v1` | 保存逐条长期记忆、人设建议、咨询精华或待办候选 |
| PromotionTransaction | `edu-manager.knowledge-promotion-transaction.v1` | 把明确选择的候选作为一个可恢复、可撤销事务写入正式文件 |

Interaction 和 ConversationAsset 使用内容哈希生成稳定 ID。相同学生、工具和内容重复导入时返回原记录，不再创建重复文件。原始导入文件一经登记不被候选编辑、晋升或撤销操作修改。

## 2. 逐条候选规则

AI 提取结果只能进入候选登记表，不能直接追加 `UnifiedMemory.md`、`UnifiedSoul.md`、咨询精华或待办。每条候选必须独立保存：

- 候选 ID、学生 ID、目标类型和状态；
- 原始 ConversationAsset 或其他来源资产 ID；
- 稳定来源 URI 和内容哈希；
- 逐字原文片段；
- 消息 ID 或来源定位；
- 创建工具、创建时间、修改时间和完整操作历史；
- 敏感数据、提示注入、冲突、缺失来源和重复检查结果。

候选支持 `pending / rejected / merged / conflict / expired / promoted / revoked`。编辑、拒绝、恢复、合并、标记冲突、解决冲突、标记过期和敏感风险确认都必须追加历史，不覆盖旧决定。

## 3. 多源入口

统一候选入口接受：

- `conversation`：原始 Agent 对话；
- `screenshot`：截图或屏幕采集资产；
- `web`：网页快照或网页资料；
- `agent_result`：Agent 返回的分析或知识建议；
- `manual`：人工录入。

非对话来源也必须提供稳定来源 URI、内容哈希、原文或可核验片段和定位。入口仅登记候选，不绕过人工审核写入正式知识。

## 4. 风险和批量边界

- 缺少来源 URI、哈希、片段或定位：阻止晋升；
- 对话消息 ID 不属于原会话：阻止晋升；
- 原文片段无法在原资产中找到：阻止晋升；
- 提示注入内容：阻止晋升；
- 冲突或待核实内容：阻止晋升，直到人工解决；
- 敏感内容：显示提示并要求明确确认；
- 相同目标和规范化内容：按指纹去重；
- 单次提取最多登记 80 条，单次事务最多晋升 50 条。

任一所选候选被阻止时，整个晋升请求不写入任何正式文件，避免部分成功被误报为整体成功。

## 5. 晋升事务和撤销

晋升前先写事务日志，随后为每条候选生成带候选 ID 和事务 ID 的边界标记。每次目标文件写入使用同目录临时文件和原子替换。事务执行中持续更新操作日志；应用异常退出后，下一次打开对话中心会根据日志移除已写入标记并将事务标为已恢复失败。

正常撤销按事务标记只删除该事务写入的内容：

1. 原始 Interaction 和 ConversationAsset 保持不变；
2. 正式 Markdown 文件移除对应标记块；
3. 候选状态从 `promoted` 变为 `revoked`；
4. 事务状态从 `committed` 变为 `reversed`；
5. 任一步失败时恢复撤销前文件和候选登记表。

## 6. 当前本地目录

```text
Agent知识管理/对话历史/
├─ imports/                         # 不可变原始对话
├─ extracts/                        # AI 原始提取结果及候选 ID
└─ governance/
   ├─ interactions/                 # Interaction JSON
   ├─ assets/                       # ConversationAsset / 多源资产登记
   ├─ knowledge-candidates.json     # 逐条候选与历史
   └─ transactions/                 # 晋升事务和恢复记录
```

P2 不安装数据库，不启用 GBrain，不移动现有学生资料，也不改变已有学生、项目和资产 ID。
