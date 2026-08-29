# Android 单机版 1.2.0 智能体对话知识管理——正式发布验收记录

## 发布边界

- 版本：`1.2.0 / code 24`。
- 本文保留 Debug 候选记录，同时记录产品证书签名、真机覆盖安装和正式发布结果。
- 不读取 PalmClaw、豆包、MobileClaw、ChatGPT/Codex 的私有数据库；只处理用户主动粘贴、选择、分享或输入的公开 HTTPS 链接。
- 不引入 Windows 主机、平台服务器、家长角色、Soul/人格同步或跨学生知识回退。

Debug 候选：`android-standalone-manager/delivery/candidates/conversation-knowledge-1.2.0/AI-Education-Manager-Android-Standalone-1.2.0-conversation-knowledge-debug.apk`

- SHA-256：`D7C1680DB6C8DA4AB1892EA501C6ECAFBA368BF1A444863603D87033AD145BF8`
- 包信息：`com.qxmatrix.edumanager.standalone / 1.2.0 / code 24 / minSdk 23 / targetSdk 34`
- 该 APK 使用 Debug 证书，不能覆盖既有正式版；真机功能验收可先卸载测试环境中的正式版或使用隔离测试设备，但不得据此判定正式覆盖升级通过。

## 自动验证

1. `powershell -ExecutionPolicy Bypass -File android-standalone-manager\build.ps1 -Task check`
2. `node --test tests\android-standalone-conversation-knowledge-contract.test.cjs`
3. `pnpm test`，确认仓库既有契约没有回归。

本轮结果：Android `check` 通过；仓库全量契约测试 870 项中 869 通过、1 项按既有环境条件跳过、0 失败。

## 家庭平板人工验收

### 导入与空状态

1. 在没有对话记录的学生上打开“管理已保存对话历史”，确认可以“立即导入”或选择其他学生。
2. 分别测试粘贴、`.md/.txt/.json` 文件、Android 分享和公开 HTTPS 链接。
3. 确认保存成功后可立即浏览原文、进入消化或打开知识管理，不再停在只有“知道了”的提示框。
4. 再次导入相同原文和相同归属，确认哈希去重，不重复生成记录。

### 对话知识管理

1. 选择准确学生，检查收件箱、待处理、候选知识、已归档和回收站均能显示空状态或记录。
2. 浏览原文，确认 Markdown 渲染且 SHA-256 校验失败时拒绝读取。
3. 执行本地分析，确认仅用于标题、摘要、主题和行动导航，不生成正式学情结论。
4. 配置可用任务 Agent 后消化对话；失败记录可以重试，完成后可查看消化结果。
5. 检查候选包含来源 URI；编辑候选后原文和哈希不变。
6. 分别测试确认采用、批量确认（最多 50 条）、标记冲突、驳回、过期、恢复和撤回采用。
7. 确认采用后，在学生摘要库或项目摘要库找到 `已审核智能体对话知识.md`，其中包含事务标记、来源 URI 和原文哈希。

### 回收站、升级与迁移

1. 未消化记录移入回收站后可以恢复；没有依赖时可以永久删除。
2. 已消化或仍有候选/已采用依赖的记录不能永久删除。
3. 用含 v1 对话记录的旧版本覆盖安装升级，确认原记录仍能浏览，缺省分析和回收站字段自动补齐。
4. 执行加密备份恢复和整机迁移，确认 `conversation-imports.json`、`conversation-knowledge-candidates.json` 以及原始对话文件均恢复，学生/项目归属不变。

## 正式发布闸门

以上步骤通过，且使用与已安装正式版一致的长期产品证书签名、验证可覆盖安装后，才可生成正式 Release APK、更新公开下载清单和 Git 发布记录。

## 正式发布结果

- 正式 APK：`android-standalone-manager/delivery/AI-Education-Manager-Android-Standalone-1.2.0-release.apk`。
- 包信息：`com.qxmatrix.edumanager.standalone / 1.2.0 / code 24`。
- APK SHA-256：`0CD50763359E1059DA5B73F4627818D1C1C91B2EA74C984E0A8107F0331126BC`。
- 产品证书 SHA-256：`647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F`，与原正式版一致；v1/v2 签名验证通过。
- 2026-08-29，用户确认已经完成真机覆盖安装验证。
- 公开更新清单和下载网页升级到 1.2.0；Android 学生端、Windows 主机端、Android 教师端和 Windows 学生端版本保持不变。
