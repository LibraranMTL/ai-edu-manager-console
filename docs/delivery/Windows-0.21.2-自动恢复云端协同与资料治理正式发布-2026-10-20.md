# Windows 0.21.2 自动恢复、云端协同与资料治理正式发布

日期：2026-10-20  
发布口径：官网受控正式分发；Windows Authenticode 仍为 `NotSigned`。

## 1. 发布范围

本次将 0.21.1 之后工作树中尚未发布的 Windows 主机功能整理为 0.21.2：

- 一次授权长期复用、合同自动复核及明确的重新授权边界；
- 全局授权下的多学生项目范围冻结、发送前/提交前复核与结果隔离；
- 旧路径误判防护、空任务收敛、任务状态统一及未知结果有界核对；
- 云端连接与授权、同步结果和成果收件箱二级页面；默认只授权学情报告，健康资料独立授权；
- 云端 v2 材料、修订、授权、回执、游标、自动建档及远程 Agent 收件箱合同；
- Agent 伴侣工具条、Skills 扫描/存档/浏览/受控安装和回滚；
- SQLite 资料索引、在线备份、旧索引迁移、重复资料隔离/恢复和异步重型 IPC；
- 100,000,000 字节包体上限及 PDF/OCR、字体、语言和原生组件保留检查。

Android 单机版 1.2.8 的未发布源码同时纳入 Git 归档，但本次没有把未签名 Android 候选替换为公网正式版。

## 2. 构建来源与验证

- 源码提交：`ed1e2542280cff6b82eec8568daa6e0107f0762a`
- 构建工作树：隔离 worktree，`dirty=false`，变更路径 `0`
- 全量 Node 回归：2400 项，2399 通过，0 失败，1 条 Windows 条件跳过
- 构建敏感信息检查：源码 466 文件、暂存运行时 743 文件、两个成品均为 0 发现
- 包内资源：151/151 可达；无散落 `node_modules`
- Skills 包内验证：快照、Worker 扫描、ZIP 解包、Zip Slip 阻断、自定义存档目录迁移与重启后续写通过
- 隔离 EXE 启动：版本 0.21.2 可见；异步/同步状态一致；空 SQLite 索引健康；工具条、合成学生切换、本人项目允许和外来项目拒绝通过

隔离启动使用合成学生和独立用户目录，不等于真实摄像头、真实学生许可证、全部外部 Agent 或所有硬件组合均已验收。

## 3. 正式产物

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `AI-edu-manager-console-Windows-0.21.2.exe` | 99,891,333 | `20E12EAAD035D7527D7574B7E95747861D73327D082446A75015CBEF3C93648B` |
| `AI-edu-manager-console-Windows-0.21.2.zip` | 99,900,171 | `B553BA3EA8227291B8AA243444246533BB45E89D2C4AFCBA027FFE33FD8614FC` |

EXE 文件版本、产品版本均为 0.21.2，公司元数据为 Robogala；独立 Windows 验证结果为 `Authenticode=NotSigned`。ZIP 中只有同一份正式 EXE。

## 4. 官网与服务器发布

- ECS：`i-m5e6r68cl11nbh2y0o6z`，区域 `cn-qingdao`
- 官网：`https://www.greatbg.com/education/download.html`
- 下载清单：`https://www.greatbg.com/download/edu-manager-version.json`
- 主机手册：`https://www.greatbg.com/education/windows-host-manual.html`
- 回滚备份：`/www/backup/edu-manager-windows-0.21.2-pre-20261020135911`
- 已清理 staging：`/tmp/edu-manager-windows-0.21.2-20261020`

服务器 staging 和正式文件的八项 SHA-256 均与本地发布清单一致。公网下载页、主机手册和两份版本清单正文哈希一致；EXE 与 ZIP 均为 HTTP 200，`Content-Length` 与本地字节数一致。线上清单返回 `0.21.2 / 262 / stable`。

云端服务仍为 2.1.0 且健康；当前生产目录的云端运行文件逐项哈希与本地源码一致，因此本次没有无意义地重启或重复部署云服务。

## 5. 明确边界

- Windows 正式包没有公共 Authenticode 证书，只能从官网及已知来源受控分发；安装时可能显示未知发布者。
- 云端健康资料对象同步、全部新增资料类别的自动业务投影、OAuth/PKCE 和两台真实主机的完整远程 Agent 闭环仍按试点边界表述。
- 服务器根分区发布后只剩约 504 MB（99% 使用），旧 0.21.1 包和回滚备份为了可恢复性继续保留；扩大分发前应扩容或制定经确认的历史包保留策略。
