# Windows 0.21.2 Skills 存档与本地安装 P0—P3 候选验收

日期：2026-10-19  
候选标识：`skills-library-p0-p3-r1-20261019`

> 2026-10-19 更正：R1 包体漏打包 `yauzl`，实际打开 Skills 服务时报模块缺失，本候选不应继续用于 Skills 验收。下文源码测试和宿主测试不等于 R1 EXE 内服务可用；原隔离启动仅验证了未授权拦截，未进入 Skills 服务初始化。修复与重新验收见《Windows-0.21.2-Skills扫描修复-R2候选验收-2026-10-19.md》。保留 R1 文件与记录供追溯，不覆盖原基线。

## 1. 基线与范围

- 基线 EXE：`release/windows/candidates/agent-companion-v5-r2-20261019/AI-edu-manager-console-Windows-0.21.2-agent-companion-v5-r2-20261019.exe`
- 基线 SHA-256：`0C04F4D0856111091513A0B6CBFCC173ABEEB0D285B73F8880B41B6B05C87909`
- 基线文件未覆盖。本次另建候选目录。
- 实施范围：主机级 Skill 存档、浏览、本地目录/ZIP 导入、自动分类、Codex/WorkBuddy 用户级安装适配、QClaw 只读扫描与导出存档。
- 暂缓：MCP 能力、插件安装、OpenClaw 安装、HTTPS/Git 下载。

## 2. 产品入口

Windows 主机“Agent 管理设置”新增第五个顶级 tab `Skills管理`，内含：

1. `Skill存档管理`：Codex、WorkBuddy、QClaw 来源扫描，选择存档，目录/ZIP 导入，存储位置迁移。
2. `Skill浏览`：搜索、Agent/标签过滤、详情、哈希与风险、人工标签、安装/验证/回滚/卸载。

QClaw 在生产 UI 中显示“不可安装”；插件显示“插件暂缓”；不展示 MCP 入口。

## 3. 实施要点

- 不可变对象库：`objects/sha256/<treeSha256>/payload`，独立 catalog、settings、receipts、backups、quarantine。
- 原始字节逐文件 SHA-256 与稳定目录树 SHA-256；同版本去重，未知发布者按来源隔离。
- 严格 `SKILL.md` frontmatter，阻断多入口、密钥/凭据、可执行二进制、符号链接和越界路径。
- ZIP 限制条目数、文件数、单文件、总字节与压缩比；拒绝 Zip Slip、链接和特殊文件。
- 自动系统标签覆盖教育、研究、文档、开发、媒体、自动化、知识库和办公；人工标签单独锁定。
- 目标路径只由主进程适配器解析，renderer 不提交任意路径或命令。
- 安装使用有时效的预览计划、对象哈希、目标指纹和执行前 TOCTOU 复检；同卷 staging/rename，更新前持久备份。
- 未受管目标和被外部修改目标一律拒绝覆盖。
- “目录已发现”与“新会话已加载/已触发”分开记录。

## 4. 验收结果

### 4.1 自动化与界面

- Skills 专项：14/14 通过，含恶意 ZIP、未受管冲突、TOCTOU、迁移、QClaw 只读和安装回滚。
- 完整回归：2352 项，2351 通过，0 失败，1 按环境跳过。
- `pnpm build`：通过。
- 生产组件响应式验收：1440×900 和 400px 窄屏无水平溢出；扫描、浏览、安装预览、安装后状态、QClaw 禁用态均可见。

### 4.2 真实本机扫描与 QClaw 导出

| 宿主 | 发现 | 就绪 | 不支持 | 隔离 |
| --- | ---: | ---: | ---: | ---: |
| Codex | 60 | 45 | 13 | 2 |
| WorkBuddy | 13 | 11 | 1 | 1 |
| QClaw | 80 | 30 | 48 | 2 |

QClaw 真实导出了一个就绪 Skill 到隔离验收库，对象哈希复验通过，导出前后源树哈希相同，未向 QClaw 回写。证据：`docs/delivery/evidence/qclaw-skill-export-live-20261019.json`。

### 4.3 真实宿主安装

| 宿主 | 首次安装 | 新进程发现/触发 | 升级备份 | 回滚 | 卸载清理 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI 0.130.0-alpha.5 | 通过 | 通过，精确返回 `EDU_MANAGER_SKILL_ACCEPTANCE_OK` | 通过 | 通过 | 通过 | P3 真实闭环通过 |
| WorkBuddy 37.10.3-42 | 目录安装与指纹复验通过 | 阻断：当前官方 CLI 返回 `Authentication required` | 通过 | 通过 | 通过 | P3 真实加载/触发闸门未通过 |

验收使用合成 Skill，不读取学生资料、不使用工具。验收后 Codex 和 WorkBuddy 的合成 Skill 目录均已卸载并清理。证据：`docs/delivery/evidence/skill-install-hosts-live-20261019.json`。

WorkBuddy 未通过的原因是真实 CLI 授权不可用，而不是目录安装失败。根据计划闸门，不能用文件存在、退出码 0 或桌面 IPC 在线代替真实加载与触发。

## 5. 候选包

- EXE：`release/windows/candidates/skills-library-p0-p3-r1-20261019/AI-edu-manager-console-Windows-0.21.2-skills-library-p0-p3-r1-20261019.exe`
- EXE 字节：`100916787`
- EXE SHA-256：`A7868CC007FC36961AA6C9777E5740D468AE848E192D91C84EFF8C6E9F5AFCCF`
- ZIP SHA-256：`141E90D97B992C12FD9BF74044FE27D762952EF20D31B5EE34A1003D99E19E3B`
- Authenticode：`NotSigned`
- 包体审计：7 个 Skills 主进程模块均存在且与 staging 字节一致；生产 renderer 含 `Skills管理` / `Skill存档管理` / `QClaw` 标记；源码、staging 和包体密钥特征扫描均为 0 发现。
- 隔离启动：通过，版本可见，主窗口与工具条可用，Skills IPC 已暴露且在无许可证隔离环境中正确闭锁。
- 正式更新清单仍指向 Windows `0.21.1 stable`，未改成本候选。

## 6. 当前决策

1. 可供用户评估 Skills 管理页面、存档、浏览、QClaw 只读导出和 Codex 安装闭环。
2. 暂不宣称“WorkBuddy 已能使用安装的 Skill”。需在 WorkBuddy CLI 完成真实登录后重跑新会话发现与触发验收。
3. 本包未签名，未做用户设备上的正式安装验收，不是正式发布。
4. 后续候选再开启 HTTPS/Git 下载、插件、OpenClaw 和 MCP，不与本轮结论混同。

## 7. 官方宿主路径依据

- Codex Skills 采用用户级 `$CODEX_HOME/skills`。
- WorkBuddy/CodeBuddy 首版安装到官方文档说明的用户级 `~/.codebuddy/skills`；`.workbuddy/skills` 仅作当前桌面配置的只读发现源。
- WorkBuddy/CodeBuddy 路径依据：https://www.codebuddy.ai/docs/cli/skills
