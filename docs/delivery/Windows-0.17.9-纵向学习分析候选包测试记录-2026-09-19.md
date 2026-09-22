# Windows 0.17.9 纵向学习分析本地候选包测试记录

> 2026-09-19；测试候选，不是正式发布；源工作树含 64 个未提交路径变更，构建审计已记录当前提交与状态摘要。

## 候选产物

- 便携式 EXE：`release/windows/candidates/learning-analytics-test-20260919/AI-edu-manager-console-Windows-0.17.9-learning-analytics-test-20260919.exe`
- 同内容 ZIP：`release/windows/candidates/learning-analytics-test-20260919/AI-edu-manager-console-Windows-0.17.9-learning-analytics-test-20260919.zip`
- 构建审计：同目录的 `AI-edu-manager-console-Windows-0.17.9-learning-analytics-test-20260919-build-audit.json`
- EXE SHA-256：`5EAB36E77E6743C2BF6F21D9D33F73426D7E4D970059E677AB6319CFF6954EE2`
- ZIP SHA-256：`FE4035ED99AD7C27BF1B5A176E3E139EBFBE860F0E7C766149F5F1EB0F524B11`

这是 Electron portable 便携包，不是 MSI/安装向导；未上传服务器，未更新公开下载页或版本清单。文件版本为 0.17.9，Windows 元数据 `CompanyName=Robogala`，但 Authenticode 核验为 `NotSigned`。不要作为签名正式版传播。

## 已通过的本地自动检查

- `pnpm build:win` 完成：1031 个测试中 1030 通过、1 跳过、0 失败；Electron 打包、包体语法、资源可达性、敏感签名扫描通过。
- 产物重新计算的 SHA-256 与审计 JSON 一致；ZIP 只含目标 EXE。
- `app.asar` 含 `electron/learning-analytics.cjs`、数学 taxonomy、主进程及 preload；学习咨询上下文与历史变化候选代码存在。
- 之前的浏览器模拟回执验证了桌面/窄屏的“成长模型 → 知识轨迹 → 知识点证据”路径；这不等于本 EXE 真机验收。

## 真机测试建议（待执行）

仅在测试机或已备份的独立学生资料副本上启动，不与已有 0.17.9 实例并行，也不要指向唯一的正式学生档案。便携版默认可能复用本机教育管家配置与资料根目录，先核对 Windows“系统设置 → 学生资料根目录”。如许可证未激活，受限页面不可验收，不应绕过授权门。

1. 启动 EXE，记录能否显示“AI教育管家控制台”、版本、学生选择和许可证状态；记录启动耗时及任何错误弹窗。
2. 在测试学生下提供经授权的数学学习资料，完成正常资料消化；确认回执含学生稳定 ID、真实带时区时间、canonical 知识点 ID、0–4 表现评分和当前批次 materialId 来源。无真实样本时本项保持“未测”，不能用演示回执代替。
3. 进入“成长模型 → 知识轨迹”，核对知识点状态、时间升序证据、提示程度、错误模式、来源 ID、复测建议和“历史变化候选（未发布）”。
4. 在“教育管家问答”中询问该知识点的长期变化，核对当前学生证据注入、来源边界，以及知识库不可用时的明确提示；切换另一学生时不得看到前一学生轨迹。
5. 在 Agent 规则管理中先预览旧 `AGENT.md` 的协议迁移，仅使用测试副本核对原内容保留和保存快照；不在正式档案直接试写。
6. 故意提交缺来源、跨学生、无时区时间或越界评分的测试回执，核对异常列表与原有事件不被覆盖；修正后重新提交并核对幂等。
7. 关闭并重启 EXE，复查轨迹持久化、未发布候选边界和异常回执；记录内存、CPU、处理耗时及日志。

## 尚未验收的发布门

- 真实 Agent 产出的回执及失败恢复；真实授权资料的代表性抽检；Windows 真机启动与端到端功能；性能基线；正式代码签名；发布审批与回滚。上述项目完成前不得改称正式发行包。
