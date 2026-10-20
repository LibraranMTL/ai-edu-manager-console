# Windows 0.21.2 性能与 100 MB 体积优化

日期：2026-10-19。候选标识：`performance-size-r1-20261019`。

## 交付结论

已生成独立候选包，EXE 和 ZIP 均低于 **100,000,000 字节**，不是按 100 MiB 放宽口径。未删除功能、语言、字体或 PDF 原生组件；未覆盖上一候选包，未修改正式更新清单，未上传发布。

| 产物 | 实测字节 | 十进制 MB | SHA-256 |
| --- | ---: | ---: | --- |
| EXE | 99,866,670 | 99.866670 | `13041314BDD097953A4202D649368F03A0D9E12D02E60BE25E3F17F5D88AD33E` |
| ZIP | 99,876,054 | 99.876054 | `6FF130D1A0EA596FF64E157ECE8702A84922731237027178EA54969962E4C6CF` |

目录：`release/windows/candidates/performance-size-r1-20261019/`。

- [候选 EXE](../../release/windows/candidates/performance-size-r1-20261019/AI-edu-manager-console-Windows-0.21.2-performance-size-r1-20261019.exe)
- [候选 ZIP](../../release/windows/candidates/performance-size-r1-20261019/AI-edu-manager-console-Windows-0.21.2-performance-size-r1-20261019.zip)
- [构建审计](../../release/windows/candidates/performance-size-r1-20261019/AI-edu-manager-console-Windows-0.21.2-performance-size-r1-20261019-build-audit.json)

签名状态为 **NotSigned**，仅作为本地验收候选，不称为已签名正式版。

## 检查范围与处理

本轮检查了主进程/预加载桥接、界面状态轮询、Skills 发现/存档/安装服务、列表关联与搜索、Windows 构建和依赖闭包、PDF/OCR 运行资源及打包回归。复用了项目完整测试集，不将自动化通过等同于全部设备、账户和真实资料场景均已验收。

| 问题或风险 | 改动 | 保持的行为 |
| --- | --- | --- |
| 周期同步 IPC 可能随主进程繁忙而阻塞界面 | 新增异步状态接口；轮询单请求在途；隐藏窗口不轮询；卸载后不应用旧响应 | 保留原同步接口供旧桥接使用；12 个状态字段相同；失败保留上一状态并允许下轮重试 |
| Skills 列表逐项重复查找版本和安装记录 | 每次请求建立 Map 索引，以线性关联替代重复全表遍历 | 顺序、过滤、首个重复版本、缺失版本、卸载记录排除与读取新鲜度一致；不新增跨请求缓存 |
| 快照重复读取回执、扫描后重复请求快照 | 复用一次回执读取，扫描操作复用公共刷新流程 | 隔离计数、最近 20 条回执和刷新结果保留 |
| 搜索与选中操作重复计算、重绘行组件 | 按 React 最佳实践复用搜索文本、选中 ID Set、稳定回调和 memo 行组件 | 不改变分类、详情、风险提示、安装预览和 QClaw 只读限制 |
| 便携包略超 100 MB | 可逆 BCJ2 压缩、官方同版本 PDF 压缩版、运行脚本空白压缩、PNG 无损重压缩 | 不改运行标识符和语法；保留许可证注释、完整字体/CMaps/WASM、原生组件和全部 11 种语言 |
| 构建后体积可能再次反弹 | 发布到候选目录前校验 EXE 与 ZIP 字节上限 | 超限即失败，不自动提高限制、不交付超限产物 |

运行脚本只处理隔离 staging 中的 282 个 CJS 文件，7,563,004 → 6,812,844 字节；不改源文件格式。`license-trust-store.cjs` 原样保留，其独立安全审计未放宽。PNG 4 个文件合计减少 224,462 字节，逐字节核对解压后的扫描线、非图像数据块和尾部数据；不是降分辨率或有损图像处理。

## 性能证据

- 合成数据：5,000 个 Skill、10,000 个版本、10,000 个安装记录，交错运行 9 轮。
- 列表关联中位耗时：**195.75 ms → 2.10 ms**；对应定时器延迟中位数：195.82 ms → 2.14 ms。
- 前后完整返回结果深度相等。此结果仅代表内存列表关联，不是整个程序提速倍数，也不含磁盘、网络或 Agent 执行耗时。
- 同机各一次隔离启动，计入便携包解压及版本出现在界面：上一 Skills R2 候选 8.97 秒，新候选 8.12 秒。单次观察受缓存等因素影响，不据此承诺启动提速比例。
- 1,500 条合成 Skill 的页面检查覆盖列表、检索、详情、扫描后选择和安装预览/键盘确认；QClaw 安装仍禁用。这是模拟接口 UI 检查，不是向真实 Agent 安装 1,500 个 Skill。安装确认的一次自动鼠标点击超时，检查按钮状态后以键盘 Enter 完成；未将该次鼠标操作记为通过。

证据：[列表基准](evidence/skills-performance-20261019.json)、[基线启动](evidence/performance-baseline-launch-20261019.json)、[新包启动](../../release/windows/candidates/performance-size-r1-20261019/isolated-launch-verification.json)、[1,500 条 UI 截图](../../output/playwright/skills-performance-1500-20261019.png)。

## 回归与包内验证

1. 原始运行代码完整回归：2,365 项，2,364 通过，0 失败，1 跳过。
2. 使用发布时相同空白转换执行完整回归：最终 **2,371 项，2,370 通过，0 失败，1 跳过**；新增 PNG 和脚本压缩测试也包括在内。
3. 跳过项为已有 `material-path-recovery` 符号链接测试，代码明确在 Windows 跳过；不计为通过。
4. PDF 文本、扫描件、混合页及 Windows OCR 的相关回归通过；使用同版本官方 minified 文件且保留完整旁路资源。
5. 实际便携 EXE 隔离启动通过：版本显示、异步/同步状态结果一致、工具栏、采集/整理/范围/AI 设置菜单、目标智能体入口、合成学生切换、学生与自有项目选择，以及外来项目拒绝。包内关键运行文件与本次源代码转换结果一致。
6. Electron 43 实际加载 `app.asar` 中的 Skills 服务：快照、Worker 扫描、ZIP 解包和 Zip Slip 阻断均通过。
7. 新包服务只读扫描真实用户目录：Codex 60 项、WorkBuddy 13 项、QClaw 80 项；保留 unsupported/quarantined 分类，计数不等于均可安装。所有测试回执写入隔离临时目录，未向真实 Agent 配置或 Skill 目录写入。
8. 与上一 Skills R2 包对比：244 个外部运行文件、361 个 Electron 包内条目均保留，无缺失；原生组件、字体、语言及法律文件字节未变。5 个包内 PNG 核对通过（其中 4 个获益，其余原样保留）。
9. 151 个构建资源全部可达，包内无散落 node_modules；依赖闭包、授权安全检查、敏感信息扫描、哈希核对及 100 MB 闸门通过。

证据：[真实目录只读扫描](evidence/performance-skill-packaged-live-20261019.json)、[资源保留审计](evidence/performance-resources-20261019.json)。完整回归日志保存在 `.codex_tmp/performance-size-full-tests.log`、`.codex_tmp/performance-compact-full-tests.log` 和 `.codex_tmp/performance-final-tests.log`。

可复跑的核心命令：

```powershell
node --test tests/*.test.cjs cloud-report-service/*.test.cjs
node --require ./scripts/test-compact-runtime-hook.cjs --test tests/*.test.cjs cloud-report-service/*.test.cjs
$env:EDU_WINDOWS_CANDIDATE_TAG='performance-size-r1-20261019'
node scripts/build-windows-release.cjs
node scripts/verify-quick-capture-package.cjs
```

## 边界与回退

- “未发现回归”限定于上述证据，不能保证任何硬件、账户或资料组合绝无问题。真实摄像头、真实学生授权和长时运行仍需用户设备验收；隔离启动未拿到真实授权，不能替代授权后 Skills 页面全流程验收。
- Codex/WorkBuddy 本地 Skill 安装能力保留，QClaw 仍只读；MCP 与插件安装未启用。此次只读扫描成功不等于真实 Agent 已加载或触发全部 Skill；WorkBuddy 的真实认证/触发验收未被本轮替代。
- 为控制回归风险，未重构学生数据持久化、授权事务、Agent 执行器、原生 OCR 或大范围界面结构；这些区域通过已有测试验证，不进行缺乏收益证据的改写。
- 构建源为当前已有未提交改动的工作区，审计记录 commit `7325bac5f591cd2a27e8ccf3c8cb0d109d293b93`、dirty=true，不冒充干净 Git 发布。完整构建状态指纹见构建审计。
- 上一 Skills R2 EXE 保留，SHA-256 为 `885F6B8EC3EB3F05B40C2A9EB30D42C76AABF31D811C6B64539B0FA84CBF8F69`。用户最初指定的 Agent Companion V5 R2 EXE 仍为 `0C04F4D0856111091513A0B6CBFCC173ABEEB0D285B73F8880B41B6B05C87909`，未覆盖。
- 正式 Windows 更新清单继续为 0.21.1 stable。新包未覆盖安装到正在使用的实例，未清理用户资料；测试浏览器标签和本轮 Vite 服务已关闭。
- 建议退出旧实例后运行新候选，重点复测“扫描本机 Skills → 搜索浏览 → 存档 → Codex/WorkBuddy 安装预览”以及日常采集、PDF 处理；若有差异，退出候选后可继续使用保留的上一包。本次未作数据格式迁移。
