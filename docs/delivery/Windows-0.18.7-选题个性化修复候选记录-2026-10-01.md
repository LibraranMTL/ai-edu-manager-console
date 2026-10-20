# Windows 0.18.7 选题个性化修复候选记录

日期：2026-10-01。状态：本地便携候选；不替换既有 0.18.7 候选，不提交 Git、不发布线上。

## 问题与处理

原选题生成只有四套通用结构，把学生年级、地区等插进理由，因此不同学生会看到高度相同的主题；旧建议缓存也没有在档案或项目变化后可靠失效。本次按当前学生的兴趣、职业方向、规划偏好、档案目标、项目名称／目标、学科特长和已确认成长线索选择主题。科创与社会实践的现实问题、研究方法、原型、行动和安全约束会随主题领域变化；相同兴趣而学科特长不同，采用的调查或测量方法也不同。资料只有通用年级／地区时不再生成四条伪个性化建议，而是提示补充档案。

输入指纹或生成器版本变化后，读取接口会要求重新生成；原有草稿仍绑定原建议 ID，不会因新版本误用。已确认成长线索与正式学情报告数量只作为可复核来源提示，不推断学生能力或具体薄弱知识点。当前仍是**基于本地结构化证据的规则化候选生成**，尚非 Agent 对完整报告和学习资料的语义研究，不能宣称已经实现深度学情分析。

## 验证

- 定向测试：24 项通过，包括跨学生差异、相同兴趣但学科特长／职业不同、档案修改后失效、项目线索、资料不足空态、项目草稿幂等和旧导航合同。
- `pnpm run build:win` 返回码 0；其前置全量 Node 测试通过，Vite 构建、便携 EXE／ZIP、构建审计和源码／暂存／产物敏感信息扫描完成。未在本记录中声明未留存的全量测试项数。
- 独立 `--qa-isolated --user-data-dir` 启动冒烟：候选启动后隔离目录生成 21 项运行数据并观察到 5 个匹配进程，随后仅结束该隔离进程。该检查不等于人工 UI、真实学生业务或长期运行验收。
- Windows Authenticode：`NotSigned`。真实学生档案下的个性化表现、相机／音频／分享、学习卡片、真机、Git 和线上发布均未验收。

## 产物

- EXE：`release/windows/candidates/topic-personalization-20261001/AI-edu-manager-console-Windows-0.18.7-topic-personalization-20261001.exe`
- ZIP：`release/windows/candidates/topic-personalization-20261001/AI-edu-manager-console-Windows-0.18.7-topic-personalization-20261001.zip`
- 构建审计：`release/windows/candidates/topic-personalization-20261001/AI-edu-manager-console-Windows-0.18.7-topic-personalization-20261001-build-audit.json`
- EXE SHA-256：`3C795B8818578E2AE83BA17501D2EC4C39D6ECC22DAE39BB833DFE638335C0CD`
- ZIP SHA-256：`9E7C4C5F1B037490EB5C1CB199243D7AB332E683C4F32B768742FC6283655875`
- 构建来源为有大量未提交变更的工作树；审计记录 `dirty: true`，不能将此候选解释成干净提交的正式发布。

使用前退出正在运行的同版程序，再从本候选 EXE 启动；选择资料不同的学生，打开“项目与成果 → 选题建议”进行人工比对。历史建议将依输入指纹重新生成；没有具体学生线索时应显示补充资料提示，而不是相同的通用候选。
