# Windows 主机版 0.19.5 正式发布记录

日期：2026-10-01。Windows versionCode：245。

## 发布范围

本版只更新 Windows 主机端，修复“AI 会话自动采集”投递目标下拉菜单在会话较多或后台刷新时卡顿、偶发无法点击的问题。Android、Windows 轻终端和云端服务不升级。

正式产物保持既有便携形式：EXE 可直接运行，ZIP 内只包含同一 EXE。官网、服务器和 Git 状态分别记录，不以生成本地包替代线上发布验收。

实施前备份位于 `.codex_tmp/windows-0.19.5-formal-20261001/`，其中保存拟修改文件、SHA-256 和构建前 Git 状态。当前工作树包含其他未提交成果，本次不清理、不重置、不纳入包体。

## 修复与行为

- 会话状态读取由同步 IPC 改为异步 IPC，读取路径不再同步处理生命周期队列。
- 列表返回界面实际需要的数据并限制为当前可见会话；重复刷新合并，内容未变化时不触发状态更新。
- 投递目标选择状态位于独立会话行，避免切换下拉框时重渲染整个主页面。
- 投递成功后会话继续保留在列表，显示投递次数和回执；只有明确移入回收站或受控删除后才离开列表。

## 校验结论

最终正式构建完成于 `2026-10-01T13:15:05.209Z`，`candidateTag` 为空。

| 本地产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.19.5.exe` | 98952684 | `134F0139BABE154140B032034554F5E154F0BCA81F10243EB95C08400A728B9A` |
| `release/windows/AI-edu-manager-console-Windows-0.19.5.zip` | 98963789 | `586FFC93EE2040AB4A8DC225EE0E0DB896F2A917DBE34431BE428CE01C5C93C5` |

- 最终 `pnpm build:win` 退出码为 0；全量 Node 测试共 1736 项，1735 通过、1 项按平台条件跳过、0 失败。首次进入正式流程时，下载页合同因新版 ZIP 尚未生成而失败；先由同一受审计脚本生成启动产物后，重新执行完整流程并通过，启动产物不是最终交付件。
- Vite 生产构建通过；仅保留既有大分块提示，不是构建错误。
- 构建审计：源码 288 文件、暂存运行时 502 文件、2 个包体对象的敏感信息特征扫描均为 0 发现；ASAR 299 个文件，未携带外部 `node_modules` 运行时。
- EXE 的 FileVersion／ProductVersion 均为 `0.19.5`；Authenticode 状态为 `NotSigned`。
- ZIP 只有一份 `AI-edu-manager-console-Windows-0.19.5.exe`；包内 EXE 的字节数和 SHA-256 与正式 EXE 完全一致。
- 使用独立非敏感 `--user-data-dir` 启动正式 EXE，远程调试端点返回页面标题“AI教育管家控制台”，页面从便携包解出的 `app.asar/dist/index.html` 加载。验证结束后已停止本次启动的相关进程；未访问真实学生资料。
- 构建来源为提交 `2bbecc02b9544523cc82bd29c357a5117c2c86bf` 上的脏工作树；构建审计记录 6575 个变更／未跟踪路径。其他开发成果被保留，不能把本次包描述为干净提交的可复现产物。
- 0.19.5 真机完整业务复测：未验收；本记录及同批代码、版本资料将在同一提交推送到 `release/windows-0.6.5-cleanup`；Android、Windows 轻终端与云端应用不升级。

## 官网与服务器发布

- 已发布到迁移后的阿里云青岛实例 `i-m5e6r68cl11nbh2y0o6z`（实例名 `iZm5e6r68cl11nbh2y0o6zZ`，公网 IP `47.104.192.137`），未操作旧实例。
- 正式下载地址：`https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.5.exe` 和 `https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.19.5.zip`。
- 官网下载页、两份 Windows 主机手册及 `/education/`、`/download/` 下的版本清单已更新；版本清单保持其他客户端字段不变，只更新 Windows 版本、下载地址和说明。
- 发布前备份保留在服务器 `/www/backup/ai-edu-0.19.5-20261001-213442-qingdao/`；上传暂存目录在哈希及公网验收通过后已删除。
- 服务器落盘 SHA-256、公网下载页／手册／版本清单正文 SHA-256 均与本地发布源一致；公网 EXE／ZIP 的 `Content-Length` 分别为 `98952684` 和 `98963789` 字节，分段读取返回 HTTP 206。
- Web 服务配置未改变，无需重启或重载。Authenticode 仍为 `NotSigned`，不将其表述为已签名。
