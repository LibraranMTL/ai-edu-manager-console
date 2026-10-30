# Windows 0.22.7 P0 任务自动化与连接候选验收

验收完成时间：2026-10-28
候选标识：`p0-task-automation-r1-20261028`
结论：**本地候选验收通过；未签名、未上传、未部署、未更新正式发布清单。**

## 1. 状态边界

- 已实现：精确工作键冲突、派发阻断持久化与自动唤醒、回执核对零空写、WorkBuddy 健康与任务合同分离、多 Provider 屏幕视觉路由、Private LAN 防火墙诊断与显式修复。
- 已自动测试：全量 Node 测试、409 个 Windows 测试文件、类型检查、资源审计、任务/项目/资产基准和 P0 红绿门禁均通过。
- 已真实宿主验收：WorkBuddy/Codex 成功、明确失败、异常退出、结果未知、迟到回执、完整进程树、9 次两分钟性能矩阵和真实华为手机 Private LAN 配对/上传均通过。
- 已构建：便携 EXE、ZIP、安装包及审计文件均已生成；安装包从已接受便携包解包，不从工作树二次构建，246 个运行时文件保持不变。
- 未完成/不声明：没有 Authenticode 证书，因此 EXE 和安装包均为 `NotSigned`；没有上传服务器、部署、修改下载页或正式版本清单，也没有宣称客户正式验收。

屏幕视觉路由已通过 Provider 顺序、LLM API 图片能力、实际 Provider 记录和结果未知保护的自动化测试。隔离真实宿主没有配置可用于该合成截图的非 Codex 视觉 Provider，因此本轮没有把不存在的真实外部调用冒充通过；当存在合格 Provider 时，系统会按 WorkBuddy/已配置 Agent、LLM API、Codex 的受控顺序选择。

## 2. 回归与门禁

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | 通过，退出码 0 |
| `pnpm test:windows` | 通过，409/409 文件 |
| Windows 资源审计 | 通过，无缺失资源、重复媒体或未引用媒体候选 |
| 资产索引基准 | 通过 |
| 项目状态 30k/100k 基准 | 通过，100k 元数据更新 P95 1.716 ms，100 条定向更新 P95 5.754 ms |
| 任务 162/10k/100k 基准 | 通过，100k 当前页 P95 27.954 ms，100 条更新 P95 18.174 ms，事件循环最大 19.874 ms |
| P0 correctness / stability / causal | 全部通过 |
| P0 release | 通过；Task 12、包来源及因果证据齐全 |

全量测试中修正了五处已经落后于当前合同的测试夹具：回执监听改为有限退避后，旧测试仍断言 10 秒/60 秒固定扫描；两个 VM 测试缺少新增纯函数依赖。修正仅更新测试合同和夹具注入，没有放宽生产断言。

## 3. 真实宿主结果

- WorkBuddy 成功和 Codex 成功各只提交一次；Codex 在 Windows OS sandbox 不可用时按既定 `host-mediated-no-tools` 降级，不伪造 sandbox 成功。
- 明确失败和异常退出可以结束并按剩余预算回退；结果未知只核对一次原 Provider，不切换 Agent、不重复发送。
- 不同工作键从 `auto_wake_queued` 到 `task_prepared` 为 8424 ms；相同工作键继续保存 `execution_unknown_same_work` 阻断证据。
- 9 次两分钟性能矩阵全部通过；`Responding=False` 为 0，Renderer P95 0.1–0.2 ms，空闲未知结果语义哈希不变。
- `HUAWEI TAS-AL00` 在同一 Private Wi-Fi 从 `192.168.3.181` 完成主机配对、授权、健康检查和合成 WebP 上传；上传账本、登记和落盘文件 SHA-1/SHA-256 一致，正式学生数据未被触碰。
- 防火墙产品规则仅为 `Private + LocalSubnet` 的 TCP 18777 和 UDP 18778，重复规则为 0；旧规则只诊断不删除。

## 4. 候选包身份

| 产物 | 字节 | SHA-256 | Authenticode |
|---|---:|---|---|
| `AI-edu-manager-console-Windows-0.22.7-p0-task-automation-r1-20261028.exe` | 98,964,352 | `F12ECEE9A419145A967767626E25044DD610CDDA40639676BDB40BAE7E1574BB` | `NotSigned` |
| `AI-edu-manager-console-Windows-0.22.7-p0-task-automation-r1-20261028.zip` | 98,972,695 | `D97FA04A099A7EE688604786A913D03999BAEABF8C540AF13D6C674676DA8F7A` | 不适用 |
| `installer/AI-edu-manager-console-Windows-0.22.7-p0-task-automation-r1-20261028-Setup.exe` | 99,677,215 | `15E34FB3CA8DAD8398ABED0B4F71054E16030C51B402D95F44DEB8B4E4BE1B61` | `NotSigned` |

- `app.asar`：19,199,205 字节，SHA-256 `F9A1603D68892C525DDF6F6EBC092D6D32F5BDB6D90F92CACD7203A2E234E16D`。
- ASAR 内嵌版本：`0.22.7`；source map 数量：0。
- 防火墙脚本：4110 字节，SHA-256 `386AAFB79EE40E0BB3D04471E4A92999142692EE643BE9C6CE754CE19ECCEF45`；位于 `app.asar.unpacked/electron/windows-firewall.ps1`，运行时优先解析该真实路径。
- 三层密钥扫描：源码 0、暂存运行时 0、候选包 0。
- 最终便携 EXE 本体使用隔离用户目录启动成功：Renderer 为 `complete`，项目子系统为 `ready`，Private 防火墙规则为 2 条且重复规则为 0；启动文件 SHA-256 与构建审计一致。
- 构建来源：Git commit `1bc23c68d09c495bd0f9d2800ccbe1d46b5c937e`，构建时工作区状态 SHA-256 `4A419D36BB60744D6E43246E45D65A6EB52F53DFDE177884BC6858E2978B9E58`。工作区为 dirty，审计记录了 297 个路径；这不是干净提交构建，不能省略该边界。

## 5. 包体差异

相对 `0.22.6 print-task-closure-r2`：

- 便携 EXE 增长 6204 字节；
- ZIP 增长 4948 字节；
- 安装包增长 8597 字节。

三项均低于 200 KiB 解释门槛，也远低于 1 MiB 拒绝门槛。没有新增生产依赖。EXE/ZIP 均低于解除硬限制后的 100,000,000 字节目标，但超过 95,000,000 字节预警线；主要体积仍来自既有 Electron、PDF/Canvas 运行时和按需图形依赖，本轮增量不是这些依赖的新增副本。

## 6. 证据与停线边界

- 真实宿主清单：`artifacts/p0-host-acceptance-20261028/manifest.json`。
- 手机验收：`artifacts/p0-host-acceptance-20261028/phone-acceptance.json`。
- 性能矩阵：`artifacts/p0-host-acceptance-20261028/performance-2min-x3/performance-summary.json`。
- 最终回归：`artifacts/p0-red-gate-20261025/p0-release-regression.json`。
- 构建审计：候选目录中的 `*-build-audit.json`；安装包审计：`installer/installer-audit.json`。

如果后续需要正式发布，必须另行获得明确授权，并至少完成签名决策、正式数据升级演练和下载页/发布清单的原子更新。本次不执行这些操作。


## 2026-10-29 验收边界勘误

原测试结果保留，但 overall P0 未完成。正常/积压性能夹具使用 internal 任务，不能替代真实 Agent 吞吐；失败矩阵的注入与 Node 进程异常不能统一称为 WorkBuddy/Codex 真宿主五类闭环；Renderer setTimeout 指标不等于用户点击响应；完成预期数量不足以推导吞吐下降0%。0.22.8 将分别复验，未运行项保持 not_run。

## 2026-10-30 同源边界补充

0.22.7 的候选结果继续作为历史证据保留，不外推为当前 0.22.8 源码已经通过。当前运行 r13 与隔离源码的逐字节对应尚未建立；内部任务、注入异常和短时响应样本不能替代真实 Agent 同候选闭环、吞吐基线和用户可见交互。后续只追加新证据，不改写原始 JSON 或旧结论。
