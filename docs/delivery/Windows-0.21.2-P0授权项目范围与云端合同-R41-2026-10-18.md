# Windows 0.21.2 P0授权、项目范围与云端合同 R41

日期：2026-10-18  
基线：`Windows 0.21.2 auto-recovery-r40-20261017`  
内部候选：`p0-auth-project-scope-recovery-r41-20261018`

## 本轮实现

- 一次授权长期复用：启动先恢复持久化授权，后台检查与账号授权分层；普通检查不更新授权版本；只有明确认证失效才显示重新授权。
- 全局授权多学生项目：新增 `agent-capabilities.v2` 和 `ProjectExecutionScope`；范围只包含项目知识空间，成员集合顺序无关，发送前/提交前双重复验，范围变化不重复派发。
- 路径与队列 P0 回归：继续执行可验证旧路径迁移、空任务安全终态、统一状态机、未知结果先查回执以及普通用户核对入口。
- 云端 v2 基础合同：学生资料修订、默认基础字段、健康独立许可、五类资料、目标主机授权、稳定ID自动建档、传输回执和同步游标。
- 普通用户界面：授权四态、已连接时隐藏普通授权入口、云端同步设置归入 Agent 设置管理、健康资料保持单独开关。

## 自动化验证

- 完整测试：2303 项；2302 通过、1 跳过、0 失败。
- P0授权/启动兼容定向回归：41/41 通过。
- 项目范围、云端v1/v2、自动建档和健康隔离定向回归：40/40 通过。
- Vite生产构建通过；包体构建审计通过。
- 敏感信息扫描：源码437文件、暂存运行时720文件、候选包2个文件，发现数均为0。

## 候选文件

- EXE：`release/windows/candidates/p0-auth-project-scope-recovery-r41-20261018/AI-edu-manager-console-Windows-0.21.2-p0-auth-project-scope-recovery-r41-20261018.exe`
  - SHA-256：`AEF959146ABE202D757A52A2142EB892F34997F2C3F9D4FC896A6E91E7C1E998`
  - 大小：100276982字节
  - Authenticode：`NotSigned`（内部候选，不是正式签名发布件）
- ZIP：`release/windows/candidates/p0-auth-project-scope-recovery-r41-20261018/AI-edu-manager-console-Windows-0.21.2-p0-auth-project-scope-recovery-r41-20261018.zip`
  - SHA-256：`86DBBC2DD336E30E597BE5CCEDF849F5496183303F12BE602390A4BC0775320F`
  - 大小：100288055字节
- 构建审计：同目录 `AI-edu-manager-console-Windows-0.21.2-p0-auth-project-scope-recovery-r41-20261018-build-audit.json`

## 备份与恢复边界

- P0实施前备份：`D:/群星矩阵文件/智能体开发项目/AI教育管家/artifacts/r41-p0-backup-20261018-095914`
- 备份文件数：1994；总字节数：962362875。
- 清单：`sha256.csv`；清单自身SHA-256：`6F8962D219FB46FAA354C9B5FC06DF51A85C6EC07BFB94DE65014E80E2FA6A24`。
- 未强制结束旧主机进程，未清理运行账本，未重跑未知结果任务。

## 未完成边界

- 本文件和上述哈希冻结的是 R41 P0 候选快照。候选构建后新增的远程 Agent 会话与云端成果收件箱源码未进入 R41，不通过覆盖候选文件的方式追溯修改。
- 候选首次真实启动、关闭/重启、凭据撤销、CLI升级和多学生项目实机冒烟仍待执行。
- 云端 v2 尚未部署到生产；旧生产库迁移、异地主机、远程 OAuth/MCP、完整成果收件箱和跨设备恢复尚未验收。
- Authenticode 独立检查结果为 `NotSigned`；正式签名和时间戳仍须进入正式发布流程，候选构建成功不等于正式发布。
- 工作树在本轮前已有大量未提交变更，构建审计记录为 dirty；本候选不能证明干净工作树。
