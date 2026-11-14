# AI教育管家 0.23.0 共享契约 v1

状态：已冻结字段语义；业务数据库仍保持独立。实现入口：`electron/shared-contracts.cjs`。

## 边界

- 共享契约只统一主体范围、证据引用、截止时间、读者投影、提交键及更正/撤回语义。
- 资产、学情和项目报告继续使用独立数据库、迁移和功能开关，不建立通用业务数据仓库。
- 所有构造器返回不可变值，不读取文件、不访问数据库、不产生业务写入。
- 真实学生数据不得进入测试；`tests/fixtures/0230/shared-contracts.json` 仅包含两名虚构学生和一个虚构多人项目。

## 六类契约

### SubjectScope

包含可信 `actorId/actorRole`、明确的 `studentIds`，以及可选 `projectId/deviceId`。学生 ID 不从当前页面、名称相似度或最近一次会话推断。主体范围至少包含一个学生或一个项目。

### EvidenceRef

包含 `sourceType/sourceId/revision/contentHash/availability`。`contentHash` 固定为 SHA-256；只有 `availability=active` 时 `usable=true`。撤回、失效、缺失和禁止读取不得回退成其他来源。

### AsOfContext

包含 `asOf/timezone/policyVersion/dataGeneration/authorizationVersion`。跨模块读取必须在同一个截止时间和时区解释数据；响应代次低于当前代次时不得覆盖当前界面。

### AccessProjection

包含读者身份与角色、允许的学生白名单、字段白名单和授权版本。读取同时校验学生和字段，任一不匹配返回 `subject_scope_forbidden`。

### CommitKey

由业务命名空间和稳定组成部分生成 SHA-256 键。相同业务意图重试得到同一键；修订、周期或对象改变时生成不同键。未知执行结果必须先使用原键对账，不得另建替代行动。

### CorrectionRecord

更正与撤回采用追加记录，绑定对象、期望修订、动作、原因、主体、时间和提交键。旧快照和历史报告不物理改写。

## 固定错误码

| 错误码 | 含义 |
| --- | --- |
| `shared_contract_invalid` | 字段、时间、哈希、角色或修订不符合契约 |
| `subject_scope_required` | 写入未携带明确学生或项目范围 |
| `subject_scope_forbidden` | 读者不在学生白名单内或字段未授权 |

## 兼容规则

- v1 新字段只能以可选字段追加；改变既有字段含义必须升级契约版本。
- SQLite 业务迁移只前进，契约升级本身不清空或重写业务库。
- 页面浏览、报告下钻和导出预览只能消费这些契约，不得以“补齐上下文”为由产生业务写入。
