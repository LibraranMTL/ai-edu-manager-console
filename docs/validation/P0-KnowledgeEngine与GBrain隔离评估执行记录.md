# P0 KnowledgeEngine 与 GBrain 隔离评估执行记录

> 开始日期：2026-07-21  
> 当前状态：核心合同验证完成；向量/混合检索补充验证待独立测试凭据  
> 数据边界：仅虚构数据；未读取、复制、导入或连接任何真实学生资料。

## 运行环境

| 项目 | 实测值 |
| --- | --- |
| Bun | `1.3.14` |
| GBrain | `0.42.63.0` |
| Engine | PGLite，本地独立实例 |
| Schema | v124 |
| 检索模式 | `conservative` |
| 嵌入/外部模型 | 未配置 |
| 最终运行 ID | `20260721124309` |
| namespace | `edu-manager-synthetic-eval-20260721124309` |
| 健康检查 | warnings / 70；连接、pgvector、Schema 和 search mode 正常 |

每次实跑都创建独立 `.gbrain-evaluation/runs/<runId>/runtime`，不会读取用户默认 `~/.gbrain`，也不挂载正式知识空间、备份或凭据。

## 已交付

1. `edu-manager.knowledge-engine.v1` 合同。
2. 现有本地 LLM Wiki 引擎。
3. GBrain P0 评估适配器和真实 CLI transport。
4. 非虚构写入、跨 namespace 引用和非隔离 home 三重硬阻断。
5. 十个固定虚构教育场景与可重复运行器。
6. GBrain 原生 Markdown + 合同级 JSON 双格式导出。
7. stdio MCP 实际握手、工具列表和工具调用验证。
8. `adopt / adapt / build / defer` ADR。

## 十场景结果

| 场景 | 结果 | 实测证据 |
| --- | --- | --- |
| 01 原始资料不可变与幂等 | 通过 | 重复导入返回 duplicate；不同内容被 `IMMUTABLE_SOURCE_CONFLICT` 阻断 |
| 02 confirmed 强制 Evidence | 通过 | 无证据写入被拒绝；来源 URI 与摘录可读回 |
| 03 candidate 默认隐藏 | 通过 | 普通查询只返回 confirmed；显式 statuses 才返回 candidate |
| 04 冲突观察并存 | 通过 | 两条 Claim 均保留；原生 `conflicts_with` link 可读 |
| 05 时间修订与历史 | 通过 | Claim ID 不变；旧修订保存为独立 history 页面 |
| 06 实体关系检索 | 通过 | 稳定端点 slug、原生 link 和双向图遍历通过 |
| 07 两学生隔离 | 通过 | 适配层 subjectId 过滤不串档；无过滤调用明确返回两者 |
| 08 敏感字段分权 | 通过 | 普通查询隐藏；显式候选权限可读；权限决策保留在产品层 |
| 09 纠正与申诉事件 | 通过 | 两个事件页面和两条原生 timeline；处理责任人保留 |
| 10 导出、停用与降级 | 通过 | 17 页面 Markdown + JSON；GBrain 停用后本地 LLM Wiki 保留相同来源 ID |

十场景合计 `10/10` 通过。各场景耗时约 `3.9–22.1` 秒；全程约 `120.5` 秒，主要成本来自 Windows 上逐操作启动 CLI。

## MCP 实测

- 启动 `gbrain serve` stdio；
- JSON-RPC initialize 成功；
- `tools/list` 返回 `102` 个工具；
- `search` 与 `get_page` 均存在；
- `tools/call search` 成功返回。

## 发现并修正的问题

### 1. namespace 前缀不是强隔离

前两次被中断/复跑时，相同 Claim 内容存在于不同 namespace。GBrain 检索对重复内容去重，只返回最早页面；适配器再按新 namespace 过滤后得到空结果。

结论：同一 brain 中只靠 slug 前缀不能作为学生或租户隔离证明。P0 改为每次运行独立 `GBRAIN_HOME + PGLite`；生产必须另行验证 source scope、OAuth/RLS、Profile 策略和缓存失效。

### 2. 原生导出不是完整合同快照

GBrain CLI 可以导出 Markdown，但教育管家还需要稳定 ID、结构化 Claim/Evidence 和恢复清单。因此 transport 在原生 Markdown 导出后补充 `snapshot.json`。

### 3. GBrain 不负责教育发布规则

GBrain 可存储候选和敏感页面，但候选隐藏、学生范围和敏感字段权限必须由适配层及后续 `AgentPolicy / ContextGrant` 执行。

## 未验证项

未配置任何 API Key，因此本轮没有验证：

- 向量嵌入召回；
- ZeroEntropy reranker；
- LLM 查询扩展；
- 相关费用、延迟和外部数据边界。

这部分列为生产 GBrain 适配前的补充闸门，不阻塞 P1 Education Domain Protocol 和旧数据兼容映射继续开发。

## 复现

```powershell
node scripts/check-gbrain-evaluation-readiness.cjs
node scripts/run-gbrain-education-evaluation.cjs
```

运行器只使用 `tests/fixtures/knowledge-engine/education-synthetic-v1.json` 定义的虚构场景。详细结果保存在忽略版本控制的：

- `.gbrain-evaluation/results/latest.json`
- `.gbrain-evaluation/results/latest.md`

## 决策与下一步

- [ADR-001：GBrain P0 采用边界](../architecture/ADR-001-GBrain-P0采用边界.md)
- 下一步进入 P1：现有成长证据兼容映射和 Education Domain Protocol v1 冻结。
- 在 P4 或真实数据接入前补做向量/混合检索、多主体权限和长驻 MCP transport 验证。
