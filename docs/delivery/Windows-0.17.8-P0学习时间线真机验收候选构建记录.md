# Windows 0.17.8 P0 学习时间线真机验收候选构建记录

构建日期：2026-09-11

候选标签：`p0-timeline-acceptance`

用途：Windows 主机端与 Windows 学生端双机真机验收。当前包尚未替换官网正式下载，也未作为正式版本发布。

## 候选安装包

| 终端 | 文件 | 大小 | SHA-256 |
| --- | --- | ---: | --- |
| Windows 主机端 | `release/windows/candidates/p0-timeline-acceptance/AI-edu-manager-console-Windows-0.17.8-p0-timeline-acceptance.exe` | 90,940,695 字节 | `B296593AB44E212AD8E7368BA1B52541F56C72F2BD927E997C2BB06DB1FB70BF` |
| Windows 主机端 ZIP | `release/windows/candidates/p0-timeline-acceptance/AI-edu-manager-console-Windows-0.17.8-p0-timeline-acceptance.zip` | 90,948,961 字节 | `E3072280F7061363F8B9DC071F3DD0CFF017CD62FEAC5711C923976F8369735D` |
| Windows 学生端 | `release/windows-terminal/candidates/p0-timeline-acceptance/AI-edu-manager-student-terminal-Windows-0.17.8-p0-timeline-acceptance.exe` | 85,549,127 字节 | `2C680093417E952995AED7E21B644D290AC8889E729E3BC8FF7EA0B27B837CEE` |

两个 EXE 的 Windows 文件版本、产品版本均为 `0.17.8`，发布者字段为 `Robogala`。这两个候选 EXE 当前均未配置 Authenticode 代码签名，Windows SmartScreen 可能显示未知发布者；只有在 SHA-256 与上表一致时才继续验收。

## 已完成的自动验证

- P0 与发布专项回归：30/30 通过。
- 全量 Node 测试：950 项，947 通过、1 跳过、2 失败。两项失败均为 Android 单机版测试仍断言旧版 `1.2.2 / code 26`，而当前 Android 源码为 `1.2.5 / code 29`；与 Windows P0 时间线和本候选包无关。
- 主机端构建审计：83 个前端文件全部可达，ASAR 210 个文件、无 `node_modules`；源码、暂存运行时和最终包三阶段敏感信息扫描均为 0 发现。
- 学生端构建审计：ASAR 21 个文件、406,625 字节、无 `node_modules`，已核对启动所需本地模块。
- 构建来源：分支 `release/windows-0.6.5-cleanup`，提交基线 `35170a7169718c97693b65dca9b6dbfc1e003310`；工作区为脏状态，精确状态指纹和文件数记录在主机端构建审计中。本候选包仅用于当前工作区真机验收，不作为可复现正式发布证明。

## 性能基准

使用 5,000 条采集事件完成压力基准，所有保护门槛均通过：

| 指标 | 实测 | 门槛 |
| --- | ---: | ---: |
| 单条增量写入 p95 | 5.39 ms | 小于 25 ms |
| 单条增量写入最大值 | 30.80 ms | 小于 150 ms |
| 分页查询 p95 | 29.92 ms | 小于 100 ms |
| 5,000 条旧数据迁移 | 28.45 ms | 小于 500 ms |
| 首页送入渲染器 | 30 条 / 18,455 字节 | 小于 256 KB |
| 相对整表传输缩减 | 93.24% | 仅传一页 |
| 堆内存增量 | 37.38 MB | 小于 96 MB |

自动基准只能证明代码路径和合成数据满足门槛，不能替代真实电脑连续运行验收。

## 建议真机验收步骤

1. 关闭两台电脑上正在运行的旧主机端或学生端；不要删除原有 `%APPDATA%`、学生档案和授权记录。
2. 主机电脑运行主机端候选 EXE，学生电脑运行学生端候选 EXE；确认关于页或文件属性显示 `0.17.8`。
3. 选择一个明确的测试学生，启用屏幕连续采集，连续进行窗口切换、课程浏览和 Agent 学习操作至少 30 分钟。
4. 检查时间线是否持续增量出现，缩略图、时间、来源与学生归属是否正确；切换到另一学生后不得看到前一学生记录。
5. 快速滚动长时间线、切换模块、最小化与恢复窗口，观察是否出现明显卡顿、白屏或主进程无响应。
6. 在任务管理器记录启用前、运行 10 分钟和运行 30 分钟时的 CPU、内存和磁盘占用；资源曲线应趋于稳定，不应随事件数持续无界增长。
7. 重启双端，确认历史时间线可分页恢复、没有重复迁移，新的采集仍能继续追加。
8. 验证停止采集后不再新增记录；断网重连后仅恢复允许的同步，不串学生、不重复上传。

## 转正式版前置条件

- 双机覆盖运行、连续采集、重启恢复与学生隔离全部通过。
- 真机未出现明显 UI 卡顿，CPU、内存和磁盘占用无持续异常增长。
- 决定是否配置 Windows Authenticode 代码签名。
- 清理或确认脏工作区来源，形成可复现提交；再把候选状态改为正式状态，更新官网、版本清单并推送 Git。

## 审计文件

- 主机端：`release/windows/candidates/p0-timeline-acceptance/AI-edu-manager-console-Windows-0.17.8-p0-timeline-acceptance-build-audit.json`
- 学生端：`release/windows-terminal/candidates/p0-timeline-acceptance/AI-edu-manager-student-terminal-Windows-0.17.8-p0-timeline-acceptance-build-audit.json`
