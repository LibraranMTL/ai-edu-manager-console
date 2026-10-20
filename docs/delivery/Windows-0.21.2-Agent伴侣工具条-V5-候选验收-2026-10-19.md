# Windows 0.21.2 Agent伴侣工具条 V5 候选验收

日期：2026-10-19

## 基线确认

- 最新本地 Windows 候选基线：`0.21.2-agent-companion-v4-20261019`；
- 基线 EXE SHA-256：`DACF66C82703E8D8C6E9DDFE7939BAA22B7100954A2B3E8D8ED2AD65643C996F`；
- 基线 ZIP SHA-256：`011080FB9EC559DDE700C030B26EAD0D577776285BFE3D579D2FCD9EC5C566DC`；
- V4 构建暂存中的 `quick-capture.html`、`quick-capture-renderer.js`、`companion-toolbar.cjs`、`companion-popover-renderer.js` 和 `main.cjs` 哈希与 V5 实施前备份逐项一致；
- 因此 V5 是在最新 V4 程序包对应源码上实施，不是从旧版源码重新拼接。

## 候选产物

- EXE：`release/windows/candidates/agent-companion-v5-20261019/AI-edu-manager-console-Windows-0.21.2-agent-companion-v5-20261019.exe`
  - 大小：`100299332` 字节
  - SHA-256：`750B2110AD0FD50C1A365A56EC126A1A6076E932B5BA465DD740AE810530D228`
- ZIP：`release/windows/candidates/agent-companion-v5-20261019/AI-edu-manager-console-Windows-0.21.2-agent-companion-v5-20261019.zip`
  - 大小：`100310099` 字节
  - SHA-256：`C26FF6C5CCFE820C025BBC0B40EB16E0087FCCB0C66DA7C4007CCA545FEBDAAF`
- 构建审计：`AI-edu-manager-console-Windows-0.21.2-agent-companion-v5-20261019-build-audit.json`
- 隔离启动记录：`isolated-launch-verification.json`

## 验证结果

- 完整 Node 测试：2337 项，2336 通过、0 失败、1 跳过；
- 工具条专项测试：28/28 通过；
- Vite 生产构建：通过；
- 构建阶段源码、暂存运行时和候选产物敏感信息扫描：0 项发现；
- 包内 14 个工具条相关运行时文件与当前源码逐字节一致；
- 便携 EXE 使用独立 `--user-data-dir` 真实启动通过；
- 主界面显示版本 `0.21.2`，工具条视口高度为 `35px`；
- 第一行菜单为采集、整理、学习，AI设置位于关闭按钮前；
- 未发现省略号或目标 Agent 控件；
- 学习浮层包含学习、互动、测验、核验、计划五个页签；
- 学习页包含知识闪卡、思维导图、信息图和图表总结。

## 状态边界

- Authenticode：`NotSigned`；
- Git：当前工作树原本含大量未提交内容，本轮未提交、未推送；
- 真机：尚未使用真实学生、许可证、摄像头、麦克风和外部 Agent 完成业务验收；
- 发布：未上传服务器、未更新网页；
- 正式版清单保持 Windows `0.21.1 / stable`，未被候选构建修改；
- 本候选仅供真机测试，不等同于正式发布。
