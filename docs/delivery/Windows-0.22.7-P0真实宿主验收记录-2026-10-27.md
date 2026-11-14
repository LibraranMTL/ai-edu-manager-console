# Windows 0.22.7 P0 真实宿主验收记录

验收日期：2026-10-28
状态：**Task 12 已通过；Agent、调度、性能及真实手机 Private LAN 配对/上传均通过。最终 `0.22.7` 本地候选已构建并通过包级审计；候选未签名、未上传、未部署、未发布。**

## 1. 验收边界

- 使用隔离的 `%TEMP%\edu-p0-*` 合成用户目录；未读写正式学生正文、正式项目资料或正式任务库。
- WorkBuddy/Codex 使用真实本机宿主；所有材料均为合成探针。
- 预检运行时来自 `p0-native-preflight-r12-20261028`，便携 EXE SHA-256 为 `D82D0FFC1DCCBC7C46501FCDCBE1EEBCC27CC259E968AA2E8047FA6FC9DD6931`。
- 调度时序热修复已进入最终 `0.22.7-p0-task-automation-r1-20261028` 候选；包级版本、运行时哈希和三件套哈希见候选验收记录。

## 2. Agent 五类结果

| 场景 | 结果 | 关键断言 |
|---|---|---|
| WorkBuddy 成功 | 通过 | 真实认证和资格通过，原件未变化，主机仅提交一次 |
| Codex 成功 | 通过（降级隔离） | 结果提交一次；Windows OS sandbox 不可用时使用 `host-mediated-no-tools`，未改原件 |
| 明确失败 | 通过 | WorkBuddy/Codex 各调用一次；明确失败可退出，不制造未知批次 |
| 异常退出 | 通过 | 退出码 23 被识别为明确失败 |
| 结果未知 | 通过 | 只调用 WorkBuddy 一次，未盲目切换 Codex |
| 迟到回执 | 通过 | delivery/reconcile/settlement 各一次，重复投递为 0 |

原始证据：`workbuddy-success.json`、`codex-success.json`、`failure-matrix.json` 和两份完整进程树。

## 3. 精确工作键调度回归

第一次完整应用夹具无效：人工塞入的周任务并非当前周期候选，生产候选刷新将其退出；没有资料投影的消化任务被正确结算为 `no_work`。该结果已记录在 `live-dispatch-fixture-validity.json`，没有据此修改生产代码。

使用真实候选生成链重新复现后发现并修复启动时序问题：任务在执行面就绪前 2 秒入队，首次被冷却阻断后又受到 15 秒队列排空间隔，准备延迟约 17 秒。修复后首次入队直接钳制到执行面就绪时刻，保留正常运行的 15 秒合并限制。

复验结果：

- 不同工作键：未知消化任务保持 `cancelled + recoveryState=unknown`，周任务从 `auto_wake_queued` 到 `task_prepared` 为 **8424 ms**，通过 10 秒门槛。
- 相同工作键：候选保持 `pending`，持久化 `dispatchBlock.code=execution_unknown_same_work`、阻断任务 ID 和 `nextCheckAt`，没有重复执行。

证据：`live-different-work-fixed.json`、`live-same-work-fixed.json`。

## 4. 2 分钟性能矩阵

三个场景各重复三次，共九次：

- 空闲未知结果：主进程单核 CPU 平均 0.51%–0.74%，语义哈希三次均不变。
- 正常任务：CPU 平均 0.79%–0.85%，三次均由 pending 进入 succeeded。
- 12 项积压：CPU 平均 1.06%–1.17%，三次均完成 12/12。
- 九次 `Responding=False` 样本均为 0；Renderer P95 为 0.1–0.2 ms；最大私有内存约 139 MiB。

证据：`performance-2min-x3/performance-summary.json`。

## 5. WorkBuddy 状态分离

- 轻量连接检查耗时 0.083 ms，未调用模型合同。
- 强制输出预算超限与资格超时只将 classification profile 标为未通过。
- digest profile 保持 ready；未知发送不触发 Provider 回退。

证据：`packaged-workbuddy-health.json`、`packaged-workbuddy-profile-isolation.json`。

## 6. 手机连接

当前隔离主机服务已监听 TCP 18777 和 UDP 18778，并提供一个合成学生。2026-10-28 18:20 后，用户已将 WLAN `liliistudio 3` 改为 **Private**，并关闭手机移动数据、连接同一 Wi-Fi。两条稳定产品规则已实际创建并只允许 `Private + LocalSubnet`：TCP 18777、UDP 18778；本机通过 WLAN 地址 `192.168.3.55:18777` 的 TCP 探测成功。

验收同时发现预检候选的防火墙辅助脚本路径解析缺陷：`windows-firewall.ps1` 已正确进入 `app.asar.unpacked`，但运行时代码优先选择了 `app.asar` 虚拟路径，导致 PowerShell `-File` 报“路径不存在”。该缺陷已增加回归测试并修正为打包环境优先解析 `app.asar.unpacked`；源码脚本已成功建立上述两条规则，最终候选也通过了脚本哈希和打包路径审计。真实手机配对、主机授权、健康检查和上传回执均已完成。

剩余步骤：

1. ~~用户将当前 Wi-Fi 改为专用网络，手机关闭移动数据并连接同一 Wi-Fi。~~ 已完成。
2. ~~执行防火墙修复，用户确认 UAC。~~ 已通过源码中的同版脚本完成；候选包路径缺陷已修复并由自动测试覆盖。
3. ~~验证两条产品规则、Private、LocalSubnet、TCP 18777/UDP 18778；旧规则只诊断不删除。~~ 已完成。
4. ~~手机发起配对，主机 `pair-requests.json` 出现新的真实请求并由主机授权。~~ 已完成：`HUAWEI TAS-AL00`（Android，协议 v2）从 `192.168.3.181` 发起，请求经历 `pending_host_accept → accepted`，设备登记为在线共享终端；未复用 API Token。
5. ~~上传一份合成资料并核对回执。~~ 已完成：手机向 `P0合成学生01` 上传 9304 字节 WebP；主机上传账本、资料登记和实际文件的 SHA-1/SHA-256 一致，文件位于隔离临时夹具而非正式学生根目录。证据见 `artifacts/p0-host-acceptance-20261028/phone-acceptance.json`。

手机上传后隔离夹具按现有自动化规则创建了消化批次；夹具没有授权 Agent，因此消化提示执行器不可用。该状态不影响 Private LAN 配对、授权和上传验收，也没有被误报为消化成功。Task 12 的真实宿主阻断已解除；Task 13 的完整回归、版本升级、候选构建及包级审计随后均已完成。

## 7. 停线检查

目前未观察到重复 Agent 调用、未知结果保护丢失、跨学生访问、正式物理原件变化、空闲语义写循环、Provider 顺序被修改或手机规则过度暴露。Task 12 结论为通过；该结论允许本地候选构建和验收，不授权上传、部署或正式发布。


## 2026-10-29 验收边界勘误

原测试结果保留，但 overall P0 未完成。正常/积压性能夹具使用 internal 任务，不能替代真实 Agent 吞吐；失败矩阵的注入与 Node 进程异常不能统一称为 WorkBuddy/Codex 真宿主五类闭环；Renderer setTimeout 指标不等于用户点击响应；完成预期数量不足以推导吞吐下降0%。0.22.8 将分别复验，未运行项保持 not_run。

## 2026-10-30 同源边界补充

当前运行的 r13 EXE 哈希已经重新记录，但尚无构建审计证明它与当前隔离源码逐字节同源。旧任务时间线可用于定位首个不良转换，不能作为当前源码修复后的通过证据。WorkBuddy/Codex 五类真实宿主结果、可见交互和同窗口吞吐仍由 0.22.8 Task 8 重跑；未重跑项保持 `not_run`。
