# Windows 0.23.3 项目综合报告与学情工作台正式发布记录

## 发布基线

- 源码分支：`codex/project-report-workbench-0233`
- 构建提交：`953a313f4afdd55478efc01c9f9799c9a83e8738`
- 正式版本：Windows `0.23.3`，稳定清单版本码 `272`
- 生产实例：阿里云青岛 `i-m5e6r68cl11nbh2y0o6z`；未访问或同步退役北京实例。

## 发布内容

- 项目综合报告增加结构化成功标准、主机数值验证、带证据与反例的 AI 描述性推定、迭代时间线、参与分层和下一行动转任务。
- “首页”升级为“学情工作台”；学习闭环显示当前学生的真实处理数量，并与单学生本周资料上传统计并列展示；移除“更多快捷入口”。
- “学情与学习”在“学习卡片”后增加独立“学习模式”页面，复用工具条的学习、互动、测验、核验和计划动作及同一提示词生成边界。
- 修复推荐选题后台更新期间“采用”按钮被全局忙碌状态锁死的问题；采用操作使用独立状态并防止重复提交。
- 真人专家咨询继续复用授权上传流程，按学生长期保留咨询范围草稿，撤权只锁定、不删除。

## 自动化、性能与精确运行时验收

- TypeScript 检查通过；Windows 全量回归 `470/470` 通过；资源审计通过。
- 资产 5,000、项目 30,000/100,000、任务 162/10,000/100,000 三类性能门禁最终均通过。
- 正式构建审计记录源码树干净：`dirty=false`、`changedPathCount=0`；源码、暂存和包体敏感信息扫描均为 0 项。
- `app.asar` SHA-256 为 `45E3DACA3E98FB3C7A35C5B0F04DFA7AB3EAC78A8E9C92AFD0A89732DC46D7D8`。
- 同一 `app.asar` 完成 Codex 三轮、WorkBuddy 三轮纯合成资料真实闭环；每轮均包含认领、发送意图、真实进程、回执、主机提交和结算，且 `formalStudentDataTouched=false`。
- 安装包在隔离目录完成两次静默安装/覆盖安装，退出码均为 0；安装后运行时哈希与已验收候选一致，独立用户数据标记保持不变，隔离启动的进程已关闭。
- 新验收索引在 `stage=release` 下通过：6 个真实 Agent 场景、25 项矩阵、安装升级和三类打包证据均有效。

## 正式产物

| 文件 | 字节数 | SHA-256 | Authenticode |
| --- | ---: | --- | --- |
| `AI-edu-manager-console-Windows-0.23.3-Setup.exe` | 99,774,207 | `709B83820A927071250C4A49811DCD7DB3AB40340F762DFA06CDFEFB9116329E` | `NotSigned` |
| `AI-edu-manager-console-Windows-0.23.3.exe` | 99,128,642 | `E0BF3B37382AC4DD315A5073F1B3F0EA5FF472FAED2F69BBCDA465EA58DB1BEB` | `NotSigned` |
| `AI-edu-manager-console-Windows-0.23.3.zip` | 99,137,808 | `2B0BCB3B9FD26D45C4181768FE32D6F1CE2D8096624F58FBBE919E2A54496B81` | 不适用 |

正式安装器从已验收便携运行时封装，封装前后 246 个运行时文件完全一致；没有重新编译业务源码。

## 阿里云正式发布

- 站点根目录：`/www/wwwroot/123.56.83.50`。
- 回滚备份：`/www/backups/windows-0.23.3-20261105-953a313`，保留发布前下载页、两份清单、0.23.1 三个 Windows 包和哈希清单。
- 上传暂存：`/tmp/edu-manager-windows-0.23.3-20261105-953a313`；上传后逐文件核对 SHA-256、JSON 和页面引用，再通过同目录临时文件原子切换。公网验收通过后已删除该精确暂存目录。
- 正式文件：三个 Windows 包位于 `/download`；客户端清单位于 `/download/edu-manager-version.json`，产品页清单和下载页位于 `/education`。

## 公网验收

- `https://www.greatbg.com/education/download.html` 返回 HTTP 200，正文 SHA-256 为 `44BED7CE41B92F2B8880CAB495F808BBB2006CFB32B9729780CEEF81D0789915`，并引用 0.23.3 的 Setup、EXE 和 ZIP。
- `/download/edu-manager-version.json` 与 `/education/edu-manager-version.json` 内容一致，正文 SHA-256 为 `6443EFDC2DE571C20AADEBA7C7D9669B95325AE9CFD59C334A36F6EF740F46C9`，Windows 字段为 `0.23.3 / 272 / stable`。
- 三个公开下载地址均返回 HTTP 200，`Content-Length` 分别为 99,774,207、99,128,642 和 99,137,808 字节。
- 安装包从公网完整反向下载后的 SHA-256 为 `709B83820A927071250C4A49811DCD7DB3AB40340F762DFA06CDFEFB9116329E`，与本地构建和服务器实时文件完全一致。

## 剩余边界

- Windows 安装包和便携 EXE 仍未进行 Authenticode 签名；下载页与清单已明确提示未签名状态。
- 本记录的隔离安装升级与真实 Agent 闭环使用合成资料，不等同于真实学生资料的长期质量评估。
