# Windows 0.21.2 Skills 扫描修复 R2 候选验收

日期：2026-10-19  
候选标识：`skills-library-p0-p3-r2-20261019`

## 故障与修复

用户截图中的 `Cannot find module 'yauzl'` 已在 R1 的真实 `app.asar` 中复现。Windows 精简包不带 `node_modules`，但 `skill-archive-extractor.cjs` 顶层直接加载 ZIP 解析库；Skills 服务初始化时便失败，连不使用 ZIP 的扫描入口也不可用。这不是本机 Skill 路径或用户权限配置问题。

本次将 ZIP 解析库及传递依赖通过 esbuild 打进运行模块，不要求用户安装 Node.js、npm 或额外依赖。新增无依赖环境红绿回归，以及最终 ASAR 的 Electron 运行检查；任何初始化、工作线程扫描或 ZIP 校验失败都会阻止候选发布。

R1 原先的源码测试和真实宿主适配器测试不能证明 R1 EXE 可用。原隔离启动仅走到无许可证拦截，没有进入 Skills 服务。本次补齐该验收缺口；R1 报告已追加更正，旧文件保留追溯。

## 验证结果

- 红色回归：从 R1 ASAR 加载服务，稳定复现 `Cannot find module 'yauzl'`。
- 绿色回归：在不含 `node_modules` 的隔离目录中加载修复模块，服务快照、三个宿主工作线程扫描、ZIP 解包和路径越界阻断通过。
- 包体闸门：Electron 43.0.0 直接加载 R2 最终 ASAR，不使用源码服务或模拟 IPC；上述四项检查全部通过。
- 最终包体对本机进行只读扫描，回执写入独立测试目录，不写入用户现有 Skills 存档库或 Agent 配置。

| 本机宿主 | 发现 | 可存档 | 格式不支持 | 隔离 |
| --- | ---: | ---: | ---: | ---: |
| Codex | 60 | 45 | 13 | 2 |
| WorkBuddy | 13 | 11 | 1 | 1 |
| QClaw | 80 | 30 | 48 | 2 |

扫描数量包含格式不支持和风险隔离项，不等于全部可以安装。

- 完整回归：2356 项，2355 通过，0 失败，1 项环境跳过。日志：`.codex_tmp/skills-r2-full-tests.log`。
- 构建通过；`app.asar` 为 20,472,948 字节，包内 `node_modules` 文件数为 0；源码、staging、包体密钥特征扫描均无发现。
- 实机包体扫描证据：`docs/delivery/evidence/skill-packaged-runtime-r2-live-20261019.json`。
- 构建审计包含 `package.skillRuntimeVerification`，记录三来源合成扫描、ZIP 解包与越界阻断结果。

## 文件与边界

- EXE：`release/windows/candidates/skills-library-p0-p3-r2-20261019/AI-edu-manager-console-Windows-0.21.2-skills-library-p0-p3-r2-20261019.exe`
- EXE 字节：`100919329`
- EXE SHA-256：`885F6B8EC3EB3F05B40C2A9EB30D42C76AABF31D811C6B64539B0FA84CBF8F69`
- ZIP SHA-256：`6761532A5C0E580D88F9780AB77A2AD8868FA94B7E0EA121BFB8BAF29A2726ED`
- Authenticode 实测：`NotSigned`，仍是未签名评估候选，不是正式发布。
- 用户指定原始基线 EXE 未覆盖，SHA-256 仍为 `0C04F4D0856111091513A0B6CBFCC173ABEEB0D285B73F8880B41B6B05C87909`。
- 正式 Windows 更新清单仍指向 `0.21.1 stable`，未推送或上传候选。
- 构建保留现有工作区内容：相对 R1，工作区已有陪伴工具条的视觉任务参数修改（`main.cjs`、`companion-toolbar.cjs`、`companion-popover.html`、`companion-popover-renderer.js`），未回退或覆盖；这些随 R2 一并构建。生命周期 Hook EXE 重新编译。Skills 服务、扫描 Worker、preload 及 renderer 与 R1 对应 staging 字节一致，ZIP 运行模块按本次修复重新打包。因此 R2 不是仅单文件差异的二进制补丁。
- 本次验证真实包体后端，不声称已完成用户当前授权界面的点击验收。WorkBuddy 新会话实际触发仍沿用 R1 报告中的待授权验证状态；本次没有重新安装任何真实 Agent Skill。QClaw 仍只读扫描/导出，MCP 与插件安装仍暂缓。

## 用户复测

从系统托盘彻底退出旧教育管家，再运行 R2 EXE，进入“Agent 管理设置 → Skills管理 → Skill存档管理”，点击扫描。无需清空数据、删除存档、重装 Agent 或手动安装依赖。
