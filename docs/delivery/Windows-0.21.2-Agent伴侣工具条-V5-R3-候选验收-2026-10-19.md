# Windows 0.21.2 Agent伴侣工具条 V5 R3 候选验收

日期：2026-10-19。状态：本地候选，非正式发布。

## 实施结果

- 知识闪卡、思维导图、信息图、图表总结使用数量和风格配置。
- 数量选项为 1张、2张、自动、自定义；自定义数量为 1–50 张，仅在被选中时显示。
- 风格选项为简洁、标准、动漫；默认配置为自动、标准。
- 核验、计划仅保留本次目标，不发送难度和会话时长；互动、测验仍使用难度和时长。
- 闪卡指令要求实际生成可打印 PNG/PDF 文件，并包含 A4 版式、双面对应、来源、清晰度和文件可打开性检查；无文件生成工具时不得用文案冒充成品。

## 验证

- 专项测试：32 通过、0 失败。
- 完整 Node 测试：2355 项，2354 通过、0 失败、1 跳过。
- Vite 构建、包内运行时核对和三阶段敏感信息扫描通过，扫描结果为 0 项。
- 使用独立 `--user-data-dir` 和合成学生启动真实便携 EXE：通过。
- 包内 15 个工具条文件与当前源码逐字节一致。
- 实际渲染确认：默认“自动”时自定义数量隐藏，切换“自定义”后显示；核验、计划均无难度、时长和数量控件，仅有目标。
- 详细机器记录：`release/windows/candidates/agent-companion-v5-r3-20261019/isolated-launch-verification.json`。

## 候选产物

- EXE：`AI-edu-manager-console-Windows-0.21.2-agent-companion-v5-r3-20261019.exe`
  - 大小：100919685 字节。
  - SHA-256：`4E4CE540F66DB6C3B77C006CAA58A7C749E5C62B34EDE7B7816BCE78D7BAB0AB`。
- ZIP：`AI-edu-manager-console-Windows-0.21.2-agent-companion-v5-r3-20261019.zip`
  - 大小：100931054 字节。
  - SHA-256：`80C398FEF3C9BD84CCA757FBFE4E3A051962AB60BDD6B818F3F09E0336D04AF5`。
- 构建审计：`AI-edu-manager-console-Windows-0.21.2-agent-companion-v5-r3-20261019-build-audit.json`。
- FileVersion / ProductVersion：`0.21.2`。

## 边界

- Authenticode 独立检查：`NotSigned`。
- 正式版清单继续保持 Windows `0.21.1 / stable`。
- 未上传服务器、未更新下载网页、未提交或推送 Git。
- 真实外部 Agent 是否具备 PNG/PDF 生成工具，需要真机按目标 Agent 分别验收；工具条只复制任务指令，不能为缺少的 Agent 工具虚增能力。
- 按用户要求，整体性能优化和小于 100MB 的包体压缩任务继续暂缓，本候选未执行该专项。
