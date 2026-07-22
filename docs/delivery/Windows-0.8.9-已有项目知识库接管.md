# Windows 0.8.9：已有项目知识库接管

## 使用流程

1. 新建学习项目，分别选择项目工作空间来源和项目知识空间来源。
2. 在“项目知识空间来源”中选择“接管已有项目知识库”。
3. 选择包含项目原始资料库、概念库、实体库、摘要库、问答精华库和综合汇总库的目录。
4. 查看只读检查结果，包括稳定身份、文件数量、AGENT.md、pathmap 和旧主机绝对路径。
5. 检查通过后创建项目。教育管家只在项目管理目录写入兼容映射与接管记录。

## 安全边界

- 项目工作空间与项目知识空间不能使用同一目录，也不会相互替代。
- 接管前不写入任何文件；接管后不覆盖原 AGENT.md、metadata 或 pathmap。
- 同一知识空间不能同时被两个项目独占绑定。
- 缺少统一 LLM Wiki Schema、身份冲突或路径重复时阻止接管。
- 项目记录安全删除或恢复不会删除被接管知识库。

## 验证

- 项目知识库接管与扫描聚焦测试：8 项通过。
- 全量自动化测试：118 项通过。
- Vite 生产构建通过。
- Windows EXE：`release/windows/AI-edu-manager-console-Windows-0.8.9.exe`，SHA-256 `C316F56FF2DD81DB4738A1CF128D456F73ED4CD3F70641CB2263614104544B2D`。
- Windows ZIP：`release/windows/AI-edu-manager-console-Windows-0.8.9.zip`，SHA-256 `EA3C27FF638AD5950B507EDAD599AB7447BC7004D03641C5897371D2D0D5C7C7`。
