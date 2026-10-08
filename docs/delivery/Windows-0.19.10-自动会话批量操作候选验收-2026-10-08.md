# Windows 0.19.10 自动会话采集批量操作候选验收

日期：2026-10-08。版本：Windows 0.19.10 / versionCode 250，candidate。

本候选在同日快速截屏候选基础上增补自动会话采集批量操作，保留快速截屏功能。正式官网版本未变；本次没有上传服务器、提交或推送 Git。

## 使用方式

在「收集与整理 → 会话自动采集」进入会话列表：

1. 勾选单条、选择本页或全选当前列表；选择可以跨页保留。
2. 统一投递目标可选当前学生原始资料库或其可写关联项目，点击「投递选中会话」。投递沿用既有受控目录与去重，不接受任意外部路径。
3. 点击「选中移入回收站」一次确认所选记录；已投递资料及已晋升知识保持不变。
4. 切换「回收站」可批量恢复，或「彻底删除选中可删除项」。删除前确认实际可删数量；有资料投递、已晋升知识等下游依赖的记录保留，主机再次检查依赖。

原有逐条目标选择、投递、恢复、移除、空会话清理均保留。

当前返回最近 100 条授权会话，前端每页 20 条；「全选当前列表」跨当前范围的所有分页，不代表全部历史存档。更早资料仍可通过原「管理全部对话资料」入口查看。采集中或尚未归档的会话不参与勾选操作。

## 实现与保护

- 解除主机及页面只显示 8 条的双重截断，沿用原学生范围查询。
- 批量投递复用 `deliverConversationMaterials`；管理操作增加异步 IPC `manageConversationImportsAsync`，复用既有许可和来源检查。
- 每批最多 20 条，低于主机 100 条上限。逐条核对回执，成功项取消勾选，失败／受保护项保留。
- 批次处理中锁定操作，避免重复点击。切换学生后重建选择状态，旧请求不修改新学生界面，后续批次停止；已提交的批次继续归属原学生。
- 异常后重新读取原学生记录，不把响应缺失当作成功，也不自动重复写入。
- React 状态按学生重置，勾选数与当前可操作集合动态推导；行组件更新不再被旧的自定义比较函数忽略。
- 修改前备份位于 `.codex_tmp/agent-session-batch-20261008-baseline/`，保留既有未提交开发成果。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| 本次相关 Node 测试 | 30 项通过、0 失败；包含批次上限、学生隔离、部分失败、依赖保护、损坏响应及真实主机状态函数超过 8 条的返回 |
| Electron 合成界面验证 | 13 项通过；实际生产 React 组件，使用合成学生和模拟回执，覆盖跨页勾选、全选、目标、锁定、部分成功、回收、恢复、删除、学生切换与控件布局 |
| 全量 Node 测试 | 执行时 1808 项：1806 通过、1 失败、1 跳过；之后补充的主机状态行为测试已计入上述 30 项相关测试 |
| 全量失败说明 | `download-inbox-contract.test.cjs` 要求旧 `CaptureInboxPanel key={studentId}`；此前快速截屏工作已改为含刷新请求的 key。本次未修改该组件，使用本次修改前备份重跑该合同，确认同样失败；未放宽或修改该测试 |
| Vite、发布暂存、构建审计 | 通过；89 个 dist 文件、74 个资源全部可达 |
| 敏感信息扫描 | 源码、暂存、产物均 0 命中 |
| 实际便携 EXE 独立启动 | 通过；隔离空学生目录、任务自动调度关闭、版本显示 0.19.10、新异步批量接口存在、10 个包内 Electron 文件与源码一致 |
| 工具条回归启动 | 通过；展开 161、收起 73，无学生时相关操作禁用 |
| 用户真机业务验收 | 未验收：真实授权会话批量投递、实际项目目标、回收站恢复与删除仍需用户试用 |
| Authenticode | NotSigned |
| Git / 线上发布 | 未提交、未推送、未部署；HEAD 保持 d78bc6fd80f93f6fb5e04facabd1832c5edbb26d |

测试脚本：`tests/agent-session-batch.test.cjs`、`scripts/verify-agent-session-batch.cjs`、`scripts/verify-quick-capture-package.cjs`。

本地证据：`output/agent-session-batch-20261008/verification.json`、`batch-list.png`；`.codex_tmp/agent-session-batch-tests.log`、`agent-session-batch-targeted.log`；候选目录内 `isolated-launch-verification.json`。

## 交付产物

目录：`release/windows/candidates/session-batch-20261008/`

- `AI-edu-manager-console-Windows-0.19.10-session-batch-20261008.exe`：98,969,369 字节。
  SHA-256：`1C973C5CCC4A7C3AA0B002315E307EF06A395E040D85B2AAE10964D420DCDE2F`
- 对应 ZIP：98,980,018 字节。
  SHA-256：`EF6649E5FEF29C6A7FDEEE3C99B6BAB0BB43120F88B408C5AB4F99BCCEDA8424`
- `AI-edu-manager-console-Windows-0.19.10-session-batch-20261008-build-audit.json`
- `isolated-launch-verification.json`
- `SHA256SUMS.txt`

构建时间：2026-10-08T05:44:18.005Z。此包用于本地真机测试，全量测试存在上述已知旧合同失败，不能标为全部测试通过或正式发布。
